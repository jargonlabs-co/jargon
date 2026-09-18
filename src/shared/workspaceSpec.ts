import type {
  Channel,
  DeploySpecInput,
  PrimarySurface,
  ProjectKind,
  WorkspaceSpec,
  WorkspaceSpecStep
} from '../server/types'
import { matchOutboundIntent } from './outboundIntents'

export type {
  Channel,
  DeploySpecInput,
  PrimarySurface,
  ProjectKind,
  WorkspaceSpec,
  WorkspaceSpecStep
}

/** In-Claude MCP App chrome. Web still uses PrimarySurface. */
export type McpSurface = 'sequence' | 'inbox' | 'one_off' | 'queue' | 'tasks' | 'overflow'

/** Tab the in-chat workspace lands on. Surface is the motion; this is the phase. */
export type McpTab = 'contacts' | 'sequence' | 'tasks' | 'inbox' | 'queue'

const CHANNELS: Channel[] = ['email', 'call', 'linkedin']
const SURFACES: PrimarySurface[] = ['queue', 'dial', 'inbox', 'linkedin', 'sequence']
const KINDS: ProjectKind[] = ['dialer', 'sequencer', 'cadence', 'list', 'today', 'generic']

export function compileWorkspaceSpec(prompt: string, override?: DeploySpecInput): WorkspaceSpec {
  const t = prompt.toLowerCase()
  const intent = matchOutboundIntent(prompt, override?.kind)
  const channels = uniqueChannels(override?.channels) ?? intent.channels
  const primarySurface = override?.primarySurface ?? refinePrimarySurface(t, channels, intent.primarySurface)
  const goal = override?.goal?.trim() || intent.goal
  const segment = override?.segment?.trim() || inferSegment(prompt)
  const steps = override?.steps?.length
    ? normalizeSteps(override.steps, goal)
    : buildSteps(channels, goal, prompt)
  const kind = override?.kind ?? refineKind(t, channels, primarySurface, intent.kind)
  return { goal, segment, primarySurface, channels, steps, kind }
}

export function specToAnswers(spec: WorkspaceSpec): Record<string, string> {
  return {
    segment: spec.segment,
    team: 'Sales',
    data_source: 'unconfigured',
    channels: formatChannels(spec.channels),
    goal: spec.goal,
    primary_surface: spec.primarySurface
  }
}

export function formatChannels(channels: Channel[]): string {
  return channels.map(channelLabel).join(' + ')
}

export function channelLabel(channel: Channel): string {
  if (channel === 'call') return 'Phone'
  if (channel === 'linkedin') return 'LinkedIn'
  return 'Email'
}

export function workspaceKindLabel(spec: WorkspaceSpec): string {
  if (spec.channels.length === 1 && spec.channels[0] === 'linkedin') return 'LinkedIn queue'
  if (spec.channels.length === 1 && spec.channels[0] === 'call') return 'Outbound dialer'
  if (spec.channels.length === 1 && spec.channels[0] === 'email') return 'Email sequencer'
  if (spec.primarySurface === 'dial') return 'Outbound dialer'
  if (spec.kind === 'today' || spec.primarySurface === 'queue') return 'Outbound sequence'
  if (spec.channels.includes('linkedin') || spec.channels.length > 1) return 'Multi-channel cadence'
  if (spec.kind === 'sequencer') return 'Email sequencer'
  return 'Outbound workspace'
}

const MCP_INBOX_RE = /\binbox\b|\bmailbox\b|\bthreads?\b|\brepl(?:y|ies)\b/
const MCP_SEQUENCE_RE =
  /\bsequenc|\bcadence\b|\bdrip\b|\bfollow[ -]?ups?\b|\bover \d+ days\b|\bday \d+\b/
const MCP_ONE_OFF_RE =
  /\bone[ -]?offs?\b|\bhandful\b|\ba few emails\b|\bindividual emails?\b|\bjust (?:send|email|draft)/
const MCP_TASKS_RE =
  /\btasks? (?:view|list|feed|tab|board)\b|\bdaily tasks\b|\btoday'?s tasks\b|\btasks? due\b|\bdue today\b|\bto[ -]?do list\b|\bwork (?:through )?(?:my |the )?tasks\b|\bclick through .{0,24}tasks\b/

export function inferMcpSurface(input: {
  prompt: string
  primarySurface?: PrimarySurface
  channels?: Channel[]
  steps?: Array<{ channel: string; day?: number }>
}): McpSurface {
  const t = input.prompt.toLowerCase()
  const channels = input.channels ?? []
  const steps = input.steps ?? []
  const emailSteps = steps.filter((step) => step.channel === 'email')
  const emailMotion = channels.includes('email') || emailSteps.length > 0
  const executionList =
    channels.includes('call') ||
    channels.includes('linkedin') ||
    input.primarySurface === 'dial' ||
    input.primarySurface === 'linkedin' ||
    input.primarySurface === 'queue' ||
    /\btoday|daily (tasks?|queue)|work the (list|queue)|\bdialer|power[ -]?dial/.test(t)

  if (MCP_TASKS_RE.test(t)) return 'tasks'
  if (executionList) return 'queue'
  if (!emailMotion) return 'queue'

  if (MCP_ONE_OFF_RE.test(t) && !MCP_SEQUENCE_RE.test(t)) return 'one_off'
  if (MCP_SEQUENCE_RE.test(t) || input.primarySurface === 'sequence') return 'sequence'
  // Inbox only when they asked for a mailbox — not because email-only compile defaulted to inbox.
  if (MCP_INBOX_RE.test(t)) return 'inbox'
  return 'sequence'
}

/** Contacts after import, Sequence while designing, Tasks after enroll. */
export function inferMcpDefaultTab(input: {
  surface: McpSurface
  focus?: McpTab
  enrolled: boolean
}): McpTab {
  if (input.focus) return input.focus
  if (input.surface === 'one_off') return 'contacts'
  if (input.surface === 'inbox') return 'inbox'
  // Sequenced work lives on Tasks — including dialers. Queue is still a tab.
  if (input.enrolled || input.surface === 'tasks') return 'tasks'
  if (input.surface === 'queue') return 'queue'
  return 'contacts'
}

/** Cadences and dialers enroll when research saves (MCP) or on API/CLI deploy by default. One-off sends and inbox views do not. */
export function shouldAutoStartSequence(input: {
  prompt: string
  primarySurface?: PrimarySurface
  channels?: Channel[]
  steps?: Array<{ channel: string; day?: number }>
}): boolean {
  const surface = inferMcpSurface(input)
  return surface !== 'one_off' && surface !== 'inbox'
}

export function specFromProject(project: {
  kind: ProjectKind
  prompt?: string
  segment?: string
  answers?: Record<string, string>
  spec?: WorkspaceSpec
}): WorkspaceSpec {
  if (project.spec?.channels?.length && project.spec.steps?.length) return project.spec
  const fromAnswers = parseStoredSpec(project.answers?.spec_json)
  if (fromAnswers) return fromAnswers
  return compileWorkspaceSpec(project.prompt || project.kind, {
    kind: project.kind,
    goal: project.answers?.goal,
    segment: project.answers?.segment || project.segment,
    channels: parseChannelString(project.answers?.channels),
    primarySurface: parseSurface(project.answers?.primary_surface)
  })
}

export function hasChannel(spec: WorkspaceSpec, channel: Channel): boolean {
  return spec.channels.includes(channel)
}

export function motionComplete(
  contact: { channelsDone?: Channel[] },
  spec: WorkspaceSpec
): boolean {
  const done = new Set(contact.channelsDone ?? [])
  return spec.channels.every((ch) => done.has(ch))
}

export function nextChannel(
  contact: { channelsDone?: Channel[]; stepIndex?: number },
  spec: WorkspaceSpec
): Channel | null {
  if (motionComplete(contact, spec)) return null
  const done = new Set(contact.channelsDone ?? [])
  const step = spec.steps[contact.stepIndex ?? 0]
  if (step && !done.has(step.channel) && spec.channels.includes(step.channel)) return step.channel
  return spec.channels.find((ch) => !done.has(ch)) ?? null
}

export function parseDeploySpec(
  raw: unknown
): { ok: true; spec?: DeploySpecInput } | { ok: false; error: string } {
  if (raw == null) return { ok: true }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'spec must be an object' }
  }
  const rec = raw as Record<string, unknown>
  const spec: DeploySpecInput = {}

  if (rec.goal != null) {
    if (typeof rec.goal !== 'string' || !rec.goal.trim()) {
      return { ok: false, error: 'spec.goal must be a string' }
    }
    spec.goal = rec.goal.trim()
  }
  if (rec.segment != null) {
    if (typeof rec.segment !== 'string') return { ok: false, error: 'spec.segment must be a string' }
    spec.segment = rec.segment.trim()
  }
  if (rec.primarySurface != null) {
    const surface = parseSurface(rec.primarySurface)
    if (!surface) return { ok: false, error: 'spec.primarySurface must be queue, dial, inbox, linkedin, or sequence' }
    spec.primarySurface = surface
  }
  if (rec.kind != null) {
    if (typeof rec.kind !== 'string' || !KINDS.includes(rec.kind as ProjectKind)) {
      return { ok: false, error: 'spec.kind is invalid' }
    }
    spec.kind = rec.kind as ProjectKind
  }
  if (rec.channels != null) {
    if (!Array.isArray(rec.channels) || rec.channels.length === 0) {
      return { ok: false, error: 'spec.channels must be a non-empty array' }
    }
    const channels = uniqueChannels(rec.channels)
    if (!channels) return { ok: false, error: 'spec.channels must be email, call, and/or linkedin' }
    spec.channels = channels
  }
  if (rec.steps != null) {
    if (!Array.isArray(rec.steps) || rec.steps.length === 0) {
      return { ok: false, error: 'spec.steps must be a non-empty array' }
    }
    if (rec.steps.length > 8) return { ok: false, error: 'spec.steps is limited to 8' }
    const steps: WorkspaceSpecStep[] = []
    for (const [i, item] of rec.steps.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, error: `spec.steps[${i}] must be an object` }
      }
      const row = item as Record<string, unknown>
      const channel = parseChannel(row.channel)
      if (!channel) return { ok: false, error: `spec.steps[${i}].channel must be email, call, or linkedin` }
      const day = row.day == null ? undefined : Number(row.day)
      if (day != null && (!Number.isInteger(day) || day < 0 || day > 30)) {
        return { ok: false, error: `spec.steps[${i}].day must be an integer 0–30` }
      }
      steps.push({
        day: day ?? i,
        channel,
        label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : defaultLabel(channel, i === 0 ? 'intro' : 'followup'),
        subject: typeof row.subject === 'string' ? row.subject : undefined,
        body: typeof row.body === 'string' ? row.body : undefined
      })
    }
    spec.steps = steps
  }

  return { ok: true, spec: Object.keys(spec).length ? spec : undefined }
}

/** Refine catalog surface with prompt cues that don't change the tool identity. */
function refinePrimarySurface(
  t: string,
  channels: Channel[],
  fromIntent: PrimarySurface
): PrimarySurface {
  if (/\bdialer|power[ -]?dial/.test(t) && channels.includes('call')) return 'dial'
  if (/\btoday|daily (tasks?|queue)|work the (list|queue)/.test(t) || MCP_TASKS_RE.test(t)) return 'queue'
  if (MCP_INBOX_RE.test(t) && channels.includes('email')) return 'inbox'
  if (MCP_ONE_OFF_RE.test(t) && channels.includes('email')) return 'inbox'
  if (channels.length === 1) {
    if (channels[0] === 'call') return 'dial'
    if (channels[0] === 'linkedin') return 'linkedin'
    if (/\bsequenc|\bcadence|\bdrip\b/.test(t)) return 'sequence'
    return fromIntent === 'inbox' ? 'inbox' : 'sequence'
  }
  if (/\bsequenc|\bcadence/.test(t) && !/\btoday|daily/.test(t)) return 'sequence'
  if (channels[0] === 'call') return 'dial'
  if (channels[0] === 'linkedin') return 'queue'
  return fromIntent
}

function refineKind(
  t: string,
  channels: Channel[],
  primary: PrimarySurface,
  fromIntent: ProjectKind
): ProjectKind {
  if (/\btoday|daily (tasks?|queue)/.test(t) || primary === 'queue') return 'today'
  if (channels.length === 1 && channels[0] === 'call') return 'dialer'
  if (primary === 'dial') return 'dialer'
  if (channels.length === 1 && channels[0] === 'email') return 'sequencer'
  if (channels.length === 1 && channels[0] === 'linkedin') return fromIntent
  if (channels.includes('linkedin') || channels.length > 1) return 'cadence'
  return fromIntent
}

function inferSegment(prompt: string): string {
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[[\s\S]*?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const forMatch = cleaned.match(/\bfor\s+(?:my\s+)?(.{3,60}?)(?:[.!?]|$)/i)
  if (forMatch?.[1] && !/these \d+|this list|the following/i.test(forMatch[1])) {
    return titleCase(forMatch[1].replace(/\b(a|an|the)\s+/i, '').trim())
  }
  return 'HubSpot contacts'
}

function buildSteps(channels: Channel[], goal: string, prompt: string): WorkspaceSpecStep[] {
  const tone = /casual|friendly|warm/.test(prompt.toLowerCase()) ? 'Warm & brief' : 'Direct & concise'
  const ladder = parseExplicitDayLadder(prompt)
  if (ladder?.length) {
    return ladder.slice(0, 8).map((step, i) => ({
      day: step.day,
      channel: step.channel,
      label: defaultLabel(step.channel, i === 0 ? 'intro' : 'followup'),
      ...copyFor(step.channel, i === 0 ? 'intro' : 'followup', goal, tone)
    }))
  }

  const span = parseStepSpan(prompt)
  if (span) {
    return expandStepSpan(channels, span.count, span.days, goal, tone)
  }

  const steps: WorkspaceSpecStep[] = channels.map((channel, i) => {
    const role = i === 0 ? 'intro' : 'same-day'
    return {
      day: i <= 1 ? 0 : 2,
      channel,
      label: defaultLabel(channel, role),
      ...copyFor(channel, role, goal, tone)
    }
  })
  if (channels.length === 1) {
    steps.push({
      day: 2,
      channel: channels[0],
      label: defaultLabel(channels[0], 'followup'),
      ...copyFor(channels[0], 'followup', goal, tone)
    })
  }
  return steps
}

/** Parse "day 0 email, day 3 call, day 7 linkedin" ladders from the prompt. */
function parseExplicitDayLadder(prompt: string): Array<{ day: number; channel: Channel }> | undefined {
  const re =
    /\bday\s+(\d{1,2})\s*(?:[:\-–—,]|\s)\s*(email|e-?mail|call|phone|dial|linkedin|inmail)\b/gi
  const out: Array<{ day: number; channel: Channel }> = []
  for (const match of prompt.matchAll(re)) {
    const day = Number(match[1])
    const channel = channelFromWord(match[2])
    if (!Number.isInteger(day) || day < 0 || day > 30 || !channel) continue
    out.push({ day, channel })
  }
  return out.length >= 2 ? out.slice(0, 8) : undefined
}

/** Parse "7 steps over 10 days" / "7-step sequence across 10 days". */
function parseStepSpan(prompt: string): { count: number; days: number } | undefined {
  const t = prompt.toLowerCase()
  const match =
    t.match(
      /(\d{1,2})\s*[- ]?\s*steps?[\s\w-]{0,48}?(?:over|across|in|spanning|through)\s+(\d{1,2})\s*days?/
    ) ||
    t.match(
      /(?:sequence|cadence|drip)\s+(?:of\s+)?(\d{1,2})\s*steps?\s+(?:over|across|in|spanning|through)\s+(\d{1,2})\s*days?/
    )
  if (!match) return undefined
  const count = Math.min(8, Math.max(1, Number(match[1])))
  const days = Math.min(30, Math.max(0, Number(match[2])))
  if (!Number.isFinite(count) || !Number.isFinite(days)) return undefined
  return { count, days }
}

function expandStepSpan(
  channels: Channel[],
  count: number,
  spanDays: number,
  goal: string,
  tone: string
): WorkspaceSpecStep[] {
  const n = Math.min(8, Math.max(1, count))
  const days = Math.min(30, Math.max(0, spanDays))
  const pool = channels.length ? channels : (['email'] as Channel[])
  return Array.from({ length: n }, (_, i) => {
    const channel = pool[i % pool.length]
    const day = n === 1 ? 0 : Math.round((i / (n - 1)) * days)
    const role = i === 0 ? 'intro' : 'followup'
    return {
      day,
      channel,
      label: defaultLabel(channel, role),
      ...copyFor(channel, role, goal, tone)
    }
  })
}

function channelFromWord(word: string): Channel | undefined {
  const t = word.toLowerCase()
  if (/email|e-?mail/.test(t)) return 'email'
  if (/call|phone|dial/.test(t)) return 'call'
  if (/linkedin|inmail/.test(t)) return 'linkedin'
  return undefined
}

function normalizeSteps(steps: WorkspaceSpecStep[], goal: string): WorkspaceSpecStep[] {
  return steps.map((step, i) => ({
    day: Number.isFinite(step.day) ? step.day : i <= 1 ? 0 : 2,
    channel: step.channel,
    label: step.label || defaultLabel(step.channel, i === 0 ? 'intro' : 'followup'),
    subject: step.subject,
    body: step.body ?? (step.channel === 'call' ? undefined : copyFor(step.channel, i === 0 ? 'intro' : 'followup', goal, 'Direct & concise').body)
  }))
}

function defaultLabel(channel: Channel, role: 'intro' | 'same-day' | 'followup'): string {
  if (channel === 'call') return role === 'intro' ? 'Discovery dial' : 'Follow-up call'
  if (channel === 'linkedin') {
    if (role === 'followup') return 'LinkedIn follow-up'
    if (role === 'same-day') return 'LinkedIn note'
    return 'LinkedIn intro'
  }
  if (role === 'followup') return 'Follow-up email'
  if (role === 'same-day') return 'Same-day email'
  return 'Intro email'
}

function copyFor(
  channel: Channel,
  role: 'intro' | 'same-day' | 'followup',
  goal: string,
  tone: string
): { subject?: string; body?: string } {
  if (channel === 'call') return {}
  const goalText = goal.toLowerCase()
  if (channel === 'linkedin') {
    if (role === 'followup') {
      return {
        body: `Hi {{first_name}} — bumping this in case it got buried. Open to a short note toward ${goalText}?`
      }
    }
    return {
      body: `Hi {{first_name}}, noticed {{company}} and thought it was worth a short note toward ${goalText}. (${tone})`
    }
  }
  if (role === 'followup') {
    return {
      subject: 'Following up',
      body: `Hi {{first_name}},\n\nWanted to bump this in case it got buried — happy to keep it short.\n\n— (${tone})`
    }
  }
  return {
    subject: 'Quick idea for {{company}}',
    body: `Hi {{first_name}},\n\nNoticed {{company}} and thought it was worth a 12-min look toward ${goalText}.\n\n— (${tone})`
  }
}

function uniqueChannels(raw?: unknown): Channel[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out: Channel[] = []
  for (const item of raw) {
    const channel = parseChannel(item)
    if (channel && !out.includes(channel)) out.push(channel)
  }
  return out.length ? out : undefined
}

function parseChannel(value: unknown): Channel | undefined {
  return typeof value === 'string' && CHANNELS.includes(value as Channel) ? (value as Channel) : undefined
}

function parseSurface(value: unknown): PrimarySurface | undefined {
  return typeof value === 'string' && SURFACES.includes(value as PrimarySurface)
    ? (value as PrimarySurface)
    : undefined
}

function parseChannelString(value?: string): Channel[] | undefined {
  if (!value) return undefined
  const t = value.toLowerCase()
  const found: Channel[] = []
  if (/email/.test(t)) found.push('email')
  if (/call|phone/.test(t)) found.push('call')
  if (/linkedin/.test(t)) found.push('linkedin')
  return found.length ? found : undefined
}

function parseStoredSpec(raw?: string): WorkspaceSpec | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as WorkspaceSpec
    if (parsed?.channels?.length && parsed.steps?.length) return parsed
  } catch {
    /* ignore */
  }
  return undefined
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
