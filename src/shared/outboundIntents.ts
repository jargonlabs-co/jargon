import type { Channel, PrimarySurface, ProjectKind } from '../server/types'

/** Catalog of outbound tools the rule compiler can pick without an LLM. */
export type OutboundIntentId = 'linkedin' | 'phone' | 'email' | 'multi'

export type OutboundIntentMatch = {
  id: OutboundIntentId
  channels: Channel[]
  primarySurface: PrimarySurface
  kind: ProjectKind
  goal: string
}

type IntentDef = {
  id: OutboundIntentId
  channels: Channel[]
  primarySurface: PrimarySurface
  kind: ProjectKind
  goal: string
  /** Weighted phrase hits; higher weight = stronger signal. */
  patterns: Array<{ re: RegExp; weight: number }>
}

const LINKEDIN: IntentDef = {
  id: 'linkedin',
  channels: ['linkedin'],
  primarySurface: 'linkedin',
  kind: 'cadence',
  goal: 'Start a LinkedIn conversation',
  patterns: [
    { re: /\blinkedin\b/, weight: 4 },
    { re: /\binmail\b/, weight: 4 },
    { re: /\bconnection requests?\b/, weight: 3 },
    { re: /\bsocial (?:selling|outbound|outreach)\b/, weight: 3 },
    { re: /\bli[ -]?outreach\b/, weight: 2 },
    { re: /\blinkedin[ -]?(?:queue|sequenc|cadence|outreach|tool|campaign)\b/, weight: 5 }
  ]
}

const PHONE: IntentDef = {
  id: 'phone',
  channels: ['call'],
  primarySurface: 'dial',
  kind: 'dialer',
  goal: 'Dial accounts',
  patterns: [
    { re: /\bdialer\b/, weight: 5 },
    { re: /\bpower[ -]?dial(?:er|ing)?\b/, weight: 5 },
    { re: /\bsoftphone\b/, weight: 4 },
    { re: /\bcold[ -]?calls?\b/, weight: 4 },
    { re: /\bphone[ -]?(?:dial|outbound|outreach|queue|campaign|tool)?\b/, weight: 3 },
    { re: /\bvoice[ -]?(?:outbound|dial|outreach)?\b/, weight: 3 },
    { re: /\bcalling (?:queue|tool|campaign|list)\b/, weight: 3 },
    { re: /\b(?:make|place|run) (?:calls?|dials?)\b/, weight: 2 },
    { re: /\bcalls?\b/, weight: 1 }
  ]
}

const EMAIL: IntentDef = {
  id: 'email',
  channels: ['email'],
  primarySurface: 'sequence',
  kind: 'sequencer',
  goal: 'Book a meeting',
  patterns: [
    { re: /\bemail[ -]?sequenc/, weight: 5 },
    { re: /\bemail[ -]?cadence\b/, weight: 5 },
    { re: /\bemail[ -]?drip\b/, weight: 4 },
    { re: /\bcold[ -]?emails?\b/, weight: 4 },
    { re: /\bmailer\b/, weight: 3 },
    { re: /\bdrip\b/, weight: 3 },
    { re: /\bsequenc(?:e|er|ing)\b/, weight: 2 },
    { re: /\bemails?\b/, weight: 2 },
    { re: /\binbox\b/, weight: 1 }
  ]
}

const MULTI: IntentDef = {
  id: 'multi',
  channels: ['email', 'call', 'linkedin'],
  primarySurface: 'queue',
  kind: 'cadence',
  goal: 'Book a meeting',
  patterns: [
    { re: /\bmulti[ -]?channel\b/, weight: 5 },
    { re: /\bcadence\b/, weight: 4 },
    { re: /\boutbound (?:sequence|cadence|motion|campaign)\b/, weight: 4 },
    { re: /\btoday(?:'s)? (?:tasks?|queue|list)\b/, weight: 3 },
    { re: /\bdaily (?:tasks?|queue)\b/, weight: 3 },
    { re: /\bwork the (?:list|queue)\b/, weight: 3 },
    { re: /\boutbound\b/, weight: 1 }
  ]
}

const CATALOG: IntentDef[] = [LINKEDIN, PHONE, EMAIL, MULTI]

const EXCLUSIVE_RE = /\b(?:only|just|exclusively|solely)\b/
const DIALER_WITH_EMAIL_RE =
  /\b(?:email|mail) (?:follow[ -]?ups?|touches?|steps?)|\bfollow[ -]?up emails?\b|\bwith emails?\b|\bplus emails?\b|\band emails?\b/

/**
 * Pick an outbound tool from the catalog based on the prompt.
 * Prefer single-channel tools when only one channel family is named.
 */
export function matchOutboundIntent(
  prompt: string,
  kindHint?: ProjectKind
): OutboundIntentMatch {
  const t = prompt.toLowerCase()
  const named = namedChannels(t)
  const exclusive = EXCLUSIVE_RE.test(t)
  const scores = scoreIntents(t)

  // Explicit day ladder or multiple named channels → multi with those channels.
  if (named.length >= 2) {
    return multiMatch(orderByMention(t, named), t)
  }

  // Exclusivity: "only LinkedIn", "just calls", etc.
  if (exclusive && named.length === 1) {
    return singleFromChannel(named[0], t)
  }

  // Single named channel family wins over vague multi ("outbound").
  if (named.length === 1) {
    const channel = named[0]
    if (channel === 'call' && DIALER_WITH_EMAIL_RE.test(t)) {
      return {
        id: 'multi',
        channels: orderByMention(t, ['call', 'email']),
        primarySurface: 'dial',
        kind: 'dialer',
        goal: goalFor(t, ['call', 'email'], 'Dial accounts')
      }
    }
    return singleFromChannel(channel, t)
  }

  // Strongest single-channel intent when multi is only weakly matched (e.g. bare "outbound").
  const ranked = ([...CATALOG] as IntentDef[])
    .map((intent) => ({ intent, score: scores[intent.id] }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  const second = ranked[1]
  if (best && best.score > 0) {
    if (best.intent.id !== 'multi') {
      // Prefer phone/email/linkedin when they clearly beat multi, or multi is weak.
      if (best.score >= (scores.multi || 0) + (scores.multi <= 1 ? 0 : 1)) {
        return finalize(best.intent, t)
      }
    } else if (best.score >= 3 || (best.score > 0 && (!second || second.score === 0))) {
      return finalize(MULTI, t)
    } else if (second && second.score > 0 && second.intent.id !== 'multi') {
      return finalize(second.intent, t)
    }
  }

  // Kind hint from API when the prompt has no channel signal.
  if (kindHint === 'dialer') {
    return finalize(PHONE, t)
  }
  if (kindHint === 'sequencer' || kindHint === 'list') {
    return finalize(EMAIL, t)
  }
  if (kindHint === 'cadence' || kindHint === 'today') {
    return finalize(MULTI, t)
  }

  // Default outbound tool when nothing matches: multi-channel cadence.
  return finalize(MULTI, t)
}

function scoreIntents(t: string): Record<OutboundIntentId, number> {
  const scores: Record<OutboundIntentId, number> = {
    linkedin: 0,
    phone: 0,
    email: 0,
    multi: 0
  }
  for (const intent of CATALOG) {
    for (const { re, weight } of intent.patterns) {
      if (re.test(t)) scores[intent.id] += weight
    }
  }
  // "email cadence" / "linkedin sequence" should not also boost generic multi from "cadence"/"sequence".
  if (/\bemail[ -]?cadence\b/.test(t)) scores.multi = Math.max(0, scores.multi - 4)
  if (/\blinkedin[ -]?(?:sequenc|cadence)\b/.test(t)) {
    scores.multi = Math.max(0, scores.multi - 4)
    scores.email = Math.max(0, scores.email - 2)
  }
  if (/\bphone[ -]?cadence\b|\bdial(?:er)?[ -]?cadence\b/.test(t)) {
    scores.multi = Math.max(0, scores.multi - 4)
  }
  return scores
}

function namedChannels(t: string): Channel[] {
  const found: Channel[] = []
  if (/\bemails?\b|\binbox\b|\bmailer\b|\bdrip\b|\bcold[ -]?emails?\b/.test(t)) found.push('email')
  if (
    /\b(?:dialer|power[ -]?dial|softphone|phone|voice|cold[ -]?calls?)\b|\bcalls?\b|\bdials?\b/.test(t)
  ) {
    found.push('call')
  }
  if (/\blinkedin\b|\binmail\b|connection requests?|\bsocial (?:selling|outbound|outreach)\b/.test(t)) {
    found.push('linkedin')
  }
  return found
}

function singleFromChannel(channel: Channel, t: string): OutboundIntentMatch {
  if (channel === 'call') return finalize(PHONE, t)
  if (channel === 'linkedin') return finalize(LINKEDIN, t)
  return finalize(EMAIL, t)
}

function multiMatch(channels: Channel[], t: string): OutboundIntentMatch {
  const primarySurface: PrimarySurface =
    channels[0] === 'call'
      ? 'dial'
      : channels[0] === 'linkedin'
        ? 'queue'
        : /\btoday|daily (?:tasks?|queue)|work the (?:list|queue)/.test(t)
          ? 'queue'
          : 'sequence'
  const kind: ProjectKind =
    primarySurface === 'dial'
      ? 'dialer'
      : channels.length === 1 && channels[0] === 'email'
        ? 'sequencer'
        : /\btoday|daily/.test(t)
          ? 'today'
          : 'cadence'
  return {
    id: 'multi',
    channels,
    primarySurface,
    kind,
    goal: goalFor(t, channels, MULTI.goal)
  }
}

function finalize(intent: IntentDef, t: string): OutboundIntentMatch {
  let primarySurface = intent.primarySurface
  let kind = intent.kind
  if (intent.id === 'multi') {
    if (/\btoday|daily (?:tasks?|queue)|work the (?:list|queue)/.test(t)) {
      primarySurface = 'queue'
      kind = 'today'
    } else if (/\bsequenc|\bcadence/.test(t) && !/\btoday|daily/.test(t)) {
      primarySurface = 'sequence'
      kind = 'cadence'
    }
  }
  if (intent.id === 'email' && /\binbox\b|\bmailbox\b/.test(t) && !/\bsequenc|\bcadence|\bdrip\b/.test(t)) {
    primarySurface = 'inbox'
  }
  return {
    id: intent.id,
    channels: [...intent.channels],
    primarySurface,
    kind,
    goal: goalFor(t, intent.channels, intent.goal)
  }
}

function goalFor(t: string, channels: Channel[], fallback: string): string {
  if (/recruit|hire/.test(t)) return 'Book a recruiting conversation'
  if (/renew|churn|retention/.test(t)) return 'Protect the account'
  if (channels.length === 1 && channels[0] === 'call') return 'Dial accounts'
  if (channels.length === 1 && channels[0] === 'linkedin') return 'Start a LinkedIn conversation'
  if (/\bcadence/.test(t)) return 'Run a cadence'
  if (/\btoday|daily/.test(t)) return 'Work the outbound sequence'
  return fallback
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
    call: /\b(call|dialer|phone|voice|dial)/,
    linkedin: /\blinkedin/
  }
  const idx = t.search(patterns[channel])
  return idx < 0 ? 999 : idx
}
