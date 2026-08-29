import type { JsonStore } from '../store'
import type { ServerConfig } from '../config'
import {
  getConnection,
  readSecrets,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import { GTM_TITLES } from './apollo'
import { promptToCrustdataQuery, type CrustdataFilterNode } from './crustdataQuery'
import type { ContextProspect, ProspectSearchResult } from './prospects'

const CRUSTDATA_BASE = 'https://api.crustdata.com'
const API_VERSION = '2025-11-01'

type CrustdataProfile = {
  crustdata_person_id?: number | string
  basic_profile?: {
    name?: string
    headline?: string
    current_title?: string
    location?: {
      raw?: string
      city?: string
      state?: string
      country?: string
    }
  }
  social_handles?: {
    professional_network_identifier?: {
      profile_url?: string
    }
  }
  experience?: {
    employment_details?: {
      current?:
        | Array<{ name?: string; company_name?: string; title?: string }>
        | { name?: string; company_name?: string; title?: string }
    }
  }
  contact?: {
    business_emails?: string[]
    phone_numbers?: string[]
  }
}

type CrustdataSearchResponse = {
  profiles?: CrustdataProfile[]
  next_cursor?: string | null
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'x-api-version': API_VERSION
  }
}

function mapProfile(profile: CrustdataProfile, index: number): ContextProspect {
  const currentRaw = profile.experience?.employment_details?.current
  const currentJob = Array.isArray(currentRaw) ? currentRaw[0] : currentRaw
  const name = profile.basic_profile?.name?.trim() || `Prospect ${index + 1}`
  const company =
    currentJob?.name?.trim() ||
    currentJob?.company_name?.trim() ||
    'Software company'
  const title =
    currentJob?.title?.trim() ||
    profile.basic_profile?.current_title?.trim() ||
    GTM_TITLES[index % GTM_TITLES.length]
  const location = profile.basic_profile?.location
  const city =
    [location?.city, location?.state].filter(Boolean).join(', ') ||
    location?.raw ||
    ''
  const linkedinUrl =
    profile.social_handles?.professional_network_identifier?.profile_url
  const email =
    profile.contact?.business_emails?.find(Boolean) ||
    `${name.toLowerCase().replace(/\s+/g, '.')}@${company.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`
  const phone = profile.contact?.phone_numbers?.find(Boolean) || ''
  const externalId = String(profile.crustdata_person_id ?? `crustdata_${index + 1}`)
  const headline = profile.basic_profile?.headline?.trim()
  const context: string[] = []
  if (headline) context.push(headline.slice(0, 160))
  if (title && company) context.push(`${title} at ${company}`)
  if (city) context.push(city)

  return {
    externalId,
    name,
    company,
    title,
    email,
    phone,
    city,
    accountName: company,
    linkedinUrl,
    companyIndustry: 'computer software',
    context: context.slice(0, 3)
  }
}

export async function validateCrustdataKey(
  apiKey: string
): Promise<{ ok: true; label: string; credits?: number } | { ok: false; error: string }> {
  const trimmed = apiKey.trim()
  if (!trimmed) return { ok: false, error: 'API key required' }
  if (trimmed === 'demo') return { ok: true, label: 'Crustdata (demo)' }

  try {
    const res = await fetch(`${CRUSTDATA_BASE}/account/credits`, {
      headers: headers(trimmed)
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid Crustdata API key' }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: text || `Crustdata validation failed (${res.status})` }
    }
    const data = (await res.json()) as { account?: { credits?: number } }
    return {
      ok: true,
      label: 'Crustdata',
      credits: data.account?.credits
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Crustdata validation failed' }
  }
}

/** GTM leaders — default when no prompt is provided. */
function defaultFilters(): CrustdataFilterNode {
  return {
    op: 'and',
    conditions: [
      {
        op: 'or',
        conditions: [
          { field: 'experience.employment_details.current.title', type: '(.)', value: 'VP' },
          { field: 'experience.employment_details.current.title', type: '(.)', value: 'Director' },
          { field: 'experience.employment_details.current.title', type: '(.)', value: 'Head' },
          { field: 'experience.employment_details.current.title', type: '(.)', value: 'Chief' }
        ]
      }
    ]
  }
}

async function searchPeople(
  apiKey: string,
  limit: number,
  filters: CrustdataFilterNode
): Promise<CrustdataSearchResponse> {
  const capped = Math.min(Math.max(limit, 1), 100)
  const res = await fetch(`${CRUSTDATA_BASE}/person/search`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      filters,
      limit: capped,
      fields: [
        'basic_profile',
        'experience.employment_details',
        'social_handles',
        'contact'
      ]
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Crustdata person search failed (${res.status})`)
  }

  return (await res.json()) as CrustdataSearchResponse
}

export async function searchPeopleFromPrompt(
  apiKey: string,
  prompt: string,
  limitOverride?: number,
  demo = false
): Promise<ProspectSearchResult & { querySummary: string }> {
  const intent = promptToCrustdataQuery(prompt)
  const limit = limitOverride ?? intent.limit
  const capped = Math.min(Math.max(limit, 1), 100)

  if (demo || apiKey === 'demo') {
    return {
      prospects: buildDemoCrustdataProspects(capped),
      mode: 'demo',
      querySummary: intent.summary
    }
  }

  const data = await searchPeople(apiKey, capped, intent.filters)
  const prospects = (data.profiles ?? []).map(mapProfile)
  return { prospects, mode: 'live', total: prospects.length, querySummary: intent.summary }
}

export async function searchGtmSoftwarePeople(
  apiKey: string,
  limit: number,
  demo = false
): Promise<ProspectSearchResult> {
  const capped = Math.min(Math.max(limit, 1), 100)
  if (demo || apiKey === 'demo') {
    return { prospects: buildDemoCrustdataProspects(capped), mode: 'demo' }
  }

  const data = await searchPeople(apiKey, capped, defaultFilters())
  const prospects = (data.profiles ?? []).map(mapProfile)
  return { prospects, mode: 'live', total: prospects.length }
}

export function buildDemoCrustdataProspects(limit: number): ContextProspect[] {
  const companies = [
    'Clearstack',
    'Harbor AI',
    'OrbitOps',
    'Ledgerly',
    'Vaultline',
    'Summit Grid',
    'Copperline',
    'Nimbus CRM'
  ]
  const out: ContextProspect[] = []
  for (let i = 0; i < limit; i++) {
    const company = companies[i % companies.length]
    const title = GTM_TITLES[i % GTM_TITLES.length]
    const externalId = `crustdata_demo_${i + 1}`
    out.push({
      externalId,
      name: `Demo Prospect ${i + 1}`,
      company,
      title,
      email: `prospect${i + 1}@${company.toLowerCase().replace(/\s+/g, '')}.com`,
      phone: `+1-555-${String(1000 + i).slice(-4)}`,
      city: 'San Francisco',
      accountName: company,
      linkedinUrl: `https://www.linkedin.com/in/demo${i + 1}`,
      companyIndustry: 'computer software',
      context: [`${title} at ${company}`]
    })
  }
  return out
}

export function ensureCrustdataConnection(
  store: JsonStore,
  orgId: string,
  serverConfig: ServerConfig
) {
  const apiKey = serverConfig.crustdata.apiKey.trim()
  if (!apiKey) return getConnection(store, orgId, 'crustdata')

  const existing = getConnection(store, orgId, 'crustdata')
  if (existing?.status === 'connected') {
    try {
      const secrets = readSecrets(existing)
      if (secrets.accessToken === apiKey) return existing
    } catch {
      /* re-upsert below */
    }
  }

  return upsertConnection(store, {
    orgId,
    provider: 'crustdata',
    status: 'connected',
    accountLabel: 'Crustdata',
    secrets: { accessToken: apiKey } satisfies ProviderSecrets,
    meta: { mode: apiKey === 'demo' ? 'demo' : 'live', source: 'env' }
  })
}

export function resolveCrustdataApiKey(
  store: JsonStore,
  orgId: string,
  serverConfig: ServerConfig
): { apiKey: string; demo: boolean } | null {
  ensureCrustdataConnection(store, orgId, serverConfig)
  const conn = getConnection(store, orgId, 'crustdata')
  if (conn?.status === 'connected') {
    const secrets = readSecrets(conn)
    const apiKey = secrets.accessToken?.trim()
    if (apiKey) return { apiKey, demo: apiKey === 'demo' || conn.meta?.mode === 'demo' }
  }
  if (serverConfig.crustdata.apiKey.trim()) {
    const apiKey = serverConfig.crustdata.apiKey.trim()
    return { apiKey, demo: apiKey === 'demo' }
  }
  return null
}
