import type { ServerConfig } from './config'
import { compilePromptWithLlm, mergeDeploySpec } from './compilePrompt'
import type { DeploySpecInput, ProjectKind, WorkspaceSpec } from './types'
import { compileWorkspaceSpec, specToAnswers } from '../shared/workspaceSpec'

export type DeployParams = {
  kind: ProjectKind
  answers: Record<string, string>
  spec: WorkspaceSpec
}

/** Compile a deploy prompt (and optional spec override) into a workspace motion. */
export function inferDeployParams(prompt: string, override?: DeploySpecInput): DeployParams {
  const spec = compileWorkspaceSpec(prompt, override)
  return {
    kind: spec.kind,
    answers: specToAnswers(spec),
    spec
  }
}

/**
 * LLM interprets free-form prompts into a DeploySpec, then the deterministic compiler
 * validates and fills gaps. Falls back to regex-only when LLM is off or fails.
 */
export async function inferDeployParamsAsync(
  prompt: string,
  override: DeploySpecInput | undefined,
  config: ServerConfig
): Promise<DeployParams> {
  const llmSpec = await compilePromptWithLlm(prompt, config, override)
  const merged = mergeDeploySpec(override, llmSpec)
  return inferDeployParams(prompt, merged)
}
