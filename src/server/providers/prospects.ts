import { uid } from '../crypto'
import type { Contact, ContactStatus } from '../types'
import { buildProspectContext } from './apollo'

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
    notes: source === 'crustdata' ? 'Crustdata · live profile' : `${source} · synced into Jargon`,
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
