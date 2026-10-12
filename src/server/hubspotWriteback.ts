import type { ServerConfig } from './config'
import type { DataStore } from './store'
import type { Contact, HubSpotOutboxItem } from './types'
import { uid } from './crypto'
import { getConnection } from './connections'
import { hubspotAccessToken, isDemoHubSpot } from './providers/hubspot'
import { log, reportError } from './observability'

const OBJECTS = 'https://api.hubapi.com/crm/v3/objects'
/** HubSpot-defined association type ids: engagement → contact. */
const ASSOCIATION_TYPE: Record<HubSpotOutboxItem['kind'], number> = {
  email: 198,
  call: 194,
  note: 202,
  meeting: 200
}
const PATH: Record<HubSpotOutboxItem['kind'], string> = {
  email: 'emails',
  call: 'calls',
  note: 'notes',
  meeting: 'meetings'
}
const MAX_ATTEMPTS = 6
const BATCH = 50

export type HubSpotActivity =
  | { kind: 'email'; subject: string; body: string; at?: number }
  | { kind: 'call'; disposition: string; durationMs?: number; notes?: string; at?: number }
  | { kind: 'note'; body: string; at?: number }
  | { kind: 'meeting'; title: string; body?: string; start: number; end: number; url?: string; at?: number }

function humanize(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function propertiesFor(activity: HubSpotActivity): Record<string, string> {
  const at = String(activity.at ?? Date.now())
  if (activity.kind === 'email') {
    return {
      hs_timestamp: at,
      hs_email_direction: 'EMAIL',
      hs_email_status: 'SENT',
      hs_email_subject: activity.subject.slice(0, 500),
      hs_email_text: activity.body.slice(0, 60_000)
    }
  }
  if (activity.kind === 'call') {
    const lines = [`Outcome: ${humanize(activity.disposition)}`, activity.notes?.trim()].filter(Boolean)
    return {
      hs_timestamp: at,
      hs_call_title: `Jargon call · ${humanize(activity.disposition)}`,
      hs_call_body: lines.join('\n\n'),
      hs_call_status: 'COMPLETED',
      hs_call_direction: 'OUTBOUND',
      ...(activity.durationMs ? { hs_call_duration: String(Math.max(0, Math.round(activity.durationMs))) } : {})
    }
  }
  if (activity.kind === 'meeting') {
    return {
      hs_timestamp: at,
      hs_meeting_title: activity.title.slice(0, 500),
      hs_meeting_body: (activity.body ?? '').slice(0, 60_000),
      hs_meeting_start_time: String(activity.start),
      hs_meeting_end_time: String(activity.end),
      hs_meeting_outcome: 'SCHEDULED',
      ...(activity.url ? { hs_meeting_external_url: activity.url } : {})
    }
  }
  return { hs_timestamp: at, hs_note_body: activity.body.slice(0, 60_000) }
}

function cachedHubSpotId(contact: Contact): string | undefined {
  if (contact.source === 'hubspot' && contact.externalId) return contact.externalId
  const cached = contact.attrs?.hubspot_id
  return typeof cached === 'string' && cached.trim() ? cached.trim() : undefined
}

/**
 * Queue an activity for the org's connected CRM. People who did not start in HubSpot
 * are matched by email when the outbox flushes, and created there if they are missing.
 */
export function enqueueHubSpotActivity(store: DataStore, contact: Contact, activity: HubSpotActivity): boolean {
  const conn = getConnection(store, contact.orgId, 'hubspot')
  if (!conn || conn.status !== 'connected' || conn.meta?.writeback === 'off') return false
  const hubspotContactId = cachedHubSpotId(contact)
  if (!hubspotContactId && !contact.email?.trim()) return false
  const now = Date.now()
  store.update((db) => {
    db.hubspotOutbox.push({
      id: uid('hso'),
      orgId: contact.orgId,
      contactId: contact.id,
      hubspotContactId,
      email: contact.email?.trim() || undefined,
      kind: activity.kind,
      properties: propertiesFor(activity),
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now
    })
  })
  return true
}

function splitName(name: string): { firstname?: string; lastname?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return {}
  if (parts.length === 1) return { firstname: parts[0] }
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') }
}

/** Find a HubSpot contact by email, or create one so the activity has a record to land on. */
export async function resolveHubSpotContactId(
  fetcher: typeof fetch,
  token: string,
  contact: Pick<Contact, 'email' | 'name' | 'company' | 'title' | 'phone'>
): Promise<string | null> {
  const email = contact.email?.trim()
  if (!email) return null
  const search = await fetcher(`${OBJECTS}/contacts/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email'],
      limit: 1
    })
  })
  if (search.ok) {
    const json = (await search.json()) as { results?: Array<{ id?: string }> }
    const found = json.results?.[0]?.id
    if (found) return String(found)
  } else if (search.status === 403 || search.status === 401) {
    throw new Error(`HubSpot contact search failed (${search.status})`)
  }
  const created = await fetcher(`${OBJECTS}/contacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        email,
        ...splitName(contact.name),
        ...(contact.company?.trim() ? { company: contact.company.trim() } : {}),
        ...(contact.title?.trim() ? { jobtitle: contact.title.trim() } : {}),
        ...(contact.phone?.trim() ? { phone: contact.phone.trim() } : {})
      }
    })
  })
  if (!created.ok) {
    if (created.status === 403 || created.status === 401) {
      throw new Error(`HubSpot contact create failed (${created.status})`)
    }
    return null
  }
  const json = (await created.json()) as { id?: string }
  return json.id ? String(json.id) : null
}

function rememberHubSpotId(store: DataStore, contactId: string, hubspotContactId: string): void {
  store.update((db) => {
    const row = db.contacts.find((c) => c.id === contactId)
    if (!row) return
    row.attrs = { ...(row.attrs ?? {}), hubspot_id: hubspotContactId }
    row.updatedAt = Date.now()
  })
}

function retryDelayMs(attempts: number): number {
  return Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** attempts)
}

/** Sends due outbox items. Called from the scheduler on the writer process only. */
export async function flushHubSpotOutbox(
  store: DataStore,
  config: ServerConfig,
  fetcher: typeof fetch = fetch,
  now = Date.now()
): Promise<{ sent: number; failed: number }> {
  const due = store.db.hubspotOutbox.filter((item) => item.nextAttemptAt <= now).slice(0, BATCH)
  let sent = 0
  let failed = 0
  const tokens = new Map<string, string | null>()
  const finish = (id: string) =>
    store.update((db) => {
      db.hubspotOutbox = db.hubspotOutbox.filter((x) => x.id !== id)
    })
  const retry = (item: HubSpotOutboxItem, error: string) => {
    failed++
    store.update((db) => {
      const row = db.hubspotOutbox.find((x) => x.id === item.id)
      if (!row) return
      row.attempts += 1
      row.lastError = error
      row.nextAttemptAt = now + retryDelayMs(row.attempts)
      if (row.attempts >= MAX_ATTEMPTS) {
        db.hubspotOutbox = db.hubspotOutbox.filter((x) => x.id !== item.id)
        log('warn', 'hubspot writeback dropped', { orgId: item.orgId, kind: item.kind, error })
      }
    })
  }

  for (const item of due) {
    const conn = getConnection(store, item.orgId, 'hubspot')
    if (!conn || conn.status !== 'connected' || conn.meta?.writeback === 'off') {
      finish(item.id)
      continue
    }
    if (isDemoHubSpot(config, conn)) {
      finish(item.id)
      sent++
      continue
    }
    if (!tokens.has(item.orgId)) {
      tokens.set(item.orgId, await hubspotAccessToken(store, config, conn, fetcher).catch(() => null))
    }
    const token = tokens.get(item.orgId)
    if (!token) {
      retry(item, 'HubSpot token unavailable')
      continue
    }
    try {
      let hubspotContactId = item.hubspotContactId
      if (!hubspotContactId) {
        const contact = store.db.contacts.find((c) => c.id === item.contactId)
        hubspotContactId =
          (await resolveHubSpotContactId(fetcher, token, {
            email: item.email || contact?.email || '',
            name: contact?.name ?? '',
            company: contact?.company ?? '',
            title: contact?.title ?? '',
            phone: contact?.phone ?? ''
          })) ?? undefined
        if (!hubspotContactId) {
          retry(item, 'No HubSpot contact for this email')
          continue
        }
        rememberHubSpotId(store, item.contactId, hubspotContactId)
        store.update((db) => {
          const row = db.hubspotOutbox.find((x) => x.id === item.id)
          if (row) row.hubspotContactId = hubspotContactId
        })
      }
      const res = await fetcher(`${OBJECTS}/${PATH[item.kind]}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: item.properties,
          associations: [
            {
              to: { id: hubspotContactId },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION_TYPE[item.kind] }]
            }
          ]
        })
      })
      if (res.ok) {
        finish(item.id)
        sent++
        continue
      }
      const text = (await res.text()).slice(0, 300)
      if (res.status === 403) {
        store.update((db) => {
          const row = db.connections.find((c) => c.id === conn.id)
          if (row) row.meta = { ...row.meta, writebackError: 'Reconnect HubSpot to log activity there' }
        })
        finish(item.id)
        failed++
        log('warn', 'hubspot writeback missing scope', { orgId: item.orgId, kind: item.kind })
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        retry(item, `HubSpot ${res.status}`)
        continue
      }
      // Other 4xx (deleted contact, bad property): retrying won't help.
      finish(item.id)
      failed++
      log('warn', 'hubspot writeback rejected', { orgId: item.orgId, kind: item.kind, status: res.status, error: text })
    } catch (err) {
      retry(item, err instanceof Error ? err.message : 'network error')
      if (item.attempts + 1 >= MAX_ATTEMPTS) reportError(err, { source: 'hubspot-writeback', orgId: item.orgId })
    }
  }
  return { sent, failed }
}
