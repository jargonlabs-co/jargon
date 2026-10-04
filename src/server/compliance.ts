import type { ServerConfig } from './config'
import type { DataStore } from './store'
import { signToken, uid, verifyToken } from './crypto'
import { plivoWebhookBase } from './providers/plivo'
import { toE164 } from '../shared/phone'
import { normalizeLinkedInUrl } from '../shared/linkedinUrl'
import type {
  Contact,
  Database,
  Suppression,
  SuppressionKind,
  SuppressionReason
} from './types'

export type OutboundChannel = 'email' | 'call' | 'linkedin'

export function normalizeSuppressionValue(kind: SuppressionKind, raw: string): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (kind === 'email') {
    const email = value.toLowerCase()
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null
  }
  if (kind === 'domain') {
    const domain = value.toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').split('/')[0]
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null
  }
  if (kind === 'phone') return toE164(value)
  return normalizeLinkedInUrl(value)?.toLowerCase().replace(/\/$/, '') ?? null
}

function contactKeys(contact: Pick<Contact, 'email' | 'phone' | 'linkedinUrl'>, channel: OutboundChannel) {
  const keys: Array<{ kind: SuppressionKind; value: string }> = []
  if (channel === 'email') {
    const email = normalizeSuppressionValue('email', contact.email ?? '')
    if (email) {
      keys.push({ kind: 'email', value: email })
      keys.push({ kind: 'domain', value: email.split('@')[1] })
    }
  } else if (channel === 'call') {
    const phone = normalizeSuppressionValue('phone', contact.phone ?? '')
    if (phone) keys.push({ kind: 'phone', value: phone })
  } else {
    const url = normalizeSuppressionValue('linkedin', contact.linkedinUrl ?? '')
    if (url) keys.push({ kind: 'linkedin', value: url })
  }
  return keys
}

/**
 * Org rows plus global (orgId null) rows that block this contact on this channel.
 * A CRM opt-out on the contact (attrs.email_opt_out) also blocks email.
 */
export function findSuppression(
  db: Pick<Database, 'suppressions'>,
  orgId: string,
  channel: OutboundChannel,
  contact: Pick<Contact, 'email' | 'phone' | 'linkedinUrl'> & { attrs?: Contact['attrs'] }
): Suppression | undefined {
  if (channel === 'email' && contact.attrs?.email_opt_out === true) {
    return {
      id: 'crm_opt_out',
      orgId,
      kind: 'email',
      value: contact.email ?? '',
      reason: 'unsubscribed',
      source: 'crm',
      createdAt: 0
    }
  }
  const keys = contactKeys(contact, channel)
  if (!keys.length) return undefined
  return (db.suppressions ?? []).find(
    (s) =>
      (s.orgId === orgId || s.orgId === null) &&
      keys.some((k) => k.kind === s.kind && k.value === s.value)
  )
}

const REASON_TEXT: Record<SuppressionReason, string> = {
  unsubscribed: 'Recipient unsubscribed',
  bounced: 'Address bounced',
  complaint: 'Recipient reported spam',
  do_not_call: 'Number is on the do-not-call list',
  manual: 'Recipient is on the suppression list'
}

export function suppressionMessage(s: Suppression): string {
  return REASON_TEXT[s.reason]
}

export interface SuppressionInput {
  orgId: string | null
  kind: SuppressionKind
  value: string
  reason: SuppressionReason
  source?: string
}

/** Adds in one write. Returns the row for each valid input (existing rows are reused). */
export function addSuppressions(store: DataStore, inputs: SuppressionInput[]): Suppression[] {
  const result: Suppression[] = []
  const created: Suppression[] = []
  const seen = new Map<string, Suppression>()
  for (const s of store.db.suppressions) seen.set(`${s.orgId}|${s.kind}|${s.value}`, s)
  for (const input of inputs) {
    const value = normalizeSuppressionValue(input.kind, input.value)
    if (!value) continue
    const key = `${input.orgId}|${input.kind}|${value}`
    let row = seen.get(key)
    if (!row) {
      row = {
        id: uid('sup'),
        orgId: input.orgId,
        kind: input.kind,
        value,
        reason: input.reason,
        source: input.source,
        createdAt: Date.now()
      }
      seen.set(key, row)
      created.push(row)
    }
    result.push(row)
  }
  if (created.length) {
    store.update((db) => {
      db.suppressions.push(...created)
      cancelSuppressedMessages(db, created)
    })
  }
  return result
}

export function addSuppression(store: DataStore, input: SuppressionInput): Suppression | null {
  return addSuppressions(store, [input])[0] ?? null
}

export function removeSuppression(store: DataStore, orgId: string, id: string): boolean {
  const row = store.db.suppressions.find((s) => s.id === id && s.orgId === orgId)
  if (!row) return false
  store.update((db) => {
    db.suppressions = db.suppressions.filter((s) => s.id !== id)
  })
  return true
}

function channelForKind(kind: SuppressionKind): OutboundChannel {
  return kind === 'phone' ? 'call' : kind === 'linkedin' ? 'linkedin' : 'email'
}

/** Cancel queued and draft messages that the new rows now block. One pass over contacts. */
function cancelSuppressedMessages(db: Database, rows: Suppression[]): void {
  const byKey = new Map<string, Suppression>()
  for (const row of rows) {
    if (channelForKind(row.kind) !== 'call') byKey.set(`${row.kind}|${row.value}`, row)
  }
  if (!byKey.size) return
  const now = Date.now()
  const blocked = new Map<string, { contact: Contact; channel: OutboundChannel; row: Suppression }>()
  for (const contact of db.contacts) {
    for (const channel of ['email', 'linkedin'] as const) {
      for (const key of contactKeys(contact, channel)) {
        const row = byKey.get(`${key.kind}|${key.value}`)
        if (row && (row.orgId === null || row.orgId === contact.orgId)) {
          blocked.set(`${contact.id}|${channel}`, { contact, channel, row })
        }
      }
    }
  }
  if (!blocked.size) return
  for (const m of db.messages) {
    if (m.status !== 'queued' && m.status !== 'draft') continue
    const hit = blocked.get(`${m.contactId}|${m.channel}`)
    if (!hit) continue
    m.status = 'cancelled'
    m.error = REASON_TEXT[hit.row.reason]
    m.updatedAt = now
  }
  for (const { contact, channel, row } of blocked.values()) {
    db.activities.unshift({
      id: uid('act'),
      orgId: contact.orgId,
      projectId: contact.projectId,
      contactId: contact.id,
      kind: 'system',
      summary: `${REASON_TEXT[row.reason]}. Stopped ${channel} for ${contact.name}`,
      createdAt: now
    })
  }
}

// ——— Unsubscribe links ———

const UNSUBSCRIBE_PURPOSE = 'unsubscribe'

interface UnsubscribePayload {
  o: string
  e: string
}

export function unsubscribeLinkBase(config: Pick<ServerConfig, 'publicUrl'>): string {
  const override = process.env.JARGON_UNSUBSCRIBE_BASE_URL?.trim()
  return (override || plivoWebhookBase(config)).replace(/\/$/, '')
}

export function unsubscribeUrl(
  config: Pick<ServerConfig, 'publicUrl'>,
  orgId: string,
  email: string
): string {
  const token = signToken(UNSUBSCRIBE_PURPOSE, { o: orgId, e: email.trim().toLowerCase() })
  return `${unsubscribeLinkBase(config)}/u/${token}`
}

export function readUnsubscribeToken(token: string): { orgId: string; email: string } | null {
  const payload = verifyToken<UnsubscribePayload>(UNSUBSCRIBE_PURPOSE, token)
  if (!payload?.o || !payload.e) return null
  return { orgId: payload.o, email: payload.e }
}

export function unsubscribePageHtml(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Unsubscribe</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#222;line-height:1.5}
button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #222;background:#222;color:#fff;cursor:pointer}</style>
</head><body>${inner}</body></html>`
}

export function emailFooter(input: { unsubscribeUrl: string; postalAddress?: string }): string {
  const lines = ['', '--']
  if (input.postalAddress?.trim()) lines.push(input.postalAddress.trim())
  lines.push(`Unsubscribe: ${input.unsubscribeUrl}`)
  return lines.join('\n')
}

// ——— Calling hours ———

/** Local-time window for outbound calls, from JARGON_CALL_WINDOW="8-21" (start inclusive, end exclusive). */
export function callWindowHours(env: NodeJS.ProcessEnv = process.env): { start: number; end: number } {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(env.JARGON_CALL_WINDOW?.trim() ?? '')
  if (match) {
    const start = Number(match[1])
    const end = Number(match[2])
    if (start >= 0 && end <= 24 && start < end) return { start, end }
  }
  return { start: 8, end: 21 }
}

function validTimeZone(tz: string): string | null {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/** Accepts IANA names and HubSpot's `america_slash_new_york` style. */
export function normalizeTimeZone(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null
  if (validTimeZone(text)) return text
  const fromHubSpot = text
    .toLowerCase()
    .split('_slash_')
    .map((part) =>
      part
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join('_')
    )
    .join('/')
  return validTimeZone(fromHubSpot)
}

const TIMEZONE_ATTRS = ['timezone', 'time_zone', 'timeZone', 'hs_timezone', 'tz']

export function contactTimeZone(contact: Pick<Contact, 'attrs'>): string | null {
  for (const key of TIMEZONE_ATTRS) {
    const tz = normalizeTimeZone(contact.attrs?.[key])
    if (tz) return tz
  }
  return null
}

function localHour(tz: string, now: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(now)
    .find((p) => p.type === 'hour')?.value
  return Number(hour)
}

/**
 * Known timezone: use it. US/Canada number without one: require the window in
 * both Eastern and Pacific time. Anything else needs a timezone on the contact.
 */
export function checkCallingHours(
  contact: Pick<Contact, 'phone' | 'attrs'>,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env
): { ok: true } | { ok: false; reason: string } {
  const { start, end } = callWindowHours(env)
  const inWindow = (tz: string) => {
    const h = localHour(tz, now)
    return h >= start && h < end
  }
  const label = `${start}:00–${end}:00`
  const tz = contactTimeZone(contact)
  if (tz) {
    return inWindow(tz)
      ? { ok: true }
      : { ok: false, reason: `Outside calling hours (${label} in ${tz})` }
  }
  const phone = toE164(contact.phone ?? '')
  if (phone?.startsWith('+1')) {
    return inWindow('America/New_York') && inWindow('America/Los_Angeles')
      ? { ok: true }
      : { ok: false, reason: `Outside calling hours (${label} local). Add a timezone to the contact to widen the window` }
  }
  return { ok: false, reason: 'Add a timezone to this contact before calling a non-US number' }
}

/** Every pre-dial check. Returns a user-facing reason when the call must not happen. */
export function callBlockReason(
  db: Pick<Database, 'suppressions'>,
  contact: Contact,
  now = new Date()
): string | null {
  const suppressed = findSuppression(db, contact.orgId, 'call', contact)
  if (suppressed) return suppressionMessage(suppressed)
  const hours = checkCallingHours(contact, now)
  return hours.ok ? null : hours.reason
}

export class OutboundBlockedError extends Error {
  readonly status = 409
  readonly code = 'outbound_blocked'
}
