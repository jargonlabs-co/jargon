import type { ProjectKind } from './types'

export type DeployParams = {
  kind: ProjectKind
  answers: Record<string, string>
}

/** Infer project kind + answers from a natural-language deploy prompt. */
export function inferDeployParams(prompt: string): DeployParams {
  const base = {
    segment: 'HubSpot contacts',
    team: 'Sales',
    data_source: 'unconfigured',
    channels: 'Email + Call + LinkedIn'
  }
  if (/dialer|power.?dial/i.test(prompt)) {
    return { kind: 'dialer', answers: { ...base, goal: 'Dial accounts' } }
  }
  if (/sequenc|email.?seq/i.test(prompt)) {
    return { kind: 'sequencer', answers: { ...base, goal: 'Book a meeting' } }
  }
  if (/cadence|multi.?channel|linkedin/i.test(prompt)) {
    return { kind: 'cadence', answers: { ...base, goal: 'Run a cadence' } }
  }
  return {
    kind: 'today',
    answers: { ...base, goal: "Work today's queue" }
  }
}
