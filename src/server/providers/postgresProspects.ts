import pg from 'pg'
import { uid } from '../crypto'
import type { DataStore } from '../store'
import { buildProspectContext, prospectsToContacts, type ContextProspect } from './prospects'

const { Pool } = pg

export const DEFAULT_PROSPECTS_TABLE = 'jargon_prospects'

export type PostgresColumnMap = {
  id?: string
  name?: string
  email?: string
  phone?: string
  title?: string
  company?: string
  city?: string
  linkedinUrl?: string
  companyDomain?: string
  companyIndustry?: string
  companySize?: string
}

const DEFAULT_COLUMN_MAP: Required<PostgresColumnMap> = {
  id: 'id',
  name: 'name',
  email: 'email',
  phone: 'phone',
  title: 'title',
  company: 'company',
  city: 'city',
  linkedinUrl: 'linkedin_url',
  companyDomain: 'company_domain',
  companyIndustry: 'company_industry',
  companySize: 'company_size'
}

function sanitizeTable(table: string): string {
  const cleaned = table.trim().replace(/[^a-zA-Z0-9_]/g, '')
  return cleaned || DEFAULT_PROSPECTS_TABLE
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function poolFromUrl(databaseUrl: string): pg.Pool {
  // Railway / managed proxies often present a chain Node does not trust by default.
  const needsInsecureSsl =
    /sslmode=require/i.test(databaseUrl) ||
    databaseUrl.includes('rlwy.net') ||
    databaseUrl.includes('railway') ||
    process.env.PGSSL === '1'
  const connectionString = needsInsecureSsl
    ? databaseUrl.replace(/([?&])sslmode=[^&]+/i, '$1').replace(/\?$/, '')
    : databaseUrl
  return new Pool({
    connectionString,
    ssl: needsInsecureSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15_000,
    max: 2
  })
}

/** Safe label for UI — host:port/table, never the full connection string. */
export function postgresAccountLabel(databaseUrl: string, table: string): string {
  try {
    const parsed = new URL(databaseUrl)
    const host = parsed.hostname || 'postgres'
    const port = parsed.port ? `:${parsed.port}` : ''
    return `${host}${port}/${sanitizeTable(table)}`
  } catch {
    return `postgres/${sanitizeTable(table)}`
  }
}

function mapRow(
  row: Record<string, unknown>,
  columnMap: PostgresColumnMap,
  index: number
): ContextProspect | null {
  const cols = { ...DEFAULT_COLUMN_MAP, ...columnMap }
  const name = pickString(row, [cols.name, 'full_name', 'contact_name'])
  if (!name) return null

  const company =
    pickString(row, [cols.company, 'company_name', 'account_name', 'employer']) ||
    'Unknown company'
  const title = pickString(row, [cols.title, 'job_title', 'current_title']) || 'Contact'
  const email = pickString(row, [cols.email, 'work_email', 'business_email'])
  const phone = pickString(row, [cols.phone, 'phone_number', 'mobile'])
  const city = pickString(row, [cols.city, 'location', 'city_state'])
  const linkedinUrl = pickString(row, [
    cols.linkedinUrl,
    'linkedin',
    'profile_url',
    'linkedin_profile_url'
  ])
  const companyDomain = pickString(row, [cols.companyDomain, 'domain', 'website'])
  const companyIndustry = pickString(row, [cols.companyIndustry, 'industry'])
  const companySize = pickString(row, [cols.companySize, 'employee_count', 'headcount'])
  const externalId =
    pickString(row, [cols.id, 'crustdata_person_id', 'external_id']) || `postgres_${index + 1}`

  return {
    externalId,
    name,
    company,
    title,
    email:
      email ||
      `${name.toLowerCase().replace(/\s+/g, '.')}@${companyDomain || 'example.com'}`,
    phone: phone || '',
    city,
    accountName: company,
    linkedinUrl: linkedinUrl || undefined,
    companyDomain: companyDomain || undefined,
    companyIndustry: companyIndustry || undefined,
    companySize: companySize || undefined,
    context: buildProspectContext({
      id: externalId,
      company,
      title,
      companySize,
      companyIndustry
    })
  }
}

export async function validatePostgresProspects(
  databaseUrl: string,
  table = DEFAULT_PROSPECTS_TABLE
): Promise<{ ok: true; label: string; rowCount: number } | { ok: false; error: string }> {
  const url = databaseUrl.trim()
  if (!url) return { ok: false, error: 'databaseUrl required' }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return { ok: false, error: 'Expected a postgres:// or postgresql:// connection string' }
  }
  const safeTable = sanitizeTable(table)
  const pool = poolFromUrl(url)
  try {
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${safeTable}`
    )
    const rowCount = Number(countResult.rows[0]?.count ?? 0)
    await pool.query(`SELECT 1 FROM ${safeTable} LIMIT 1`)
    return {
      ok: true,
      label: postgresAccountLabel(url, safeTable),
      rowCount
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Postgres validation failed'
    if (/does not exist/i.test(message)) {
      return {
        ok: false,
        error: `Table "${safeTable}" not found — create it or set the correct --table name`
      }
    }
    return { ok: false, error: message }
  } finally {
    await pool.end()
  }
}

export async function fetchPostgresProspects(input: {
  databaseUrl: string
  table?: string
  limit?: number
  columnMap?: PostgresColumnMap
}): Promise<ContextProspect[]> {
  const safeTable = sanitizeTable(input.table ?? DEFAULT_PROSPECTS_TABLE)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500)
  const columnMap = input.columnMap ?? DEFAULT_COLUMN_MAP
  const pool = poolFromUrl(input.databaseUrl.trim())
  try {
    let result: pg.QueryResult<Record<string, unknown>>
    try {
      result = await pool.query(
        `SELECT * FROM ${safeTable} ORDER BY updated_at DESC NULLS LAST LIMIT $1`,
        [limit]
      )
    } catch {
      try {
        result = await pool.query(
          `SELECT * FROM ${safeTable} ORDER BY created_at DESC NULLS LAST LIMIT $1`,
          [limit]
        )
      } catch {
        result = await pool.query(`SELECT * FROM ${safeTable} LIMIT $1`, [limit])
      }
    }
    return result.rows
      .map((row, index) => mapRow(row, columnMap, index))
      .filter((p): p is ContextProspect => p !== null)
  } finally {
    await pool.end()
  }
}

export function writePostgresContactsToProjects(
  store: DataStore,
  orgId: string,
  prospects: ContextProspect[],
  projectId?: string,
  meta?: { table?: string }
): number {
  let count = 0
  const table = meta?.table ?? DEFAULT_PROSPECTS_TABLE
  store.update((db) => {
    const projects = db.projects.filter(
      (p) => p.orgId === orgId && (!projectId || p.id === projectId)
    )
    for (const project of projects) {
      const contacts = prospectsToContacts(orgId, project.id, prospects, 'postgres')
      db.contacts = db.contacts.filter((c) => c.projectId !== project.id)
      db.contacts.push(...contacts)
      project.answers = {
        ...project.answers,
        data_source: 'postgres',
        prospect_source: 'postgres',
        prospect_count: String(contacts.length),
        prospect_table: table,
        segment: project.answers.segment || 'Postgres prospects'
      }
      project.updatedAt = Date.now()
      const campaign = db.campaigns.find((x) => x.projectId === project.id && x.state === 'ACTIVE')
      if (campaign) {
        campaign.total = contacts.length
        campaign.updatedAt = Date.now()
      }
      db.activities.unshift({
        id: uid('act'),
        orgId,
        projectId: project.id,
        kind: 'sync',
        summary: `Loaded ${contacts.length} contacts from Postgres (${table})`,
        createdAt: Date.now()
      })
      count = contacts.length
    }
  })
  return count
}

export function readPostgresSecrets(secrets: {
  accessToken?: string
  extra?: Record<string, string>
}): { databaseUrl: string; table: string } {
  const databaseUrl = (secrets.extra?.databaseUrl || secrets.accessToken || '').trim()
  const table = sanitizeTable(secrets.extra?.table || DEFAULT_PROSPECTS_TABLE)
  return { databaseUrl, table }
}
