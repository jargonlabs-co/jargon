import type { ServerConfig } from './config'
import { getConnection } from './connections'
import {
  apolloProspectsToContacts,
  resolveApolloApiKey,
  searchGtmSoftwareProspects
} from './providers/apollo'
import {
  resolveCrustdataApiKey,
  searchPeopleFromPrompt
} from './providers/crustdata'
import { prospectsToContacts } from './providers/prospects'
import { seedProject } from './seed'
import type { JsonStore } from './store'
import type { ProjectKind } from './types'

export async function createProjectRecord(
  store: JsonStore,
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

  if (kind === 'today') {
    const limit = Number(finalAnswers.prospect_count ?? 20)
    const capped = Math.min(Math.max(limit, 1), 100)
    let syncedContacts = undefined as ReturnType<typeof prospectsToContacts> | undefined
    let prospectSource = 'crustdata_demo'
    let querySummary = ''

    try {
      const crustdata = resolveCrustdataApiKey(store, orgId, config)
      if (crustdata) {
        const result = await searchPeopleFromPrompt(
          crustdata.apiKey,
          prompt,
          capped,
          crustdata.demo
        )
        querySummary = result.querySummary
        if (result.prospects.length > 0) {
          syncedContacts = prospectsToContacts(orgId, 'pending', result.prospects, 'crustdata')
          prospectSource = result.mode === 'live' ? 'crustdata' : 'crustdata_demo'
          const crustConn = getConnection(store, orgId, 'crustdata')
          if (crustConn) {
            store.update((db) => {
              const c = db.connections.find((x) => x.id === crustConn.id)
              if (c) {
                c.lastSyncAt = Date.now()
                c.updatedAt = Date.now()
              }
            })
          }
        }
      }
    } catch (err) {
      console.warn('[jargon] Crustdata search on create failed, trying Apollo', err)
    }

    if (!syncedContacts) {
      try {
        const resolved = resolveApolloApiKey(store, orgId, config)
        if (resolved) {
          const result = await searchGtmSoftwareProspects(
            resolved.apiKey,
            capped,
            resolved.demo
          )
          syncedContacts = apolloProspectsToContacts(orgId, 'pending', result.prospects)
          prospectSource = result.mode === 'live' ? 'apollo' : 'apollo_demo'
          const apolloConn = getConnection(store, orgId, 'apollo')
          if (apolloConn) {
            store.update((db) => {
              const c = db.connections.find((x) => x.id === apolloConn.id)
              if (c) {
                c.lastSyncAt = Date.now()
                c.updatedAt = Date.now()
              }
            })
          }
        }
      } catch (err) {
        console.warn('[jargon] Apollo search on create failed, using demo fixtures', err)
      }
    }

    store.update((db) => {
      const project = seedProject(db, {
        orgId,
        prompt,
        kind,
        answers: {
          ...finalAnswers,
          prospect_source: prospectSource,
          crustdata_query: querySummary || finalAnswers.crustdata_query,
          segment:
            finalAnswers.segment ||
            (querySummary ||
              (prospectSource.startsWith('crustdata')
                ? 'GTM leaders (Crustdata)'
                : 'Software · GTM titles')),
          channels: finalAnswers.channels || 'Phone call + Email'
        },
        contacts: syncedContacts
      })
      projectId = project.id
    })
  } else {
    store.update((db) => {
      const project = seedProject(db, {
        orgId,
        prompt,
        kind,
        answers: finalAnswers
      })
      projectId = project.id
    })
  }

  return projectId
}
