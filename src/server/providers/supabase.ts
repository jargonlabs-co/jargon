import type { DataStore } from '../store'
import type { ServerConfig } from '../config'
import {
  getConnection,
  readSecrets,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import { buildProspectContext } from './apollo'
import type { ContextProspect, ProspectSearchResult } from './prospects'

export const DEFAULT_SUPABASE_TABLE = 'jargon_prospects'

export type SupabaseConnectionConfig = {
  projectUrl: string
  table: string
}

export type SupabaseColumnMap = {
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

const DEFAULT_COLUMN_MAP: Required<SupabaseColumnMap> = {
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

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readColumnMap(meta: Record<string, string>): SupabaseColumnMap {
  if (!meta.columnMap) return DEFAULT_COLUMN_MAP
  try {
    const parsed = JSON.parse(meta.columnMap) as SupabaseColumnMap
    return { ...DEFAULT_COLUMN_MAP, ...parsed }
  } catch {
    return DEFAULT_COLUMN_MAP
  }
}

export function readSupabaseConfig(
  secrets: ProviderSecrets,
  meta: Record<string, string>
): SupabaseConnectionConfig {
  const projectUrl = normalizeUrl(
    meta.projectUrl || secrets.extra?.projectUrl || ''
  )
  const table = (meta.table || secrets.extra?.table || DEFAULT_SUPABASE_TABLE).trim()
  return { projectUrl, table }
}

export async function validateSupabaseConnection(input: {
  projectUrl: string
  apiKey: string
  table?: string
}): Promise<{ ok: true; label: string; rowCount?: number } | { ok: false; error: string }> {
  const projectUrl = normalizeUrl(input.projectUrl)
  const apiKey = input.apiKey.trim()
  const table = (input.table?.trim() || DEFAULT_SUPABASE_TABLE).replace(/[^a-zA-Z0-9_]/g, '')

  if (!projectUrl) return { ok: false, error: 'Supabase project URL required' }
  if (!apiKey) return { ok: false, error: 'Supabase API key required' }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl)) {
    return { ok: false, error: 'Expected Supabase URL like https://your-project.supabase.co' }
  }

  try {
    const res = await fetch(
      `${projectUrl}/rest/v1/${table}?select=id&limit=1`,
      {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Prefer: 'count=exact'
        }
      }
    )
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid Supabase API key or missing table access' }
    }
    if (res.status === 404) {
      return {
        ok: false,
        error: `Table "${table}" not found — run docs/supabase-schema.sql in your project first`
      }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: text || `Supabase probe failed (${res.status})` }
    }
    const countHeader = res.headers.get('content-range')
    const rowCount = countHeader?.includes('/')
      ? Number(countHeader.split('/')[1])
      : undefined
    const host = new URL(projectUrl).hostname.split('.')[0]
    return { ok: true, label: `Supabase · ${host}`, rowCount: Number.isFinite(rowCount) ? rowCount : undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Supabase validation failed' }
  }
}

function mapRow(
  row: Record<string, unknown>,
  columnMap: SupabaseColumnMap,
  index: number
): ContextProspect | null {
  const cols = { ...DEFAULT_COLUMN_MAP, ...columnMap }
  const name = pickString(row, [cols.name!, 'full_name', 'contact_name'])
  if (!name) return null

  const company =
    pickString(row, [cols.company!, 'company_name', 'account_name', 'employer']) ||
    'Unknown company'
  const title = pickString(row, [cols.title!, 'job_title', 'current_title']) || 'Contact'
  const email = pickString(row, [cols.email!, 'work_email', 'business_email'])
  const phone = pickString(row, [cols.phone!, 'phone_number', 'mobile'])
  const city = pickString(row, [cols.city!, 'location', 'city_state'])
  const linkedinUrl = pickString(row, [
    cols.linkedinUrl!,
    'linkedin',
    'profile_url',
    'linkedin_profile_url'
  ])
  const companyDomain = pickString(row, [cols.companyDomain!, 'domain', 'website'])
  const companyIndustry = pickString(row, [cols.companyIndustry!, 'industry'])
  const companySize = pickString(row, [cols.companySize!, 'employee_count', 'headcount'])
  const externalId =
    pickString(row, [cols.id!, 'crustdata_person_id', 'external_id']) || `supabase_${index + 1}`

  return {
    externalId,
    name,
    company,
    title,
    email: email || `${name.toLowerCase().replace(/\s+/g, '.')}@${companyDomain || 'example.com'}`,
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

export async function fetchSupabaseProspects(input: {
  projectUrl: string
  apiKey: string
  table: string
  limit: number
  columnMap?: SupabaseColumnMap
}): Promise<ProspectSearchResult> {
  const table = input.table.replace(/[^a-zA-Z0-9_]/g, '')
  const limit = Math.min(Math.max(input.limit, 1), 500)
  const columnMap = input.columnMap ?? DEFAULT_COLUMN_MAP

  const res = await fetch(
    `${normalizeUrl(input.projectUrl)}/rest/v1/${table}?select=*&limit=${limit}`,
    {
      headers: {
        apikey: input.apiKey,
        Authorization: `Bearer ${input.apiKey}`
      }
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Supabase fetch failed (${res.status})`)
  }

  const rows = (await res.json()) as Record<string, unknown>[]
  const prospects = rows
    .map((row, index) => mapRow(row, columnMap, index))
    .filter((p): p is ContextProspect => p !== null)

  return { prospects, mode: 'live', total: prospects.length }
}

export function ensureSupabaseConnection(
  store: DataStore,
  orgId: string,
  serverConfig: ServerConfig
) {
  const projectUrl = (serverConfig.supabase.projectUrl ?? '').trim()
  const apiKey = (serverConfig.supabase.apiKey ?? '').trim()
  if (!projectUrl || !apiKey) return getConnection(store, orgId, 'supabase')

  const existing = getConnection(store, orgId, 'supabase')
  if (existing?.status === 'connected') {
    try {
      const secrets = readSecrets(existing)
      const meta = existing.meta ?? {}
      if (secrets.accessToken === apiKey && meta.projectUrl === projectUrl) return existing
    } catch {
      /* re-upsert below */
    }
  }

  return upsertConnection(store, {
    orgId,
    provider: 'supabase',
    status: 'connected',
    accountLabel: new URL(projectUrl).hostname.split('.')[0],
    secrets: {
      accessToken: apiKey,
      extra: { projectUrl, table: serverConfig.supabase.table || DEFAULT_SUPABASE_TABLE }
    },
    meta: {
      mode: 'live',
      source: 'env',
      projectUrl,
      table: serverConfig.supabase.table || DEFAULT_SUPABASE_TABLE
    }
  })
}

export function resolveSupabaseConnection(
  store: DataStore,
  orgId: string,
  serverConfig: ServerConfig
): { projectUrl: string; apiKey: string; table: string; columnMap: SupabaseColumnMap } | null {
  ensureSupabaseConnection(store, orgId, serverConfig)
  const conn = getConnection(store, orgId, 'supabase')
  if (conn?.status === 'connected') {
    const secrets = readSecrets(conn)
    const apiKey = secrets.accessToken?.trim()
    const cfg = readSupabaseConfig(secrets, conn.meta ?? {})
    if (apiKey && cfg.projectUrl) {
      return {
        projectUrl: cfg.projectUrl,
        apiKey,
        table: cfg.table,
        columnMap: readColumnMap(conn.meta ?? {})
      }
    }
  }
  const projectUrl = serverConfig.supabase.projectUrl.trim()
  const apiKey = serverConfig.supabase.apiKey.trim()
  if (projectUrl && apiKey) {
    return {
      projectUrl,
      apiKey,
      table: serverConfig.supabase.table || DEFAULT_SUPABASE_TABLE,
      columnMap: DEFAULT_COLUMN_MAP
    }
  }
  return null
}
