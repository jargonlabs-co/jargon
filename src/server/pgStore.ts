import pg from 'pg'
import type { Database } from './types'
import { ensureBootstrapTenant } from './bootstrap'
import type { DataStore } from './store'
import { migrateDatabase } from './store'

const { Pool } = pg

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jargon_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

const ROW_ID = 'main'

/** Postgres-backed store — persists the full app state as JSONB (Railway Postgres). */
export class PgStore implements DataStore {
  private pool: pg.Pool
  private data: Database

  private constructor(pool: pg.Pool, data: Database) {
    this.pool = pool
    this.data = data
  }

  static async connect(databaseUrl: string, empty: Database, options?: { bootstrap?: boolean }): Promise<PgStore> {
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl:
        databaseUrl.includes('sslmode=require') || process.env.PGSSL === '1'
          ? { rejectUnauthorized: false }
          : undefined
    })
    await pool.query(SCHEMA)
    const loaded = await PgStore.load(pool, empty)
    const store = new PgStore(pool, loaded)
    if (options?.bootstrap !== false) {
      ensureBootstrapTenant(store)
      store.data = migrateDatabase(store.data)
      await store.persistAsync()
    }
    return store
  }

  private static async load(pool: pg.Pool, empty: Database): Promise<Database> {
    const result = await pool.query<{ data: Database }>(
      'SELECT data FROM jargon_state WHERE id = $1',
      [ROW_ID]
    )
    if (result.rowCount === 0) {
      await pool.query('INSERT INTO jargon_state (id, data) VALUES ($1, $2::jsonb)', [
        ROW_ID,
        JSON.stringify(empty)
      ])
      return structuredClone(empty)
    }
    return migrateDatabase(result.rows[0].data as Partial<Database>)
  }

  get db(): Database {
    return this.data
  }

  persist(next?: Database): void {
    if (next) this.data = next
    void this.persistAsync().catch((err) => {
      console.error('[jargon] Postgres persist failed:', err)
    })
  }

  private async persistAsync(): Promise<void> {
    await this.pool.query(
      `INSERT INTO jargon_state (id, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [ROW_ID, JSON.stringify(this.data)]
    )
  }

  update(mutator: (db: Database) => void): Database {
    mutator(this.data)
    void this.persistAsync().catch((err) => {
      console.error('[jargon] Postgres persist failed:', err)
    })
    return this.data
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
