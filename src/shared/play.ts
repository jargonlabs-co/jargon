/** A play turns first-party and public facts into sequence variables. */

export type PlayParty = 'first' | 'third'

export type PlayVariable = {
  key: string
  label: string
  party: PlayParty
  /** System the value is read from. */
  source: string
}

export type PlayAudience = {
  label: string
  /** Normalized stage the user named, such as "stage 2". */
  stage: string
  stageNumber?: number
  /** Keep a deal when its last activity is at least this many days old. */
  inactiveDays?: number
}

export type PlayAssignment = {
  kind: 'rep' | 'team'
  id?: string
  name: string
}

export const PLAY_TEAMS = [
  { id: 'all', name: 'Whole team' },
  { id: 'am_bdrs', name: 'AM BDRs' }
] as const

export type Play = {
  audience?: PlayAudience
  variables: PlayVariable[]
  assignment?: PlayAssignment
  /** Why the audience could not be loaded. */
  notice?: string
}

export type PlayStep = {
  day: number
  channel: 'email' | 'call' | 'linkedin'
  label: string
  subject?: string
  body?: string
}

export type PlayView = Play & {
  roster: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string; company: string; title: string; values: Record<string, string> }>
  steps: Array<{ channel: string; day: number; label: string; body: string }>
}

type Binder = PlayVariable & { match: RegExp }

const BINDERS: Binder[] = [
  {
    key: 'last_call_objection',
    label: 'Last call objection',
    party: 'first',
    source: 'HubSpot calls',
    match: /objection[\s\S]{0,48}last call|last call[\s\S]{0,48}objection/i
  },
  {
    key: 'quiet_window',
    label: 'Quiet hours',
    party: 'third',
    source: 'Google Business Profile',
    match: /google business|\bquietest\b|\bleast[- ]busy\b|\bslowest\b/i
  }
]

const STAGE_RE = /\bstage[-\s]?(\d+)\b/i
const INACTIVE_RE = /\bno activity in\s+(\d+)\s+days\b/i

export function parsePlay(prompt: string): Play | null {
  const stage = prompt.match(STAGE_RE)
  const inactive = prompt.match(INACTIVE_RE)
  const variables = BINDERS.filter((binder) => binder.match.test(prompt)).map(({ match: _match, ...variable }) => variable)
  const asked = /\bplay\b/i.test(prompt) || Boolean(stage) || variables.length > 0
  if (!asked || (!stage && !variables.length)) return null
  const stageNumber = stage ? Number(stage[1]) : undefined
  const inactiveDays = inactive ? Number(inactive[1]) : undefined
  const audience: PlayAudience | undefined =
    stageNumber != null
      ? {
          stage: `stage ${stageNumber}`,
          stageNumber,
          inactiveDays,
          label:
            inactiveDays != null
              ? `Stage-${stageNumber} deals with no activity in ${inactiveDays} days`
              : `Stage-${stageNumber} deals`
        }
      : undefined
  return { audience, variables }
}

export function playSpecInput(play: Play): {
  goal: string
  segment: string
  channels: Array<'call' | 'email'>
  primarySurface: 'sequence'
  kind: 'cadence'
  steps: PlayStep[]
} {
  return {
    goal: 'Reopen deals that have gone quiet',
    segment: play.audience?.label ?? 'Deals',
    channels: ['call', 'email'],
    primarySurface: 'sequence',
    kind: 'cadence',
    steps: playSequenceSteps(play)
  }
}

export function playSequenceSteps(play: Play): PlayStep[] {
  const keys = new Set(play.variables.map((variable) => variable.key))
  const objection = keys.has('last_call_objection')
  const quiet = keys.has('quiet_window')
  const call = [
    objection ? 'Open with their last objection: {{last_call_objection}}' : 'Open on the last conversation.',
    quiet ? 'Call during {{quiet_window}}, when the office is quietest.' : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  const email = [
    objection ? 'You raised this on our last call: {{last_call_objection}}' : 'Following up on our last conversation.',
    quiet ? 'I can talk during {{quiet_window}}, when the office is quiet.' : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { day: 0, channel: 'call', label: 'Open on the last objection', body: call },
    {
      day: 2,
      channel: 'email',
      label: 'Follow up',
      subject: 'Following up, {{first_name}}',
      body: `Hi {{first_name}},\n\n${email}\n`
    }
  ]
}

export type HoursPeriod = {
  open: { day: number; hour: number; minute: number }
  close?: { day: number; hour: number; minute: number }
}

/** First 90 minutes after the office opens, from posted hours. Weekdays win. */
export function quietWindowFromPeriods(
  periods: HoursPeriod[],
  timeZone?: string
): { label: string; timezone?: string } | null {
  const usable = periods.filter((period) => Number.isFinite(period.open?.hour))
  if (!usable.length) return null
  const weekdays = usable.filter((period) => period.open.day >= 1 && period.open.day <= 5)
  const pool = weekdays.length ? weekdays : usable
  const period = [...pool].sort((a, b) => minutes(a.open) - minutes(b.open))[0]
  if (!period) return null
  const start = minutes(period.open)
  const close = period.close ? minutes(period.close) : start + 90
  const end = Math.max(start + 30, Math.min(start + 90, close > start ? close : start + 90))
  const zone = zoneAbbrev(timeZone)
  const label = `${formatClock(start, false)}–${formatClock(end, true)}${zone ? ` ${zone}` : ''}`
  return { label, timezone: timeZone }
}

export function objectionFromCall(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .find((part) => /object|concern|pushback|already (?:have|use)|too expensive|not ready|budget|timing/i.test(part))
  return (sentence || text).slice(0, 280)
}

export type DealStage = { id: string; label: string; displayOrder: number }

/** Match "stage 2" to a pipeline stage label, then to the stage in that position. */
export function matchDealStage(stages: DealStage[], requested: string): DealStage | null {
  const want = requested.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  const number = want.match(/stage\s+(\d+)/)
  const n = number ? Number(number[1]) : undefined
  const labeled = stages.find((stage) => {
    const label = stage.label.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    if (label === want) return true
    if (n != null && (label === `stage ${n}` || label.includes(`stage ${n}`))) return true
    return false
  })
  if (labeled) return labeled
  if (n == null) return null
  return stages.find((stage) => stage.displayOrder === n - 1) ?? null
}

function minutes(clock: { hour: number; minute: number }): number {
  return clock.hour * 60 + (clock.minute || 0)
}

function formatClock(total: number, withMeridiem: boolean): string {
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  const h = hour % 12 || 12
  const m = String(minute).padStart(2, '0')
  if (!withMeridiem) return `${h}:${m}`
  return `${h}:${m}${hour < 12 ? 'am' : 'pm'}`
}

function zoneAbbrev(timeZone?: string): string {
  if (!timeZone) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date())
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    if (!name || name === timeZone) return ''
    return name
  } catch {
    return ''
  }
}
