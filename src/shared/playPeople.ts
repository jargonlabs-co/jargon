import type { Play, PlayVariable } from './play'

export type PlayPerson = {
  name: string
  title: string
  company: string
  email: string
  phone: string
  city: string
  values: Record<string, string>
}

/** The stage-deal preview, used when the sentence only asks for the last objection and quiet hours. */
export const DEAL_PLAY_PEOPLE: PlayPerson[] = [
  {
    name: 'Ada Morales',
    title: 'Office manager',
    company: 'Pine Street Veterinary',
    city: 'Austin',
    email: 'ada@pinestreet.example',
    phone: '+15125550110',
    values: {
      last_call_objection: 'Already locked into a records system through next year.',
      quiet_window: '8:00–9:30am CT'
    }
  },
  {
    name: 'Owen Briggs',
    title: 'Practice owner',
    company: 'Summit Veterinary',
    city: 'Denver',
    email: 'owen@summit.example',
    phone: '+13035550110',
    values: {
      last_call_objection: 'Budget is frozen until the new hospital wing opens.',
      quiet_window: '7:30–9:00am MT'
    }
  },
  {
    name: 'Noah Patel',
    title: 'Medical director',
    company: 'Cascade Veterinary',
    city: 'Seattle',
    email: 'noah@cascade.example',
    phone: '+12065550110',
    values: {
      last_call_objection: 'Too many vendors already calling the front desk.',
      quiet_window: '8:00–9:30am PT'
    }
  }
]

const GENERIC_PLAY_PEOPLE: PlayPerson[] = [
  {
    name: 'Ava Singh',
    title: 'Operations lead',
    company: 'Northwind',
    city: 'Chicago',
    email: 'ava.singh@northwind.example',
    phone: '+13125550121',
    values: {}
  },
  {
    name: 'Jonah Reed',
    title: 'Director',
    company: 'Brightline',
    city: 'Denver',
    email: 'jonah.reed@brightline.example',
    phone: '+13035550134',
    values: {}
  },
  {
    name: 'Sofia Alvarez',
    title: 'Owner',
    company: 'Fieldwork',
    city: 'Austin',
    email: 'sofia.alvarez@fieldwork.example',
    phone: '+15125550147',
    values: {}
  }
]

const QUIET = ['8:00–9:30am CT', '7:30–9:00am MT', '8:00–9:30am PT']
const OBJECTIONS = [
  'Already locked into the current setup through next year.',
  'Budget is frozen until the next planning cycle.',
  'Too many vendors already in the account.'
]
const ADDONS = [
  'Replenishment inside the existing ordering app',
  'A seasonal set that rides the current fixture',
  'Loyalty that uses their own list'
]

export function demoPeopleFor(play: Play): Array<PlayPerson & { attrs: Record<string, string> }> {
  const keys = play.variables.map((variable) => variable.key)
  const dealShaped = keys.length > 0 && keys.every((key) => key === 'last_call_objection' || key === 'quiet_window')
  const roster = dealShaped ? DEAL_PLAY_PEOPLE : GENERIC_PLAY_PEOPLE
  return roster.map((person, index) => ({
    ...person,
    attrs: Object.fromEntries(play.variables.map((variable) => [variable.key, person.values[variable.key] || valueFor(variable, index)]))
  }))
}

export function valueFor(variable: PlayVariable, index: number): string {
  const n = ((index % 3) + 3) % 3
  if (variable.key === 'quiet_window' || variable.use === 'when' || /quiet|hour|google/i.test(variable.label)) {
    return QUIET[n] ?? QUIET[0]
  }
  if (variable.key === 'last_call_objection' || variable.key === 'attention_pain') return OBJECTIONS[n] ?? ''
  if (variable.key === 'brand_addon') return ADDONS[n] ?? ''
  if (variable.use === 'position') {
    const options = [
      `${variable.label}: a similar-account example`,
      `${variable.label}: the version that matches their setup`,
      `${variable.label}: the option they asked about last quarter`
    ]
    return options[n] ?? options[0]
  }
  const lines = [
    'Which plan includes onboarding.',
    'Whether this replaces what they already run.',
    'Who else needs to be on the next call.'
  ]
  return lines[n] ?? lines[0]
}
