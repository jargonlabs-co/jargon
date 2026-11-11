/** A play turns first-party and public facts into sequence variables. */

export type PlayParty = 'first' | 'third'

export type PlayUse = 'open' | 'position' | 'when' | 'include'

export type PlayVariable = {
  key: string
  label: string
  party: PlayParty
  /** System the value is read from. */
  source: string
  /** How the sequence uses the value. */
  use?: PlayUse
}

export type PlayAudience = {
  label: string
  /** Normalized stage the user named, such as "stage 2", or "open upsell". */
  stage: string
  stageNumber?: number
  /** Deals come from the CRM pipeline. Upsell is the open book. Anything else is the audience the sentence named. */
  kind?: 'deals' | 'upsell' | 'custom'
  /** Keep a record when its last activity is at least this many days old. */
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
    key: 'attention_pain',
    label: 'Last Attention call',
    party: 'first',
    source: 'Attention',
    use: 'open',
    match: /attention[\s\S]{0,40}call|pain point[\s\S]{0,80}(?:objection|call)|objection[\s\S]{0,80}attention/i
  },
  {
    key: 'brand_addon',
    label: 'Brand add-on',
    party: 'first',
    source: 'Brand',
    use: 'position',
    match: /add-?on[\s\S]{0,48}brand|brand[\s\S]{0,48}add-?on/i
  },
  {
    key: 'last_call_objection',
    label: 'Last call objection',
    party: 'first',
    source: 'HubSpot calls',
    use: 'open',
    match: /objection[\s\S]{0,48}last call|last call[\s\S]{0,48}objection/i
  },
  {
    key: 'quiet_window',
    label: 'Quiet hours',
    party: 'third',
    source: 'Google Business Profile',
    use: 'when',
    match: /google business|\bquietest\b|\bleast[- ]busy\b|\bslowest\b/i
  }
]

const STAGE_RE = /\bstage[-\s]?(\d+)\b/i
const INACTIVE_RE = /\bno activity in\s+(\d+)\s+days\b/i
const UPSELL_RE = /\bupsell opportunities\b/i

export function parsePlay(prompt: string): Play | null {
  const stage = prompt.match(STAGE_RE)
  const inactive = prompt.match(INACTIVE_RE)
  const upsell = UPSELL_RE.test(prompt)
  const named = audiencePhrase(prompt)
  const known = BINDERS.filter((binder) => binder.match.test(prompt)).map(({ match: _match, ...variable }) => variable)
  const variables = dedupeVariables([...known, ...extraVariables(prompt, known)]).sort(
    (a, b) => useRank(useOf(a)) - useRank(useOf(b))
  )
  const asked = /\bplay\b/i.test(prompt) || Boolean(stage) || upsell || variables.length > 0
  if (!asked || (!stage && !upsell && !named && !variables.length)) return null
  const stageNumber = stage ? Number(stage[1]) : undefined
  const inactiveDays = inactive ? Number(inactive[1]) : undefined
  const audience: PlayAudience | undefined = upsell
    ? {
        kind: 'upsell',
        stage: 'open upsell',
        inactiveDays,
        label:
          inactiveDays != null
            ? `Open upsell opportunities with no activity in ${inactiveDays} days`
            : 'Open upsell opportunities'
      }
    : stageNumber != null
      ? {
          kind: 'deals',
          stage: `stage ${stageNumber}`,
          stageNumber,
          inactiveDays,
          label:
            inactiveDays != null
              ? `Stage-${stageNumber} deals with no activity in ${inactiveDays} days`
              : `Stage-${stageNumber} deals`
        }
      : named
        ? {
            kind: 'custom',
            stage: named.toLowerCase(),
            inactiveDays,
            label: inactiveDays != null ? `${sentenceCase(named)} with no activity in ${inactiveDays} days` : sentenceCase(named)
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
    goal:
      play.audience?.kind === 'upsell'
        ? 'Reopen upsell opportunities that have gone quiet'
        : play.audience?.kind === 'custom'
          ? play.audience.label
          : 'Reopen deals that have gone quiet',
    segment:
      play.audience?.kind === 'upsell' ? 'open upsell opportunities' : (play.audience?.label ?? 'Deals'),
    channels: ['call', 'email'],
    primarySurface: 'sequence',
    kind: 'cadence',
    steps: playSequenceSteps(play)
  }
}

export function playSequenceSteps(play: Play): PlayStep[] {
  const place = play.audience?.kind === 'upsell' || /\bstore/i.test(play.audience?.label ?? '') ? 'store' : 'office'
  const callLines = play.variables.map((variable) => callLine(variable, place)).filter(Boolean)
  const emailLines = play.variables.map((variable) => emailLine(variable, place)).filter(Boolean)
  const call = callLines.length ? callLines.join('\n\n') : 'Open on the last conversation.'
  const email = emailLines.length ? emailLines.join('\n\n') : 'Following up on our last conversation.'
  const opener = play.variables.find((variable) => useOf(variable) === 'open')
  const position = play.variables.find((variable) => useOf(variable) === 'position')
  return [
    { day: 0, channel: 'call', label: callLabel(opener), body: call },
    {
      day: 2,
      channel: 'email',
      label: position?.key === 'brand_addon' ? 'Position the add-on' : position ? position.label : 'Follow up',
      subject: 'Following up, {{first_name}}',
      body: `Hi {{first_name}},\n\n${email}\n`
    }
  ]
}

const CLAUSE_RULES: Array<{ use: PlayUse; re: RegExp }> = [
  { use: 'open', re: /\b(?:open|lead|start) with\s+([^.;]+)/gi },
  { use: 'position', re: /\b(?:position|mention|offer|pitch)\s+([^.;]+)/gi },
  { use: 'when', re: /\b(?:schedule calls for|call during)\s+([^.;]+)/gi }
]

const KEY_STOP = new Set([
  'the', 'a', 'an', 'their', 'each', 'from', 'on', 'that', 'with', 'for', 'and', 'to', 'of', 'them',
  'they', 'this', 'those', 'these', 'into', 'your', 'our', 'when', 'based'
])

function extraVariables(prompt: string, known: PlayVariable[]): PlayVariable[] {
  const seen = new Set(known.map((variable) => variable.key))
  const out: PlayVariable[] = []
  for (const rule of CLAUSE_RULES) {
    for (const match of prompt.matchAll(rule.re)) {
      const clause = (match[1] ?? '').split(/\s*,\s*and\s+|\s+and\s+/i)[0]?.trim() ?? ''
      if (clause.length < 3) continue
      if (BINDERS.some((binder) => binder.match.test(clause))) continue
      const phrase = clause.replace(/^(?:the|a|an)\s+/i, '').replace(/\s+/g, ' ').trim()
      const key = keyFrom(phrase)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push({
        key,
        label: sentenceCase(phrase),
        party: /google|quiet|hour/i.test(phrase) ? 'third' : 'first',
        source: sourceFor(phrase),
        use: rule.use
      })
    }
  }
  return out
}

function audiencePhrase(prompt: string): string | undefined {
  const match = prompt.match(/\bplay for\s+([^.?\n]+)/i)
  if (!match?.[1]) return undefined
  const text = match[1].replace(/\s+with no activity in\s+\d+\s+days\b/i, '').trim()
  return text || undefined
}

function dedupeVariables(variables: PlayVariable[]): PlayVariable[] {
  const seen = new Set<string>()
  return variables.filter((variable) => {
    if (seen.has(variable.key)) return false
    seen.add(variable.key)
    return true
  })
}

function keyFrom(phrase: string): string {
  const words = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !KEY_STOP.has(word))
    .slice(0, 4)
  return words.join('_').slice(0, 40)
}

function sourceFor(phrase: string): string {
  if (/attention/i.test(phrase)) return 'Attention'
  if (/google|quiet|hour/i.test(phrase)) return 'Google Business Profile'
  if (/last call|call/i.test(phrase)) return 'HubSpot calls'
  return 'Account'
}

function sentenceCase(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function useRank(use: PlayUse): number {
  if (use === 'open') return 0
  if (use === 'position') return 1
  if (use === 'include') return 2
  return 3
}

function useOf(variable: PlayVariable): PlayUse {
  if (variable.use) return variable.use
  if (variable.key === 'brand_addon') return 'position'
  if (variable.key === 'quiet_window') return 'when'
  if (variable.key === 'attention_pain' || variable.key === 'last_call_objection') return 'open'
  return 'include'
}

function callLine(variable: PlayVariable, place: string): string {
  const token = `{{${variable.key}}}`
  if (variable.key === 'attention_pain') return `Open with what they said on the last Attention call: ${token}`
  if (variable.key === 'last_call_objection') return `Open with their last objection: ${token}`
  if (variable.key === 'brand_addon') return `The add-on that fits the brand: ${token}`
  if (variable.key === 'quiet_window') return `Call during ${token}, when the ${place} is quietest.`
  if (useOf(variable) === 'open') return `Open with this: ${token}`
  if (useOf(variable) === 'position') return `Bring up ${token}.`
  if (useOf(variable) === 'when') return `Call during ${token}.`
  return `Use ${token}.`
}

function emailLine(variable: PlayVariable, place: string): string {
  const token = `{{${variable.key}}}`
  if (variable.key === 'attention_pain') return `On the last Attention call you raised this: ${token}`
  if (variable.key === 'last_call_objection') return `You raised this on our last call: ${token}`
  if (variable.key === 'brand_addon') return `${token} fits {{company}}.`
  if (variable.key === 'quiet_window') return `I can talk during ${token}, when the ${place} is quiet.`
  if (useOf(variable) === 'open') return `You raised this: ${token}`
  if (useOf(variable) === 'position') return `For {{company}}, use ${token}.`
  if (useOf(variable) === 'when') return `I can talk during ${token}.`
  return token
}

function callLabel(opener: PlayVariable | undefined): string {
  if (!opener) return 'Open'
  if (opener.key === 'attention_pain') return 'Open on the last Attention call'
  if (opener.key === 'last_call_objection') return 'Open on the last objection'
  return opener.label.length > 42 ? 'Open' : `Open on ${opener.label.charAt(0).toLowerCase()}${opener.label.slice(1)}`
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
