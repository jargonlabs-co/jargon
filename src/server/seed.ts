import type {
  Campaign,
  Contact,
  Database,
  Project,
  ProjectKind,
  Sequence,
  SequenceStep
} from './types'
import { uid } from './crypto'
import {
  apolloProspectsToContacts,
  buildDemoGtmSoftwareProspects
} from './providers/apollo'

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
const ATLANTA_CITIES = ['Atlanta', 'Marietta', 'Alpharetta', 'Sandy Springs', 'Roswell', 'Decatur']
const ATLANTA_ACCOUNTS = [
  'Peachtree Logistics',
  'Delta Commerce Group',
  'Buckhead Analytics',
  'Cobb Manufacturing',
  'Midtown SaaS Co',
  'Perimeter Health Tech',
  'Atlantic Freight',
  'Georgia FinServ'
]

export function seedProject(
  db: Database,
  input: {
    orgId: string
    prompt: string
    kind: ProjectKind
    answers: Record<string, string>
    contacts?: Contact[]
  }
): Project {
  const kind = resolveKind(input.answers, input.kind)
  const segment = titleCase(input.answers.segment ?? 'Target accounts')
  const team = titleCase(input.answers.team ?? 'Sales')
  const label = kindLabel(kind)
  const prospectCount = input.answers.prospect_count ?? '100'
  const regionalAtlanta = isAtlantaMidMarket(segment, team, input.prompt)
  const name =
    kind === 'today'
      ? `Today · top ${prospectCount} GTM prospects`
      : regionalAtlanta && (kind === 'sequencer' || kind === 'cadence')
        ? 'Mid Market Atlanta · outbound sequencer'
        : segment !== 'General' && segment !== 'Target accounts'
          ? `${segment} ${label}`
          : `${team} ${label}`
  const now = Date.now()
  const orgId = input.orgId
  const todaySegment =
    kind === 'today'
      ? input.answers.segment?.trim() || 'Software · GTM titles'
      : segment

  const project: Project = {
    id: uid('proj'),
    orgId,
    name,
    kind,
    prompt: input.prompt,
    segment: todaySegment,
    team,
    description:
      kind === 'today'
        ? `Outbound sequencer for top ${prospectCount} GTM-title prospects in software — email and phone.`
        : regionalAtlanta
          ? `Find the right contacts across assigned mid-market accounts in Atlanta and run an outbound flow for each rep.`
          : `${label} for ${segment}, owned by ${team}.`,
    answers: {
      ...input.answers,
      ...(kind === 'today'
        ? {
            segment: todaySegment,
            prospect_source: input.answers.prospect_source ?? 'apollo',
            channels: input.answers.channels ?? 'Phone call + Email'
          }
        : {})
    },
    createdAt: now,
    updatedAt: now
  }

  db.projects.unshift(project)

  if (input.contacts?.length) {
    db.contacts.push(...input.contacts.map((c) => ({ ...c, projectId: project.id, orgId })))
  } else if (kind === 'today') {
    const count = Number(prospectCount)
    const prospects = buildDemoGtmSoftwareProspects(Math.min(Math.max(count, 1), 100))
    db.contacts.push(...apolloProspectsToContacts(orgId, project.id, prospects))
  } else if (regionalAtlanta) {
    db.contacts.push(...buildAtlantaMidMarketContacts(orgId, project.id, 12))
  } else {
    db.contacts.push(...buildContacts(orgId, project.id, 6, segment))
  }

  const contactCount = db.contacts.filter((c) => c.projectId === project.id).length

  if (kind === 'dialer' || kind === 'generic' || kind === 'today' || regionalAtlanta) {
    db.campaigns.push(...buildCampaigns(project, contactCount))
  }

  if (kind === 'today') {
    const { sequence, steps } = buildTodayOutboundSequence(project)
    db.sequences.push(sequence)
    db.steps.push(...steps)
  } else if (regionalAtlanta && (kind === 'sequencer' || kind === 'cadence')) {
    const { sequence, steps } = buildRegionalOutboundSequence(project)
    db.sequences.push(sequence)
    db.steps.push(...steps)
  } else if (kind === 'sequencer' || kind === 'cadence' || kind === 'generic' || kind === 'list') {
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
    orgId,
    projectId: project.id,
    kind: 'system',
    summary:
      kind === 'today'
        ? `Enrolled ${contactCount} GTM software prospects into outbound sequencer (email + call)`
        : regionalAtlanta
          ? `Loaded ${contactCount} contacts across ${ATLANTA_ACCOUNTS.length} assigned mid-market Atlanta accounts`
          : `Created project ${project.name}`,
    createdAt: now
  })

  return project
}

function resolveKind(answers: Record<string, string>, fallback: ProjectKind): ProjectKind {
  if (fallback === 'today') return 'today'
  const confirm = answers.kind_confirm
  if (!confirm) return fallback
  if (/today|prospect|call \+ email|phone/i.test(confirm)) return 'today'
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
    case 'today':
      return 'Today Queue'
    default:
      return 'Sales Tool'
  }
}

function isAtlantaMidMarket(segment: string, team: string, prompt: string): boolean {
  const haystack = `${segment} ${team} ${prompt}`.toLowerCase()
  return /atlanta/.test(haystack) && /mid[- ]market|midmarket/.test(haystack)
}

function buildContacts(
  orgId: string,
  projectId: string,
  count: number,
  segment: string
): Contact[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[i % FIRST.length]
    const last = LAST[(i + 3) % LAST.length]
    const company = COMPANIES[(i + 1) % COMPANIES.length]
    return {
      id: uid('contact'),
      orgId,
      projectId,
      name: `${first} ${last}`,
      company,
      title: TITLES[i % TITLES.length],
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '').slice(0, 12)}.com`,
      phone: `+1 (312) 555-${String(1000 + i * 17).slice(-4)}`,
      city: CITIES[i % CITIES.length],
      status: i === 0 ? ('active' as const) : ('queued' as const),
      stepIndex: 0,
      notes: `${segment} prospect`,
      source: 'seed' as const,
      channelsDone: [],
      createdAt: now,
      updatedAt: now
    }
  })
}

function buildAtlantaMidMarketContacts(orgId: string, projectId: string, count: number): Contact[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[i % FIRST.length]
    const last = LAST[(i + 2) % LAST.length]
    const accountName = ATLANTA_ACCOUNTS[i % ATLANTA_ACCOUNTS.length]
    const company = accountName
    return {
      id: uid('contact'),
      orgId,
      projectId,
      name: `${first} ${last}`,
      company,
      accountName,
      title: TITLES[i % TITLES.length],
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '').slice(0, 14)}.com`,
      phone: `+1 (404) 555-${String(1000 + i * 13).slice(-4)}`,
      city: ATLANTA_CITIES[i % ATLANTA_CITIES.length],
      companyDomain: `${company.toLowerCase().replace(/\s+/g, '').slice(0, 18)}.com`,
      companyIndustry: 'B2B software · logistics & supply chain',
      companySize: ['120', '180', '250', '320', '410'][i % 5],
      companyRevenue: ['$18M', '$24M', '$31M', '$42M', '$55M'][i % 5],
      status: i === 0 ? ('active' as const) : ('queued' as const),
      stepIndex: 0,
      notes: 'Mid Market · Atlanta assigned account',
      source: 'seed' as const,
      channelsDone: [],
      createdAt: now,
      updatedAt: now
    }
  })
}

function buildCampaigns(project: Project, contactCount: number): Campaign[] {
  const now = Date.now()
  const mode = project.answers.dial_mode ?? 'Click-to-call'
  const type = /parallel/i.test(mode)
    ? 'PARALLEL'
    : /click/i.test(mode)
      ? 'CLICK-TO-CALL'
      : 'BROADCAST'
  const goal = project.answers.goal ?? 'Book a meeting'

  return [
    {
      id: uid('camp'),
      orgId: project.orgId,
      projectId: project.id,
      name: project.kind === 'today' ? `Today · ${contactCount} prospects` : `${project.segment} ${goal}`,
      state: 'ACTIVE',
      type,
      done: 0,
      total: contactCount,
      ringRatio: 100,
      answerRatio: 0,
      createdAt: now,
      updatedAt: now
    }
  ]
}

function buildTodayOutboundSequence(project: Project): {
  sequence: Sequence
  steps: SequenceStep[]
} {
  const now = Date.now()
  const tone = project.answers.tone ?? 'Direct & concise'
  const goal = project.answers.goal ?? 'Book a meeting'
  const sequence: Sequence = {
    id: uid('seq'),
    orgId: project.orgId,
    projectId: project.id,
    name: 'Today outbound · email + call',
    goal,
    createdAt: now,
    updatedAt: now
  }

  const steps: SequenceStep[] = [
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'email',
      label: 'Intro email',
      subject: 'Quick idea for {{company}}',
      body: `Hi {{first_name}},\n\nNoticed GTM teams at software companies like {{company}} are prioritizing outbound this week. Open to a 12-min look toward ${goal.toLowerCase()}?\n\n— (${tone})`,
      order: 0
    },
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'call',
      label: 'Same-day call',
      order: 1
    },
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 2,
      channel: 'email',
      label: 'Follow-up email',
      subject: 'Following up',
      body: 'Hi {{first_name}},\n\nWanted to bump this in case it got buried — happy to keep it short.',
      order: 2
    }
  ]

  return { sequence, steps }
}

function buildSequence(project: Project): { sequence: Sequence; steps: SequenceStep[] } {
  const now = Date.now()
  const sequence: Sequence = {
    id: uid('seq'),
    orgId: project.orgId,
    projectId: project.id,
    name: project.name,
    goal: project.answers.goal ?? 'Book a meeting',
    createdAt: now,
    updatedAt: now
  }

  const stepCount = Number((project.answers.steps ?? '3').match(/\d+/)?.[0] ?? 3)
  const tone = project.answers.tone ?? 'Direct & concise'
  const templates = [
    {
      day: 0,
      label: 'Intro email',
      subject: 'Quick idea for {{company}}',
      body: `Hi {{first_name}},\n\nNoticed teams like yours are prioritizing outbound this week. Worth a 12-min look?\n\n— (${tone})`
    },
    {
      day: 0,
      label: 'Same-day call',
      channel: 'call' as const,
      subject: undefined,
      body: undefined
    },
    {
      day: 2,
      label: 'Follow-up',
      subject: 'Following up',
      body: 'Hi {{first_name}},\n\nWanted to bump this in case it got buried.'
    }
  ]

  const steps: SequenceStep[] = templates.slice(0, stepCount).map((t, order) => ({
    id: uid('step'),
    orgId: project.orgId,
    sequenceId: sequence.id,
    projectId: project.id,
    day: t.day,
    channel: ('channel' in t && t.channel ? t.channel : 'email') as 'email' | 'call',
    label: t.label,
    subject: t.subject,
    body: t.body,
    order
  }))

  return { sequence, steps }
}

function buildRegionalOutboundSequence(project: Project): {
  sequence: Sequence
  steps: SequenceStep[]
} {
  const now = Date.now()
  const goal = project.answers.goal ?? 'Book a meeting'
  const tone = project.answers.tone ?? 'Direct & concise'
  const sequence: Sequence = {
    id: uid('seq'),
    orgId: project.orgId,
    projectId: project.id,
    name: 'Mid Market Atlanta · email + call',
    goal,
    createdAt: now,
    updatedAt: now
  }

  const steps: SequenceStep[] = [
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'email',
      label: 'Regional intro',
      subject: 'Quick idea for {{company}}',
      body: `Hi {{first_name}},\n\nReaching out to mid-market teams in Atlanta like {{company}} — open to a short look at how peers are running outbound across assigned accounts?\n\n— (${tone})`,
      order: 0
    },
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'call',
      label: 'Same-day call',
      order: 1
    },
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 2,
      channel: 'email',
      label: 'Account follow-up',
      subject: 'Following up on {{company}}',
      body: `Hi {{first_name}},\n\nWanted to bump this for {{company}} — happy to keep it brief and focused on ${goal.toLowerCase()}.`,
      order: 2
    }
  ]

  return { sequence, steps }
}

function buildDialSequence(project: Project): { sequence: Sequence; steps: SequenceStep[] } {
  const now = Date.now()
  const sequence: Sequence = {
    id: uid('seq'),
    orgId: project.orgId,
    projectId: project.id,
    name: `${project.name} call flow`,
    goal: project.answers.goal ?? 'Book a meeting',
    createdAt: now,
    updatedAt: now
  }
  const steps: SequenceStep[] = [
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'call',
      label: 'Discovery dial',
      order: 0
    },
    {
      id: uid('step'),
      orgId: project.orgId,
      sequenceId: sequence.id,
      projectId: project.id,
      day: 0,
      channel: 'email',
      label: 'Post-call follow-up',
      subject: 'Great connecting',
      body: 'Thanks for the time — here’s what we covered…',
      order: 1
    }
  ]
  return { sequence, steps }
}
