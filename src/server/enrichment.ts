import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { Contact } from './types'
import { coerceAttrValue, extraAttrs } from '../shared/fieldCatalog'
import { normalizeLinkedInUrl } from '../shared/linkedinUrl'
import { setProjectCatalog } from './fieldCatalogSync'
import { enrollPublicSequence, projectIsSequenced } from './publicApi'
import { enrolledAtOf } from './workspaceTasks'

export type EnrichmentResult = {
  matched: number
  updated: number
  unmatched: Array<{ row: number; key: string }>
  enrolled: number
}

const MATCH_KEYS = new Set([
  'contactId',
  'contact_id',
  'id',
  'crmId',
  'crm_id',
  'hubspot_id',
  'hubspotId',
  'externalId',
  'external_id'
])

const FILL_IF_EMPTY: Array<[keyof Contact, string[]]> = [
  ['email', ['email', 'emailAddress', 'email_address', 'workEmail', 'work_email']],
  ['phone', ['phone', 'phoneNumber', 'phone_number', 'mobile', 'directDial', 'direct_dial']],
  ['title', ['title', 'jobTitle', 'job_title']],
  ['city', ['city', 'location']],
  ['companyDomain', ['companyDomain', 'company_domain', 'domain', 'website']],
  ['companyIndustry', ['companyIndustry', 'industry', 'company_industry']],
  ['companySize', ['companySize', 'company_size', 'employees', 'employee_count', 'headcount']],
  ['companyRevenue', ['companyRevenue', 'company_revenue', 'revenue', 'annual_revenue']]
]

const FILLED_KEYS = new Set(FILL_IF_EMPTY.flatMap(([, keys]) => keys))

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function first(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(row[key])
    if (value) return value
  }
  return undefined
}

function findContact(pool: Contact[], row: Record<string, unknown>): Contact | undefined {
  const id = first(row, ['contactId', 'contact_id', 'id'])
  if (id) {
    const byId = pool.find((c) => c.id === id)
    if (byId) return byId
  }
  const crmId = first(row, ['crmId', 'crm_id', 'hubspot_id', 'hubspotId', 'externalId', 'external_id'])
  if (crmId) {
    const byCrm = pool.find((c) => c.externalId === crmId)
    if (byCrm) return byCrm
  }
  const email = first(row, ['email', 'emailAddress', 'email_address', 'workEmail', 'work_email'])?.toLowerCase()
  if (email) {
    const byEmail = pool.find((c) => c.email.trim().toLowerCase() === email)
    if (byEmail) return byEmail
  }
  const linkedin = normalizeLinkedInUrl(first(row, ['linkedinUrl', 'linkedin_url', 'linkedin', 'profileUrl', 'profile_url']))
  if (linkedin) return pool.find((c) => c.linkedinUrl && normalizeLinkedInUrl(c.linkedinUrl) === linkedin)
  return undefined
}

function rowKey(row: Record<string, unknown>): string {
  return first(row, ['email', 'linkedinUrl', 'linkedin', 'crmId', 'crm_id', 'hubspot_id', 'contactId', 'id', 'name']) ?? '(no key)'
}

/**
 * Merge enrichment rows into existing contacts, matched by contact id, CRM id, email, or LinkedIn URL.
 * Extra columns land in `attrs` (overwriting), identity fields only fill blanks, and `context` lines
 * are appended. People who now have every requested field are enrolled if the sequence is running.
 */
export async function upsertEnrichment(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  rows: Record<string, unknown>[],
  opts?: { projectId?: string; sandbox?: boolean }
): Promise<EnrichmentResult> {
  const pool = store.db.contacts.filter(
    (c) => c.orgId === orgId && (!opts?.projectId || c.projectId === opts.projectId)
  )
  const now = Date.now()
  const touched = new Map<string, Set<string>>()
  const unmatched: EnrichmentResult['unmatched'] = []
  let matched = 0
  let updated = 0

  rows.forEach((row, index) => {
    const target = findContact(pool, row)
    if (!target) {
      unmatched.push({ row: index, key: rowKey(row) })
      return
    }
    matched += 1
    const attrs = extraAttrs(row, [...MATCH_KEYS, ...FILLED_KEYS])
    const context = Array.isArray(row.context)
      ? row.context.map(text).filter((line): line is string => Boolean(line))
      : text(row.context)
        ? [text(row.context)!]
        : []
    store.update((db) => {
      const c = db.contacts.find((x) => x.id === target.id)
      if (!c) return
      let changed = false
      for (const [field, keys] of FILL_IF_EMPTY) {
        const value = first(row, keys)
        if (value && !text(c[field])) {
          ;(c as unknown as Record<string, unknown>)[field] = value
          changed = true
        }
      }
      const linkedin = normalizeLinkedInUrl(first(row, ['linkedinUrl', 'linkedin_url', 'linkedin']))
      if (linkedin && !c.linkedinUrl) {
        c.linkedinUrl = linkedin
        changed = true
      }
      for (const [key, value] of Object.entries(attrs)) {
        const coerced = coerceAttrValue(value)
        if (coerced === undefined) continue
        if (JSON.stringify(c.attrs?.[key]) === JSON.stringify(coerced)) continue
        c.attrs = { ...(c.attrs ?? {}), [key]: coerced }
        changed = true
      }
      const fresh = context.filter((line) => !(c.context ?? []).includes(line))
      if (fresh.length) {
        c.context = [...(c.context ?? []), ...fresh].slice(-8)
        changed = true
      }
      if (!changed) return
      c.enrichedAt = now
      c.updatedAt = now
      updated += 1
      const ids = touched.get(c.projectId) ?? new Set<string>()
      ids.add(c.id)
      touched.set(c.projectId, ids)
    })
  })

  let enrolled = 0
  for (const [projectId, ids] of touched) {
    store.update((db) => setProjectCatalog(db, projectId))
    if (!projectIsSequenced(store, projectId)) continue
    const before = new Set([...ids].filter((id) => enrolledAtOf(store.db.contacts.find((c) => c.id === id) ?? {}) != null))
    await enrollPublicSequence(store, config, orgId, projectId, {
      contactIds: [...ids],
      sandbox: opts?.sandbox
    })
    enrolled += [...ids].filter(
      (id) => !before.has(id) && enrolledAtOf(store.db.contacts.find((c) => c.id === id) ?? {}) != null
    ).length
  }
  return { matched, updated, unmatched, enrolled }
}
