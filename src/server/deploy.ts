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
