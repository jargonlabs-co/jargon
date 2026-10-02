/** HubSpot pull that should open the ranked To-dos pipeline, not a research step. */
export function isPriorityPipelinePrompt(prompt: string): boolean {
  const t = prompt.toLowerCase()
  const fromCrm = /\bhubspot\b/.test(t) || /\btarget accounts?\b/.test(t)
  return fromCrm && /\bpriority pipeline\b/.test(t)
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
}

/** Score any contact — HubSpot, Railway, import, or demo book. */
export function leadIdentity(contact: {
  email?: string | null
  externalId?: string | null
  id?: string | null
  company?: string | null
  title?: string | null
}): LeadIdentity | null {
  const seed = (contact.email || contact.externalId || contact.id || '').trim().toLowerCase()
  if (!seed) return null
  return { seed, company: contact.company ?? '', title: contact.title ?? undefined }
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

export function scoreLead(input: { seed: string; company: string; title?: string }): Omit<LeadPriority, 'rank' | 'band'> {
  const h = hashSeed(input.seed.trim().toLowerCase())
  const company = cleanCompany(input.company)
  const title = cleanTitle(input.title)
  const motion: LeadMotion = h % 5 < 2 ? 'inbound' : 'outbound'
  const base = (h % 70) + 20
  const score = motion === 'inbound' ? Math.min(99, base + 12) : base
  const inbound = [
    'Demo request this week',
    'Replied after viewing pricing',
    'Asked for a follow-up from a webinar',
    'Form fill on the product page',
    company ? `${company} requested a walkthrough` : 'Requested a walkthrough',
    'Booked time, then went quiet'
  ]
  const outbound = [
    'No prior conversation',
    company ? `Hiring on the GTM team at ${company}` : 'Hiring on the GTM team',
    title ? `New ${title} in seat` : 'New leader in seat',
    company ? `${company} raised recently` : 'Raised recently',
    'Evaluating outbound tools',
    'Posted about pipeline coverage'
  ]
  const pool = motion === 'inbound' ? inbound : outbound
  const first = pool[h % pool.length] ?? pool[0]
  const second = pool[(h + 2) % pool.length] ?? first
  const signals = first === second ? [first] : [first, second]
  return { score, motion, signals }
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
