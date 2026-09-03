import type { ServerConfig } from './config'
import { seedProject } from './seed'
import type { DataStore } from './store'
import type { ProjectKind } from './types'

export async function createProjectRecord(
  store: DataStore,
  _config: ServerConfig,
  input: {
    orgId: string
    prompt: string
    kind: ProjectKind
    answers?: Record<string, string>
  }
): Promise<string> {
  const { orgId, prompt, kind } = input
  const finalAnswers = input.answers ?? {}
  let projectId = ''

  store.update((db) => {
    const project = seedProject(db, {
      orgId,
      prompt,
      kind,
      answers: finalAnswers
    })
    projectId = project.id
  })

  return projectId
}
