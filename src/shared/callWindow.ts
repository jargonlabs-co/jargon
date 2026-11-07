/** Recommended local window for calling a kind of business. Stored on the contact, shown on the to-do. */

export const ATTR_CALL_WINDOW = '_callWindow'

export type CallWindow = {
  /** 24-hour HH:MM in the account's local clock, or the rep's clock when the zone is unknown. */
  startLocal: string
  endLocal: string
  timezone?: string
  clock: 'account' | 'rep'
  businessType: string
  reason: string
  inferred: boolean
}

/** What Claude sends on a call research item, before Jargon fills timezone and business type. */
export type CallWindowDraft = {
  startLocal: string
  endLocal: string
  timezone?: string
  businessType?: string
  reason?: string
  inferred?: boolean
}

const TZ_KEYS = ['hs_timezone', 'timezone', 'company_timezone', 'company_hs_timezone']

export function wantsCallWindows(prompt: string): boolean {
  const t = prompt.toLowerCase()
  if (/\bbest times? of day\b/.test(t)) return true
  if (/\b(least[- ]busy|quietest|slowest)\b/.test(t) && /\b(time|times|hour|hours|call|dial)\b/.test(t)) return true
  if (/\bbest times?\b/.test(t) && /\b(call|dial|phone)\b/.test(t)) return true
  if (/\b(when|time|times) to call\b/.test(t)) return true
  return false
}

/** "Phone-heavy sequencer" is a call-first cadence, not a single-channel dialer. */
export function isPhoneHeavySequence(prompt: string): boolean {
  const t = prompt.toLowerCase()
  return /\bphone[ -]?heavy\b/.test(t) && /\bsequenc|\bcadence\b/.test(t)
}

/** The phone-heavy sequencer that should be ordered by when to call. */
export function isPracticeCallOrder(prompt: string): boolean {
  return isPhoneHeavySequence(prompt) && wantsCallWindows(prompt)
}

/** Extra person fields so Claude can group accounts by business and zone. */
export function callWindowPersonFields(contact: {
  attrs?: Record<string, unknown> | null
}): Record<string, string> {
  const out: Record<string, string> = {}
  const tz = contactTimezone(contact.attrs)
  if (tz) out.timezone = tz
  const state = attrString(contact.attrs, ['state', 'company_state'])
  if (state) out.state = state
  const country = attrString(contact.attrs, ['country', 'company_country'])
  if (country) out.country = country
  return out
}

export function callWindowClause(): string {
  return 'This dialer also needs the least-busy time of day to call. Group people by companyIndustry and timezone (timezone, else state and city). For each group, recommend one local window for that kind of business and put the same callWindow on every call item: {"startLocal":"07:30","endLocal":"09:00","timezone":"America/Chicago","businessType":"Automotive","reason":"Before the bays fill","inferred":false}. startLocal and endLocal are local clock times. businessType is the industry string. If industry is blank, infer it from the company name and set inferred true. timezone is an IANA zone; omit it when you cannot tell, and Jargon labels the time as the rep\'s clock. Copy that window onto every person in the group. The window is a recommendation with a reason, not a CRM fact. Do not invent funding, hiring, or tenure.'
}

export function contactTimezone(attrs?: Record<string, unknown> | null): string | undefined {
  return attrString(attrs, TZ_KEYS)
}

export function readCallWindow(attrs?: Record<string, unknown> | null): CallWindow | null {
  const raw = attrs?.[ATTR_CALL_WINDOW]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const startLocal = typeof rec.startLocal === 'string' ? parseClock(rec.startLocal) : null
  const endLocal = typeof rec.endLocal === 'string' ? parseClock(rec.endLocal) : null
  if (!startLocal || !endLocal) return null
  const timezone = cleanZone(typeof rec.timezone === 'string' ? rec.timezone : undefined)
  const businessType = typeof rec.businessType === 'string' ? rec.businessType.trim().slice(0, 80) : ''
  const reason = typeof rec.reason === 'string' ? rec.reason.trim().slice(0, 180) : ''
  return {
    startLocal,
    endLocal,
    timezone,
    clock: rec.clock === 'rep' || !timezone ? 'rep' : 'account',
    businessType,
    reason,
    inferred: rec.inferred === true
  }
}

export function takeCallWindow(
  value: unknown
): { ok: true; callWindow?: CallWindowDraft } | { ok: false; error: string } {
  if (value == null) return { ok: true }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'callWindow must be an object with startLocal and endLocal' }
  }
  const rec = value as Record<string, unknown>
  const startLocal = parseClock(typeof rec.startLocal === 'string' ? rec.startLocal : '')
  const endLocal = parseClock(typeof rec.endLocal === 'string' ? rec.endLocal : '')
  if (!startLocal || !endLocal) {
    return { ok: false, error: 'callWindow startLocal and endLocal must be clock times like 7:30am' }
  }
  const timezone = cleanZone(typeof rec.timezone === 'string' ? rec.timezone : undefined)
  const businessType = typeof rec.businessType === 'string' ? rec.businessType.trim().slice(0, 80) : undefined
  const reason = typeof rec.reason === 'string' ? rec.reason.trim().slice(0, 180) : undefined
  return {
    ok: true,
    callWindow: {
      startLocal,
      endLocal,
      timezone,
      businessType: businessType || undefined,
      reason: reason || undefined,
      inferred: rec.inferred === true
    }
  }
}

export function attachCallWindow(
  draft: CallWindowDraft,
  contact: { companyIndustry?: string | null; attrs?: Record<string, unknown> | null }
): CallWindow | null {
  const startLocal = parseClock(draft.startLocal)
  const endLocal = parseClock(draft.endLocal)
  if (!startLocal || !endLocal) return null
  const industry = (contact.companyIndustry ?? '').trim()
  const named = (draft.businessType ?? '').trim()
  const timezone = cleanZone(draft.timezone) || contactTimezone(contact.attrs)
  return {
    startLocal,
    endLocal,
    timezone,
    clock: timezone ? 'account' : 'rep',
    businessType: (named || industry).slice(0, 80),
    reason: (draft.reason ?? '').trim().slice(0, 180),
    inferred: draft.inferred === true || (!industry && Boolean(named))
  }
}

export function callWindowGroupKey(window: Pick<CallWindow, 'businessType' | 'timezone'>): string | null {
  const business = window.businessType.trim().toLowerCase()
  if (!business) return null
  return `${business}|${(window.timezone ?? '').trim() || 'rep'}`
}

export function contactCallWindowKey(contact: {
  companyIndustry?: string | null
  attrs?: Record<string, unknown> | null
}): string | null {
  const business = (contact.companyIndustry ?? '').trim().toLowerCase()
  if (!business) return null
  return `${business}|${contactTimezone(contact.attrs) || 'rep'}`
}

export function formatCallWindow(window: CallWindow): string {
  const range = formatRange(window.startLocal, window.endLocal)
  if (window.clock === 'rep' || !window.timezone) return `${range} your time`
  return `${range} ${zoneAbbrev(window.timezone)}`
}

export function callWindowSortMinutes(window: Pick<CallWindow, 'startLocal'>): number {
  const [h, m] = window.startLocal.split(':').map(Number)
  return h * 60 + m
}

const DAY_MINUTES = 24 * 60

/** Minutes on the clock in an IANA zone. Falls back to the machine clock when the zone is missing. */
export function minutesInZone(now: Date, timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now)
    let hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
    if (hour === 24) hour = 0
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return now.getHours() * 60 + now.getMinutes()
    return hour * 60 + minute
  } catch {
    return now.getHours() * 60 + now.getMinutes()
  }
}

/**
 * Who to call next from this instant.
 * A window that is open now sorts first (soonest to close, still ahead of later windows).
 * Then a window still ahead today, by how many minutes until it opens.
 * A window that already passed sorts last, by how soon it opens again tomorrow in that account's zone.
 */
export function callWindowSortKey(
  window: Pick<CallWindow, 'startLocal' | 'endLocal' | 'timezone'>,
  now: Date = new Date()
): number {
  const nowMin = minutesInZone(now, window.timezone)
  const start = callWindowSortMinutes(window)
  const end = callWindowSortMinutes({ startLocal: window.endLocal })
  if (end > start && nowMin >= start && nowMin < end) return end - nowMin - DAY_MINUTES
  if (nowMin < start) return start - nowMin
  return DAY_MINUTES - nowMin + start
}

export function callWindowTaskFields(
  attrs?: Record<string, unknown> | null,
  now: number | Date = new Date()
): {
  callWindowLabel?: string
  callWindowReason?: string
  callWindowSort?: number
} {
  const window = readCallWindow(attrs)
  if (!window) return {}
  const at = now instanceof Date ? now : new Date(now)
  return {
    callWindowLabel: formatCallWindow(window),
    callWindowReason: window.reason || undefined,
    callWindowSort: callWindowSortKey(window, at)
  }
}

function attrString(attrs: Record<string, unknown> | null | undefined, keys: string[]): string | undefined {
  if (!attrs) return undefined
  for (const key of keys) {
    const value = attrs[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function cleanZone(raw?: string): string | undefined {
  const zone = raw?.trim()
  if (!zone) return undefined
  if (/^(your time|local|rep|unknown)$/i.test(zone)) return undefined
  return zone.slice(0, 80)
}

/** Accept 7:30, 07:30, 7:30am, 7pm. Returns HH:MM. */
export function parseClock(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '')
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const period = match[3]
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null
  if (period) {
    if (hour < 1 || hour > 12) return null
    if (period === 'pm' && hour !== 12) hour += 12
    if (period === 'am' && hour === 12) hour = 0
  } else if (hour === 24 && minute === 0) {
    hour = 0
  } else if (hour > 23) {
    return null
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatRange(start: string, end: string): string {
  const startHour = Number(start.slice(0, 2))
  const endHour = Number(end.slice(0, 2))
  const samePeriod = startHour < 12 === endHour < 12
  if (samePeriod) return `${formatClock(start, false)}–${formatClock(end, true)}`
  return `${formatClock(start, true)}–${formatClock(end, true)}`
}

function formatClock(hhmm: string, withPeriod: boolean): string {
  const [hourRaw, minuteRaw] = hhmm.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  const period = hour >= 12 ? 'pm' : 'am'
  const hour12 = hour % 12 || 12
  const body = `${hour12}:${String(minute).padStart(2, '0')}`
  return withPeriod ? `${body}${period}` : body
}

function zoneAbbrev(zone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value
    if (name) return name
  } catch {
    /* keep the zone string Claude sent */
  }
  return zone
}
