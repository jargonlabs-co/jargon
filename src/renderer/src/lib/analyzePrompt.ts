import type { ClarifyQuestion, ClarifySession, ToolKind } from '../types'

const KIND_PATTERNS: Array<{ kind: ToolKind; pattern: RegExp; label: string }> = [
  { kind: 'dialer', pattern: /dialer|dial|call|phone|power.?dial/i, label: 'Outbound Dialer' },
  {
    kind: 'sequencer',
    pattern: /sequenc|email.?seq|drip|nurture|instantly|engage/i,
    label: 'Email Sequencer'
  },
  {
    kind: 'cadence',
    pattern: /cadence|multi.?channel|outreach.?flow|gong/i,
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
  const forMatch = prompt.match(
    /(?:for|targeting|aimed at)\s+(?:the\s+)?([a-z0-9 &\-/]+?)(?:\s+(?:segment|team|market|region|accounts?))?(?:[.!,]|$)/i
  )
  if (forMatch?.[1]) {
    const value = titleCase(forMatch[1].trim())
    if (!/team$/i.test(value)) return value.replace(/\s+Team$/i, '')
  }

  const segmentMatch = prompt.match(/([a-z0-9 &\-/]+)\s+segment/i)
  if (segmentMatch?.[1]) return titleCase(segmentMatch[1].trim())

  return undefined
}

export function extractTeam(prompt: string): string | undefined {
  const teamMatch = prompt.match(/([a-z0-9 &\-/]+)\s+team/i)
  if (teamMatch?.[1]) return titleCase(teamMatch[1].trim())
  return undefined
}

export function detectKind(prompt: string): { kind: ToolKind; label: string } {
  for (const entry of KIND_PATTERNS) {
    if (entry.pattern.test(prompt)) {
      return { kind: entry.kind, label: entry.label }
    }
  }
  return { kind: 'generic', label: 'Sales Tool' }
}

export function kindLabel(kind: ToolKind): string {
  return KIND_PATTERNS.find((k) => k.kind === kind)?.label ?? 'Sales Tool'
}

function questionsFor(
  kind: ToolKind,
  inferred: { segment?: string; team?: string }
): ClarifyQuestion[] {
  const questions: ClarifyQuestion[] = []

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
          prompt: 'What kind of outbound tool should I build?',
          options: ['Outbound Dialer', 'Email Sequencer', 'Multi-channel Cadence', 'Lead List Builder']
        },
        {
          id: 'goal',
          prompt: 'What’s the primary goal?',
          options: ['Book a meeting', 'Qualify leads', 'Re-engage pipeline']
        }
      )
  }

  return questions.slice(0, 4)
}

export function startClarifySession(prompt: string): ClarifySession {
  const { kind } = detectKind(prompt)
  const inferred = {
    segment: extractSegment(prompt),
    team: extractTeam(prompt)
  }

  return {
    id: `session_${Date.now()}`,
    originalPrompt: prompt,
    kind,
    inferred,
    questions: questionsFor(kind, inferred),
    answers: {
      ...(inferred.segment ? { segment: inferred.segment } : {}),
      ...(inferred.team ? { team: inferred.team } : {})
    },
    currentIndex: 0
  }
}

export function analysisIntro(session: ClarifySession): string {
  const label = kindLabel(session.kind)
  const known: string[] = []
  if (session.inferred.segment) known.push(`segment **${session.inferred.segment}**`)
  if (session.inferred.team) known.push(`team **${session.inferred.team}**`)

  const knownLine =
    known.length > 0
      ? `I picked up ${known.join(' and ')} from your prompt.`
      : `I’ll treat this as a **${label}**.`

  return `Got it — building a **${label}**.\n\n${knownLine}\n\nA few quick questions so the tool matches how your team sells:`
}

export const SUGGESTED_PROMPTS = [
  'Create an outbound dialer for the Midwest segment',
  'Create an email sequencing tool for the SMB team',
  'Build a multi-channel cadence for enterprise renewals',
  'Make a lead list builder for fintech startups'
]
