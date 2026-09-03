import { uid } from '../crypto'
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
  context?: string[]
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
