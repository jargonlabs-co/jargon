import type {
  Channel,
  DeploySpecInput,
  PrimarySurface,
  ProjectKind,
  WorkspaceSpec,
  WorkspaceSpecStep
} from '../server/types'

export type {
  Channel,
  DeploySpecInput,
  PrimarySurface,
  ProjectKind,
  WorkspaceSpec,
  WorkspaceSpecStep
}

const CHANNELS: Channel[] = ['email', 'call', 'linkedin']
const SURFACES: PrimarySurface[] = ['queue', 'dial', 'inbox', 'linkedin', 'sequence']
const KINDS: ProjectKind[] = ['dialer', 'sequencer', 'cadence', 'list', 'today', 'generic']

export function compileWorkspaceSpec(prompt: string, override?: DeploySpecInput): WorkspaceSpec {
  const t = prompt.toLowerCase()
  const channels = uniqueChannels(override?.channels) ?? inferChannels(t, override?.kind)
  const primarySurface = override?.primarySurface ?? inferPrimarySurface(t, channels)
  const goal = override?.goal?.trim() || inferGoal(t, channels)
  const segment = override?.segment?.trim() || inferSegment(prompt)
  const steps = override?.steps?.length
    ? normalizeSteps(override.steps, goal)
    : buildSteps(channels, goal, prompt)
  const kind = override?.kind ?? inferKind(t, channels, primarySurface)
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
  if (spec.kind === 'today' || spec.primarySurface === 'queue') return 'Today queue'
  if (spec.channels.includes('linkedin') || spec.channels.length > 1) return 'Multi-channel cadence'
  if (spec.kind === 'sequencer') return 'Email sequencer'
  return 'Outbound workspace'
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

function inferChannels(t: string, kind?: ProjectKind): Channel[] {
  const exclusive = /\b(only|just|exclusively)\b/.test(t)
  const linkedin = /\blinkedin\b|\binmail\b|connection request/.test(t)
  const call = /\b(dialer|power[ -]?dial|softphone|phone|voice)\b|\bcalls?\b/.test(t)
  const email = /\bemails?\b|\binbox\b|\bmailer\b/.test(t)
  const sequencer = /\bsequenc/.test(t)

  const found: Channel[] = []
  if (email) found.push('email')
  if (call) found.push('call')
  if (linkedin) found.push('linkedin')

  if (linkedin && sequencer && !email && !call) return ['linkedin']
  if (exclusive) {
    if (linkedin && !email && !call) return ['linkedin']
    if (email && !call && !linkedin) return ['email']
    if (call && !email && !linkedin) return ['call']
    if (found.length === 1) return found
  }

  if (found.length) {
    if (/\bdialer|power[ -]?dial/.test(t) && !exclusive && !found.includes('email')) {
      found.push('email')
    }
    return orderByMention(t, found)
  }

  if (/\bcadence\b|multi[ -]?channel/.test(t)) return ['email', 'call', 'linkedin']
  if (sequencer) return ['email']
  if (/\bdialer|power[ -]?dial/.test(t)) return exclusive ? ['call'] : ['call', 'email']
  if (kind === 'dialer') return ['call', 'email']
  if (kind === 'sequencer' || kind === 'list') return ['email']
  if (kind === 'cadence') return ['email', 'call', 'linkedin']
  return ['email', 'call']
}

function inferPrimarySurface(t: string, channels: Channel[]): PrimarySurface {
  if (/\bdialer|power[ -]?dial/.test(t) && channels.includes('call')) return 'dial'
  if (/\btoday|daily (tasks?|queue)|work the (list|queue)/.test(t)) return 'queue'
  if (/\bsequenc|\bcadence/.test(t) && !/\btoday|daily/.test(t)) return 'sequence'
  if (channels.length === 1) {
    if (channels[0] === 'call') return 'dial'
    if (channels[0] === 'linkedin') return 'linkedin'
    return 'inbox'
  }
  if (channels[0] === 'call') return 'dial'
  if (channels[0] === 'linkedin') return 'queue'
  return 'queue'
}

function inferKind(t: string, channels: Channel[], primary: PrimarySurface): ProjectKind {
  if (/\btoday|daily (tasks?|queue)/.test(t) || primary === 'queue') return 'today'
  if (channels.length === 1 && channels[0] === 'call') return 'dialer'
  if (primary === 'dial') return 'dialer'
  if (channels.length === 1 && channels[0] === 'email') return 'sequencer'
  if (channels.includes('linkedin') || channels.length > 1) return 'cadence'
  return 'today'
}

function inferGoal(t: string, channels: Channel[]): string {
  if (/recruit|hire/.test(t)) return 'Book a recruiting conversation'
  if (/renew|churn|retention/.test(t)) return 'Protect the account'
  if (channels.length === 1 && channels[0] === 'call') return 'Dial accounts'
  if (channels.length === 1 && channels[0] === 'linkedin') return 'Start a LinkedIn conversation'
  if (/\bcadence/.test(t)) return 'Run a cadence'
  if (/\btoday|daily/.test(t)) return "Work today's queue"
  return 'Book a meeting'
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

function orderByMention(t: string, channels: Channel[]): Channel[] {
  if (/linkedin first|start with linkedin|linkedin[ -]then/.test(t)) {
    return ['linkedin', ...channels.filter((c) => c !== 'linkedin')]
  }
  if (/call first|phone first|dial first/.test(t)) {
    return ['call', ...channels.filter((c) => c !== 'call')]
  }
  if (/email first/.test(t)) {
    return ['email', ...channels.filter((c) => c !== 'email')]
  }
  return [...channels].sort((a, b) => mentionIndex(t, a) - mentionIndex(t, b))
}

function mentionIndex(t: string, channel: Channel): number {
  const patterns: Record<Channel, RegExp> = {
    email: /\bemail/,
    call: /\b(call|dialer|phone|voice)/,
    linkedin: /\blinkedin/
  }
  const idx = t.search(patterns[channel])
  return idx < 0 ? 999 : idx
}

function buildSteps(channels: Channel[], goal: string, prompt: string): WorkspaceSpecStep[] {
  const tone = /casual|friendly|warm/.test(prompt.toLowerCase()) ? 'Warm & brief' : 'Direct & concise'
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
