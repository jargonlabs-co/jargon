import type { ProjectKind } from './types'

export type DeployParams = {
  kind: ProjectKind
  answers: Record<string, string>
}

function extractProspectCount(prompt: string): string | undefined {
  const m =
    prompt.match(/(?:top\s+)?(\d+)\s+prospects?/i) ||
    prompt.match(/find\s+(?:me\s+)?(\d+)/i)
  return m?.[1]
}

function isProspectQueuePrompt(prompt: string): boolean {
  return /today|\d+\s+prospects?|prospects?\s+to\s+contact|contact today|gtm|outbound queue/i.test(
    prompt
  )
}

/** Infer project kind + answers from a natural-language deploy prompt. */
export function inferDeployParams(prompt: string): DeployParams {
  const prospectCount = extractProspectCount(prompt)
  if (isProspectQueuePrompt(prompt)) {
    return {
      kind: 'today',
      answers: {
        prospect_count: prospectCount ?? '20',
        segment: 'Crustdata prospects',
        team: 'RevOps',
        goal: 'Contact today',
        channels: 'Email + Call'
      }
    }
  }
  if (/dialer|power.?dial/i.test(prompt)) {
    return { kind: 'dialer', answers: { segment: 'General', team: 'RevOps', goal: 'Dial prospects' } }
  }
  if (/sequenc|email.?seq/i.test(prompt)) {
    return {
      kind: 'sequencer',
      answers: { segment: 'General', team: 'RevOps', goal: 'Book a meeting', channels: 'Email + Call' }
    }
  }
  return {
    kind: 'today',
    answers: {
      prospect_count: prospectCount ?? '20',
      segment: 'Crustdata prospects',
      team: 'RevOps',
      goal: 'Contact today',
      channels: 'Email + Call'
    }
  }
}
