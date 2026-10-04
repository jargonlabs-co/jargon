import { encryptJson, uid } from '../crypto'
import type { ServerConfig } from '../config'
import { isProduction } from '../env'
import { createOAuthState, oauthRedirectUri, readSecrets, type ProviderSecrets } from '../connections'
import type { Connection } from '../types'
import type { DataStore } from '../store'
import { hasReachableContact, isRealEmail } from '../../shared/priorityOverlay'
import { prospectsToContacts, factsFromProspect, type ContextProspect } from './prospects'
import { extraAttrs } from '../../shared/fieldCatalog'
import { normalizeLinkedInUrl } from '../../shared/linkedinUrl'
import { hubspotTime, scoreWarmth } from '../../shared/warmth'
import { setProjectCatalog } from '../fieldCatalogSync'

const HUBSPOT_TOKEN = 'https://api.hubapi.com/oauth/v1/token'
const HUBSPOT_CONTACTS = 'https://api.hubapi.com/crm/v3/objects/contacts'
const HUBSPOT_SEARCH = 'https://api.hubapi.com/crm/v3/objects/contacts/search'
const HUBSPOT_PROPERTIES = 'https://api.hubapi.com/crm/v3/properties/contacts'
const HUBSPOT_COMPANY_PROPERTIES = 'https://api.hubapi.com/crm/v3/properties/companies'
const HUBSPOT_COMPANIES_BATCH = 'https://api.hubapi.com/crm/v3/objects/companies/batch/read'
const HUBSPOT_BASE_PROPS = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'mobilephone',
  'jobtitle',
  'company',
  'city',
  'hs_linkedinid',
  'hs_linkedin_url',
  'linkedinbio',
  'website',
  'createdate',
  'lastmodifieddate',
  'associatedcompanyid',
  'hs_email_optout',
  'hs_timezone'
]
/** Contacts modified this recently with no email/phone/LinkedIn are treated as in-flight enrichment. */
export const RECENT_HUBSPOT_MS = 30 * 60 * 1000
const ENRICH_ATTEMPTS = 4
const ENRICH_DELAY_MS = 2000
const PROP_PRIORITY = /linkedin|lusha|phone|email|mobile|dial|enrich|intent|seniority|signal|funding|technolog|department/i
const HUBSPOT_USEFUL_PROPS = [
  'industry',
  'numberofemployees',
  'annualrevenue',
  'country',
  'state',
  'lifecyclestage',
  'hs_lead_status',
  'notes_last_contacted',
  'hs_last_sales_activity_timestamp',
  'hs_sales_email_last_replied',
  'linkedinbio',
  'hs_linkedin_url',
  'job_function',
  'seniority',
  'intent_topics',
  'intent_topics_count',
  'intent_topics_average_score'
]
const HUBSPOT_COMPANY_BASE_PROPS = [
  'name',
  'domain',
  'industry',
  'numberofemployees',
  'annualrevenue',
  'description'
]
/** Already mapped onto the contact (company, domain, industry, size, revenue) or bookkeeping. */
const HUBSPOT_COMPANY_SKIP = [
  'name',
  'domain',
  'industry',
  'numberofemployees',
  'annualrevenue',
  'createdate',
  'lastmodifieddate',
  'hs_createdate',
  'hs_lastmodifieddate',
  'hs_object_id'
]
/** Company properties get their own budget so contact fields can't crowd them out. */
const MAX_COMPANY_ATTRS = 20

async function hubspotPropertyNames(accessToken: string): Promise<string[]> {
  const names = [...HUBSPOT_BASE_PROPS]
  try {
    const res = await fetch(HUBSPOT_PROPERTIES, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return names
    const json = (await res.json()) as {
      results?: Array<{ name?: string; hidden?: boolean; hubspotDefined?: boolean }>
    }
    for (const prop of json.results ?? []) {
      const name = prop.name?.trim()
      if (!name || prop.hidden) continue
      if (prop.hubspotDefined === false || HUBSPOT_USEFUL_PROPS.includes(name)) names.push(name)
    }
  } catch {
    /* keep base props */
  }
  return prioritizeHubSpotProperties(names)
}

export function prioritizeHubSpotProperties(names: string[]): string[] {
  const unique = [...new Set(names)]
  const rest = unique.filter((name) => !HUBSPOT_BASE_PROPS.includes(name))
  const priority = rest.filter((name) => PROP_PRIORITY.test(name))
  const other = rest.filter((name) => !PROP_PRIORITY.test(name))
  return [...HUBSPOT_BASE_PROPS, ...priority, ...other].slice(0, 80)
}

export type HubSpotContactPull = {
  reachable: ContextProspect[]
  pending: ContextProspect[]
  recentlyPending: number
}

export function classifyHubSpotPull(
  prospects: ContextProspect[],
  now = Date.now()
): HubSpotContactPull {
  const reachable: ContextProspect[] = []
  const pending: ContextProspect[] = []
  for (const prospect of prospects) {
    if (hasReachableContact(prospect)) reachable.push(prospect)
    else if (prospect.name.trim()) pending.push(prospect)
  }
  const recentlyPending = pending.filter((prospect) => isRecentlyTouched(prospect, now)).length
  return { reachable, pending, recentlyPending }
}

export function isRecentlyTouched(prospect: { lastModifiedAt?: number }, now = Date.now()): boolean {
  const at = prospect.lastModifiedAt
  return typeof at === 'number' && Number.isFinite(at) && now - at >= 0 && now - at <= RECENT_HUBSPOT_MS
}

export function hubspotEnrichmentWaitMessage(pending: number): string {
  const noun = pending === 1 ? 'contact was' : 'contacts were'
  const verb = pending === 1 ? 'has' : 'have'
  return `${pending} HubSpot ${noun} just added but still ${verb} no email, phone, or LinkedIn. Wait for enrichment to finish writing into HubSpot, then call list_crm_contacts again. Do not enroll and do not save_research until those fields exist.`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchHubSpotContacts(
  accessToken: string,
  limit: number,
  demo: boolean
): Promise<ContextProspect[]> {
  const pull = await pullHubSpotContacts(accessToken, limit, demo)
  return pull.reachable
}

export async function pullHubSpotContacts(
  accessToken: string,
  limit: number,
  demo: boolean
): Promise<HubSpotContactPull> {
  const capped = Math.min(Math.max(limit, 1), 200)
  if (demo || accessToken === 'demo-hubspot-token') {
    return { reachable: [], pending: [], recentlyPending: 0 }
  }

  const props = await hubspotPropertyNames(accessToken)
  const rows: Array<{ id: string; properties?: Record<string, string | null> }> = []
  let after: string | undefined
  let pages = 0
  while (rows.length < 500 && pages < 6) {
    const pageSize = Math.min(100, 500 - rows.length)
    const page = await fetchHubSpotContactPage(accessToken, props, pageSize, after)
    if (!page) break
    for (const row of page.results) {
      rows.push(row)
      if (rows.length >= 500) break
    }
    after = page.after
    pages += 1
    if (!after || !page.results.length) break
  }
  const companies = await fetchHubSpotCompaniesByIds(
    accessToken,
    rows.map((row) => (row.properties?.associatedcompanyid ?? '').trim()).filter(Boolean)
  )
  const scanned = rows.map((row) =>
    prospectFromHubSpotRow(row, companies.get((row.properties?.associatedcompanyid ?? '').trim()))
  )
  const classified = classifyHubSpotPull(scanned)
  return {
    reachable: classified.reachable.slice(0, capped),
    pending: classified.pending.slice(0, 100),
    recentlyPending: classified.recentlyPending
  }
}

/** Retry while enrichment is still writing email/phone/LinkedIn into HubSpot. */
export async function pullHubSpotContactsUntilReady(
  accessToken: string,
  limit: number,
  demo: boolean,
  opts?: { attempts?: number; delayMs?: number }
): Promise<HubSpotContactPull> {
  const attempts = Math.max(1, opts?.attempts ?? ENRICH_ATTEMPTS)
  const delayMs = Math.max(0, opts?.delayMs ?? ENRICH_DELAY_MS)
  let pull = await pullHubSpotContacts(accessToken, limit, demo)
  for (let i = 1; i < attempts && pull.recentlyPending > 0; i++) {
    if (delayMs) await sleep(delayMs)
    pull = await pullHubSpotContacts(accessToken, limit, demo)
  }
  return pull
}

type HubSpotPage = {
  results: Array<{ id: string; properties?: Record<string, string | null> }>
  after?: string
}

async function fetchHubSpotContactPage(
  accessToken: string,
  props: string[],
  pageSize: number,
  after?: string
): Promise<HubSpotPage | null> {
  const searched = await searchHubSpotContactPage(accessToken, props, pageSize, after)
  if (searched) return searched
  return listHubSpotContactPage(accessToken, props, pageSize, after)
}

async function searchHubSpotContactPage(
  accessToken: string,
  props: string[],
  pageSize: number,
  after?: string
): Promise<HubSpotPage | null> {
  try {
    const res = await fetch(HUBSPOT_SEARCH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: '0' }]
          }
        ],
        sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }],
        properties: props,
        limit: pageSize,
        after: after || '0'
      })
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      results?: Array<{ id: string; properties?: Record<string, string | null> }>
      paging?: { next?: { after?: string } }
    }
    return { results: json.results ?? [], after: json.paging?.next?.after }
  } catch {
    return null
  }
}

async function hubspotCompanyPropertyNames(accessToken: string): Promise<string[]> {
  const names = [...HUBSPOT_COMPANY_BASE_PROPS]
  try {
    const res = await fetch(HUBSPOT_COMPANY_PROPERTIES, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return names
    const json = (await res.json()) as {
      results?: Array<{ name?: string; hidden?: boolean; hubspotDefined?: boolean }>
    }
    for (const prop of json.results ?? []) {
      const name = prop.name?.trim()
      if (!name || prop.hidden) continue
      if (prop.hubspotDefined === false || PROP_PRIORITY.test(name) || HUBSPOT_USEFUL_PROPS.includes(name)) {
        names.push(name)
      }
    }
  } catch {
    /* keep base props */
  }
  return [...new Set(names)].slice(0, 40)
}

async function fetchHubSpotCompaniesByIds(
  accessToken: string,
  ids: string[]
): Promise<Map<string, Record<string, string | null>>> {
  const map = new Map<string, Record<string, string | null>>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return map
  const props = await hubspotCompanyPropertyNames(accessToken)
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    try {
      const res = await fetch(HUBSPOT_COMPANIES_BATCH, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: props,
          inputs: chunk.map((id) => ({ id }))
        })
      })
      if (!res.ok) continue
      const json = (await res.json()) as {
        results?: Array<{ id?: string; properties?: Record<string, string | null> }>
      }
      for (const result of json.results ?? []) {
        const id = result.id?.trim()
        if (!id) continue
        map.set(id, result.properties ?? {})
      }
    } catch {
      /* skip this chunk */
    }
  }
  return map
}

async function listHubSpotContactPage(
  accessToken: string,
  props: string[],
  pageSize: number,
  after?: string
): Promise<HubSpotPage | null> {
  const url = new URL(HUBSPOT_CONTACTS)
  url.searchParams.set('limit', String(pageSize))
  url.searchParams.set('properties', props.join(','))
  if (after) url.searchParams.set('after', after)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`HubSpot contacts failed: ${await res.text()}`)
  const json = (await res.json()) as {
    results?: Array<{ id: string; properties?: Record<string, string | null> }>
    paging?: { next?: { after?: string } }
  }
  return { results: json.results ?? [], after: json.paging?.next?.after }
}

export function hubspotAuthUrl(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  userId: string
): string {
  const state = createOAuthState(store, { orgId, userId, provider: 'hubspot' })
  if (!config.hubspot.clientId) {
    return `${config.publicUrl}/oauth/hubspot/callback?code=demo&state=${state.id}`
  }
  const url = new URL('https://app.hubspot.com/oauth/authorize')
  url.searchParams.set('client_id', config.hubspot.clientId)
  url.searchParams.set('redirect_uri', oauthRedirectUri(config, 'hubspot'))
  url.searchParams.set('scope', config.hubspot.scopes)
  url.searchParams.set('state', state.id)
  return url.toString()
}

export function isDemoHubSpot(config: ServerConfig, conn: Connection): boolean {
  return readSecrets(conn).accessToken === 'demo-hubspot-token' || !config.hubspot.clientId
}

/** A live access token; HubSpot's expire after 30 minutes, so this refreshes and saves when needed. */
export async function hubspotAccessToken(
  store: DataStore,
  config: ServerConfig,
  conn: Connection,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const secrets = readSecrets(conn)
  if (isDemoHubSpot(config, conn)) return secrets.accessToken
  if (secrets.accessToken && (!secrets.expiresAt || secrets.expiresAt - 60_000 > Date.now())) {
    return secrets.accessToken
  }
  const markError = () =>
    store.update((db) => {
      const row = db.connections.find((c) => c.id === conn.id)
      if (!row) return
      row.status = 'error'
      row.error = 'Reconnect HubSpot'
      row.updatedAt = Date.now()
    })
  if (!secrets.refreshToken) {
    markError()
    throw new Error('HubSpot needs to be reconnected in Jargon (Account → Data).')
  }
  const res = await fetcher(HUBSPOT_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      redirect_uri: oauthRedirectUri(config, 'hubspot'),
      refresh_token: secrets.refreshToken
    })
  })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) markError()
    throw new Error(`HubSpot token refresh failed (${res.status}). Reconnect HubSpot in Jargon (Account → Data).`)
  }
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  const next: ProviderSecrets = {
    ...secrets,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || secrets.refreshToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
  }
  store.update((db) => {
    const row = db.connections.find((c) => c.id === conn.id)
    if (!row) return
    row.secretsCipher = encryptJson(next)
    row.updatedAt = Date.now()
  })
  return next.accessToken
}

export async function exchangeHubSpotCode(
  config: ServerConfig,
  code: string
): Promise<ProviderSecrets & { accountLabel: string }> {
  if (code === 'demo' || !config.hubspot.clientId) {
    if (isProduction()) throw new Error('HubSpot OAuth is not configured on this server')
    return {
      accessToken: 'demo-hubspot-token',
      accountLabel: 'HubSpot (demo portal)'
    }
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.hubspot.clientId,
    client_secret: config.hubspot.clientSecret,
    redirect_uri: oauthRedirectUri(config, 'hubspot'),
    code
  })
  const res = await fetch(HUBSPOT_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`HubSpot token exchange failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    tokenType: json.token_type,
    accountLabel: 'HubSpot'
  }
}

export function prospectFromHubSpotRow(
  row: {
    id: string
    properties?: Record<string, string | null>
  },
  companyProperties?: Record<string, string | null>
): ContextProspect {
  const p = row.properties ?? {}
  const companyP = companyProperties ?? {}
  const first = (p.firstname ?? '').trim()
  const last = (p.lastname ?? '').trim()
  const email = emailFromHubSpot(p)
  const name = `${first} ${last}`.trim() || email
  const company = (p.company ?? '').trim() || (companyP.name ?? '').trim()
  const linkedin = linkedinFromHubSpot(p)
  const industry = (p.industry ?? '').trim() || (companyP.industry ?? '').trim()
  const size = (p.numberofemployees ?? '').trim() || (companyP.numberofemployees ?? '').trim()
  const attrs = extraAttrs(p as Record<string, unknown>, [
    'email',
    'firstname',
    'lastname',
    'phone',
    'mobilephone',
    'jobtitle',
    'company',
    'city',
    'hs_linkedinid',
    'hs_linkedin_url',
    'linkedinbio',
    'website',
    'createdate',
    'lastmodifieddate',
    'associatedcompanyid',
    'hs_email_optout',
    'hs_timezone'
  ])
  Object.assign(attrs, lushaAttrsFromHubSpot(p, companyP))
  const companyAttrs = Object.entries(extraAttrs(companyP as Record<string, unknown>, HUBSPOT_COMPANY_SKIP))
  for (const [key, value] of companyAttrs.slice(0, MAX_COMPANY_ATTRS)) {
    if (attrs[`company_${key}`] === undefined) attrs[`company_${key}`] = value
  }
  if ((p.hs_email_optout ?? '').trim().toLowerCase() === 'true') attrs.email_opt_out = true
  if ((p.hs_timezone ?? '').trim()) attrs.hs_timezone = p.hs_timezone
  const lastActivityAt = hubspotTime(p.notes_last_contacted) ?? hubspotTime(p.hs_last_sales_activity_timestamp)
  const lastReplyAt = hubspotTime(p.hs_sales_email_last_replied)
  const warmth = scoreWarmth({
    lifecycleStage: p.lifecyclestage ?? undefined,
    leadStatus: p.hs_lead_status ?? undefined,
    lastActivityAt,
    lastReplyAt
  })
  if ((p.lifecyclestage ?? '').trim()) attrs.lifecyclestage = p.lifecyclestage
  if ((p.hs_lead_status ?? '').trim()) attrs.hs_lead_status = p.hs_lead_status
  if (lastActivityAt) attrs.lastActivityAt = lastActivityAt
  if ((p.annualrevenue ?? '').trim()) attrs.annualrevenue = p.annualrevenue
  else if ((companyP.annualrevenue ?? '').trim()) attrs.annualrevenue = companyP.annualrevenue
  attrs.warmth = warmth
  const domain =
    (p.website ?? '').replace(/^https?:\/\//, '').split('/')[0] ||
    (companyP.domain ?? '').replace(/^https?:\/\//, '').split('/')[0] ||
    undefined
  const prospect = {
    externalId: row.id,
    name,
    company,
    title: (p.jobtitle ?? '').trim(),
    email,
    phone: phoneFromHubSpot(p),
    city: (p.city ?? '').trim() || '',
    accountName: company,
    linkedinUrl: linkedin,
    companyDomain: domain || undefined,
    companyIndustry: industry || undefined,
    companySize: size || undefined,
    warmth,
    lastModifiedAt: hubspotTime(p.lastmodifieddate) ?? hubspotTime(p.createdate) ?? undefined,
    attrs
  }
  return { ...prospect, context: factsFromProspect(prospect) }
}

function firstHubSpotValue(p: Record<string, string | null>, names: string[]): string {
  for (const name of names) {
    const value = (p[name] ?? '').trim()
    if (value) return value
  }
  return ''
}

function firstHubSpotMatch(p: Record<string, string | null>, pattern: RegExp): string {
  for (const [key, raw] of Object.entries(p)) {
    if (!pattern.test(key)) continue
    const value = (raw ?? '').trim()
    if (value) return value
  }
  return ''
}

function splitHubSpotList(value: string): string[] {
  return value.split(/[;|,]/).map((item) => item.trim()).filter(Boolean)
}

function hubSpotNumber(value: string): number | undefined {
  const n = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Lift Lusha / intent HubSpot fields into ranking attrs. Contact wins over company. */
export function lushaAttrsFromHubSpot(
  contact: Record<string, string | null>,
  company?: Record<string, string | null>
): Record<string, unknown> {
  const src: Record<string, string | null> = { ...(company ?? {}), ...contact }
  const attrs: Record<string, unknown> = {}
  const topics =
    firstHubSpotValue(src, ['intent_topics', 'lusha_intent_topics', 'hs_intent_topics']) ||
    firstHubSpotMatch(src, /intent_topics$/i)
  const topicList = splitHubSpotList(topics)
  const signal =
    firstHubSpotValue(src, ['lusha_latest_signal', 'latest_signal']) ||
    firstHubSpotMatch(src, /lusha_.*signal$/i)
  const gtm: string[] = []
  for (const topic of topicList.slice(0, 4)) gtm.push(`Intent: ${topic}`)
  if (signal) gtm.push(signal)
  if (gtm.length) attrs.gtm_initiative = gtm
  if (topics) attrs.intent_topics = topics
  const hiring =
    firstHubSpotValue(src, ['lusha_hiring', 'hiring_roles', 'open_roles']) ||
    firstHubSpotMatch(src, /lusha_hiring|open_roles/i)
  if (hiring) attrs.hiring = splitHubSpotList(hiring).slice(0, 4)
  const seniority =
    firstHubSpotValue(src, ['seniority', 'hs_seniority', 'lusha_seniority']) ||
    firstHubSpotMatch(src, /seniority/i)
  if (seniority) attrs.seniority = seniority
  const department =
    firstHubSpotValue(src, ['lusha_department', 'department', 'job_function']) ||
    firstHubSpotMatch(src, /department|job_function/i)
  if (department) attrs.department = department
  const funding =
    firstHubSpotValue(src, ['lusha_funding_stage', 'funding_stage', 'hs_funding_stage']) ||
    firstHubSpotMatch(src, /funding/i)
  if (funding) attrs.funding_stage = funding
  const tech =
    firstHubSpotValue(src, ['technologies', 'lusha_technologies', 'hs_technologies']) ||
    firstHubSpotMatch(src, /technolog/i)
  if (tech) attrs.technologies = tech
  const intentScore = hubSpotNumber(
    firstHubSpotValue(src, [
      'intent_topics_average_score',
      'lusha_intent_score',
      'lusha_signal_score',
      'intent_score'
    ]) || firstHubSpotMatch(src, /intent.*(score|average)|signal_score/i)
  )
  if (intentScore != null) attrs.intent_score = intentScore
  const intentCount = hubSpotNumber(
    firstHubSpotValue(src, ['intent_topics_count', 'lusha_intent_topics_count']) ||
      firstHubSpotMatch(src, /intent_topics_count/i)
  )
  if (intentCount != null) attrs.intent_count = intentCount
  return attrs
}

function emailFromHubSpot(p: Record<string, string | null>): string {
  const primary = (p.email ?? '').trim()
  if (isRealEmail(primary)) return primary
  for (const [key, raw] of Object.entries(p)) {
    const value = (raw ?? '').trim()
    if (!isRealEmail(value)) continue
    if (/email|lusha/i.test(key)) return value
  }
  return primary
}

function phoneFromHubSpot(p: Record<string, string | null>): string {
  const primary = (p.phone ?? '').trim() || (p.mobilephone ?? '').trim()
  if (digits(primary) >= 10) return primary
  for (const [key, raw] of Object.entries(p)) {
    const value = (raw ?? '').trim()
    if (digits(value) < 10) continue
    if (/phone|mobile|dial|lusha/i.test(key)) return value
  }
  return primary
}

function linkedinFromHubSpot(p: Record<string, string | null>): string | undefined {
  const preferred = [
    p.hs_linkedin_url,
    p.linkedinbio,
    p.linkedin_url,
    p.linkedin,
    p.hs_linkedinid
  ]
  for (const raw of preferred) {
    const url = linkedinValue(raw)
    if (url) return url
  }
  for (const [key, raw] of Object.entries(p)) {
    if (!/linkedin|lusha/i.test(key) && !/linkedin\.com/i.test(raw ?? '')) continue
    const url = linkedinValue(raw)
    if (url) return url
  }
  return undefined
}

function linkedinValue(raw: string | null | undefined): string | undefined {
  const s = (raw ?? '').trim()
  if (!s || /^\d+$/.test(s)) return undefined
  return normalizeLinkedInUrl(s)
}

function digits(value: string): number {
  return value.replace(/\D/g, '').length
}

export function finishHubSpotOAuthHtml(config: ServerConfig, ok: boolean, message: string): string {
  const next = `${config.appUrl}/`
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? 'HubSpot connected' : 'HubSpot connection failed'}</h2>
  <p>${message}</p>
  <p>Your tools will load contacts from this portal. Returning to Jargon…</p>
  <script>location.href=${JSON.stringify(next)}</script>
  <p><a href="${next}">Open Jargon</a></p>
  </body></html>`
}

export function writeHubSpotContactsToProjects(
  store: DataStore,
  orgId: string,
  prospects: ContextProspect[],
  projectId?: string
): number {
  let count = 0
  store.update((db) => {
    const projects = db.projects.filter(
      (p) => p.orgId === orgId && (!projectId || p.id === projectId)
    )
    for (const project of projects) {
      const contacts = prospectsToContacts(
        orgId,
        project.id,
        prospects.filter(hasReachableContact),
        'hubspot'
      )
      db.contacts = db.contacts.filter((c) => c.projectId !== project.id)
      db.contacts.push(...contacts)
      setProjectCatalog(db, project.id)
      project.answers = {
        ...project.answers,
        data_source: 'hubspot',
        prospect_source: 'hubspot',
        prospect_count: String(contacts.length),
        segment: project.answers.segment || 'HubSpot contacts'
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
        summary: `Loaded ${contacts.length} contacts from HubSpot`,
        createdAt: Date.now()
      })
      count = contacts.length
    }
  })
  return count
}
