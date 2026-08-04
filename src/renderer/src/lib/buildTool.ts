import type {
  Channel,
  Lead,
  LeadStatus,
  SalesTool,
  SequenceStep,
  ToolKind
} from '../types'
import { detectKind, kindLabel, titleCase } from './analyzePrompt'

const FIRST = ['Ava', 'Marcus', 'Sofia', 'Jonah', 'Priya', 'Elena', 'Chris', 'Noah']
const LAST = ['Chen', 'Lee', 'Grant', 'Price', 'Shah', 'Brooks', 'Nguyen', 'Patel']
const COMPANIES = [
  'Northwind Logistics',
  'Prairie Health',
  'Lakeside CRM',
  'Midwest Forge',
  'Ledgerly',
  'Paynest',
  'Vaultline',
  'Clearstack'
]
const TITLES = ['VP Sales', 'Head of Growth', 'SDR Manager', 'CRO', 'RevOps Lead', 'Founder']
const CITIES = ['Chicago', 'Minneapolis', 'Detroit', 'Indy', 'Milwaukee', 'Columbus', 'St. Louis']

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]
}

function buildLeads(count: number, segment: string): Lead[] {
  return Array.from({ length: count }, (_, i) => {
    const first = pick(FIRST, i)
    const last = pick(LAST, i + 3)
    const company = pick(COMPANIES, i + 1)
    const status: LeadStatus = i === 0 ? 'active' : 'queued'
    return {
      id: uid('lead'),
      name: `${first} ${last}`,
      company,
      title: pick(TITLES, i),
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${company
        .toLowerCase()
        .replace(/\s+/g, '')
        .slice(0, 12)}.com`,
      phone: `+1 (312) 555-${String(1000 + i * 17).slice(-4)}`,
      city: pick(CITIES, i),
      status,
      stepIndex: 0,
      notes: `${segment} prospect · ICP fit high`
    }
  })
}

function parseStepCount(answers: Record<string, string>): number {
  const raw = answers.steps ?? ''
  const match = raw.match(/(\d+)/)
  return match ? Number(match[1]) : 5
}

function buildSequencerSteps(answers: Record<string, string>, segment: string): SequenceStep[] {
  const count = parseStepCount(answers)
  const tone = answers.tone ?? 'Direct & concise'
  const goal = answers.goal ?? 'Book a meeting'
  const templates = [
    {
      day: 0,
      label: 'Intro hook',
      subject: `Quick idea for {{company}}`,
      body: `Hi {{first_name}},\n\nNoticed teams in ${segment} are wrestling with outbound volume. We help reps book more ${goal.toLowerCase()}s without burning the list.\n\nWorth a 12-min look?\n\n— (${tone})`
    },
    {
      day: 2,
      label: 'Social proof',
      subject: `How {{similar_company}} approached this`,
      body: `Hi {{first_name}},\n\nSharing a short teardown from a peer team hitting the same ICP. Happy to tailor it for {{company}}.\n\n—`
    },
    {
      day: 4,
      label: 'Value bump',
      subject: `One metric that usually matters`,
      body: `Hi {{first_name}},\n\nMost ${segment} leaders care about connect-to-meeting rate. We typically lift that in the first two weeks.\n\nOpen to comparing notes?`
    },
    {
      day: 7,
      label: 'Soft ask',
      subject: `12 minutes this week?`,
      body: `Hi {{first_name}},\n\nIf ${goal.toLowerCase()} is on your plate, I can show a live workflow built for ${segment}.\n\nTue or Thu?`
    },
    {
      day: 10,
      label: 'Breakup',
      subject: `Closing the loop`,
      body: `Hi {{first_name}},\n\nI’ll step back for now — if timing opens up for ${goal.toLowerCase()}, I’m around.\n\n—`
    },
    {
      day: 14,
      label: 'Revival',
      subject: `New angle for {{persona}}`,
      body: `Hi {{first_name}},\n\nCame across a new play that fits ${segment}. Want me to send the 1-pager?`
    },
    {
      day: 18,
      label: 'Final bump',
      subject: `Last note from me`,
      body: `Hi {{first_name}},\n\nLast nudge — happy to archive this thread if it’s not relevant.`
    }
  ]

  return templates.slice(0, count).map((t, i) => ({
    id: uid('step'),
    day: t.day,
    channel: 'email' as Channel,
    label: t.label,
    subject: t.subject,
    body: t.body,
    completed: i === 0
  }))
}

function buildDialerSteps(answers: Record<string, string>): SequenceStep[] {
  const goal = answers.goal ?? 'Book a meeting'
  return [
    { id: uid('step'), day: 0, channel: 'call', label: `Discovery dial · ${goal}`, completed: false },
    { id: uid('step'), day: 0, channel: 'call', label: 'Voicemail drop', completed: false },
    { id: uid('step'), day: 1, channel: 'email', label: 'Post-call follow-up', subject: 'Great connecting', body: 'Thanks for the time — here’s what we covered…', completed: false },
    { id: uid('step'), day: 3, channel: 'call', label: 'Second attempt', completed: false }
  ]
}

function buildCadenceSteps(answers: Record<string, string>): SequenceStep[] {
  const channels = answers.channels ?? 'Email + Call + LinkedIn'
  const useLi = /linkedin/i.test(channels)
  const useCall = /call/i.test(channels)
  const steps: SequenceStep[] = [
    {
      id: uid('step'),
      day: 0,
      channel: 'email',
      label: 'Intro email',
      subject: 'Quick intro',
      body: 'Opening value prop…',
      completed: false
    }
  ]
  if (useCall) {
    steps.push({ id: uid('step'), day: 1, channel: 'call', label: 'Discovery dial', completed: false })
  }
  if (useLi) {
    steps.push({
      id: uid('step'),
      day: 2,
      channel: 'linkedin',
      label: 'Connect + note',
      body: 'Short LinkedIn note…',
      completed: false
    })
  }
  steps.push(
    {
      id: uid('step'),
      day: 4,
      channel: 'email',
      label: 'Case study',
      subject: 'Peer story',
      body: 'Social proof…',
      completed: false
    },
    {
      id: uid('step'),
      day: 7,
      channel: useCall ? 'call' : 'email',
      label: useCall ? 'Follow-up dial' : 'Breakup email',
      subject: useCall ? undefined : 'Closing the loop',
      body: useCall ? undefined : 'Breakup…',
      completed: false
    }
  )
  return steps
}

function buildListSteps(): SequenceStep[] {
  return [
    { id: uid('step'), day: 0, channel: 'email', label: 'Source accounts', completed: true },
    { id: uid('step'), day: 0, channel: 'email', label: 'Enrich contacts', completed: true },
    { id: uid('step'), day: 0, channel: 'email', label: 'Score & filter', completed: false },
    { id: uid('step'), day: 0, channel: 'email', label: 'Push to sequence', completed: false }
  ]
}

function resolveKind(answers: Record<string, string>, fallback: ToolKind): ToolKind {
  const confirm = answers.kind_confirm
  if (!confirm) return fallback
  if (/dialer/i.test(confirm)) return 'dialer'
  if (/sequenc/i.test(confirm)) return 'sequencer'
  if (/cadence/i.test(confirm)) return 'cadence'
  if (/list/i.test(confirm)) return 'list'
  return fallback
}

export function buildToolFromSession(input: {
  prompt: string
  kind: ToolKind
  answers: Record<string, string>
}): SalesTool {
  const kind = resolveKind(input.answers, input.kind)
  const segment = titleCase(input.answers.segment ?? 'General')
  const team = titleCase(input.answers.team ?? 'Sales')
  const label = kindLabel(kind)
  const name = segment !== 'General' ? `${segment} ${label}` : `${team} ${label}`
  const leads = buildLeads(kind === 'list' ? 8 : 6, segment)

  let steps: SequenceStep[]
  switch (kind) {
    case 'dialer':
      steps = buildDialerSteps(input.answers)
      break
    case 'sequencer':
      steps = buildSequencerSteps(input.answers, segment)
      break
    case 'cadence':
      steps = buildCadenceSteps(input.answers)
      break
    case 'list':
      steps = buildListSteps()
      break
    default:
      steps = buildSequencerSteps(input.answers, segment)
  }

  const config: SalesTool['config'] = {
    segment,
    team,
    goal: input.answers.goal ?? 'Book a meeting',
    ...input.answers
  }

  return {
    id: uid('tool'),
    name,
    kind,
    prompt: input.prompt,
    segment,
    team,
    description: `${label} for ${segment}, owned by ${team}. Goal: ${String(config.goal)}.`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'ready',
    answers: input.answers,
    config,
    leads,
    steps,
    stats: {
      enrolled: leads.length,
      contacted: 1,
      replied: 0,
      booked: 0
    },
    activeLeadId: leads[0]?.id ?? null
  }
}

export function assistantReadyReply(tool: SalesTool): string {
  return [
    `Built **${tool.name}** — ready to use.`,
    '',
    tool.description,
    '',
    `Enrolled **${tool.stats.enrolled}** leads · **${tool.steps.length}** steps configured.`,
    '',
    'Open the canvas to run outreach, update dispositions, and advance the sequence. Keep prompting if you want changes.'
  ].join('\n')
}

export function inferKindFromPrompt(prompt: string): ToolKind {
  return detectKind(prompt).kind
}
