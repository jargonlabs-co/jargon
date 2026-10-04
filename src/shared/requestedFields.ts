import { interpolationVars, sanitizeFieldKey } from './fieldCatalog'

type FieldSource = Parameters<typeof interpolationVars>[0]

const KEYWORD_FIELDS: Array<[RegExp, string]> = [
  [/\bintent (score|strength|level)\b/, 'intent_score'],
  [/\b(intent( topics?| signals?| data)?|buyer intent|surge)\b/, 'intent_topics'],
  [/\b(funding|raised|series [a-e]|investment round)\b/, 'funding_stage'],
  [/\b(hiring|open roles|job postings?|headcount growth)\b/, 'hiring'],
  [/\bseniority\b/, 'seniority'],
  [/\b(tech ?stack|technolog(y|ies)|technographics?|tools they use)\b/, 'technologies'],
  [/\b(latest|recent|trigger) (signal|event|news)\b/, 'latest_signal'],
  [/\bindustry\b/, 'companyIndustry'],
  [/\b(company size|headcount|employee count|number of employees)\b/, 'companySize'],
  [/\b(revenue|arr)\b/, 'companyRevenue']
]

const ALWAYS_PRESENT = new Set(['name', 'first_name', 'last_name', 'persona', 'context', 'notes'])

const CLAUSE =
  /\b(?:personali[sz]e[sd]?(?: (?:it|them|each|every|copy|messages?|emails?|openers?))?(?: (?:with|using|on|around|by|from))?|reference|referencing|mention(?:ing)?|cite|citing|require[sd]?|must (?:have|include)|needs?|based on|using|leverag(?:e|ing)|include|including|fields?:)\s+([^.;\n]+)/gi

/**
 * Fields the deploy prompt asks the copy to use. Explicit `{{placeholders}}` always count; otherwise
 * a known signal only counts when it appears in a personalization clause ("personalize with their
 * funding and tech stack"), so audience filters ("companies that raised a Series B") don't gate enroll.
 */
export function parseRequestedFields(prompt: string): string[] {
  const found = new Set<string>()
  for (const match of prompt.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    const key = sanitizeFieldKey(match[1].replace(/^attrs\./, ''))
    if (key && !ALWAYS_PRESENT.has(key)) found.add(key)
  }
  for (const match of prompt.matchAll(CLAUSE)) {
    const clause = match[1].toLowerCase()
    for (const [pattern, field] of KEYWORD_FIELDS) {
      if (pattern.test(clause)) found.add(field)
    }
    for (const token of clause.matchAll(/\battrs\.([a-z0-9_]+)|\b([a-z0-9]+(?:_[a-z0-9]+)+)\b/g)) {
      const key = sanitizeFieldKey(token[1] ?? token[2])
      if (key && !ALWAYS_PRESENT.has(key)) found.add(key)
    }
  }
  return [...found].slice(0, 12)
}

export function missingRequestedFields(contact: FieldSource, fields: string[] | undefined): string[] {
  if (!fields?.length) return []
  const vars = interpolationVars(contact)
  return fields.filter((field) => !vars[field]?.trim())
}
