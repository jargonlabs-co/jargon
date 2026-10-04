/**
 * Canonical names for buying signals, with the column / property names enrichment vendors use.
 * Keys are matched case- and punctuation-insensitively, so "Intent Score" and "intent-score" both hit.
 */
export const SIGNAL_ALIASES = {
  intent_score: [
    'intent_score',
    'lusha_signal_score',
    'buyer_intent_score',
    'bombora_composite_score',
    'composite_score',
    'sixsense_intent_score',
    '6sense_intent_score',
    'demandbase_intent_score',
    'g2_intent_score'
  ],
  intent_count: ['intent_count', 'intent_signals', 'surge_count'],
  intent_topics: ['intent_topics', 'lusha_intent_topics', 'bombora_topics', 'surging_topics', 'buyer_intent_topics'],
  latest_signal: ['latest_signal', 'lusha_latest_signal', 'last_signal', 'trigger_event', 'buying_signal'],
  hiring: ['hiring', 'open_roles', 'hiring_roles', 'job_postings', 'open_positions'],
  funding_stage: [
    'funding_stage',
    'lusha_funding_stage',
    'latest_funding_stage',
    'last_funding_round',
    'latest_funding_round',
    'funding_round',
    'last_funding_type'
  ],
  seniority: ['seniority', 'lusha_seniority', 'hs_seniority', 'job_seniority', 'management_level', 'job_level'],
  technologies: ['technologies', 'lusha_technologies', 'tech_stack', 'technographics', 'technology_stack']
} as const

export type CanonicalSignal = keyof typeof SIGNAL_ALIASES

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function present(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** The first non-empty value for each canonical signal, whatever the source called it. */
export function canonicalSignals(attrs?: Record<string, unknown> | null): Partial<Record<CanonicalSignal, unknown>> {
  if (!attrs) return {}
  const byKey = new Map<string, unknown>()
  for (const [key, value] of Object.entries(attrs)) {
    const k = normalizeKey(key)
    if (present(value) && !byKey.has(k)) byKey.set(k, value)
  }
  const out: Partial<Record<CanonicalSignal, unknown>> = {}
  for (const [canonical, aliases] of Object.entries(SIGNAL_ALIASES) as Array<[CanonicalSignal, readonly string[]]>) {
    for (const alias of aliases) {
      const value = byKey.get(normalizeKey(alias))
      if (value !== undefined) {
        out[canonical] = value
        break
      }
    }
  }
  return out
}
