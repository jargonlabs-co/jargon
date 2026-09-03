/** Talk-track intelligence shown in the rep console. */

export interface TalkTrackSection {
  id: string
  label: string
  items: string[]
  /** Visual emphasis for hot signals */
  emphasis?: 'default' | 'hot'
}

export interface ProspectTalkTrack {
  hook: string
  opener: string
  sections: TalkTrackSection[]
}

export interface ProspectContextInput {
  id: string
  name: string
  company: string
  title?: string
  city?: string
  linkedinUrl?: string
  companyDomain?: string
  companyIndustry?: string
  companySize?: string
  companyRevenue?: string
  accountName?: string
  context?: string[]
}

const TENURE = ['2 months', '3 months', '4 months', '6 months', '9 months', 'about a year']
const ROUNDS = ['Series A', 'Series B', 'Series C', 'seed extension']
const PREV = ['a Series A SaaS', 'a PLG startup', 'an enterprise CRM', 'a fintech Series B']

const TECH_STACKS = [
  ['Salesforce CRM', 'HubSpot Marketing', 'Outreach', 'Gong'],
  ['HubSpot CRM', 'Salesloft', 'ZoomInfo', 'LinkedIn Sales Nav'],
  ['Salesforce', 'Marketo', '6sense', 'Clari'],
  ['Pipedrive', 'Apollo', 'Instantly', 'Fireflies'],
  ['Microsoft Dynamics', 'ZoomInfo', 'Gong', 'Snowflake']
]

const HIRING_SIGNALS = [
  '3 SDR openings posted in the last 30 days',
  'RevOps manager role opened 2 weeks ago',
  'Head of Sales hire — new leader in seat',
  'GTM engineer posting · building outbound infra',
  'SDR team doubling per LinkedIn headcount',
  'First AE hire in Atlanta hub this quarter'
]

const INTENT_SIGNALS = [
  'Visited pricing page twice this week',
  'Downloaded outbound playbook last month',
  'Engaged with competitor comparison content',
  'Attended GTM webinar · asked about sequencing',
  'LinkedIn post about scaling pipeline last week',
  'Job posts mention “build outbound from scratch”'
]

const FUNDING_SIGNALS = [
  'Recent Series B — GTM budget unlock likely',
  'Series A closed · hiring SDRs next',
  'Bootstrapped but profitable · investing in sales tools',
  'PE-backed · efficiency mandate on pipeline'
]

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h
}

function pick<T>(arr: T[], seed: number, offset = 0): T {
  return arr[(seed + offset) % arr.length]
}

function pickMany<T>(arr: T[], seed: number, count: number, stride = 3): T[] {
  const out: T[] = []
  for (let i = 0; i < count; i++) {
    const item = arr[(seed + i * stride) % arr.length]
    if (!out.includes(item)) out.push(item)
  }
  return out
}

/** Talk track from live Crustdata fields — no synthetic demo signals. */
export function crustdataTalkTrack(contact: ProspectContextInput): ProspectTalkTrack {
  const first = contact.name.split(/\s+/)[0] || contact.name
  const company = contact.accountName ?? contact.company ?? 'their company'
  const title = contact.title || 'leader'
  const headline = contact.context?.[0] ?? `${title} at ${company}`
  const hook = headline.length > 140 ? `${headline.slice(0, 137)}…` : headline
  const opener = `Hi ${first} — ${hook} Open to a quick conversation this week?`

  return {
    hook,
    opener,
    sections: [
      {
        id: 'profile',
        label: 'From Crustdata',
        items: [
          headline,
          `${title} · ${company}`,
          ...(contact.city ? [contact.city] : []),
          ...(contact.linkedinUrl ? ['LinkedIn profile available'] : [])
        ].filter(Boolean)
      }
    ]
  }
}

/** Structured talk track for rep console. */
export function prospectTalkTrack(contact: ProspectContextInput): ProspectTalkTrack {
  if (contact.context?.length && !contact.companyIndustry?.includes('demo')) {
    const fromProfile = crustdataTalkTrack(contact)
    if (contact.context.some((line) => line.length > 20)) return fromProfile
  }
  const company = contact.accountName ?? contact.company ?? 'their company'
  const h = hash(contact.id || company)
  const first = contact.name.split(/\s+/)[0] || contact.name
  const title = contact.title || 'leader'
  const industry = contact.companyIndustry ?? 'B2B software'
  const size = contact.companySize ?? '150–400'
  const tenure = pick(TENURE, h)
  const round = pick(ROUNDS, h >> 2)
  const tech = pick(TECH_STACKS, h >> 4)
  const crm = tech[0]
  const engagement = tech[tech.length - 1]

  const technographics: TalkTrackSection = {
    id: 'tech',
    label: 'Technographics',
    items: [
      `CRM: ${crm} · sales engagement on ${tech[2] ?? 'Outreach'}`,
      `Data stack: ${tech[1]} · conversation intel via ${engagement}`,
      contact.companyDomain ? `Domain: ${contact.companyDomain}` : `Mid-market ${industry} stack`,
      size ? `${size} employees · typical 2–4 rep pods` : 'Mid-market team structure'
    ]
  }

  const hiring: TalkTrackSection = {
    id: 'hiring',
    label: 'Hiring trends',
    emphasis: h % 3 === 0 ? 'hot' : 'default',
    items: pickMany(HIRING_SIGNALS, h >> 1, 3, 2)
  }

  const signals: TalkTrackSection = {
    id: 'signals',
    label: 'Intent & signals',
    emphasis: 'hot',
    items: [
      ...pickMany(INTENT_SIGNALS, h >> 3, 2, 5),
      pick(FUNDING_SIGNALS, h >> 5),
      `Started as ${title} ${tenure} ago — still shaping priorities`,
      `Recent ${round} · outbound motion likely funded`
    ].slice(0, 4)
  }

  const account: TalkTrackSection = {
    id: 'account',
    label: 'Account context',
    items: [
      `${company} · ${industry}`,
      contact.city ? `${contact.city} HQ · regional mid-market account` : 'Regional mid-market account',
      `Previously at ${pick(PREV, h >> 6)}`,
      `${title} owns pipeline targets this quarter`
    ]
  }

  if (contact.context?.length) {
    signals.items = [...contact.context.slice(0, 2), ...signals.items].slice(0, 4)
  }

  const hook = `Strong fit — ${company} is scaling GTM with open reqs and active buying signals.`
  const opener = `Hi ${first} — saw ${company} is ${pick(HIRING_SIGNALS, h).toLowerCase()} and running ${crm}. Worth 15 minutes on how similar teams book more meetings without adding headcount?`

  return {
    hook,
    opener,
    sections: [technographics, hiring, signals, account]
  }
}

/** @deprecated use prospectTalkTrack */
export function prospectContextSnippets(contact: ProspectContextInput): string[] {
  const track = prospectTalkTrack(contact)
  return track.sections.flatMap((s) => s.items).slice(0, 3)
}
