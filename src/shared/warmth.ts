export type Warmth = 'hot' | 'warm' | 'cold' | 'unknown'

export type WarmthSignals = {
  lifecycleStage?: string
  leadStatus?: string
  lastActivityAt?: number | null
  lastReplyAt?: number | null
}

const DAY_MS = 86_400_000

function compact(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[\s_-]/g, '')
}

function withinDays(at: number | null | undefined, days: number, now: number): boolean {
  return typeof at === 'number' && Number.isFinite(at) && now - at <= days * DAY_MS && now - at >= 0
}

/** Hot: replied or touched recently, or an open deal. Warm: qualified or active in the last quarter. */
export function scoreWarmth(signals: WarmthSignals, now = Date.now()): Warmth {
  const life = compact(signals.lifecycleStage)
  const lead = compact(signals.leadStatus)
  const hotLead = lead === 'open' || lead === 'inprogress' || lead === 'connected' || lead === 'opendeal'
  const hotLife = life === 'opportunity' || life === 'customer' || life === 'evangelist'
  if (
    withinDays(signals.lastReplyAt, 30, now) ||
    withinDays(signals.lastActivityAt, 14, now) ||
    hotLead ||
    (hotLife && withinDays(signals.lastActivityAt, 45, now))
  ) {
    return 'hot'
  }
  const warmLife = life === 'marketingqualifiedlead' || life === 'salesqualifiedlead' || life === 'opportunity'
  const warmLead = lead === 'attemptedtocontact' || lead === 'new'
  if (withinDays(signals.lastActivityAt, 90, now) || warmLife || warmLead) return 'warm'
  if (life || lead || signals.lastActivityAt || signals.lastReplyAt) return 'cold'
  return 'unknown'
}

export function parseWarmthFilter(raw: string | undefined): Warmth[] | 'all' {
  const query = (raw ?? '').trim().toLowerCase()
  if (!query || query === 'all' || query === 'everyone') return 'all'
  const picked: Warmth[] = []
  for (const part of query.split(/[\s,;/]+/)) {
    if (part === 'hot' || part === 'warm' || part === 'cold' || part === 'unknown') {
      if (!picked.includes(part)) picked.push(part)
    }
  }
  return picked.length ? picked : 'all'
}

export function warmthRank(warmth: Warmth | undefined): number {
  if (warmth === 'hot') return 0
  if (warmth === 'warm') return 1
  if (warmth === 'cold') return 2
  return 3
}

export function hubspotTime(value: string | null | undefined): number | null {
  if (!value?.trim()) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
