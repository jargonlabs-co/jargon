import { createHash } from 'crypto'
import pg from 'pg'
import type { Database } from './types'
import type { DataStore } from './store'
import { migrateDatabase } from './store'

const { Pool } = pg

/** Fixed advisory lock key for the state (records + ownership row). */
const STATE_LOCK_KEY = 872_364_91
const ROW_ID = 'main'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jargon_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS writer_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'row';
CREATE TABLE IF NOT EXISTS jargon_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  org_id TEXT,
  seq BIGINT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS jargon_records_org ON jargon_records (org_id, collection);
CREATE TABLE IF NOT EXISTS jargon_state_snapshots (
  id BIGSERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  version BIGINT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

/** Snapshots kept per reason ('boot', 'daily', 'pre-restore'). */
export const SNAPSHOT_KEEP = 14
/** Collections the code keeps newest-first (`unshift`). */
const NEWEST_FIRST = new Set(['activities', 'calls', 'creditLedger', 'messages', 'projects'])
const WRITE_CHUNK = 500

/** The subset of pg.Pool the store uses (lets tests supply a fake). */
export interface PgPoolLike {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>
  connect(): Promise<{
    query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>
    release(): void
  }>
  end(): Promise<void>
}

type Queryable = Pick<PgPoolLike, 'query'>

export async function ensureStateSchema(db: Queryable): Promise<void> {
  await db.query(SCHEMA)
}

export const STATE_ROW_ID = ROW_ID
export const STATE_ADVISORY_LOCK = STATE_LOCK_KEY

async function pruneSnapshots(db: Queryable, reason: string, keep: number): Promise<void> {
  await db.query(
    `DELETE FROM jargon_state_snapshots WHERE reason = $1 AND id NOT IN
       (SELECT id FROM jargon_state_snapshots WHERE reason = $1 ORDER BY id DESC LIMIT $2)`,
    [reason, keep]
  )
}

/** Stable per-collection key. Most records have `id`; billing rows are keyed by org (and day). */
export function recordKey(collection: string, record: Record<string, unknown>): string {
  if (collection === 'orgBilling' && typeof record.orgId === 'string') return record.orgId
  if (collection === 'usageDaily' && typeof record.orgId === 'string') return `${record.orgId}:${String(record.day)}`
  if (typeof record.id === 'string' && record.id) return record.id
  return `anon:${createHash('sha1').update(JSON.stringify(record)).digest('hex')}`
}

/** App state as last saved: from per-record rows, or the legacy single row before migration. */
export async function loadStoredState(
  db: Queryable
): Promise<{ data: Partial<Database>; storage: 'row' | 'records'; version: number; maxSeq: number }> {
  const meta = await db.query<{ data: Partial<Database>; storage: string; version: string | number }>(
    'SELECT data, storage, version FROM jargon_state WHERE id = $1',
    [ROW_ID]
  )
  const row = meta.rows[0]
  if (!row || row.storage !== 'records') {
    return { data: row?.data ?? {}, storage: 'row', version: Number(row?.version) || 0, maxSeq: 0 }
  }
  const records = await db.query<{ collection: string; seq: string | number; data: unknown }>(
    'SELECT collection, seq, data FROM jargon_records ORDER BY collection, seq'
  )
  const data: Record<string, unknown[]> = {}
  let maxSeq = 0
  for (const r of records.rows) {
    ;(data[r.collection] ??= []).push(r.data)
    maxSeq = Math.max(maxSeq, Number(r.seq))
  }
  for (const name of NEWEST_FIRST) data[name]?.reverse()
  return { data: data as Partial<Database>, storage: 'records', version: Number(row.version) || 0, maxSeq }
}

export class StaleWriterError extends Error {
  constructor() {
    super('Another Jargon API process took over the database; this one must stop writing.')
  }
}

type Persisted = Map<string, Map<string, { json: string; seq: number }>>
type RecordRow = { collection: string; id: string; org_id: string | null; seq: number; data: unknown }

/**
 * Postgres-backed store. State is cached in memory (all reads are synchronous)
 * and saved as one row per record in `jargon_records`. Each save writes only
 * records that were added, changed, or removed, and bursts of updates coalesce
 * into one save.
 *
 * Only one process may own the state. Each boot claims it by bumping
 * `jargon_state.writer_epoch`; every save checks the epoch is still ours. A
 * replaced process (deploy overlap, a second replica) stops writing and calls
 * `onFenced`, so it never overwrites the newer process's state or keeps sending.
 */
export class PgStore implements DataStore {
  private pool: PgPoolLike
  private data: Database
  private readonly epoch: number
  private persisted: Persisted = new Map()
  private nextSeq: number
  private migrated: boolean
  private fenced = false
  private queued = false
  private writeChain: Promise<void> = Promise.resolve()
  /** Called once when this process loses ownership. */
  onFenced: () => void = () => {}

  private constructor(pool: PgPoolLike, data: Database, epoch: number, nextSeq: number, migrated: boolean) {
    this.pool = pool
    this.data = data
    this.epoch = epoch
    this.nextSeq = nextSeq
    this.migrated = migrated
  }

  static async connect(databaseUrl: string, empty: Database): Promise<PgStore> {
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl:
        databaseUrl.includes('sslmode=require') || process.env.PGSSL === '1'
          ? { rejectUnauthorized: false }
          : undefined
    })
    return PgStore.open(pool, empty)
  }

  static async open(pool: PgPoolLike, empty: Database): Promise<PgStore> {
    await ensureStateSchema(pool)
    const claimed = await PgStore.claim(pool, empty)
    const store = new PgStore(
      pool,
      migrateDatabase(claimed.raw),
      claimed.epoch,
      claimed.maxSeq + 1,
      claimed.storage === 'records'
    )
    if (claimed.storage === 'records') store.persisted = store.snapshotRecords(claimed.raw, false)
    await store.persistUnderLock()
    return store
  }

  /** Take ownership, load state, and save a boot snapshot, in one locked transaction. */
  private static async claim(
    pool: PgPoolLike,
    empty: Database
  ): Promise<{ raw: Partial<Database>; storage: 'row' | 'records'; maxSeq: number; epoch: number }> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [STATE_LOCK_KEY])
      await client.query(
        `INSERT INTO jargon_state (id, data, version, writer_epoch, storage) VALUES ($1, $2::jsonb, 0, 0, 'records')
         ON CONFLICT (id) DO NOTHING`,
        [ROW_ID, JSON.stringify(empty)]
      )
      const claimed = await client.query<{ writer_epoch: string | number }>(
        'UPDATE jargon_state SET writer_epoch = writer_epoch + 1 WHERE id = $1 RETURNING writer_epoch',
        [ROW_ID]
      )
      const loaded = await loadStoredState(client)
      // State as the previous deploy left it, before this code's migrations rewrite it.
      await client.query(
        `INSERT INTO jargon_state_snapshots (data, version, reason) VALUES ($1::jsonb, $2, 'boot')`,
        [JSON.stringify(loaded.data), loaded.version]
      )
      await pruneSnapshots(client, 'boot', SNAPSHOT_KEEP)
      await client.query('COMMIT')
      return {
        raw: loaded.data,
        storage: loaded.storage,
        maxSeq: loaded.maxSeq,
        epoch: Number(claimed.rows[0].writer_epoch)
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  get db(): Database {
    return this.data
  }

  persist(next?: Database): void {
    if (next) this.data = next
    this.enqueuePersist()
  }

  update(mutator: (db: Database) => void): Database {
    mutator(this.data)
    this.enqueuePersist()
    return this.data
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  /** True while this process still owns the state. Check before side effects like sending. */
  async isWriter(): Promise<boolean> {
    if (this.fenced) return false
    const result = await this.pool.query<{ writer_epoch: string | number }>(
      'SELECT writer_epoch FROM jargon_state WHERE id = $1',
      [ROW_ID]
    )
    if (Number(result.rows[0]?.writer_epoch) !== this.epoch) this.fence()
    return !this.fenced
  }

  /**
   * Save the current state into jargon_state_snapshots, keeping the newest `keep` per reason.
   * Skips when the newest snapshot for `reason` is younger than `minAgeMs`. Returns the new id, if any.
   */
  async snapshot(reason: string, options: { minAgeMs?: number; keep?: number } = {}): Promise<number | null> {
    if (!(await this.isWriter())) return null
    await this.flush()
    if (options.minAgeMs) {
      const latest = await this.pool.query<{ age_ms: string | number | null }>(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) * 1000 AS age_ms
         FROM jargon_state_snapshots WHERE reason = $1`,
        [reason]
      )
      const age = latest.rows[0]?.age_ms
      if (age != null && Number(age) < options.minAgeMs) return null
    }
    const inserted = await this.pool.query<{ id: string | number }>(
      `INSERT INTO jargon_state_snapshots (data, version, reason)
       SELECT $1::jsonb, version, $2 FROM jargon_state WHERE id = $3 RETURNING id`,
      [JSON.stringify(this.data), reason, ROW_ID]
    )
    await pruneSnapshots(this.pool, reason, options.keep ?? SNAPSHOT_KEEP)
    return Number(inserted.rows[0]?.id) || null
  }

  private fence(): void {
    if (this.fenced) return
    this.fenced = true
    console.error(`[jargon] ${new StaleWriterError().message} Run exactly one API replica.`)
    this.onFenced()
  }

  private enqueuePersist(): void {
    if (this.fenced || this.queued) return
    this.queued = true
    this.writeChain = this.writeChain
      .then(() => {
        this.queued = false
        return this.persistUnderLock()
      })
      .catch((err) => {
        if (err instanceof StaleWriterError) return
        console.error('[jargon] Postgres persist failed:', err)
      })
  }

  /**
   * Serialize every record, keyed per collection. With `assignSeq`, records not
   * saved before get the next sequence numbers in their insertion order.
   */
  private snapshotRecords(data: Partial<Database>, assignSeq = true): Persisted {
    const next: Persisted = new Map()
    let seq = this.nextSeq
    for (const [collection, value] of Object.entries(data)) {
      if (!Array.isArray(value)) continue
      const previous = this.persisted.get(collection)
      const rows = new Map<string, { json: string; seq: number }>()
      // Newest-first arrays: walk oldest to newest so sequence numbers follow insertion.
      const ordered = NEWEST_FIRST.has(collection) ? [...value].reverse() : value
      for (const record of ordered as unknown as Record<string, unknown>[]) {
        let key = recordKey(collection, record)
        for (let n = 2; rows.has(key); n++) key = `${recordKey(collection, record)}#${n}`
        const json = JSON.stringify(record)
        const known = previous?.get(key)
        rows.set(key, { json, seq: known?.seq ?? (assignSeq ? seq++ : 0) })
      }
      next.set(collection, rows)
    }
    if (!assignSeq) {
      // Loaded rows: number them in load order (only relative order matters).
      for (const rows of next.values()) for (const row of rows.values()) row.seq = seq++
    }
    this.nextSeq = seq
    return next
  }

  private async persistUnderLock(): Promise<void> {
    if (this.fenced) throw new StaleWriterError()
    const next = this.snapshotRecords(this.data)
    const upserts: RecordRow[] = []
    const deletes: Array<{ collection: string; id: string }> = []
    for (const [collection, rows] of next) {
      const previous = this.persisted.get(collection)
      for (const [id, row] of rows) {
        if (previous?.get(id)?.json === row.json) continue
        const data = JSON.parse(row.json) as Record<string, unknown>
        upserts.push({ collection, id, org_id: typeof data.orgId === 'string' ? data.orgId : null, seq: row.seq, data })
      }
    }
    for (const [collection, rows] of this.persisted) {
      const current = next.get(collection)
      for (const id of rows.keys()) if (!current?.has(id)) deletes.push({ collection, id })
    }
    if (!upserts.length && !deletes.length && this.migrated) {
      this.persisted = next
      return
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [STATE_LOCK_KEY])
      const current = await client.query<{ writer_epoch: string | number }>(
        'SELECT writer_epoch FROM jargon_state WHERE id = $1 FOR UPDATE',
        [ROW_ID]
      )
      if (Number(current.rows[0]?.writer_epoch) !== this.epoch) {
        await client.query('ROLLBACK')
        this.fence()
        throw new StaleWriterError()
      }
      if (!this.migrated) await client.query('DELETE FROM jargon_records')
      for (let i = 0; i < deletes.length; i += WRITE_CHUNK) {
        await client.query(
          `DELETE FROM jargon_records r USING jsonb_to_recordset($1::jsonb) AS x(collection text, id text)
           WHERE r.collection = x.collection AND r.id = x.id`,
          [JSON.stringify(deletes.slice(i, i + WRITE_CHUNK))]
        )
      }
      for (let i = 0; i < upserts.length; i += WRITE_CHUNK) {
        await client.query(
          `INSERT INTO jargon_records (collection, id, org_id, seq, data)
           SELECT collection, id, org_id, seq, data
           FROM jsonb_to_recordset($1::jsonb) AS x(collection text, id text, org_id text, seq bigint, data jsonb)
           ON CONFLICT (collection, id) DO UPDATE
             SET data = EXCLUDED.data, org_id = EXCLUDED.org_id, updated_at = NOW()`,
          [JSON.stringify(upserts.slice(i, i + WRITE_CHUNK))]
        )
      }
      await client.query(
        `UPDATE jargon_state SET version = version + 1, storage = 'records', updated_at = NOW() WHERE id = $1`,
        [ROW_ID]
      )
      await client.query('COMMIT')
      this.persisted = next
      if (!this.migrated) {
        this.migrated = true
        console.log(`[jargon] Migrated app state to per-record storage (${upserts.length} records)`)
      }
    } catch (err) {
      if (!(err instanceof StaleWriterError)) await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.flush()
    await this.pool.end()
  }
}
