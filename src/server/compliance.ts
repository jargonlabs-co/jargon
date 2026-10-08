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
  return REASON_TEXT[s.reason] ?? REASON_TEXT.manual
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

/** The do-not-call note for this number, when one exists. */
export function doNotCallNote(
  db: Pick<Database, 'suppressions'>,
  orgId: string,
  contact: Pick<Contact, 'email' | 'phone' | 'linkedinUrl'> & { attrs?: Contact['attrs'] }
): string | null {
  const suppressed = findSuppression(db, orgId, 'call', contact)
  if (!suppressed || suppressed.reason !== 'do_not_call') return null
  return suppressionMessage(suppressed)
}

/** Every pre-dial check. Returns a user-facing reason when the call must not happen. */
export function callBlockReason(
  db: Pick<Database, 'suppressions'>,
  contact: Contact,
  opts?: { allowDoNotCall?: boolean }
): string | null {
  const suppressed = findSuppression(db, contact.orgId, 'call', contact)
  if (!suppressed) return null
  if (opts?.allowDoNotCall && suppressed.reason === 'do_not_call') return null
  return suppressionMessage(suppressed)
}

export class OutboundBlockedError extends Error {
  readonly status = 409
  readonly code = 'outbound_blocked'
}
