import { uid } from '../crypto'
import type { Contact } from '../types'
import type { ServerConfig } from '../config'
import {
  getConnection,
  readSecrets,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import type { JsonStore } from '../store'

const APOLLO_BASE = 'https://api.apollo.io/api/v1'

export type ApolloPerson = {
  id?: string
  name?: string
  first_name?: string
  last_name?: string
  title?: string
  email?: string
  linkedin_url?: string
  city?: string
  state?: string
  country?: string
  phone_numbers?: Array<{ sanitized_number?: string; raw_number?: string }>
  organization?: ApolloOrganization
}

export type ApolloOrganization = {
  id?: string
  name?: string
  website_url?: string
  primary_domain?: string
  linkedin_url?: string
  industry?: string
  estimated_num_employees?: number
  annual_revenue_printed?: string
  annual_revenue?: number
  city?: string
  state?: string
  country?: string
  phone?: string
  short_description?: string
}

export type ApolloEnrichment = {
  person?: ApolloPerson | null
  organization?: ApolloOrganization | null
  mode: 'live' | 'demo'
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'x-api-key': apiKey
  }
}

function domainFromEmail(email?: string): string | undefined {
  if (!email?.includes('@')) return undefined
  const domain = email.split('@')[1]?.trim().toLowerCase()
  if (!domain || domain === 'gmail.com' || domain === 'yahoo.com' || domain === 'hotmail.com') {
    return undefined
  }
  return domain
}

function domainFromCompany(company?: string): string | undefined {
  if (!company?.trim()) return undefined
  const cleaned = company.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!cleaned) return undefined
  return `${cleaned}.com`
}

function pickPhone(person?: ApolloPerson | null): string | undefined {
  const first = person?.phone_numbers?.find((p) => p.sanitized_number || p.raw_number)
  return first?.sanitized_number || first?.raw_number
}

function formatEmployees(n?: number): string | undefined {
  if (!n || !Number.isFinite(n)) return undefined
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

function demoEnrichment(contact: Contact): ApolloEnrichment {
  const company = contact.company || contact.accountName || 'Acme Corp'
  return {
    mode: 'demo',
    person: {
      id: 'demo-person',
      name: contact.name,
      title: contact.title || 'VP Sales',
      email: contact.email || undefined,
      city: contact.city || 'San Francisco',
      linkedin_url: 'https://www.linkedin.com/in/demo',
      phone_numbers: contact.phone ? [{ sanitized_number: contact.phone }] : [{ sanitized_number: '+1 415 555 0100' }],
      organization: {
        id: 'demo-org',
        name: company,
        primary_domain: domainFromEmail(contact.email) || domainFromCompany(company),
        industry: 'information technology & services',
        estimated_num_employees: 250,
        annual_revenue_printed: '25M',
        city: contact.city || 'San Francisco',
        short_description: 'Software company enrichment from Apollo.'
      }
    },
    organization: {
      id: 'demo-org',
      name: company,
      primary_domain: domainFromEmail(contact.email) || domainFromCompany(company),
      industry: 'information technology & services',
      estimated_num_employees: 250,
      annual_revenue_printed: '25M',
      city: contact.city || 'San Francisco',
      short_description: 'Software company enrichment from Apollo.'
    }
  }
}

export async function validateApolloKey(apiKey: string): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  if (!apiKey.trim()) return { ok: false, error: 'API key required' }
  if (apiKey.trim() === 'demo') return { ok: true, label: 'Apollo' }

  try {
    // Probe with an impossible email. 401/403 = bad/scoped key; other statuses mean the key was accepted.
    const probe = await fetch(`${APOLLO_BASE}/people/match?email=__jargon_probe_invalid__@example.invalid`, {
      method: 'POST',
      headers: headers(apiKey.trim()),
      body: JSON.stringify({})
    })
    if (probe.status === 401 || probe.status === 403) {
      const text = await probe.text()
      return { ok: false, error: text || 'Invalid Apollo API key or missing people enrichment scope' }
    }
    return { ok: true, label: 'Apollo' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Apollo validation failed' }
  }
}

export async function enrichPerson(
  apiKey: string,
  contact: Contact,
  demo = false
): Promise<ApolloPerson | null> {
  if (demo || apiKey === 'demo') return demoEnrichment(contact).person ?? null

  const params = new URLSearchParams()
  if (contact.email) params.set('email', contact.email)
  if (contact.name) params.set('name', contact.name)
  const domain = domainFromEmail(contact.email)
  if (domain) params.set('domain', domain)
  if (contact.company) params.set('organization_name', contact.company)
  params.set('reveal_personal_emails', 'false')
  params.set('reveal_phone_number', 'false')

  const res = await fetch(`${APOLLO_BASE}/people/match?${params.toString()}`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({})
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Apollo people enrich failed (${res.status})`)
  }
  const data = (await res.json()) as { person?: ApolloPerson | null }
  return data.person ?? null
}

export async function enrichOrganization(
  apiKey: string,
  contact: Contact,
  demo = false
): Promise<ApolloOrganization | null> {
  if (demo || apiKey === 'demo') return demoEnrichment(contact).organization ?? null

  const params = new URLSearchParams()
  const domain = domainFromEmail(contact.email)
  if (domain) params.set('domain', domain)
  if (contact.company) params.set('name', contact.company)
  if (!domain && !contact.company) return null

  const res = await fetch(`${APOLLO_BASE}/organizations/enrich?${params.toString()}`, {
    method: 'GET',
    headers: headers(apiKey)
  })
  if (!res.ok) {
    // Soft-fail org enrich if person already succeeded — org match is best-effort.
    if (res.status === 404 || res.status === 422) return null
    const text = await res.text()
    throw new Error(text || `Apollo org enrich failed (${res.status})`)
  }
  const data = (await res.json()) as { organization?: ApolloOrganization | null }
  return data.organization ?? null
}

export async function enrichContactFromApollo(
  apiKey: string,
  contact: Contact,
  demo = false
): Promise<ApolloEnrichment> {
  if (demo || apiKey === 'demo') return demoEnrichment(contact)

  const person = await enrichPerson(apiKey, contact, false)
  const orgFromPerson = person?.organization ?? null
  let organization = orgFromPerson
  if (!organization) {
    organization = await enrichOrganization(apiKey, contact, false)
  }
  return { person, organization, mode: 'live' }
}

/** GTM-facing titles used for “top prospects to contact today” demos. */
export const GTM_TITLES = [
  'VP of Sales',
  'Head of Sales',
  'Chief Revenue Officer',
  'VP Revenue',
  'Head of Growth',
  'VP Marketing',
  'Head of Demand Generation',
  'Director of Demand Generation',
  'SDR Manager',
  'BDR Manager',
  'RevOps Lead',
  'Head of Revenue Operations',
  'GTM Lead',
  'VP Go-To-Market'
]

export type ApolloProspect = {
  externalId: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  accountName: string
  linkedinUrl?: string
  companyDomain?: string
  companyIndustry?: string
  companySize?: string
  context?: string[]
}

export type ApolloSearchResult = {
  prospects: ApolloProspect[]
  mode: 'live' | 'demo'
  total?: number
}

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h
}

/** Sample talk-track context for dialer (tenure, funding, hiring signals). */
export function buildProspectContext(input: {
  id?: string
  company: string
  title?: string
  companySize?: string
  companyIndustry?: string
}): string[] {
  const company = input.company || 'their company'
  const h = hashSeed(input.id || `${input.company}:${input.title}`)
  const tenure = ['2 months', '3 months', '4 months', '6 months', '9 months', 'about a year'][
    h % 6
  ]
  const round = ['Series A', 'Series B', 'Series C', 'seed extension'][(h >> 3) % 4]
  const prev = ['a Series A SaaS', 'a PLG startup', 'an enterprise CRM', 'a fintech Series B'][
    (h >> 5) % 4
  ]
  const size = input.companySize ? `${input.companySize} employees` : null
  const pool = [
    `Started at ${company} ${tenure} ago`,
    `Recent ${round} raise`,
    `Hiring SDRs this quarter`,
    `Previously at ${prev}`,
    `Posted about outbound last week`,
    `New in seat — good intro window`,
    size ? `${size} · expanding GTM` : `GTM team scaling at ${company}`,
    input.companyIndustry ? `Focus: ${input.companyIndustry}` : `Software / SaaS account`,
    `${input.title || 'Leader'} owns pipeline targets`
  ]
  const a = pool[h % pool.length]
  const b = pool[(h + 3) % pool.length]
  const c = pool[(h + 7) % pool.length]
  return [...new Set([a, b, c])].slice(0, 2)
}

function mapPersonToProspect(person: ApolloPerson, index: number): ApolloProspect {
  const org = person.organization
  const first = person.first_name
  const last = person.last_name
  const name =
    person.name?.trim() ||
    [first, last].filter(Boolean).join(' ').trim() ||
    `Prospect ${index + 1}`
  const company = org?.name?.trim() || 'Software company'
  const domain =
    org?.primary_domain ||
    org?.website_url?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') ||
    domainFromCompany(company)
  const email =
    person.email ||
    `${(first || 'prospect').toLowerCase()}.${(last || String(index)).toLowerCase()}@${domain || 'example.com'}`
  const cityParts = [person.city, person.state].filter(Boolean)
  const title = person.title || GTM_TITLES[index % GTM_TITLES.length]
  const companySize = formatEmployees(org?.estimated_num_employees)
  const companyIndustry = org?.industry || 'computer software'
  const externalId = person.id || `apollo_${index + 1}`

  return {
    externalId,
    name,
    company,
    title,
    email,
    phone: pickPhone(person) || `+1-555-${String(1000 + index).slice(-4)}`,
    city: cityParts.join(', ') || org?.city || '',
    accountName: company,
    linkedinUrl: person.linkedin_url,
    companyDomain: domain,
    companyIndustry,
    companySize,
    context: buildProspectContext({
      id: externalId,
      company,
      title,
      companySize,
      companyIndustry
    })
  }
}

/** Demo list: GTM titles at software / SaaS companies (no API key required). */
export function buildDemoGtmSoftwareProspects(limit: number): ApolloProspect[] {
  const first = [
    'Ava', 'Marcus', 'Sofia', 'Jonah', 'Priya', 'Elena', 'Chris', 'Noah', 'Maya', 'Leo',
    'Iris', 'Owen', 'Nina', 'Kai', 'Ruth', 'Sam', 'Tess', 'Victor', 'Willa', 'Zane',
    'Amara', 'Blake', 'Cora', 'Devon', 'Eden', 'Felix', 'Gia', 'Hugo', 'Ivy', 'Jules'
  ]
  const last = [
    'Chen', 'Lee', 'Grant', 'Price', 'Shah', 'Brooks', 'Nguyen', 'Patel', 'Kim', 'Ross',
    'Ortiz', 'Walsh', 'Diaz', 'Singh', 'Cohen'
  ]
  const companies = [
    { name: 'Clearstack', domain: 'clearstack.io', size: '120' },
    { name: 'Harbor AI', domain: 'harborai.com', size: '85' },
    { name: 'OrbitOps', domain: 'orbitops.com', size: '210' },
    { name: 'Ledgerly', domain: 'ledgerly.com', size: '340' },
    { name: 'Vaultline', domain: 'vaultline.io', size: '95' },
    { name: 'Summit Grid', domain: 'summitgrid.com', size: '160' },
    { name: 'Copperline', domain: 'copperline.ai', size: '70' },
    { name: 'Paynest', domain: 'paynest.com', size: '450' },
    { name: 'Nimbus CRM', domain: 'nimbuscrm.com', size: '280' },
    { name: 'Relaystack', domain: 'relaystack.io', size: '55' },
    { name: 'Brightloop', domain: 'brightloop.com', size: '190' },
    { name: 'Forgecloud', domain: 'forgecloud.com', size: '620' }
  ]
  const cities = [
    'San Francisco', 'Austin', 'Seattle', 'Denver', 'New York', 'Chicago', 'Boston', 'Remote'
  ]

  const out: ApolloProspect[] = []
  for (let i = 0; i < limit; i++) {
    const f = first[i % first.length]
    const l = last[(i * 3) % last.length]
    const company = companies[i % companies.length]
    const title = GTM_TITLES[i % GTM_TITLES.length]
    const externalId = `apollo_demo_${i + 1}`
    out.push({
      externalId,
      name: `${f} ${l}`,
      company: company.name,
      title,
      email: `${f.toLowerCase()}.${l.toLowerCase()}${i}@${company.domain}`,
      phone: `+1-555-${String(1000 + i).slice(-4)}`,
      city: cities[i % cities.length],
      accountName: company.name,
      linkedinUrl: `https://www.linkedin.com/in/${f.toLowerCase()}${l.toLowerCase()}${i}`,
      companyDomain: company.domain,
      companyIndustry: 'computer software',
      companySize: company.size,
      context: buildProspectContext({
        id: externalId,
        company: company.name,
        title,
        companySize: company.size,
        companyIndustry: 'computer software'
      })
    })
  }
  return out
}

export function apolloProspectsToContacts(
  orgId: string,
  projectId: string,
  prospects: ApolloProspect[]
): Contact[] {
  const now = Date.now()
  return prospects.map((p, i) => ({
    id: uid('ct'),
    orgId,
    projectId,
    name: p.name,
    company: p.company,
    title: p.title,
    email: p.email,
    phone: p.phone,
    city: p.city,
    status: i === 0 ? ('active' as const) : ('queued' as const),
    stepIndex: 0,
    notes: 'Apollo · GTM title · software industry',
    externalId: p.externalId,
    source: 'apollo' as const,
    accountName: p.accountName,
    linkedinUrl: p.linkedinUrl,
    companyDomain: p.companyDomain,
    companyIndustry: p.companyIndustry || 'computer software',
    companySize: p.companySize,
    context:
      p.context ??
      buildProspectContext({
        id: p.externalId,
        company: p.company,
        title: p.title,
        companySize: p.companySize,
        companyIndustry: p.companyIndustry
      }),
    channelsDone: [],
    createdAt: now,
    updatedAt: now
  }))
}

const SOFTWARE_INDUSTRY = /software|saas|information technology|internet|computer/i

/**
 * People API Search returns obfuscated records (no last name, email, or domain),
 * so it is only used to collect Apollo person IDs for enrichment.
 */
async function searchPersonIds(
  apiKey: string,
  page: number,
  perPage: number
): Promise<{ ids: string[]; total?: number }> {
  const params = new URLSearchParams()
  for (const title of GTM_TITLES) params.append('person_titles[]', title)
  for (const range of ['11,50', '51,200', '201,500', '501,1000']) {
    params.append('organization_num_employees_ranges[]', range)
  }
  params.set('include_similar_titles', 'true')
  params.set('q_keywords', 'software')
  params.set('page', String(page))
  params.set('per_page', String(perPage))

  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search?${params.toString()}`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({})
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Apollo people search failed (${res.status})`)
  }
  const data = (await res.json()) as {
    people?: Array<{ id?: string }>
    total_entries?: number
    pagination?: { total_entries?: number; total_pages?: number }
  }
  return {
    ids: (data.people ?? []).map((p) => p.id).filter((id): id is string => Boolean(id)),
    total: data.total_entries ?? data.pagination?.total_entries
  }
}

/** Bulk People Enrichment reveals name, email, and firmographics for up to 10 IDs per call. */
async function enrichPeopleByIds(apiKey: string, ids: string[]): Promise<ApolloPerson[]> {
  const params = new URLSearchParams({
    reveal_personal_emails: 'false',
    reveal_phone_number: 'false'
  })
  const res = await fetch(`${APOLLO_BASE}/people/bulk_match?${params.toString()}`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ details: ids.map((id) => ({ id })) })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Apollo bulk enrichment failed (${res.status})`)
  }
  const data = (await res.json()) as { matches?: Array<ApolloPerson | null> }
  return (data.matches ?? []).filter((m): m is ApolloPerson => Boolean(m))
}

/**
 * Search Apollo for GTM-title people at software companies, then enrich them so
 * names, emails, and company data are usable for outreach.
 * Falls back to generated prospects when apiKey is `demo` or `demo` flag is set.
 */
export async function searchGtmSoftwareProspects(
  apiKey: string,
  limit: number,
  demo = false
): Promise<ApolloSearchResult> {
  const capped = Math.min(Math.max(limit, 1), 100)
  if (demo || apiKey === 'demo') {
    return {
      prospects: buildDemoGtmSoftwareProspects(capped),
      mode: 'demo',
      total: capped
    }
  }

  const ids: string[] = []
  let total: number | undefined
  let page = 1
  // Small over-fetch so records without a usable email can be skipped.
  const idTarget = Math.min(capped + 20, 120)

  while (ids.length < idTarget && page <= 3) {
    const result = await searchPersonIds(apiKey, page, Math.min(idTarget, 100))
    total = result.total ?? total
    if (result.ids.length === 0) break
    ids.push(...result.ids)
    page += 1
  }

  // Enrichment consumes credits, so stop as soon as enough contacts have emails.
  const withEmail: ApolloPerson[] = []
  for (let i = 0; i < ids.length && withEmail.length < capped; i += 10) {
    const batch = await enrichPeopleByIds(apiKey, ids.slice(i, i + 10))
    withEmail.push(
      ...batch.filter((p) => p.email && !/email_not_unlocked/i.test(p.email))
    )
  }

  const softwareFirst = [
    ...withEmail.filter((p) => SOFTWARE_INDUSTRY.test(p.organization?.industry ?? '')),
    ...withEmail.filter((p) => !SOFTWARE_INDUSTRY.test(p.organization?.industry ?? ''))
  ]

  const prospects = softwareFirst.slice(0, capped).map(mapPersonToProspect)

  // Keep the workspace usable if the plan or filters return nothing.
  if (prospects.length === 0) {
    return {
      prospects: buildDemoGtmSoftwareProspects(capped),
      mode: 'demo',
      total: 0
    }
  }

  return { prospects, mode: 'live', total }
}

export function applyApolloEnrichment(
  contact: Contact,
  enrichment: ApolloEnrichment
): Partial<Contact> {
  const person = enrichment.person
  const org = enrichment.organization ?? person?.organization ?? null
  const phone = pickPhone(person)
  const cityParts = [person?.city, person?.state].filter(Boolean)
  const city = cityParts.join(', ') || org?.city || contact.city

  const companyBits = [
    org?.industry ? `Industry: ${org.industry}` : null,
    org?.estimated_num_employees
      ? `Employees: ${formatEmployees(org.estimated_num_employees)}`
      : null,
    org?.annual_revenue_printed
      ? `Revenue: ${org.annual_revenue_printed}`
      : org?.annual_revenue
        ? `Revenue: ${org.annual_revenue}`
        : null,
    org?.primary_domain || org?.website_url
      ? `Domain: ${org.primary_domain || org.website_url}`
      : null,
    person?.linkedin_url ? `LinkedIn: ${person.linkedin_url}` : null,
    org?.linkedin_url ? `Company LinkedIn: ${org.linkedin_url}` : null,
    org?.short_description ? `About: ${org.short_description}` : null
  ].filter(Boolean)

  const stamp = `Apollo enrichment · ${new Date().toISOString()}`
  const enrichmentNote = [stamp, ...companyBits].join('\n')
  const notes =
    contact.notes && contact.notes.includes('Apollo enrichment')
      ? contact.notes.replace(/Apollo enrichment[\s\S]*?(?=\n\n|$)/, enrichmentNote).trim()
      : [contact.notes?.trim(), enrichmentNote].filter(Boolean).join('\n\n')

  return {
    name: person?.name || contact.name,
    title: person?.title || contact.title,
    email: person?.email || contact.email,
    phone: phone || contact.phone,
    city: typeof city === 'string' && city ? city : contact.city,
    company: org?.name || contact.company,
    accountName: org?.name || contact.accountName || contact.company,
    externalId: person?.id || org?.id || contact.externalId,
    source: contact.source === 'hubspot' ? contact.source : 'apollo',
    linkedinUrl: person?.linkedin_url || contact.linkedinUrl,
    companyDomain: org?.primary_domain || org?.website_url || contact.companyDomain,
    companyIndustry: org?.industry || contact.companyIndustry,
    companySize: formatEmployees(org?.estimated_num_employees) || contact.companySize,
    companyRevenue: org?.annual_revenue_printed || contact.companyRevenue,
    enrichedAt: Date.now(),
    notes,
    updatedAt: Date.now()
  }
}

/**
 * Keep Apollo connected for an org when APOLLO_API_KEY is set in env —
 * no need to paste the key in the UI each time.
 */
export function ensureApolloConnection(
  store: JsonStore,
  orgId: string,
  serverConfig: ServerConfig
) {
  const apiKey = serverConfig.apollo.apiKey.trim()
  if (!apiKey) return getConnection(store, orgId, 'apollo')

  const existing = getConnection(store, orgId, 'apollo')
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
    provider: 'apollo',
    status: 'connected',
    accountLabel: apiKey === 'demo' ? 'Apollo' : 'Apollo',
    secrets: { accessToken: apiKey } satisfies ProviderSecrets,
    meta: { mode: apiKey === 'demo' ? 'demo' : 'live', source: 'env' }
  })
}

export function resolveApolloApiKey(
  store: JsonStore,
  orgId: string,
  serverConfig: ServerConfig
): { apiKey: string; demo: boolean } | null {
  ensureApolloConnection(store, orgId, serverConfig)
  const conn = getConnection(store, orgId, 'apollo')
  if (conn?.status === 'connected') {
    const secrets = readSecrets(conn)
    const apiKey = secrets.accessToken?.trim()
    if (apiKey) return { apiKey, demo: apiKey === 'demo' || conn.meta?.mode === 'demo' }
  }
  if (serverConfig.apollo.apiKey.trim()) {
    const apiKey = serverConfig.apollo.apiKey.trim()
    return { apiKey, demo: apiKey === 'demo' }
  }
  return null
}
