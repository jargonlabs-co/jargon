import type { ServerConfig } from './config'
import type { DataStore } from './store'
import { addSuppressions } from './compliance'
import { refreshGmailAccessToken } from './providers/gmail'

/**
 * Hard-bounced recipients in a raw delivery status notification (RFC 3464).
 * Soft (4.x.x) failures are ignored; Gmail's X-Failed-Recipients is treated as hard.
 */
export function parseHardBounces(raw: string): string[] {
  const text = raw.replace(/\r\n/g, '\n')
  const found = new Set<string>()
  const header = /^X-Failed-Recipients:\s*(.+)$/im.exec(text)
  if (header) {
    for (const addr of header[1].split(',')) {
      const email = addr.trim().toLowerCase()
      if (email.includes('@')) found.add(email)
    }
  }
  // Per-recipient blocks in message/delivery-status are separated by blank lines.
  for (const block of text.split(/\n\s*\n/)) {
    const recipient = /^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^>\s]+@[^>\s]+)>?/im.exec(block)
    if (!recipient) continue
    const status = /^Status:\s*(\d)\.\d+\.\d+/im.exec(block)?.[1]
    const action = /^Action:\s*(\w+)/im.exec(block)?.[1]?.toLowerCase()
    if (status === '5' || (!status && action === 'failed')) found.add(recipient[1].toLowerCase())
    else found.delete(recipient[1].toLowerCase())
  }
  return [...found]
}

const processed = new Set<string>()
const missingScope = new Set<string>()

type Fetcher = typeof fetch

async function gmailJson<T>(fetcher: Fetcher, token: string, url: string): Promise<{ status: number; body: T | null }> {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { status: res.status, body: null }
  return { status: res.status, body: (await res.json()) as T }
}

/** Poll each pool mailbox for bounce notices and globally suppress hard-bounced addresses we emailed. */
export async function pollGmailBounces(
  store: DataStore,
  config: ServerConfig,
  fetcher: Fetcher = fetch
): Promise<number> {
  const mailboxes = config.outboundPools.emailMailboxes.length
    ? config.outboundPools.emailMailboxes
    : config.google.refreshToken
      ? [{ id: 'default', refreshToken: config.google.refreshToken, label: 'platform' }]
      : []
  if (!config.google.clientId || !mailboxes.length) return 0

  const sentTo = new Set(
    store.db.messages
      .filter((m) => m.channel === 'email' && m.status === 'sent' && !m.sandbox)
      .map((m) => store.db.contacts.find((c) => c.id === m.contactId)?.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e))
  )
  let suppressed = 0
  for (const mailbox of mailboxes) {
    if (missingScope.has(mailbox.id)) continue
    let token: string
    try {
      token = (await refreshGmailAccessToken(config, { accessToken: 'pending', refreshToken: mailbox.refreshToken }))
        .accessToken
    } catch (err) {
      console.warn(`[jargon] Bounce poll: token refresh failed for ${mailbox.id}`, err instanceof Error ? err.message : err)
      continue
    }
    const q = encodeURIComponent('from:mailer-daemon newer_than:3d')
    const list = await gmailJson<{ messages?: Array<{ id: string }> }>(
      fetcher,
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100`
    )
    if (list.status === 403) {
      missingScope.add(mailbox.id)
      console.warn(
        `[jargon] Bounce poll disabled for mailbox ${mailbox.id}: token lacks gmail.readonly. Re-issue the refresh token with that scope.`
      )
      continue
    }
    const bounced: string[] = []
    for (const { id } of list.body?.messages ?? []) {
      const key = `${mailbox.id}:${id}`
      if (processed.has(key)) continue
      const msg = await gmailJson<{ raw?: string }>(
        fetcher,
        token,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`
      )
      if (!msg.body?.raw) continue
      processed.add(key)
      const raw = Buffer.from(msg.body.raw, 'base64url').toString('utf8')
      for (const email of parseHardBounces(raw)) if (sentTo.has(email)) bounced.push(email)
    }
    if (bounced.length) {
      const before = store.db.suppressions.length
      addSuppressions(
        store,
        bounced.map((value) => ({ orgId: null, kind: 'email' as const, value, reason: 'bounced' as const, source: `gmail_dsn:${mailbox.id}` }))
      )
      suppressed += store.db.suppressions.length - before
    }
  }
  return suppressed
}
