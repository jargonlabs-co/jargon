/**
 * Back up, inspect, and restore the product app state (jargon_state).
 *
 *   npm run db:state -- list
 *   npm run db:state -- export [--snapshot <id>] [--out <file.json.gz>]
 *   npm run db:state -- verify (--file <file> | --snapshot <id>)
 *   npm run db:state -- restore (--file <file> | --snapshot <id>) --yes [--database-url <url>]
 *
 * Uses DATABASE_URL unless --database-url is given. Restore drill: export from
 * production, restore into a scratch Postgres with --database-url, boot the API
 * against it, and sign in.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import pg from 'pg'
import {
  ensureStateSchema,
  loadStoredState,
  STATE_ADVISORY_LOCK,
  STATE_ROW_ID,
  type PgPoolLike
} from '../src/server/pgStore.ts'

type Queryable = Pick<PgPoolLike, 'query'>
import { migrateDatabase } from '../src/server/store.ts'
import type { Database } from '../src/server/types.ts'

type Exported = { exportedAt: string; version: number; source: string; data: Database }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function pool(): pg.Pool {
  const url = arg('database-url') ?? process.env.DATABASE_URL
  if (!url) throw new Error('Set DATABASE_URL or pass --database-url')
  return new pg.Pool({
    connectionString: url,
    ssl: url.includes('sslmode=require') || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined
  })
}

function summarize(data: Database): string {
  const counts = (['orgs', 'users', 'connections', 'projects', 'contacts', 'messages', 'calls', 'suppressions'] as const)
    .map((k) => `${k}=${(data[k] as unknown[] | undefined)?.length ?? 0}`)
  return counts.join(' ')
}

/** Throws unless this looks like real app state. */
export function validateState(raw: unknown): Database {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('State must be a JSON object')
  const obj = raw as Record<string, unknown>
  for (const key of ['users', 'orgs', 'memberships']) {
    if (!Array.isArray(obj[key])) throw new Error(`State is missing the "${key}" array`)
  }
  return migrateDatabase(obj as Partial<Database>)
}

/** Replace live state, keeping the old state as a 'pre-restore' snapshot. */
export async function restoreState(db: Pick<PgPoolLike, 'connect'>, data: Database): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [STATE_ADVISORY_LOCK])
    const previous = await loadStoredState(client)
    await client.query(
      `INSERT INTO jargon_state_snapshots (data, version, reason) VALUES ($1::jsonb, $2, 'pre-restore')`,
      [JSON.stringify(previous.data), previous.version]
    )
    // storage='row' makes the next API boot rebuild jargon_records from this data.
    // Bumping writer_epoch stops any running API from overwriting it first.
    await client.query(
      `INSERT INTO jargon_state (id, data, version, writer_epoch, storage) VALUES ($1, $2::jsonb, 1, 1, 'row')
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, storage = 'row', version = jargon_state.version + 1,
         writer_epoch = jargon_state.writer_epoch + 1, updated_at = NOW()`,
      [STATE_ROW_ID, JSON.stringify(data)]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

async function load(db: Queryable): Promise<{ data: Database; version: number; source: string }> {
  const snapshot = arg('snapshot')
  const file = arg('file')
  if (file) {
    const buf = readFileSync(file)
    const text = file.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
    const parsed = JSON.parse(text) as Partial<Exported> & Record<string, unknown>
    const data = validateState(parsed.data ?? parsed)
    return { data, version: Number(parsed.version) || 0, source: file }
  }
  if (snapshot) {
    const result = await db.query('SELECT data, version FROM jargon_state_snapshots WHERE id = $1', [snapshot])
    if (!result.rowCount) throw new Error(`No snapshot ${snapshot}`)
    return { data: validateState(result.rows[0].data), version: Number(result.rows[0].version) || 0, source: `snapshot:${snapshot}` }
  }
  const live = await loadStoredState(db)
  return { data: validateState(live.data), version: live.version, source: `live (${live.storage})` }
}

async function main() {
  const command = process.argv[2]
  const needsDb = command !== 'verify' || !arg('file')
  const db = needsDb ? pool() : (null as unknown as pg.Pool)
  try {
    if (needsDb) await ensureStateSchema(db)
    if (command === 'list') {
      const rows = await db.query(
        `SELECT id, reason, version, created_at, pg_column_size(data) AS bytes
         FROM jargon_state_snapshots ORDER BY id DESC`
      )
      for (const r of rows.rows) {
        console.log(`${r.id}\t${r.reason}\tv${r.version}\t${new Date(r.created_at).toISOString()}\t${r.bytes} bytes`)
      }
      if (!rows.rowCount) console.log('No snapshots yet')
    } else if (command === 'export') {
      const { data, version, source } = await load(db)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const out = arg('out') ?? join('data', 'backups', `jargon-state-${stamp}.json.gz`)
      mkdirSync(dirname(out), { recursive: true })
      const payload: Exported = { exportedAt: new Date().toISOString(), version, source, data }
      writeFileSync(out, gzipSync(JSON.stringify(payload)), { mode: 0o600 })
      console.log(`Wrote ${out} (${source}, v${version}): ${summarize(data)}`)
    } else if (command === 'verify') {
      const { data, version, source } = await load(db)
      console.log(`OK ${source} v${version}: ${summarize(data)}`)
    } else if (command === 'restore') {
      if (!arg('file') && !arg('snapshot')) throw new Error('restore needs --file or --snapshot')
      if (!process.argv.includes('--yes')) throw new Error('restore overwrites live state; pass --yes')
      const { data, source } = await load(db)
      await restoreState(db, data)
      console.log(`Restored ${source}: ${summarize(data)}`)
      console.log('The previous state was saved as a "pre-restore" snapshot.')
      console.log('A running API stops itself within ~30s. Restart or redeploy the API service now.')
    } else {
      console.log('Usage: npm run db:state -- list | export | verify | restore   (see scripts/db-state.ts)')
      process.exitCode = 1
    }
  } finally {
    if (needsDb) await db.end()
  }
}

if (process.argv[1]?.endsWith('db-state.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
