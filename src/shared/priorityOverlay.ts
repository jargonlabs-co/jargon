import { canonicalSignals } from './signalAliases'

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
  attrs?: Record<string, unknown> | null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[;|,]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function text(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return asStringList(value).join(', ')
  return ''
}

/** Rankable lines from any source's attrs (vendor names mapped via SIGNAL_ALIASES) — never invented. */
export function signalLinesFromAttrs(
  attrs?: Record<string, unknown> | null,
  warmth?: string | null
): string[] {
  const facts: string[] = []
  const push = (line: string) => {
    const text = line.trim()
    if (text && !facts.includes(text)) facts.push(text)
  }
  const signals = canonicalSignals(attrs)
  for (const role of asStringList(signals.hiring)) push(`Hiring: ${role}`)
  for (const line of asStringList(attrs?.gtm_initiative)) push(line)
  if (!facts.some((line) => /\bintent\b/i.test(line))) {
    for (const topic of asStringList(signals.intent_topics).slice(0, 3)) push(`Intent: ${topic}`)
  }
  const signal = text(signals.latest_signal)
  if (signal) push(signal)
  const seniority = text(signals.seniority)
  if (seniority) push(seniority)
  const funding = text(signals.funding_stage)
  if (funding) push(`Funding: ${funding}`)
  const tech = text(signals.technologies)
  if (tech) {
    const first = asStringList(tech)[0]
    if (first) push(`Uses ${first}`)
  }
  if (warmth === 'hot') push('Recent activity')
  else if (warmth === 'warm') push('Active this quarter')
  return facts.slice(0, 3)
}

function factLines(contact: {
  warmth?: string | null
  attrs?: Record<string, unknown> | null
}): string[] {
  return signalLinesFromAttrs(contact.attrs, contact.warmth)
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
    facts: factLines(contact),
    attrs: contact.attrs ?? undefined
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

function positive(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : 0
}

function intentBoost(score: number): number {
  if (score <= 0) return 0
  if (score <= 10) return Math.round(score * 4)
  return Math.min(40, Math.round(score * 0.4))
}

function hasBuyingIntent(facts: string[], intentScore: number, intentCount: number): boolean {
  if (intentScore > 0 || intentCount > 0) return true
  return facts.some((line) => /\bintent\b|buying signal/i.test(line))
}

export function scoreLead(input: {
  seed: string
  company: string
  title?: string
  facts?: string[]
  attrs?: Record<string, unknown> | null
}): Omit<LeadPriority, 'rank' | 'band'> {
  const h = hashSeed(input.seed.trim().toLowerCase())
  const company = cleanCompany(input.company)
  const title = cleanTitle(input.title)
  const facts = (input.facts ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 3)
  const signals = canonicalSignals(input.attrs)
  const intentScore = positive(signals.intent_score)
  const intentCount = positive(signals.intent_count)
  const inboundFromSignals = hasBuyingIntent(facts, intentScore, intentCount)
  const motion: LeadMotion = inboundFromSignals ? 'inbound' : 'outbound'
  // The hash only breaks ties between otherwise equal people; it never adds a signal.
  let score = 22 + (h % 8)
  if (intentScore) score += intentBoost(intentScore)
  else if (intentCount) score += Math.min(32, Math.round(intentCount * 8))
  if (isSalesExecTitle(title)) score += 14
  else if (title) score += 4
  if (company) score += 2
  if (facts.some((line) => /^hiring:/i.test(line))) score += 8
  if (facts.some((line) => /^funding:/i.test(line))) score += 6
  if (inboundFromSignals && !intentScore && !intentCount) score += 10
  score = Math.max(1, Math.min(99, score))
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
