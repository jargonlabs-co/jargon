import type { ServerConfig } from './config'
import { crmSegmentActive } from './providers/hubspot'
import {
  enrollHubSpotContacts,
  listHubSpotContactsForEnroll,
  promoteReadyAgentContacts,
  saveWorkspaceBrief
} from './publicApi'
import type { DataStore } from './store'
import { log, reportError } from './observability'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const RETRY_MS = 15 * 60_000

/** Free-text cadence from the grant. Daily when they said day; otherwise weekly. */
export function agentIntervalMs(cadence?: string): number {
  const text = (cadence ?? '').toLowerCase()
  if (/\b(day|daily)\b/.test(text) && !/\b(week|weekly|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(text)) {
    return DAY_MS
  }
  return WEEK_MS
}

/**
 * Pull the saved segment onto the agent lane and promote people a reply already marked ready.
 * Runs only for workspaces the user allowed. A failure retries in 15 minutes.
 */
export async function runDueUnattendedAgents(
  store: DataStore,
  config: ServerConfig,
  now = Date.now()
): Promise<number> {
  const due = store.db.projects.filter(
    (project) => project.brief?.unattended === 'accepted' && (project.brief.nextAgentRunAt ?? 0) <= now
  )
  let ran = 0
  for (const project of due) {
    const interval = agentIntervalMs(project.brief?.cadence)
    try {
      const listed = await listHubSpotContactsForEnroll(store, config, project.orgId, project.id)
      if (!listed.ok) throw new Error(listed.error)
      if (listed.pendingEnrichment) {
        saveWorkspaceBrief(store, project.orgId, project.id, { nextAgentRunAt: now + RETRY_MS })
        continue
      }
      if (listed.connected && crmSegmentActive(project.brief?.segment) && listed.contacts.length) {
        const enrolled = await enrollHubSpotContacts(
          store,
          config,
          project.orgId,
          project.id,
          listed.contacts.map((contact) => contact.externalId)
        )
        if (!enrolled.ok && !/No HubSpot contacts|None of those contacts/.test(enrolled.error)) {
          throw new Error(enrolled.error)
        }
      }
      promoteReadyAgentContacts(store, project.orgId, project.id)
      saveWorkspaceBrief(store, project.orgId, project.id, { nextAgentRunAt: now + interval })
      ran += 1
    } catch (err) {
      saveWorkspaceBrief(store, project.orgId, project.id, { nextAgentRunAt: now + RETRY_MS })
      log('warn', 'unattended agent run failed', {
        orgId: project.orgId,
        projectId: project.id,
        error: err instanceof Error ? err.message : 'unknown'
      })
      reportError(err, { source: 'unattended-agent', orgId: project.orgId })
    }
  }
  return ran
}
