import type { ServerConfig } from './config'
import { getConnection, readSecrets } from './connections'
import { seedProject } from './seed'
import type { DataStore } from './store'
import type { ProjectKind } from './types'
import {
  fetchHubSpotContacts,
  writeDemoContactsToProject,
  writeHubSpotContactsToProjects
} from './providers/hubspot'

export async function createProjectRecord(
  store: DataStore,
  config: ServerConfig,
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

  const conn = getConnection(store, orgId, 'hubspot')
  if (conn?.status === 'connected') {
    const secrets = readSecrets(conn)
    const demo = secrets.accessToken === 'demo-hubspot-token' || !config.hubspot.clientId
    try {
      const prospects = await fetchHubSpotContacts(secrets.accessToken, 100, demo)
      writeHubSpotContactsToProjects(store, orgId, prospects, projectId)
    } catch {
      writeDemoContactsToProject(store, orgId, projectId, 20)
    }
  } else {
    // Fill the queue when no CRM is connected yet.
    writeDemoContactsToProject(store, orgId, projectId, 20)
  }

  return projectId
}
