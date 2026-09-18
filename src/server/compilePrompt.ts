import type { ServerConfig } from './config'
import type { DeploySpecInput } from './types'
import { parseDeploySpec } from '../shared/workspaceSpec'
import { completeJson, llmCompileEnabled } from './providers/llm'

const SYSTEM = `You compile natural-language requests into Jargon outbound workspace specs.
Jargon only builds outbound GTM tools (email, phone, LinkedIn). Map any request to the closest outbound motion — never invent other product types.

Return a JSON object with any of:
- goal: string (one sentence, what success looks like)
- segment: string (who to reach — ICP / list description)
- channels: non-empty array of "email" | "call" | "linkedin" in execution order
- primarySurface: "dial" | "queue" | "sequence" | "inbox" | "linkedin"
- kind: "dialer" | "sequencer" | "cadence" | "today" | "list" | "generic"
- steps: array (1–8) of { day: 0–30, channel, label, subject?, body? }

Rules:
- Honor explicit day ladders and channel order from the prompt ("day 0 email, day 3 call…").
- Honor step counts and spans ("7 steps over 10 days", "5-step cadence across 14 days") — emit that many steps spaced across day 0…span (cap at 8). Rotate the requested channels; do not compress to one step per channel.
- Dialer / power dial / phone-first → channels include call; primarySurface "dial"; kind "dialer".
- Email sequencer / drip → email; primarySurface "sequence"; kind "sequencer".
- Multi-channel cadence / outbound / today queue → mix channels; primarySurface "queue" or "sequence".
- LinkedIn-only → linkedin channel; primarySurface "linkedin".
- Email/LinkedIn body may use {{first_name}} and {{company}}. Call steps omit body.
- Keep copy short templates, not researched personalization. Claude writes real send copy later via save_research.
- segment: extract the audience; if unclear use "HubSpot contacts".
- Omit fields you are unsure about rather than guessing wildly.`

/**
 * LLM interprets a free-form deploy prompt into a DeploySpecInput.
 * Returns undefined when LLM is disabled, skipped, or fails — caller falls back to regex compile.
 */
export async function compilePromptWithLlm(
  prompt: string,
  config: ServerConfig,
  override?: DeploySpecInput
): Promise<DeploySpecInput | undefined> {
  if (!llmCompileEnabled(config)) return undefined
  if (skipLlmCompile(override)) return undefined

  const result = await completeJson(config, {
    system: SYSTEM,
    user: `Compile this outbound request into a workspace spec JSON object:\n\n${promptForCompile(prompt)}`
  })
  if (!result.ok) {
    console.warn('[compilePrompt] LLM compile failed:', result.error)
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    console.warn('[compilePrompt] LLM returned non-JSON')
    return undefined
  }

  const validated = parseDeploySpec(parsed)
  if (!validated.ok) {
    console.warn('[compilePrompt] LLM spec invalid:', validated.error)
    return undefined
  }
  return validated.spec
}

/** Caller already supplied a full motion — no need to re-interpret. */
export function skipLlmCompile(override?: DeploySpecInput): boolean {
  return Boolean(override?.channels?.length && override?.steps?.length)
}

/** Prefer explicit caller fields; fill gaps from the LLM. */
export function mergeDeploySpec(
  override?: DeploySpecInput,
  llm?: DeploySpecInput
): DeploySpecInput | undefined {
  if (!override && !llm) return undefined
  const merged: DeploySpecInput = {
    goal: override?.goal ?? llm?.goal,
    segment: override?.segment ?? llm?.segment,
    primarySurface: override?.primarySurface ?? llm?.primarySurface,
    channels: override?.channels ?? llm?.channels,
    steps: override?.steps ?? llm?.steps,
    kind: override?.kind ?? llm?.kind
  }
  return Object.values(merged).some((v) => v != null) ? merged : undefined
}

/** Drop pasted lists/tables so the model focuses on motion, not contacts. */
export function promptForCompile(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, '\n[contact list omitted]\n')
    .replace(
      /(?:^|\n)\|?[^\n]*\|[^\n]*\n\|?[\s-:|]+\|[^\n]*\n(?:\|?[^\n]+\n?){0,80}/g,
      '\n[contact table omitted]\n'
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
}
