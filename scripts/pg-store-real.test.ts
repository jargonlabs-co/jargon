import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { loadStoredState, PgStore, type PgPoolLike } from '../src/server/pgStore.ts'
import { migrateDatabase } from '../src/server/store.ts'
import { restoreState } from './db-state.ts'
import type { Activity, Database } from '../src/server/types.ts'

/** Real Postgres (WASM) behind the PgPoolLike interface. One connection, so tests stay sequential. */
async function realPostgres(): Promise<{ pool: PgPoolLike; db: PGlite }> {
  const db = await PGlite.create()
  const query = async <R extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
    if (!values.length && text.split(';').filter((s) => s.trim()).length > 1) {
      await db.exec(text)
      return { rows: [], rowCount: 0 } as unknown as pg.QueryResult<R>
    }
    const r = await db.query<R>(text, values)
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as unknown as pg.QueryResult<R>
  }
  return {
    db,
    pool: {
      query,
      async connect() {
        return { query, release() {} }
      },
      async end() {}
    }
  }
}

const empty = () => migrateDatabase({}) as Database
const org = (id: string) => ({ id, name: id, slug: id, createdAt: 0, updatedAt: 0 }) as Database['orgs'][number]
const activity = (id: string): Activity => ({ id, orgId: 'org_a', projectId: 'p1', kind: 'note', summary: id, createdAt: 0 })

describe('PgStore against real Postgres', () => {
  it('creates the schema, saves records, and reloads them', async () => {
    const { pool, db } = await realPostgres()
    const store = await PgStore.open(pool, empty())
    store.update((d) => {
      d.orgs.push(org('org_a'))
      d.activities.unshift(activity('a1'))
      d.activities.unshift(activity('a2'))
      d.usageDaily.push({ orgId: 'org_a', day: '2026-10-02', emails: 1, calls: 0, linkedin: 0, credits: 1 })
    })
    await store.flush()
    const rows = await db.query<{ collection: string; id: string; org_id: string }>(
      'SELECT collection, id, org_id FROM jargon_records ORDER BY collection, id'
    )
    assert.deepEqual(
      rows.rows.map((r) => `${r.collection}/${r.id}/${r.org_id}`),
      ['activities/a1/org_a', 'activities/a2/org_a', 'orgs/org_a/null', 'usageDaily/org_a:2026-10-02/org_a']
    )
    store.update((d) => {
      d.orgs = []
    })
    await store.flush()
    const reloaded = await PgStore.open(pool, empty())
    assert.deepEqual(reloaded.db.orgs, [])
    assert.deepEqual(reloaded.db.activities.map((a) => a.id), ['a2', 'a1'])
    assert.equal(reloaded.db.usageDaily[0].emails, 1)
  })

  it('migrates a legacy jargon_state row', async () => {
    const { pool, db } = await realPostgres()
    await db.exec(`CREATE TABLE jargon_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    const legacy = migrateDatabase({ orgs: [org('org_old')], activities: [activity('x2'), activity('x1')] })
    await db.query(`INSERT INTO jargon_state (id, data, version) VALUES ('main', $1::jsonb, 41)`, [JSON.stringify(legacy)])
    const store = await PgStore.open(pool, empty())
    assert.deepEqual(store.db.orgs.map((o) => o.id), ['org_old'])
    const meta = await db.query<{ storage: string }>(`SELECT storage FROM jargon_state WHERE id = 'main'`)
    assert.equal(meta.rows[0].storage, 'records')
    const boot = await db.query<{ data: Database }>(`SELECT data FROM jargon_state_snapshots WHERE reason = 'boot'`)
    assert.deepEqual(boot.rows[0].data.orgs.map((o) => o.id), ['org_old'], 'boot snapshot of the legacy state')
    const reloaded = await PgStore.open(pool, empty())
    assert.deepEqual(reloaded.db.activities.map((a) => a.id), ['x2', 'x1'])
  })

  it('fences the replaced process and restores from a backup', async () => {
    const { pool, db } = await realPostgres()
    const first = await PgStore.open(pool, empty())
    first.update((d) => {
      d.orgs.push(org('org_1'))
    })
    await first.flush()
    assert.ok(await first.snapshot('daily'))

    const second = await PgStore.open(pool, empty())
    first.update((d) => {
      d.orgs.push(org('org_stale'))
    })
    await first.flush()
    assert.equal(await first.isWriter(), false)
    const stale = await db.query(`SELECT 1 FROM jargon_records WHERE id = 'org_stale'`)
    assert.equal(stale.rows.length, 0)
    assert.equal(await second.isWriter(), true)

    await restoreState(pool, migrateDatabase({ orgs: [org('org_restored')] }))
    assert.equal(await second.isWriter(), false, 'restore fences the running API')
    const live = await loadStoredState(pool)
    assert.equal(live.storage, 'row')
    const third = await PgStore.open(pool, empty())
    assert.deepEqual(third.db.orgs.map((o) => o.id), ['org_restored'])
    const pre = await db.query<{ data: Database }>(`SELECT data FROM jargon_state_snapshots WHERE reason = 'pre-restore'`)
    assert.deepEqual(pre.rows[0].data.orgs.map((o) => o.id), ['org_1'])
  })
})
