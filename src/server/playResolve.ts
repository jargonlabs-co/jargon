import type { ServerConfig } from './config'
import { getConnection, readSecrets } from './connections'
import type { DataStore } from './store'
import type { Contact } from './types'
import { hasReachableContact } from '../shared/priorityOverlay'
import type { Play, PlayAssignment, PlayView } from '../shared/play'
import { PLAY_TEAMS } from '../shared/play'
import { hubspotAccessToken, isDemoHubSpot, writeHubSpotContactsToProjects } from './providers/hubspot'
import { pullQuietDeals } from './providers/hubspotDeals'
import { lookupQuietWindow } from './providers/places'
import { setProjectCatalog } from './fieldCatalogSync'

export async function attachPlay(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  play: Play
): Promise<void> {
  const next: Play = { ...play, variables: play.variables.map((variable) => ({ ...variable })) }
  const wantsDeals = Boolean(play.audience)
  const wantsObjection = play.variables.some((variable) => variable.key === 'last_call_objection')
  const wantsQuiet = play.variables.some((variable) => variable.key === 'quiet_window')
  const conn = getConnection(store, orgId, 'hubspot')
  const hubspotReady = Boolean(conn && conn.status === 'connected' && !isDemoHubSpot(config, conn))

  const existing = store.db.contacts.some((contact) => contact.projectId === projectId && contact.orgId === orgId)
  if (wantsDeals && play.audience && hubspotReady && conn && !existing) {
    try {
      const token = await hubspotAccessToken(store, config, conn)
      const pull = await pullQuietDeals({
        accessToken: token,
        stage: play.audience.stage,
        inactiveDays: play.audience.inactiveDays
      })
      if (pull.stageLabel) next.audience = { ...play.audience, label: audienceLabel(play, pull.stageLabel) }
      if (pull.warning) next.notice = pull.warning
      const reachable = pull.prospects.filter(hasReachableContact)
      if (reachable.length) writeHubSpotContactsToProjects(store, orgId, reachable, projectId)
      else if (!next.notice) next.notice = 'No matching deals in HubSpot.'
    } catch (err) {
      next.notice = err instanceof Error ? err.message : 'HubSpot deals could not be read.'
    }
  } else if (wantsDeals && !hubspotReady) {
    next.notice = 'Connect HubSpot to pull these deals and the last call.'
  }

  if (wantsQuiet) await fillQuietWindows(store, config, orgId, projectId)
  if (wantsObjection) ensureObjectionKey(store, orgId, projectId)

  store.update((db) => {
    const project = db.projects.find((row) => row.id === projectId && row.orgId === orgId)
    if (project) {
      project.play = next
      project.requestedFields = next.variables.map((variable) => variable.key)
      project.updatedAt = Date.now()
    }
    const now = Date.now()
    for (const contact of db.contacts) {
      if (contact.projectId !== projectId || contact.orgId !== orgId) continue
      contact.enrichedAt = now
      contact.updatedAt = now
    }
    setProjectCatalog(db, projectId)
  })
}

async function fillQuietWindows(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string
): Promise<void> {
  const apiKey = config.places.apiKey
  if (!apiKey) return
  const contacts = store.db.contacts.filter((contact) => contact.projectId === projectId && contact.orgId === orgId)
  const cache = new Map<string, string>()
  for (const contact of contacts) {
    if (text(contact.attrs?.quiet_window)) continue
    const query = [contact.company, contact.city].filter(Boolean).join(' ')
    if (!query) continue
    const key = query.toLowerCase()
    let label = cache.get(key)
    if (label === undefined) {
      try {
        const found = await lookupQuietWindow(apiKey, query)
        label = found?.label ?? ''
      } catch {
        label = ''
      }
      cache.set(key, label)
    }
    if (!label) continue
    store.update((db) => {
      const row = db.contacts.find((item) => item.id === contact.id)
      if (!row) return
      row.attrs = { ...(row.attrs ?? {}), quiet_window: label }
    })
  }
}

function ensureObjectionKey(store: DataStore, orgId: string, projectId: string): void {
  store.update((db) => {
    for (const contact of db.contacts) {
      if (contact.projectId !== projectId || contact.orgId !== orgId) continue
      if (text(contact.attrs?.last_call_objection)) continue
      contact.attrs = { ...(contact.attrs ?? {}), last_call_objection: '' }
    }
  })
}

export function assignPlay(
  store: DataStore,
  orgId: string,
  projectId: string,
  input: { kind: 'rep' | 'team'; id?: string }
): { ok: true } | { ok: false; error: string } {
  const project = store.db.projects.find((row) => row.id === projectId && row.orgId === orgId)
  if (!project?.play) return { ok: false, error: 'This workspace has no play' }
  let assignment: PlayAssignment
  if (input.kind === 'team') {
    const team = PLAY_TEAMS.find((row) => row.id === (input.id || 'all'))
    if (!team) return { ok: false, error: 'That team is not on this account' }
    assignment = { kind: 'team', id: team.id, name: team.name }
  } else {
    const member = store.db.memberships.find((row) => row.orgId === orgId && row.userId === input.id)
    const user = store.db.users.find((row) => row.id === input.id)
    if (!member || !user) return { ok: false, error: 'That rep is not on this account' }
    assignment = { kind: 'rep', id: user.id, name: user.name || user.email }
  }
  store.update((db) => {
    const row = db.projects.find((item) => item.id === projectId)
    if (!row?.play) return
    row.play = { ...row.play, assignment }
    row.updatedAt = Date.now()
  })
  return { ok: true }
}

export function playViewFor(
  store: DataStore,
  orgId: string,
  projectId: string,
  play: Play,
  contacts: Contact[],
  steps: Array<{ channel: string; day: number; label: string; body?: string }>
): PlayView {
  const roster = store.db.memberships
    .filter((row) => row.orgId === orgId)
    .map((row) => store.db.users.find((user) => user.id === row.userId))
    .filter((user): user is NonNullable<typeof user> => Boolean(user))
    .map((user) => ({ id: user.id, name: user.name || user.email }))
  return {
    ...play,
    roster,
    teams: PLAY_TEAMS.map((team) => ({ id: team.id, name: team.name })),
    people: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      company: contact.company,
      title: contact.title,
      values: Object.fromEntries(
        play.variables.map((variable) => [variable.key, text(contact.attrs?.[variable.key])])
      )
    })),
    steps: steps.map((step) => ({
      channel: step.channel,
      day: step.day,
      label: step.label,
      body: step.body ?? ''
    }))
  }
}

function audienceLabel(play: Play, stageLabel: string): string {
  const days = play.audience?.inactiveDays
  if (days != null) return `${stageLabel} deals with no activity in ${days} days`
  return `${stageLabel} deals`
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
