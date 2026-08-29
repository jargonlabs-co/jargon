/** Translate natural-language prompts into Crustdata person/search filters. */

export type CrustdataFilterNode =
  | { field: string; type: string; value: string | string[] | number }
  | { op: 'and' | 'or'; conditions: CrustdataFilterNode[] }

export type CrustdataQueryIntent = {
  limit: number
  filters: CrustdataFilterNode
  summary: string
}

const TITLE_KEYWORDS = [
  'vp',
  'vice president',
  'director',
  'head',
  'chief',
  'cro',
  'cmo',
  'ceo',
  'founder',
  'president',
  'manager',
  'gtm',
  'revenue',
  'sales',
  'marketing',
  'growth'
]

function extractLimit(prompt: string): number {
  const m =
    prompt.match(/(?:top\s+)?(\d+)\s+prospects?/i) ||
    prompt.match(/(\d+)\s+people/i) ||
    prompt.match(/find\s+(?:me\s+)?(\d+)/i)
  if (m?.[1]) return Math.min(Math.max(Number(m[1]), 1), 100)
  if (/today|contact today/i.test(prompt)) return 25
  return 20
}

function titleConditionsFromPrompt(prompt: string): CrustdataFilterNode[] {
  const lower = prompt.toLowerCase()
  const matched: string[] = []

  for (const kw of TITLE_KEYWORDS) {
    if (lower.includes(kw)) {
      const token = kw === 'vice president' ? 'VP' : kw.split(' ').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ')
      if (kw === 'vp' || kw === 'vice president') matched.push('VP')
      else if (kw === 'gtm') matched.push('GTM')
      else matched.push(kw === 'cro' || kw === 'cmo' || kw === 'ceo' ? kw.toUpperCase() : token)
    }
  }

  const unique = [...new Set(matched)]
  if (unique.length === 0) {
    return [
      { field: 'experience.employment_details.current.title', type: '(.)', value: 'VP' },
      { field: 'experience.employment_details.current.title', type: '(.)', value: 'Director' },
      { field: 'experience.employment_details.current.title', type: '(.)', value: 'Head' }
    ]
  }

  return unique.map((value) => ({
    field: 'experience.employment_details.current.title',
    type: '(.)' as const,
    value
  }))
}

function extractLocation(prompt: string): string | undefined {
  const inMatch = prompt.match(/\b(?:in|based in|located in)\s+([A-Za-z .,'-]{2,48})/i)
  if (inMatch?.[1]) {
    return inMatch[1].replace(/\s+(to contact|today|this week).*$/i, '').trim()
  }
  const cities = [
    'San Francisco',
    'New York',
    'Austin',
    'Seattle',
    'Boston',
    'Chicago',
    'Atlanta',
    'London',
    'Remote'
  ]
  for (const city of cities) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(prompt)) return city
  }
  return undefined
}

/** Build a Crustdata `/person/search` filter tree from a user prompt. */
export function promptToCrustdataQuery(prompt: string): CrustdataQueryIntent {
  const limit = extractLimit(prompt)
  const conditions: CrustdataFilterNode[] = [
    {
      op: 'or',
      conditions: titleConditionsFromPrompt(prompt)
    }
  ]

  const location = extractLocation(prompt)
  if (location) {
    conditions.push({
      field: 'basic_profile.location.raw',
      type: '(.)',
      value: location
    })
  }

  if (/software|saas|b2b/i.test(prompt)) {
    conditions.push({
      field: 'experience.employment_details.current.company_industry',
      type: '(.)',
      value: 'software'
    })
  }

  const titleHint = TITLE_KEYWORDS.find((kw) => prompt.toLowerCase().includes(kw)) ?? 'GTM leaders'
  const locationHint = location ? ` · ${location}` : ''
  const summary = `Crustdata · ${limit} ${titleHint}${locationHint}`

  return {
    limit,
    filters: { op: 'and', conditions },
    summary
  }
}
