import { uid } from '../crypto'
import type { Warmth } from '../../shared/warmth'
import { signalLinesFromAttrs } from '../../shared/priorityOverlay'
import type { Contact, ContactStatus } from '../types'

export type ContextProspect = {
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
  warmth?: Warmth
  /** HubSpot lastmodifieddate / createdate, for spotting in-flight enrichment. */
  lastModifiedAt?: number
  context?: string[]
  companyOpenRoles?: Array<{
    title: string
    url?: string
    location?: string
    category?: string
  }>
  gtmInitiatives?: Array<{
    title: string
    url?: string
    snippet?: string
    source?: string
  }>
  attrs?: Record<string, unknown>
}

export type ProspectSearchResult = {
  prospects: ContextProspect[]
  mode: 'live' | 'demo'
  total?: number
}

function hashSeed(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return h
}

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

/** Real CRM/enrichment facts only — never invented funding, hiring, or tenure. */
export function factsFromProspect(p: {
  title?: string
  company?: string
  city?: string
  companyIndustry?: string
  companySize?: string
  companyDomain?: string
  linkedinUrl?: string
  attrs?: Record<string, unknown>
}): string[] {
  const lines: string[] = []
  const title = p.title?.trim()
  const company = p.company?.trim()
  if (title && company) lines.push(`${title} at ${company}`)
  else if (title) lines.push(title)
  else if (company) lines.push(company)
  for (const line of signalLinesFromAttrs(p.attrs)) {
    if (!lines.includes(line)) lines.push(line)
  }
  if (p.companyIndustry?.trim()) lines.push(p.companyIndustry.trim())
  if (p.companySize?.trim()) lines.push(`${p.companySize.trim()} employees`)
  if (p.city?.trim()) lines.push(p.city.trim())
  if (p.companyDomain?.trim()) lines.push(p.companyDomain.trim())
  const revenue = attrLine(p.attrs?.annualrevenue)
  if (revenue) lines.push(`Revenue ${revenue}`)
  if (p.linkedinUrl?.trim()) lines.push(p.linkedinUrl.trim())
  for (const [key, value] of Object.entries(p.attrs ?? {})) {
    if (skipFactAttr(key)) continue
    const text = attrLine(value)
    if (!text) continue
    lines.push(`${key.replace(/_/g, ' ')}: ${text}`)
    if (lines.length >= 8) break
  }
  return [...new Set(lines)].slice(0, 8)
}

const SKIP_FACT_ATTRS = new Set([
  'warmth',
  'lastActivityAt',
  'lifecyclestage',
  'hs_lead_status',
  'annualrevenue',
  'hiring',
  'gtm_initiative',
  'intent_score',
  'intent_count',
  'intent_topics',
  'seniority',
  'funding_stage',
  'technologies',
  'department',
  'employee_count',
  'associatedcompanyid'
])

function skipFactAttr(key: string): boolean {
  if (SKIP_FACT_ATTRS.has(key)) return true
  return /lusha_|intent_topics|associatedcompany|signal_score/i.test(key)
}

function attrLine(value: unknown): string {
  if (value == null) return ''
  const text = String(value).trim()
  return text.slice(0, 160)
}

export function prospectsToContacts(
  orgId: string,
  projectId: string,
  prospects: ContextProspect[],
  source: Contact['source']
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
    status: (i === 0 ? 'active' : 'queued') as ContactStatus,
    stepIndex: 0,
    notes: `${source ?? 'manual'} · synced into Jargon`,
    externalId: p.externalId,
    source,
    accountName: p.accountName,
    linkedinUrl: p.linkedinUrl,
    companyDomain: p.companyDomain,
    companyIndustry: p.companyIndustry,
    companySize: p.companySize,
    warmth: p.warmth,
    context:
      p.context?.length
        ? p.context
        : source === 'hubspot'
          ? factsFromProspect(p)
          : buildProspectContext({
              id: p.externalId,
              company: p.company,
              title: p.title,
              companySize: p.companySize,
              companyIndustry: p.companyIndustry
            }),
    attrs: p.attrs && Object.keys(p.attrs).length ? p.attrs : {},
    channelsDone: [],
    createdAt: now,
    updatedAt: now
  }))
}
