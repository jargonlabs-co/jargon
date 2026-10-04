import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type pg from 'pg'
import { PgStore, type PgPoolLike } from '../src/server/pgStore.ts'
import { migrateDatabase } from '../src/server/store.ts'
import { runOutboundSchedulerTick } from '../src/server/scheduler.ts'
import { loadConfig } from '../src/server/config.ts'
import type { Activity, Database, Message } from '../src/server/types.ts'

type StateRow = { data: unknown; version: number; writer_epoch: number; storage: 'row' | 'records' }
type RecordRow = { collection: string; id: string; org_id: string | null; seq: number; data: unknown }

/** In-memory Postgres that understands exactly the statements PgStore and db-state issue. */
function fakePostgres(initial?: Partial<StateRow>) {
  let state: StateRow | null = initial
    ? { data: {}, version: 0, writer_epoch: 0, storage: 'row', ...initial }
    : null
  const records = new Map<string, RecordRow>()
  const snapshots: Array<{ id: number; data: unknown; version: number; reason: string }> = []
  const writes: Array<{ upserts: number; deletes: number }> = []
  const result = <R extends pg.QueryResultRow>(rows: unknown[]) =>
    ({ rows, rowCount: rows.length }) as unknown as pg.QueryResult<R>
  const query = async <R extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim()
    if (/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|CREATE TABLE)/.test(sql)) return result<R>([])
    if (sql.startsWith('INSERT INTO jargon_state_snapshots')) {
      const reason = sql.includes("'boot'") ? 'boot' : sql.includes("'pre-restore'") ? 'pre-restore' : String(values[1])
      const id = snapshots.length + 1
      snapshots.push({ id, data: JSON.parse(values[0] as string), version: state?.version ?? 0, reason })
      return result<R>([{ id }])
    }
    if (sql.startsWith('DELETE FROM jargon_state_snapshots')) {
      const [reason, keep] = values as [string, number]
      const keepIds = snapshots.filter((s) => s.reason === reason).map((s) => s.id).slice(-keep)
      for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].reason === reason && !keepIds.includes(snapshots[i].id)) snapshots.splice(i, 1)
      }
      return result<R>([])
    }
    if (sql.startsWith('SELECT EXTRACT')) {
      return result<R>([{ age_ms: snapshots.some((s) => s.reason === values[0]) ? 0 : null }])
    }
    if (sql.startsWith('INSERT INTO jargon_state ')) {
      if (!state) state = { data: JSON.parse(values[1] as string), version: 0, writer_epoch: 0, storage: 'records' }
      return result<R>([])
    }
    if (sql.startsWith('UPDATE jargon_state SET writer_epoch')) {
      state!.writer_epoch += 1
      return result<R>([{ writer_epoch: state!.writer_epoch }])
    }
    if (sql.startsWith('UPDATE jargon_state SET version')) {
      state!.version += 1
      state!.storage = 'records'
      writes.push({ upserts: 0, deletes: 0 })
      return result<R>([])
    }
    if (sql.startsWith('SELECT data, storage, version FROM jargon_state')) {
      return result<R>(state ? [{ data: structuredClone(state.data), storage: state.storage, version: state.version }] : [])
    }
    if (sql.startsWith('SELECT writer_epoch')) return result<R>([{ writer_epoch: state!.writer_epoch }])
    if (sql.startsWith('SELECT collection, seq, data FROM jargon_records')) {
      const rows = [...records.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.seq - b.seq)
      return result<R>(rows.map((r) => ({ collection: r.collection, seq: r.seq, data: structuredClone(r.data) })))
    }
    if (sql === 'DELETE FROM jargon_records') {
      records.clear()
      return result<R>([])
    }
    if (sql.startsWith('DELETE FROM jargon_records r USING')) {
      const rows = JSON.parse(values[0] as string) as Array<{ collection: string; id: string }>
      for (const r of rows) records.delete(`${r.collection}/${r.id}`)
      pending.deletes += rows.length
      return result<R>([])
    }
    if (sql.startsWith('INSERT INTO jargon_records')) {
      const rows = JSON.parse(values[0] as string) as RecordRow[]
      for (const r of rows) {
        const key = `${r.collection}/${r.id}`
        const existing = records.get(key)
        records.set(key, { ...r, seq: existing?.seq ?? r.seq })
      }
      pending.upserts += rows.length
      return result<R>([])
    }
    throw new Error(`fake postgres: unhandled ${sql.slice(0, 80)}`)
  }
  let pending = { upserts: 0, deletes: 0 }
  const tracked = async <R extends pg.QueryResultRow>(text: string, values?: unknown[]) => {
    const out = await query<R>(text, values)
    if (text.includes('UPDATE jargon_state SET version')) {
      writes[writes.length - 1] = pending
      pending = { upserts: 0, deletes: 0 }
    }
    return out
  }
  const pool: PgPoolLike = {
    query: tracked,
    async connect() {
      return { query: tracked, release() {} }
    },
    async end() {}
  }
  return {
    pool,
    records,
    snapshots,
    writes,
    get state() {
      return state!
    }
  }
}

const empty = () => migrateDatabase({}) as Database
const org = (id: string) => ({ id, name: id, slug: id, createdAt: 0, updatedAt: 0 }) as Database['orgs'][number]
const activity = (id: string): Activity => ({ id, orgId: 'org_a', projectId: 'p1', kind: 'note', summary: id, createdAt: 0 })

describe('Postgres store ownership', () => {
  it('a newer process fences the old one: its writes are dropped and it reports not-writer', async () => {
    const fake = fakePostgres()
    const oldStore = await PgStore.open(fake.pool, empty())
    let fenced = 0
    oldStore.onFenced = () => {
      fenced += 1
    }
    oldStore.update((db) => {
      db.orgs.push(org('org_before'))
    })
    await oldStore.flush()
    assert.equal(await oldStore.isWriter(), true)

    const newStore = await PgStore.open(fake.pool, empty())
    assert.deepEqual(newStore.db.orgs.map((o) => o.id), ['org_before'], 'new process sees prior writes')

    oldStore.update((db) => {
      db.orgs.push(org('org_stale'))
    })
    await oldStore.flush()
    assert.equal(fenced, 1)
    assert.equal(await oldStore.isWriter(), false)
    assert.equal(fake.records.has('orgs/org_stale'), false, 'stale write did not reach the database')

    newStore.update((db) => {
      db.orgs.push(org('org_after'))
    })
    await newStore.flush()
    assert.equal(await newStore.isWriter(), true)
    assert.deepEqual([...fake.records.keys()].filter((k) => k.startsWith('orgs/')).sort(), ['orgs/org_after', 'orgs/org_before'])
  })

  it('snapshots the previous state on boot and daily, and only the owner snapshots', async () => {
    const fake = fakePostgres()
    const first = await PgStore.open(fake.pool, empty())
    first.update((db) => {
      db.orgs.push(org('org_1'))
    })
    await first.flush()
    assert.ok(await first.snapshot('daily', { minAgeMs: 1000 }))
    assert.equal(await first.snapshot('daily', { minAgeMs: 1000 }), null, 'skips when a recent one exists')

    const second = await PgStore.open(fake.pool, empty())
    const boots = fake.snapshots.filter((s) => s.reason === 'boot')
    assert.equal(boots.length, 2)
    assert.deepEqual((boots[1].data as Database).orgs.map((o) => o.id), ['org_1'], 'boot snapshot holds prior state')
    assert.equal(await first.snapshot('daily'), null, 'a fenced process does not snapshot')
    assert.ok(await second.snapshot('daily'))
  })

  it('validates backup files before restore', async () => {
    const { validateState } = await import('./db-state.ts')
    assert.throws(() => validateState([]), /JSON object/)
    assert.throws(() => validateState({ users: [], orgs: [] }), /memberships/)
    const ok = validateState({ users: [], orgs: [], memberships: [] })
    assert.deepEqual(ok.suppressions, [])
  })

  it('a replaced process stops sending queued messages', async () => {
    const fake = fakePostgres()
    const oldStore = await PgStore.open(fake.pool, empty())
    oldStore.update((db) => {
      db.messages.push({
        id: 'msg_1',
        orgId: 'org_a',
        projectId: 'p1',
        contactId: 'ct_1',
        subject: 'Hi',
        body: 'Hello',
        status: 'queued',
        channel: 'email',
        mode: 'demo',
        sandbox: true,
        createdAt: 0,
        updatedAt: 0,
        sendAt: 0
      } as Message)
    })
    await oldStore.flush()
    await PgStore.open(fake.pool, empty())

    const billing = {} as Parameters<typeof runOutboundSchedulerTick>[2]
    const sent = await runOutboundSchedulerTick(oldStore, loadConfig(), billing)
    assert.equal(sent, 0)
    assert.equal(oldStore.db.messages[0].status, 'queued')
  })
})

describe('per-record storage', () => {
  it('migrates the legacy single row into one row per record, tagged by org', async () => {
    const legacy = migrateDatabase({
      orgs: [org('org_a'), org('org_b')],
      activities: [activity('act_3'), activity('act_2'), activity('act_1')],
      orgBilling: [{ orgId: 'org_a', plan: 'free', status: 'active', createdAt: 0, updatedAt: 0 }]
    } as Partial<Database>)
    const fake = fakePostgres({ data: legacy, storage: 'row' })
    const store = await PgStore.open(fake.pool, empty())
    assert.equal(fake.state.storage, 'records')
    assert.equal(fake.records.get('activities/act_1')?.org_id, 'org_a')
    assert.ok(fake.records.has('orgBilling/org_a'), 'billing rows are keyed by org')
    assert.deepEqual(store.db.activities.map((a) => a.id), ['act_3', 'act_2', 'act_1'])

    const reloaded = await PgStore.open(fake.pool, empty())
    assert.deepEqual(reloaded.db.orgs.map((o) => o.id), ['org_a', 'org_b'])
    assert.deepEqual(reloaded.db.activities.map((a) => a.id), ['act_3', 'act_2', 'act_1'], 'newest-first order survives')
  })

  it('writes only changed records and coalesces bursts of updates', async () => {
    const fake = fakePostgres()
    const store = await PgStore.open(fake.pool, empty())
    store.update((db) => {
      for (let i = 0; i < 50; i++) db.orgs.push(org(`org_${i}`))
    })
    await store.flush()
    const before = fake.writes.length

    store.update((db) => {
      db.orgs[3].name = 'Renamed'
    })
    store.update((db) => {
      db.activities.unshift(activity('act_new'))
    })
    store.update((db) => {
      db.orgs = db.orgs.filter((o) => o.id !== 'org_7')
    })
    await store.flush()
    const after = fake.writes.slice(before)
    assert.equal(after.length, 1, 'three updates, one database write')
    assert.deepEqual(after[0], { upserts: 2, deletes: 1 })

    const reloaded = await PgStore.open(fake.pool, empty())
    assert.equal(reloaded.db.orgs.find((o) => o.id === 'org_3')?.name, 'Renamed')
    assert.equal(reloaded.db.orgs.length, 49)
  })

  it('keeps newest-first order for items added after the migration', async () => {
    const fake = fakePostgres()
    const store = await PgStore.open(fake.pool, empty())
    for (const id of ['a1', 'a2', 'a3']) {
      store.update((db) => {
        db.activities.unshift(activity(id))
      })
      await store.flush()
    }
    const reloaded = await PgStore.open(fake.pool, empty())
    assert.deepEqual(reloaded.db.activities.map((a) => a.id), ['a3', 'a2', 'a1'])
  })

  it('rebuilds records from the single row after a restore', async () => {
    const fake = fakePostgres()
    const store = await PgStore.open(fake.pool, empty())
    store.update((db) => {
      db.orgs.push(org('org_live'))
    })
    await store.flush()
    // What `db:state restore` does: put the backup in the row and flag it.
    Object.assign(fake.state, { data: migrateDatabase({ orgs: [org('org_restored')] }), storage: 'row' })
    const restored = await PgStore.open(fake.pool, empty())
    assert.deepEqual(restored.db.orgs.map((o) => o.id), ['org_restored'])
    assert.equal(fake.records.has('orgs/org_live'), false)
    assert.equal(fake.state.storage, 'records')
  })
})
