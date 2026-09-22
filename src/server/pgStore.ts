import pg from 'pg'
import type { Database } from './types'
import { ensureBootstrapTenant } from './bootstrap'
import type { DataStore } from './store'
import { migrateDatabase } from './store'

const { Pool } = pg

/** Fixed advisory lock key for the shared jargon_state row. */
const STATE_LOCK_KEY = 872_364_91

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jargon_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE jargon_state ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
`

const ROW_ID = 'main'

/**
 * Postgres-backed store — full app state as one JSONB row.
 *
 * Writes are serialized in-process and take a transaction advisory lock so
 * concurrent requests on one API process cannot clobber each other.
 * Run a single API replica until per-org rows ship; multi-replica still races
 * on the in-memory cache.
 */
export class PgStore implements DataStore {
  private pool: pg.Pool
  private data: Database
  private version = 0
  private writeChain: Promise<void> = Promise.resolve()

  private constructor(pool: pg.Pool, data: Database, version: number) {
    this.pool = pool
    this.data = data
    this.version = version
  }

  static async connect(
    databaseUrl: string,
    empty: Database,
    options?: { bootstrap?: boolean }
  ): Promise<PgStore> {
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl:
        databaseUrl.includes('sslmode=require') || process.env.PGSSL === '1'
          ? { rejectUnauthorized: false }
          : undefined
    })
    await pool.query(SCHEMA)
    const loaded = await PgStore.load(pool, empty)
    const store = new PgStore(pool, loaded.data, loaded.version)
    if (options?.bootstrap !== false) {
      ensureBootstrapTenant(store)
      store.data = migrateDatabase(store.data)
      await store.persistUnderLock()
    }
    return store
  }

  private static async load(
    pool: pg.Pool,
    empty: Database
  ): Promise<{ data: Database; version: number }> {
    const result = await pool.query<{ data: Database; version: string | number }>(
      'SELECT data, version FROM jargon_state WHERE id = $1',
      [ROW_ID]
    )
    if (result.rowCount === 0) {
      await pool.query(
        'INSERT INTO jargon_state (id, data, version) VALUES ($1, $2::jsonb, 0)',
        [ROW_ID, JSON.stringify(empty)]
      )
      return { data: structuredClone(empty), version: 0 }
    }
    return {
      data: migrateDatabase(result.rows[0].data as Partial<Database>),
      version: Number(result.rows[0].version) || 0
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

  private enqueuePersist(): void {
    this.writeChain = this.writeChain
      .then(() => this.persistUnderLock())
      .catch((err) => {
        console.error('[jargon] Postgres persist failed:', err)
      })
  }

  private async persistUnderLock(): Promise<void> {
    const client = await this.pool.connect()
    const payload = JSON.stringify(this.data)
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [STATE_LOCK_KEY])
      const current = await client.query<{ version: string | number }>(
        'SELECT version FROM jargon_state WHERE id = $1 FOR UPDATE',
        [ROW_ID]
      )
      const dbVersion = Number(current.rows[0]?.version) || 0
      if (dbVersion > this.version) {
        console.warn(
          `[jargon] jargon_state version drift (mem=${this.version} db=${dbVersion}). Prefer a single API replica until per-org rows ship.`
        )
      }
      const updated = await client.query<{ version: string | number }>(
        `INSERT INTO jargon_state (id, data, version, updated_at)
         VALUES ($1, $2::jsonb, 1, NOW())
         ON CONFLICT (id) DO UPDATE
           SET data = EXCLUDED.data,
               version = jargon_state.version + 1,
               updated_at = NOW()
         RETURNING version`,
        [ROW_ID, payload]
      )
      this.version = Number(updated.rows[0]?.version) || this.version + 1
      await client.query('COMMIT')
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* ignore */
      }
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
