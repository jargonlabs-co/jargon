import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Database } from './types'
import { ensureBootstrapTenant } from './bootstrap'

export interface DataStore {
  get db(): Database
  persist(next?: Database): void
  update(mutator: (db: Database) => void): Database
}

const EMPTY: Database = {
  users: [],
  orgs: [],
  memberships: [],
  sessions: [],
  apiKeys: [],
  subscriptions: [],
  connections: [],
  oauthStates: [],
  projects: [],
  campaigns: [],
  sequences: [],
  steps: [],
  contacts: [],
  calls: [],
  messages: [],
  activities: [],
  shareLinks: [],
  previewComments: []
}

function migrateDb(raw: Partial<Database>): Database {
  const db: Database = { ...structuredClone(EMPTY), ...raw } as Database
  if (!db.shareLinks) db.shareLinks = []
  if (!db.previewComments) db.previewComments = []
  if (!db.apiKeys) db.apiKeys = []
  if (!db.subscriptions) db.subscriptions = []
  // Backfill orgId on legacy single-tenant records
  const defaultOrgId = db.orgs[0]?.id
  if (defaultOrgId) {
    for (const p of db.projects) {
      if (!(p as { orgId?: string }).orgId) (p as { orgId: string }).orgId = defaultOrgId
    }
    for (const c of db.campaigns) {
      if (!(c as { orgId?: string }).orgId) (c as { orgId: string }).orgId = defaultOrgId
    }
    for (const s of db.sequences) {
      if (!(s as { orgId?: string }).orgId) (s as { orgId: string }).orgId = defaultOrgId
    }
    for (const s of db.steps) {
      if (!(s as { orgId?: string }).orgId) (s as { orgId: string }).orgId = defaultOrgId
    }
    for (const c of db.contacts) {
      if (!(c as { orgId?: string }).orgId) (c as { orgId: string }).orgId = defaultOrgId
    }
    for (const c of db.calls) {
      if (!(c as { orgId?: string }).orgId) (c as { orgId: string }).orgId = defaultOrgId
      if (!(c as { mode?: string }).mode) (c as { mode: string }).mode = 'demo'
    }
    for (const m of db.messages) {
      if (!(m as { orgId?: string }).orgId) (m as { orgId: string }).orgId = defaultOrgId
      if (!(m as { mode?: string }).mode) (m as { mode: string }).mode = 'demo'
    }
    for (const a of db.activities) {
      if (!(a as { orgId?: string }).orgId) (a as { orgId: string }).orgId = defaultOrgId
    }
  }
  return db
}

export class JsonStore implements DataStore {
  private filePath: string
  private data: Database

  constructor(filePath: string, options?: { bootstrap?: boolean }) {
    this.filePath = filePath
    this.data = this.load()
    if (options?.bootstrap !== false) {
      ensureBootstrapTenant(this)
      this.data = migrateDb(this.data)
      this.persist()
    }
  }

  get db(): Database {
    return this.data
  }

  private load(): Database {
    try {
      if (!existsSync(this.filePath)) {
        mkdirSync(dirname(this.filePath), { recursive: true })
        this.persist(EMPTY)
        return structuredClone(EMPTY)
      }
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<Database>
      return migrateDb(raw)
    } catch {
      return structuredClone(EMPTY)
    }
  }

  persist(next?: Database): void {
    if (next) this.data = next
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  update(mutator: (db: Database) => void): Database {
    mutator(this.data)
    this.persist()
    return this.data
  }
}

export { migrateDb as migrateDatabase }

export function defaultDbPath(userDataPath: string): string {
  return join(userDataPath, 'jargon-db.json')
}

export function hostedDbPath(cwd = process.cwd()): string {
  return process.env.JARGON_DB_PATH ?? join(cwd, 'data', 'jargon-db.json')
}

/** Hosted API store — Postgres when DATABASE_URL is set, else JSON file. */
export async function createHostedStore(options?: {
  bootstrap?: boolean
}): Promise<{ store: DataStore; backend: 'postgres' | 'json'; label: string }> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl) {
    const { PgStore } = await import('./pgStore')
    const store = await PgStore.connect(databaseUrl, structuredClone(EMPTY), options)
    return { store, backend: 'postgres', label: 'postgres:jargon_state' }
  }
  const dbPath = hostedDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  const store = new JsonStore(dbPath, options)
  return { store, backend: 'json', label: dbPath }
}
