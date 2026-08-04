import type {
  Campaign,
  Contact,
  Database,
  Project,
  ProjectKind,
  Sequence,
  SequenceStep
} from './types'

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

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

export function seedProject(
  db: Database,
  input: {
    prompt: string
    kind: ProjectKind
    answers: Record<string, string>
  }
): Project {
  const kind = resolveKind(input.answers, input.kind)
  const segment = titleCase(input.answers.segment ?? 'General')
  const team = titleCase(input.answers.team ?? 'Sales')
  const label = kindLabel(kind)
  const name = segment !== 'General' ? `${segment} ${label}` : `${team} ${label}`
  const now = Date.now()

  const project: Project = {
    id: uid('proj'),
    name,
    kind,
    prompt: input.prompt,
    segment,
    team,
    description: `${label} for ${segment}, owned by ${team}.`,
    answers: input.answers,
    createdAt: now,
    updatedAt: now
  }

  db.projects.unshift(project)

  const contacts = buildContacts(project.id, 6, segment)
  db.contacts.push(...contacts)

  if (kind === 'dialer' || kind === 'generic') {
    db.campaigns.push(...buildCampaigns(project, contacts.length))
  }

  if (kind === 'sequencer' || kind === 'cadence' || kind === 'generic' || kind === 'list') {
    const { sequence, steps } = buildSequence(project)
    db.sequences.push(sequence)
    db.steps.push(...steps)
  }

  if (kind === 'dialer') {
    const { sequence, steps } = buildDialSequence(project)
    db.sequences.push(sequence)
    db.steps.push(...steps)
  }

  db.activities.unshift({
    id: uid('act'),
    projectId: project.id,
    kind: 'system',
    summary: `Created project ${project.name}`,
    createdAt: now
  })

  return project
}

function resolveKind(answers: Record<string, string>, fallback: ProjectKind): ProjectKind {
  const confirm = answers.kind_confirm
  if (!confirm) return fallback
  if (/dialer/i.test(confirm)) return 'dialer'
  if (/sequenc/i.test(confirm)) return 'sequencer'
  if (/cadence/i.test(confirm)) return 'cadence'
  if (/list/i.test(confirm)) return 'list'
  return fallback
}

function kindLabel(kind: ProjectKind): string {
  switch (kind) {
    case 'dialer':
      return 'Outbound Dialer'
    case 'sequencer':
      return 'Email Sequencer'
    case 'cadence':
      return 'Outreach Cadence'
    case 'list':
      return 'Lead List Builder'
    default:
      return 'Sales Tool'
  }
}

function buildContacts(projectId: string, count: number, segment: string): Contact[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[i % FIRST.length]
    const last = LAST[(i + 3) % LAST.length]
    const company = COMPANIES[(i + 1) % COMPANIES.length]
    return {
      id: uid('contact'),
      projectId,
      name: `${first} ${last}`,
      company,
      title: TITLES[i % TITLES.length],
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '').slice(0, 12)}.com`,
      phone: `+1 (312) 555-${String(1000 + i * 17).slice(-4)}`,
      city: CITIES[i % CITIES.length],
      status: i === 0 ? 'active' : 'queued',
      stepIndex: 0,
      notes: `${segment} prospect`,
      createdAt: now,
      updatedAt: now
    }
  })
}

function buildCampaigns(project: Project, contactCount: number): Campaign[] {
  const now = Date.now()
  const mode = project.answers.dial_mode ?? 'Power dial'
  const type = /parallel/i.test(mode)
    ? 'PARALLEL'
    : /click/i.test(mode)
      ? 'CLICK-TO-CALL'
      : 'BROADCAST'
  const goal = project.answers.goal ?? 'Book a meeting'

  return [
    {
      id: uid('camp'),
      projectId: project.id,
      name: `${project.segment} ${goal}`,
      state: 'ACTIVE',
      type,
      done: 1,
      total: contactCount * 8,
      ringRatio: 100,
      answerRatio: 33.3,
      createdAt: now - 86400000 * 2,
      updatedAt: now
    },
    {
      id: uid('camp'),
      projectId: project.id,
      name: `${project.team} follow-up wave`,
      state: 'PAUSED',
      type: 'PRESS-ONE',
      done: 12,
      total: 40,
      ringRatio: 92.5,
      answerRatio: 21.4,
      createdAt: now - 86400000 * 7,
      updatedAt: now - 86400000 * 3
    },
    {
      id: uid('camp'),
      projectId: project.id,
      name: `${project.segment} reactivation`,
      state: 'DRAFT',
      type,
      done: 0,
      total: 25,
      ringRatio: 0,
      answerRatio: 0,
      createdAt: now,
      updatedAt: now
    }
  ]
}

function buildSequence(project: Project): { sequence: Sequence; steps: SequenceStep[] } {
  const now = Date.now()
  const sequence: Sequence = {
    id: uid('seq'),
    projectId: project.id,
    name: project.name,
    goal: project.answers.goal ?? 'Book a meeting',
    createdAt: now,
    updatedAt: now
  }

  const stepCount = Number((project.answers.steps ?? '5').match(/\d+/)?.[0] ?? 5)
  const tone = project.answers.tone ?? 'Direct & concise'
  const templates = [
    {
      day: 0,
      label: 'Intro hook',
      subject: 'Quick idea for {{company}}',
      body: `Hi {{first_name}},\n\nNoticed teams in ${project.segment} are wrestling with outbound volume. Worth a 12-min look?\n\n— (${tone})`
    },
    {
      day: 2,
      label: 'Social proof',
      subject: 'How peers approached this',
      body: 'Hi {{first_name}},\n\nSharing a short teardown from a peer team. Happy to tailor it for {{company}}.'
    },
    {
      day: 4,
      label: 'Value bump',
      subject: 'One metric that usually matters',
      body: `Hi {{first_name}},\n\nMost ${project.segment} leaders care about connect-to-meeting rate.`
    },
    {
      day: 7,
      label: 'Soft ask',
      subject: '12 minutes this week?',
      body: 'Hi {{first_name}},\n\nOpen to comparing notes Tue or Thu?'
    },
    {
      day: 10,
      label: 'Breakup',
      subject: 'Closing the loop',
      body: 'Hi {{first_name}},\n\nI’ll step back for now — ping me if timing opens up.'
    },
    {
      day: 14,
      label: 'Revival',
      subject: 'New angle for {{persona}}',
      body: 'Hi {{first_name}},\n\nCame across a new play that fits. Want the 1-pager?'
    },
    {
      day: 18,
      label: 'Final bump',
      subject: 'Last note from me',
      body: 'Hi {{first_name}},\n\nLast nudge — happy to archive if not relevant.'
    }
  ]

  const steps: SequenceStep[] = templates.slice(0, stepCount).map((t, order) => ({
    id: uid('step'),
    sequenceId: sequence.id,
    projectId: project.id,
    day: t.day,
    channel: 'email' as const,
    label: t.label,
    subject: t.subject,
    body: t.body,
    order
  }))

  return { sequence, steps }
}

function buildDialSequence(project: Project): { sequence: Sequence; steps: SequenceStep[] } {
  const now = Date.now()
  const sequence: Sequence = {
    id: uid('seq'),
    projectId: project.id,
    name: `${project.name} call flow`,
    goal: project.answers.goal ?? 'Book a meeting',
    createdAt: now,
    updatedAt: now
  }
  const steps: SequenceStep[] = [
    {
      id: uid('step'),
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'call',
      label: 'Discovery dial',
      order: 0
    },
    {
      id: uid('step'),
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'call',
      label: 'Voicemail drop',
      order: 1
    },
    {
      id: uid('step'),
      sequenceId: sequence.id,
      projectId: project.id,
      day: 1,
      channel: 'email',
      label: 'Post-call follow-up',
      subject: 'Great connecting',
      body: 'Thanks for the time — here’s what we covered…',
      order: 2
    }
  ]
  return { sequence, steps }
}
