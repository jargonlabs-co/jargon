import type {
  Campaign,
  Contact,
  Database,
  Project,
  ProjectKind,
  Sequence,
  SequenceStep,
  WorkspaceSpec
} from './types'
import { uid } from './crypto'
import { buildProspectContext } from './providers/prospects'
import { formatChannels, specToAnswers, workspaceKindLabel } from '../shared/workspaceSpec'
import { setProjectCatalog } from './fieldCatalogSync'

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

const FIRST = [
  'Ava', 'Marcus', 'Sofia', 'Jonah', 'Priya', 'Elena', 'Chris', 'Noah', 'Maya', 'Leo',
  'Iris', 'Owen', 'Nina', 'Kai', 'Ruth', 'Sam', 'Tess', 'Victor', 'Willa', 'Zane',
  'Amara', 'Blake', 'Cora', 'Devon', 'Eden', 'Felix', 'Gia', 'Hugo', 'Ivy', 'Jules'
]
const LAST = [
  'Chen', 'Lee', 'Grant', 'Price', 'Shah', 'Brooks', 'Nguyen', 'Patel', 'Kim', 'Ross',
  'Ortiz', 'Walsh', 'Diaz', 'Singh', 'Cohen'
]
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
const DEMO_SOFTWARE_COMPANIES = [
  { name: 'Clearstack', domain: 'clearstack.io', size: '120' },
  { name: 'Harbor AI', domain: 'harborai.com', size: '85' },
  { name: 'OrbitOps', domain: 'orbitops.com', size: '210' },
  { name: 'Ledgerly', domain: 'ledgerly.com', size: '340' },
  { name: 'Vaultline', domain: 'vaultline.io', size: '95' },
  { name: 'Summit Grid', domain: 'summitgrid.com', size: '160' },
  { name: 'Copperline', domain: 'copperline.ai', size: '70' },
  { name: 'Paynest', domain: 'paynest.com', size: '450' },
  { name: 'Nimbus CRM', domain: 'nimbuscrm.com', size: '280' },
  { name: 'Relaystack', domain: 'relaystack.io', size: '55' },
  { name: 'Brightloop', domain: 'brightloop.com', size: '190' },
  { name: 'Forgecloud', domain: 'forgecloud.com', size: '620' }
]
const TITLES = [
  'VP of Sales',
  'Head of Sales',
  'Chief Revenue Officer',
  'VP Revenue',
  'Head of Growth',
  'VP Marketing',
  'Head of Demand Generation',
  'SDR Manager',
  'BDR Manager',
  'RevOps Lead',
  'Head of Revenue Operations',
  'GTM Lead',
  'VP Go-To-Market',
  'Founder'
]
const CITIES = [
  'San Francisco', 'Austin', 'Seattle', 'Denver', 'New York', 'Chicago', 'Boston', 'Remote',
  'Minneapolis', 'Detroit', 'Indy', 'Milwaukee', 'Columbus', 'St. Louis'
]
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
    spec: WorkspaceSpec
  }
): Project {
  const spec = input.spec
  const kind = spec.kind
  const segment = titleCase(spec.segment || input.answers.segment || 'Target accounts')
  const team = titleCase(input.answers.team ?? 'Sales')
  const label = workspaceKindLabel(spec)
  const prospectCount = input.answers.prospect_count ?? '100'
  const name =
    kind === 'today'
      ? segment !== 'HubSpot contacts' && segment !== 'Target accounts'
        ? `${segment} · ${label}`
        : `Today · ${label}`
      : segment !== 'General' && segment !== 'Target accounts' && segment !== 'HubSpot contacts'
        ? `${segment} ${label}`
        : `${team} ${label}`
  const now = Date.now()
  const orgId = input.orgId

  const project: Project = {
    id: uid('proj'),
    orgId,
    name,
    kind,
    prompt: input.prompt,
    segment,
    team,
    description: `${label} for ${segment} — ${formatChannels(spec.channels)}.`,
    answers: {
      ...specToAnswers(spec),
      ...input.answers,
      segment,
      channels: formatChannels(spec.channels),
      goal: spec.goal,
      primary_surface: spec.primarySurface
    },
    spec,
    createdAt: now,
    updatedAt: now
  }

  db.projects.unshift(project)

  if (input.contacts?.length) {
    db.contacts.push(...input.contacts.map((c) => ({ ...c, projectId: project.id, orgId })))
  }
  setProjectCatalog(db, project.id)

  const contactCount = db.contacts.filter((c) => c.projectId === project.id).length

  if (spec.channels.includes('call') || spec.primarySurface === 'queue' || spec.primarySurface === 'dial') {
    db.campaigns.push(...buildCampaigns(project, contactCount))
  }

  const { sequence, steps } = buildSequenceFromSpec(project, spec)
  db.sequences.push(sequence)
  db.steps.push(...steps)

  db.activities.unshift({
    id: uid('act'),
    orgId,
    projectId: project.id,
    kind: 'system',
    summary:
      contactCount > 0
        ? `Created ${project.name} with ${contactCount} contacts`
        : `Created ${project.name}. Connect HubSpot to load your contacts.`,
    createdAt: now
  })

  return project
}

function buildDemoGtmSoftwareContacts(
  orgId: string,
  projectId: string,
  count: number
): Contact[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[i % FIRST.length]
    const last = LAST[(i * 3) % LAST.length]
    const company = DEMO_SOFTWARE_COMPANIES[i % DEMO_SOFTWARE_COMPANIES.length]
    const title = TITLES[i % TITLES.length]
    const externalId = `seed_demo_${i + 1}`
    return {
      id: uid('contact'),
      orgId,
      projectId,
      name: `${first} ${last}`,
      company: company.name,
      title,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@${company.domain}`,
      phone: `+1-555-${String(1000 + i).slice(-4)}`,
      city: CITIES[i % CITIES.length],
      status: i === 0 ? ('active' as const) : ('queued' as const),
      stepIndex: 0,
      notes: 'Demo GTM software prospect',
      externalId,
      source: 'seed' as const,
      accountName: company.name,
      linkedinUrl: `https://www.linkedin.com/in/${first.toLowerCase()}${last.toLowerCase()}${i}`,
      companyDomain: company.domain,
      companyIndustry: 'computer software',
      companySize: company.size,
      context: buildProspectContext({
        id: externalId,
        company: company.name,
        title,
        companySize: company.size,
        companyIndustry: 'computer software'
      }),
      channelsDone: [],
      createdAt: now,
      updatedAt: now
    }
  })
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

function buildSequenceFromSpec(
  project: Project,
  spec: WorkspaceSpec
): { sequence: Sequence; steps: SequenceStep[] } {
  const now = Date.now()
  const sequence: Sequence = {
    id: uid('seq'),
    orgId: project.orgId,
    projectId: project.id,
    name: `${formatChannels(spec.channels)} · ${spec.goal}`,
    goal: spec.goal,
    createdAt: now,
    updatedAt: now
  }
  const steps: SequenceStep[] = spec.steps.map((step, order) => ({
    id: uid('step'),
    orgId: project.orgId,
    sequenceId: sequence.id,
    projectId: project.id,
    day: step.day,
    channel: step.channel,
    label: step.label,
    subject: step.subject,
    body: step.body,
    order
  }))
  return { sequence, steps }
}
