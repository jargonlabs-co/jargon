/** Ranked To-dos from whatever list is connected — HubSpot, Railway, warehouse, or an import. */
export function isPriorityPipelinePrompt(prompt: string): boolean {
  const t = prompt.toLowerCase()
  if (/\bpriority pipeline\b/.test(t)) return true
  return /\bpriorit(?:y|ize|ise)\b/.test(t) && /\b(contacts?|leads?|queue|to-?dos?)\b/.test(t)
}

const FAKE_EMAIL = /@unknown\.invalid$|\.invalid$|@example\.com$/i

export function isRealEmail(email?: string | null): boolean {
  const value = (email ?? '').trim()
  if (!value || !value.includes('@')) return false
  const domain = value.split('@')[1] ?? ''
  if (!domain || FAKE_EMAIL.test(value) || /\.test$/i.test(domain)) return false
  return true
}

export function hasReachableContact(contact: {
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  name?: string | null
}): boolean {
  const name = (contact.name ?? '').trim()
  if (/^hubspot contact \d+$/i.test(name)) return false
  const phone = (contact.phone ?? '').replace(/\D/g, '')
  const linkedin = (contact.linkedinUrl ?? '').trim()
  return isRealEmail(contact.email) || phone.length >= 10 || /linkedin\.com/i.test(linkedin)
}

export function isFixtureContact(contact: {
  source?: string | null
  externalId?: string | null
  email?: string | null
}): boolean {
  if (contact.source === 'seed') return true
  const externalId = (contact.externalId ?? '').toLowerCase()
  if (externalId.startsWith('demo_') || externalId.startsWith('seed_demo_')) return true
  const domain = (contact.email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  return domain.endsWith('.test')
}

/** Real person from any source, with an email, phone, or LinkedIn URL. */
export function isPriorityContact(contact: {
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  name?: string | null
  source?: string | null
  externalId?: string | null
}): boolean {
  return hasReachableContact(contact) && !isFixtureContact(contact)
}

export function wantsSalesExecs(prompt: string): boolean {
  return /\bsales exec|\bsales leader|\brevenue (?:leader|exec)/i.test(prompt)
}

/** Titles a thin CRM can still recognize as sales leadership. */
export function isSalesExecTitle(title: string): boolean {
  const t = title.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t || t === 'contact') return false
  if (/\b(cro|cgo)\b/.test(t) || /\baccount executive\b/.test(t) || /\bsales executive\b/.test(t)) return true
  const role = '(?:vp|vice president|svp|evp|head|director|chief|manager|lead|executive|exec)'
  const fn = '(?:sales|revenue|gtm|growth|commercial)'
  return new RegExp(`\\b${role}\\b[\\w\\s,/&-]{0,24}\\b${fn}\\b`, 'i').test(t) ||
    new RegExp(`\\b${fn}\\b[\\w\\s,/&-]{0,24}\\b${role}\\b`, 'i').test(t)
}

/** Contact ids to keep. Null means the title filter was too thin, so keep the full pull. */
export function salesExecContactIds(rows: Array<{ id: string; title: string }>): string[] | null {
  const matched = rows.filter((row) => isSalesExecTitle(row.title))
  if (matched.length < 3) return null
  return matched.map((row) => row.id)
}

export type LeadMotion = 'inbound' | 'outbound'

export type PriorityBand = 'low' | 'medium' | 'high'

/** View-only ranking. Not stored on the contact and not written back to a CRM. */
export type LeadPriority = {
  rank: number
  score: number
  motion: LeadMotion
  signals: string[]
  band: PriorityBand
}

/** Split a ranked list into low / medium / high priority. Rank 1 is high. */
export function priorityBand(rank: number | undefined, total: number): PriorityBand {
  if (!rank || rank < 1 || total < 1) return 'low'
  if (total === 1) return 'high'
  if (total === 2) return rank === 1 ? 'high' : 'medium'
  const highEnd = Math.max(1, Math.ceil(total / 3))
  const mediumEnd = highEnd + Math.max(1, Math.ceil((total - highEnd) / 2))
  if (rank <= highEnd) return 'high'
  if (rank <= mediumEnd) return 'medium'
  return 'low'
}

export type LeadIdentity = {
  seed: string
  company: string
  title?: string
  facts?: string[]
}

function factLines(contact: {
  warmth?: string | null
  attrs?: Record<string, unknown> | null
}): string[] {
  const facts: string[] = []
  const hiring = contact.attrs?.hiring
  if (Array.isArray(hiring)) {
    for (const role of hiring) {
      if (typeof role === 'string' && role.trim()) facts.push(`Hiring: ${role.trim()}`)
    }
  }
  const gtm = contact.attrs?.gtm_initiative
  if (Array.isArray(gtm)) {
    for (const line of gtm) {
      if (typeof line === 'string' && line.trim()) facts.push(line.trim())
    }
  }
  if (contact.warmth === 'hot') facts.push('Recent activity')
  else if (contact.warmth === 'warm') facts.push('Active this quarter')
  return facts.slice(0, 2)
}

/** Score a reachable contact from HubSpot, Railway, warehouse, or an imported list. */
export function leadIdentity(contact: {
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  name?: string | null
  source?: string | null
  externalId?: string | null
  id?: string | null
  company?: string | null
  title?: string | null
  warmth?: string | null
  attrs?: Record<string, unknown> | null
}): LeadIdentity | null {
  if (!isPriorityContact(contact)) return null
  const seed = (contact.email || contact.externalId || contact.id || '').trim().toLowerCase()
  if (!seed) return null
  return {
    seed,
    company: contact.company ?? '',
    title: contact.title ?? undefined,
    facts: factLines(contact)
  }
}

function hashSeed(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 33 + value.charCodeAt(i)) >>> 0
  return h
}

function cleanCompany(company: string): string {
  const value = company.trim()
  if (!value || value.toLowerCase() === 'unknown company') return ''
  return value
}

function cleanTitle(title: string | undefined): string {
  const value = (title ?? '').trim()
  if (!value || value.toLowerCase() === 'contact') return ''
  return value
}

export function scoreLead(input: {
  seed: string
  company: string
  title?: string
  facts?: string[]
}): Omit<LeadPriority, 'rank' | 'band'> {
  const h = hashSeed(input.seed.trim().toLowerCase())
  const company = cleanCompany(input.company)
  const title = cleanTitle(input.title)
  const motion: LeadMotion = h % 5 < 2 ? 'inbound' : 'outbound'
  const base = (h % 70) + 20
  const score = motion === 'inbound' ? Math.min(99, base + 12) : base
  const facts = (input.facts ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 2)
  if (facts.length) return { score, motion, signals: facts }
  const who = title && company ? `${title} at ${company}` : title || company
  return { score, motion, signals: who ? [who] : [] }
}

export function rankLeads<T extends object>(
  rows: T[],
  identity: (row: T) => LeadIdentity | null
): Array<T & { priority?: LeadPriority }> {
  const scored: Array<{ index: number; row: T; score: Omit<LeadPriority, 'rank' | 'band'> }> = []
  rows.forEach((row, index) => {
    const id = identity(row)
    if (!id?.seed.trim()) return
    scored.push({ index, row, score: scoreLead(id) })
  })
  scored.sort((a, b) => b.score.score - a.score.score || a.index - b.index)
  const rankOf = new Map<T, LeadPriority>()
  scored.forEach((item, i) => {
    const rank = i + 1
    rankOf.set(item.row, { ...item.score, rank, band: priorityBand(rank, scored.length) })
  })
  const ranked = rows.filter((row) => rankOf.has(row)).sort((a, b) => rankOf.get(a)!.rank - rankOf.get(b)!.rank)
  const rest = rows.filter((row) => !rankOf.has(row))
  return [...ranked, ...rest].map((row) => {
    const priority = rankOf.get(row)
    return priority ? { ...row, priority } : { ...row }
  })
}
