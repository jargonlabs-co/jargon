import type { ServerConfig } from './config'
import type { DataStore } from './store'
import type { Contact } from './types'
import { applyDisposition } from './publicApi'
import { enqueueHubSpotActivity } from './hubspotWriteback'
import { MailboxAuthError, getOrgMailbox, mailboxAccessToken } from './mailboxes'

type Fetcher = typeof fetch

export function parseMeetingWindow(
  startRaw: string,
  durationMinutes = 30
): { start: string; end: string } | null {
  const startMs = Date.parse(startRaw)
  if (!Number.isFinite(startMs)) return null
  const minutes = Math.min(240, Math.max(15, Math.round(durationMinutes)))
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + minutes * 60_000).toISOString()
  }
}

export function googleCalendarEvent(input: {
  title: string
  note?: string
  start: string
  end: string
  attendees: string[]
}): Record<string, unknown> {
  return {
    summary: input.title,
    description: input.note || undefined,
    start: { dateTime: input.start },
    end: { dateTime: input.end },
    attendees: input.attendees.map((email) => ({ email }))
  }
}

export function outlookCalendarEvent(input: {
  title: string
  note?: string
  start: string
  end: string
  attendees: string[]
}): Record<string, unknown> {
  const graphTime = (iso: string) => ({ dateTime: iso.slice(0, 19), timeZone: 'UTC' })
  return {
    subject: input.title,
    body: { contentType: 'Text', content: input.note ?? '' },
    start: graphTime(input.start),
    end: graphTime(input.end),
    attendees: input.attendees.map((address) => ({
      emailAddress: { address },
      type: 'required'
    }))
  }
}

export async function bookPublicMeeting(
  store: DataStore,
  config: ServerConfig,
  contact: Contact,
  input: { start: string; durationMinutes?: number; title?: string; note?: string },
  fetcher: Fetcher = fetch
): Promise<
  | { ok: true; contactId: string; eventId: string; htmlLink?: string; start: string; end: string }
  | { ok: false; error: string; status: number }
> {
  if (!contact.email?.trim()) return { ok: false, status: 400, error: 'Contact has no email for the invite' }
  const window = parseMeetingWindow(input.start, input.durationMinutes)
  if (!window) return { ok: false, status: 400, error: 'start must be an ISO date' }
  let mailbox
  try {
    mailbox = getOrgMailbox(store, contact.orgId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconnect your mailbox'
    return { ok: false, status: err instanceof MailboxAuthError ? 401 : 400, error: message }
  }
  if (!mailbox || (mailbox.provider !== 'gmail' && mailbox.provider !== 'outlook')) {
    return {
      ok: false,
      status: 400,
      error: 'Connect Gmail or Outlook in Jargon (Account → Data) before booking a meeting.'
    }
  }
  const title = (input.title?.trim() || `Meeting with ${contact.name}`).slice(0, 200)
  const attendees = [contact.email.trim()]
  const provider = mailbox.provider
  let token: string
  try {
    token = await mailboxAccessToken(store, config, mailbox, fetcher)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconnect your mailbox'
    return { ok: false, status: 401, error: message }
  }
  const url =
    provider === 'gmail'
      ? 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all'
      : 'https://graph.microsoft.com/v1.0/me/events'
  const body =
    provider === 'gmail'
      ? googleCalendarEvent({ title, note: input.note, ...window, attendees })
      : outlookCalendarEvent({ title, note: input.note, ...window, attendees })
  const res = await fetcher(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let json: { id?: string; htmlLink?: string; webLink?: string; error?: { message?: string } } = {}
  try {
    json = text ? (JSON.parse(text) as typeof json) : {}
  } catch {
    json = {}
  }
  if (res.status === 403 || res.status === 401) {
    return {
      ok: false,
      status: 401,
      error: `Reconnect ${provider === 'gmail' ? 'Gmail' : 'Outlook'} in Jargon so it can send calendar invites.`
    }
  }
  if (!res.ok || !json.id) {
    return {
      ok: false,
      status: 502,
      error: json.error?.message || `Calendar invite failed (${res.status})`
    }
  }
  const htmlLink = json.htmlLink || json.webLink
  const startMs = Date.parse(window.start)
  const endMs = Date.parse(window.end)
  store.update((db) => {
    const row = db.contacts.find((c) => c.id === contact.id)
    if (!row) return
    row.meeting = { provider, eventId: json.id!, htmlLink, start: window.start, end: window.end, title }
    row.updatedAt = Date.now()
  })
  const note = [input.note?.trim(), htmlLink].filter(Boolean).join('\n')
  applyDisposition(store, contact.id, {
    status: 'meeting_booked',
    note: note || undefined
  })
  const updated = store.db.contacts.find((c) => c.id === contact.id)
  if (updated) {
    enqueueHubSpotActivity(store, updated, {
      kind: 'meeting',
      title,
      body: note || title,
      start: startMs,
      end: endMs,
      url: htmlLink,
      at: startMs
    })
  }
  return { ok: true, contactId: contact.id, eventId: json.id, htmlLink, start: window.start, end: window.end }
}
