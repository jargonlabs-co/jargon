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
import {
  fetchPostgresProspects,
  readPostgresSecrets,
  writePostgresContactsToProjects
} from './providers/postgresProspects'

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

  const limit = Math.min(
    Math.max(Number(finalAnswers.prospect_count ?? 50), 1),
    100
  )

  const postgres = getConnection(store, orgId, 'postgres')
  if (postgres?.status === 'connected') {
    try {
      const secrets = readSecrets(postgres)
      const { databaseUrl, table } = readPostgresSecrets(secrets)
      if (databaseUrl) {
        let columnMap: Record<string, string> | undefined
        if (secrets.extra?.columnMap) {
          try {
            columnMap = JSON.parse(secrets.extra.columnMap) as Record<string, string>
          } catch {
            columnMap = undefined
          }
        }
        const prospects = await fetchPostgresProspects({
          databaseUrl,
          table,
          limit,
          columnMap
        })
        if (prospects.length > 0) {
          writePostgresContactsToProjects(store, orgId, prospects, projectId, { table })
          store.update((db) => {
            const c = db.connections.find((x) => x.id === postgres.id)
            if (c) {
              c.lastSyncAt = Date.now()
              c.updatedAt = Date.now()
              c.meta = { ...c.meta, rowCount: String(prospects.length), table }
            }
          })
          return projectId
        }
      }
    } catch (err) {
      console.warn('[jargon] Postgres prospects load failed, trying HubSpot', err)
    }
  }

  const conn = getConnection(store, orgId, 'hubspot')
  if (conn?.status === 'connected') {
    const secrets = readSecrets(conn)
    const demo = secrets.accessToken === 'demo-hubspot-token' || !config.hubspot.clientId
    try {
      const prospects = await fetchHubSpotContacts(secrets.accessToken, limit, demo)
      writeHubSpotContactsToProjects(store, orgId, prospects, projectId)
    } catch {
      writeDemoContactsToProject(store, orgId, projectId, 20)
    }
  } else {
    writeDemoContactsToProject(store, orgId, projectId, 20)
  }

  return projectId
}
