import type { ClarifyQuestion, ClarifySession, ToolKind } from '../types'

const KIND_PATTERNS: Array<{ kind: ToolKind; pattern: RegExp; label: string }> = [
  {
    kind: 'today',
    pattern:
      /today|top\s+\d+\s+prospect|\d+\s+prospects?\s+to\s+contact|prospects?\s+to\s+contact|gtm|software industry|target accounts?|contact (?:them|my).*(?:phone|call).*(?:email)|(?:phone|call).*(?:email)/i,
    label: 'Today Queue'
  },
  { kind: 'dialer', pattern: /dialer|power.?dial|click.?to.?call/i, label: 'Outbound Dialer' },
  {
    kind: 'sequencer',
    pattern: /sequenc|email.?seq|drip|nurture|instantly|engage|outreach sequencer|outbound sequencer/i,
    label: 'Email Sequencer'
  },
  {
    kind: 'cadence',
    pattern: /cadence|multi.?channel|outreach.?flow|outbound flow|gong/i,
    label: 'Outreach Cadence'
  },
  { kind: 'list', pattern: /list|segment.?builder|lead.?list/i, label: 'Lead List Builder' }
]

export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function extractSegment(prompt: string): string | undefined {
  if (/software/i.test(prompt) && /gtm/i.test(prompt)) return 'Software · GTM titles'
  if (/software/i.test(prompt)) return 'Software'
  if (/gtm/i.test(prompt)) return 'GTM titles'
  if (/mid[- ]market\s+atlanta|atlanta\s+mid[- ]market/i.test(prompt)) return 'Mid Market · Atlanta'
  if (/mid[- ]market/i.test(prompt) && /atlanta/i.test(prompt)) return 'Mid Market · Atlanta'

  const forMatch = prompt.match(
    /(?:for|targeting|aimed at)\s+(?:the\s+)?([a-z0-9 &\-/]+?)(?:\s+(?:segment|team|market|region|accounts?))?(?:[.!,]|$)/i
  )
  if (forMatch?.[1]) {
    const value = titleCase(forMatch[1].trim())
    if (!/team$/i.test(value)) return value.replace(/\s+Team$/i, '')
  }

  const segmentMatch = prompt.match(/([a-z0-9 &\-/]+)\s+segment/i)
  if (segmentMatch?.[1]) return titleCase(segmentMatch[1].trim())

  if (/target accounts?/i.test(prompt)) return 'Target accounts'
  return undefined
}

export function extractTeam(prompt: string): string | undefined {
  const forTeam = prompt.match(/\bfor\s+(?:the\s+)?([a-z0-9 &\-/]+)\s+team\b/i)
  if (forTeam?.[1]) return titleCase(forTeam[1].trim())

  const teamMatch = prompt.match(/\b([a-z0-9 &\-/]{2,48})\s+team\b/i)
  if (teamMatch?.[1]) {
    const value = teamMatch[1].trim()
    if (!/^(build|create|an|the|for|outreach|outbound|scaffold|compose)/i.test(value)) {
      return titleCase(value)
    }
  }
  return undefined
}

export function extractProspectCount(prompt: string): string | undefined {
  const m = prompt.match(/top\s+(\d+)/i) || prompt.match(/(\d+)\s+prospects?/i)
  if (m?.[1]) return m[1]
  return undefined
}

export function detectKind(prompt: string): { kind: ToolKind; label: string } {
  if (/enrich|write.?back|writeback|hubspot.*(title|missing)|approval queue|internal tool|icp.?score/i.test(prompt)) {
    return { kind: 'generic', label: 'GTM Workspace' }
  }
  for (const entry of KIND_PATTERNS) {
    if (entry.pattern.test(prompt)) {
      return { kind: entry.kind, label: entry.label }
    }
  }
  return { kind: 'generic', label: 'GTM Workspace' }
}

export function kindLabel(kind: ToolKind): string {
  return KIND_PATTERNS.find((k) => k.kind === kind)?.label ?? 'GTM Workspace'
}

function questionsFor(
  kind: ToolKind,
  inferred: { segment?: string; team?: string; prospectCount?: string }
): ClarifyQuestion[] {
  const questions: ClarifyQuestion[] = []

  if (kind === 'today') {
    if (!inferred.prospectCount) {
      questions.push({
        id: 'prospect_count',
        prompt: 'How many prospects should be in today’s queue?',
        options: ['25', '50', '100']
      })
    }
    questions.push(
      {
        id: 'channels',
        prompt: 'Confirm channels for the outbound sequencer:',
        options: ['Phone call + Email', 'Email first then phone', 'Phone first then email']
      },
      {
        id: 'goal',
        prompt: 'What’s the primary outcome for each touch?',
        options: ['Book a meeting', 'Qualify & route', 'Re-engage cold leads']
      },
      {
        id: 'team',
        prompt: 'Which team is working this queue?',
        options: ['SDR', 'AE', 'SMB', 'Enterprise']
      }
    )
    return questions.slice(0, 4)
  }

  if (!inferred.segment) {
    questions.push({
      id: 'segment',
      prompt: 'Which segment or market should this target?',
      options: ['Midwest', 'SMB', 'Enterprise', 'Fintech', 'Healthcare']
    })
  }

  if (!inferred.team) {
    questions.push({
      id: 'team',
      prompt: 'Which team will own this tool?',
      options: ['SDR', 'AE', 'SMB', 'Enterprise', 'Customer Success']
    })
  }

  switch (kind) {
    case 'dialer':
      questions.push(
        {
          id: 'dial_mode',
          prompt: 'What dialing mode do you want?',
          options: ['Power dial', 'Parallel dial (3 lines)', 'Click-to-call']
        },
        {
          id: 'goal',
          prompt: 'What’s the primary outcome for each call?',
          options: ['Book a meeting', 'Qualify & route', 'Renewal check-in', 'Demo follow-up']
        },
        {
          id: 'window',
          prompt: 'When should reps be allowed to dial?',
          options: ['9am–5pm local', '8am–6pm local', 'Business hours only', 'No restriction']
        }
      )
      break
    case 'sequencer':
      questions.push(
        {
          id: 'steps',
          prompt: 'How many email steps should the sequence include?',
          options: ['3 steps', '5 steps', '7 steps']
        },
        {
          id: 'tone',
          prompt: 'What tone should the emails use?',
          options: ['Direct & concise', 'Consultative', 'Casual founder-led', 'Formal enterprise']
        },
        {
          id: 'goal',
          prompt: 'What’s the sequence goal?',
          options: ['Book a meeting', 'Product demo', 'Trial signup', 'Event registration']
        }
      )
      break
    case 'cadence':
      questions.push(
        {
          id: 'channels',
          prompt: 'Which channels should the cadence use?',
          options: ['Email + Call', 'Email + LinkedIn', 'Email + Call + LinkedIn']
        },
        {
          id: 'duration',
          prompt: 'How long should the cadence run?',
          options: ['14 days', '21 days', '30 days']
        },
        {
          id: 'goal',
          prompt: 'What’s the primary goal?',
          options: ['Book a meeting', 'Re-engage cold leads', 'Expand existing accounts']
        }
      )
      break
    case 'list':
      questions.push(
        {
          id: 'icp',
          prompt: 'What’s the ideal customer profile?',
          options: ['Series A–B SaaS', 'Mid-market finance', 'Healthcare clinics', 'Regional logistics']
        },
        {
          id: 'size',
          prompt: 'Company size to prioritize?',
          options: ['11–50', '51–200', '201–1000', '1000+']
        },
        {
          id: 'enrichment',
          prompt: 'How much enrichment do you need?',
          options: ['Basic contact info', 'Firmographics + tech stack', 'Full buying committee']
        }
      )
      break
    default:
      questions.push(
        {
          id: 'kind_confirm',
          prompt: 'What should this workspace optimize for?',
          options: [
            'CRM enrichment + approval queue',
            'Internal ops tool on CRM data',
            'Outbound sequencer (legacy template)',
            'Lead list builder'
          ]
        },
        {
          id: 'goal',
          prompt: 'What’s the primary outcome?',
          options: [
            'Fill missing CRM fields',
            'Human-approved writeback',
            'Rep-facing queue / console',
            'Ops reporting surface'
          ]
        }
      )
  }

  return questions.slice(0, 4)
}

export function startClarifySession(prompt: string): ClarifySession {
  const { kind } = detectKind(prompt)
  const prospectCount = extractProspectCount(prompt)
  const inferred = {
    segment: extractSegment(prompt) ?? (kind === 'today' ? 'Software · GTM titles' : undefined),
    team: extractTeam(prompt),
    prospectCount
  }

  return {
    id: `session_${Date.now()}`,
    originalPrompt: prompt,
    kind,
    inferred,
    questions: questionsFor(kind, inferred),
    answers: {
      ...(inferred.segment ? { segment: inferred.segment } : {}),
      ...(inferred.team ? { team: inferred.team } : {}),
      ...(prospectCount ? { prospect_count: prospectCount } : {})
    },
    currentIndex: 0
  }
}

export function analysisIntro(session: ClarifySession): string {
  const label = kindLabel(session.kind)
  const known: string[] = []
  if (session.kind === 'today') {
    known.push('an **outbound sequencer** (email + phone)')
    if (session.inferred.prospectCount) {
      known.push(`top **${session.inferred.prospectCount}** GTM-title software prospects`)
    } else {
      known.push('**GTM-title** prospects in **software**')
    }
  } else {
    if (session.inferred.segment) known.push(`segment **${session.inferred.segment}**`)
    if (session.inferred.team) known.push(`team **${session.inferred.team}**`)
  }

  const knownLine =
    known.length > 0
      ? `I picked up ${known.join(' and ')} from your prompt.`
      : `I’ll treat this as a **${label}**.`

  return `Got it — scaffolding a **${label}**.\n\n${knownLine}\n\nA few quick questions so Sources, Workflow, and Tool match what you need:`
}

export function inferProjectFromPrompt(prompt: string): {
  kind: ToolKind
  segment: string
  team: string
  goal: string
  channels?: string
  prospect_count?: string
} {
  const { kind } = detectKind(prompt)
  const prospectCount = extractProspectCount(prompt)
  const segment = extractSegment(prompt) ?? (kind === 'today' ? 'Crustdata prospects' : 'General')
  const team = extractTeam(prompt) ?? 'RevOps'
  const channels =
    kind === 'cadence' || kind === 'sequencer' || kind === 'today' || /outbound flow|outreach flow/i.test(prompt)
      ? 'Email + Call'
      : undefined
  const goal =
    kind === 'sequencer' || kind === 'cadence'
      ? 'Book a meeting'
      : kind === 'today'
        ? 'Contact today'
        : 'Move the deal forward'
  return {
    kind,
    segment,
    team,
    goal,
    ...(channels ? { channels } : {}),
    ...(prospectCount ? { prospect_count: prospectCount } : kind === 'today' ? { prospect_count: '20' } : {})
  }
}

export function isProspectQueuePrompt(prompt: string): boolean {
  return detectKind(prompt).kind === 'today'
}

export const SUGGESTED_PROMPTS = [
  'Find me 20 prospects to contact today',
  'Find 25 VP Sales leaders at software companies in Austin',
  'Build a dialer for my top 50 GTM prospects'
]
