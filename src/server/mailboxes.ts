import type { ServerConfig } from './config'
import type { DataStore } from './store'
import { createOAuthState, oauthRedirectUri, readSecrets, type ProviderSecrets } from './connections'
import { encryptJson, uid } from './crypto'
import { buildGmailRawMime, escapeEmailHtml } from './providers/gmail'
import { addSuppressions } from './compliance'
import { parseHardBounces } from './bounces'
import { consumeDailyBudget } from './outboundPools'
import type { Connection, MailboxProvider } from './types'

type Fetcher = typeof fetch

export const MAILBOX_PROVIDERS: MailboxProvider[] = ['gmail', 'outlook']

export function isMailboxProvider(value: string): value is MailboxProvider {
  return (MAILBOX_PROVIDERS as string[]).includes(value)
}

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH = 'https://graph.microsoft.com/v1.0/me'
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
].join(' ')
const MS_SCOPES = 'offline_access openid email User.Read Mail.Send Mail.ReadWrite'
/** Replies to anything older than this are not tracked. */
const THREAD_WINDOW_MS = 60 * 24 * 60 * 60 * 1000

const LABEL: Record<MailboxProvider, string> = { gmail: 'Gmail', outlook: 'Outlook' }

export class MailboxAuthError extends Error {
  readonly status = 401
  readonly code = 'mailbox_reconnect'
}

export function mailboxConfigured(config: ServerConfig, provider: MailboxProvider): boolean {
  return provider === 'gmail'
    ? Boolean(config.google.clientId && config.google.clientSecret)
    : Boolean(config.microsoft.clientId && config.microsoft.clientSecret)
}

export function mailboxAuthUrl(
  store: DataStore,
  config: ServerConfig,
  provider: MailboxProvider,
  orgId: string,
  userId: string
): string {
  const state = createOAuthState(store, { orgId, userId, provider })
  const url = new URL(provider === 'gmail' ? GOOGLE_AUTH : MS_AUTH)
  url.searchParams.set('client_id', provider === 'gmail' ? config.google.clientId : config.microsoft.clientId)
  url.searchParams.set('redirect_uri', oauthRedirectUri(config, provider))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider === 'gmail' ? GOOGLE_SCOPES : MS_SCOPES)
  url.searchParams.set('state', state.id)
  if (provider === 'gmail') {
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('include_granted_scopes', 'true')
  } else {
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('prompt', 'select_account')
  }
  return url.toString()
}

type TokenJson = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function tokenRequest(fetcher: Fetcher, url: string, body: URLSearchParams): Promise<TokenJson> {
  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await res.text()
  let json: TokenJson = {}
  try {
    json = text ? (JSON.parse(text) as TokenJson) : {}
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') {
      throw new MailboxAuthError('Mailbox access was revoked or expired. Reconnect it in Jargon.')
    }
    throw new Error(`Mailbox token request failed (${res.status}): ${json.error_description ?? json.error ?? text.slice(0, 200)}`)
  }
  return json
}

function toSecrets(json: TokenJson, previous?: ProviderSecrets): ProviderSecrets {
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token ?? previous?.refreshToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
  }
}

async function getJson<T>(fetcher: Fetcher, url: string, token: string): Promise<T> {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new MailboxAuthError('Mailbox access was revoked. Reconnect it in Jargon.')
  if (!res.ok) {
    const err = new Error(`Mailbox API ${res.status}: ${(await res.text()).slice(0, 200)}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as T
}

export async function exchangeMailboxCode(
  config: ServerConfig,
  provider: MailboxProvider,
  code: string,
  fetcher: Fetcher = fetch
): Promise<{ secrets: ProviderSecrets; email: string; cursor: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthRedirectUri(config, provider),
    client_id: provider === 'gmail' ? config.google.clientId : config.microsoft.clientId,
    client_secret: provider === 'gmail' ? config.google.clientSecret : config.microsoft.clientSecret
  })
  if (provider === 'outlook') body.set('scope', MS_SCOPES)
  const secrets = toSecrets(await tokenRequest(fetcher, provider === 'gmail' ? GOOGLE_TOKEN : MS_TOKEN, body))
  if (!secrets.refreshToken) {
    throw new Error(`${LABEL[provider]} did not grant offline access. Remove Jargon from your account's third-party access and connect again.`)
  }
  if (provider === 'gmail') {
    const profile = await getJson<{ emailAddress: string; historyId: string }>(fetcher, `${GMAIL_API}/profile`, secrets.accessToken)
    return { secrets, email: profile.emailAddress.toLowerCase(), cursor: String(profile.historyId) }
  }
  const me = await getJson<{ mail?: string; userPrincipalName?: string }>(fetcher, GRAPH, secrets.accessToken)
  const email = (me.mail || me.userPrincipalName || '').toLowerCase()
  if (!email) throw new Error('Could not read the Outlook mailbox address')
  return { secrets, email, cursor: new Date().toISOString() }
}

/** The org's sending mailbox. Throws when one is connected but needs reconnecting. */
export function getOrgMailbox(store: DataStore, orgId: string): Connection | undefined {
  const rows = store.db.connections
    .filter((c) => c.orgId === orgId && isMailboxProvider(c.provider) && c.status !== 'disconnected')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const live = rows.find((c) => c.status === 'connected')
  if (live) return live
  if (rows.length) {
    throw new MailboxAuthError(`Reconnect your ${LABEL[rows[0].provider as MailboxProvider]} mailbox in Jargon (Account → Data).`)
  }
  return undefined
}

function markMailboxError(store: DataStore, connectionId: string, message: string): void {
  store.update((db) => {
    const row = db.connections.find((c) => c.id === connectionId)
    if (!row) return
    row.status = 'error'
    row.error = message
    row.updatedAt = Date.now()
  })
}

export async function mailboxAccessToken(
  store: DataStore,
  config: ServerConfig,
  conn: Connection,
  fetcher: Fetcher = fetch
): Promise<string> {
  const secrets = readSecrets(conn)
  if (secrets.accessToken && secrets.expiresAt && secrets.expiresAt - 60_000 > Date.now()) {
    return secrets.accessToken
  }
  if (!secrets.refreshToken) {
    markMailboxError(store, conn.id, 'Reconnect your mailbox')
    throw new MailboxAuthError('Mailbox has no refresh token. Reconnect it in Jargon.')
  }
  const provider = conn.provider as MailboxProvider
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: secrets.refreshToken,
    client_id: provider === 'gmail' ? config.google.clientId : config.microsoft.clientId,
    client_secret: provider === 'gmail' ? config.google.clientSecret : config.microsoft.clientSecret
  })
  if (provider === 'outlook') body.set('scope', MS_SCOPES)
  let next: ProviderSecrets
  try {
    next = toSecrets(await tokenRequest(fetcher, provider === 'gmail' ? GOOGLE_TOKEN : MS_TOKEN, body), secrets)
  } catch (err) {
    if (err instanceof MailboxAuthError) markMailboxError(store, conn.id, 'Reconnect your mailbox')
    throw err
  }
  store.update((db) => {
    const row = db.connections.find((c) => c.id === conn.id)
    if (!row) return
    row.secretsCipher = encryptJson(next)
    row.updatedAt = Date.now()
  })
  return next.accessToken
}

export async function sendFromMailbox(
  store: DataStore,
  config: ServerConfig,
  conn: Connection,
  input: { to: string; subject: string; body: string; unsubscribeUrl?: string; footer?: string },
  fetcher: Fetcher = fetch
): Promise<{ id: string; threadId?: string; mode: MailboxProvider }> {
  consumeDailyBudget(store, conn.orgId, 'mailbox_email', config.mailboxes.dailyLimit, 'email')
  const token = await mailboxAccessToken(store, config, conn, fetcher)
  const mime = buildGmailRawMime(input)
  if (conn.provider === 'gmail') {
    const res = await fetcher(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') })
    })
    if (res.status === 401) throw new MailboxAuthError('Gmail rejected the token. Reconnect it in Jargon.')
    if (!res.ok) throw new Error(`Gmail send failed (${res.status})`)
    const json = (await res.json()) as { id: string; threadId?: string }
    return { id: json.id, threadId: json.threadId, mode: 'gmail' }
  }
  // Graph only takes List-Unsubscribe as part of a MIME message: create the draft from MIME, then send it.
  const created = await fetcher(`${GRAPH}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: Buffer.from(mime, 'utf8').toString('base64')
  })
  if (created.status === 401) throw new MailboxAuthError('Outlook rejected the token. Reconnect it in Jargon.')
  if (!created.ok) throw new Error(`Outlook draft failed (${created.status})`)
  const draft = (await created.json()) as { id: string; conversationId?: string }
  const sent = await fetcher(`${GRAPH}/messages/${encodeURIComponent(draft.id)}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!sent.ok) throw new Error(`Outlook send failed (${sent.status})`)
  return { id: draft.id, threadId: draft.conversationId, mode: 'outlook' }
}

// ——— Inbound: replies, auto-replies, bounces ———

export interface InboundMail {
  id: string
  threadId: string
  from: string
  subject: string
  snippet: string
  headers: Record<string, string>
  /** Full MIME for bounce notices only. */
  raw?: string
}

function emailFromHeader(from: string): string {
  const angle = /<([^>]+)>/.exec(from)
  return (angle ? angle[1] : from).trim().toLowerCase()
}

export function isBounceNotice(mail: Pick<InboundMail, 'from' | 'subject'>): boolean {
  return (
    /mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(mail.from) ||
    /^(undeliverable|delivery status notification \(failure\)|mail delivery failed)/i.test(mail.subject)
  )
}

export function isAutoReply(mail: Pick<InboundMail, 'headers' | 'subject'>): boolean {
  const h = (name: string) => mail.headers[name.toLowerCase()]?.toLowerCase() ?? ''
  if (h('auto-submitted') && h('auto-submitted') !== 'no') return true
  if (h('x-autoreply') || h('x-autorespond') || h('x-auto-response-suppress').includes('oof')) return true
  if (/^(auto_reply|bulk|junk)$/.test(h('precedence'))) return true
  return /^(automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office)\b/i.test(mail.subject.trim())
}

export function applyInboundMail(
  store: DataStore,
  conn: Connection,
  mails: InboundMail[]
): { replies: number; autoReplies: number; bounces: number } {
  const counts = { replies: 0, autoReplies: 0, bounces: 0 }
  const self = (conn.meta.email ?? '').toLowerCase()
  const sentByThread = new Map(
    store.db.messages
      .filter((m) => m.senderConnectionId === conn.id && m.providerThreadId && m.status === 'sent')
      .map((m) => [m.providerThreadId!, m])
  )
  const sentTo = new Set(
    [...sentByThread.values()]
      .map((m) => store.db.contacts.find((c) => c.id === m.contactId)?.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e))
  )
  const bounced: string[] = []
  for (const mail of mails) {
    if (isBounceNotice(mail)) {
      for (const email of parseHardBounces(mail.raw ?? '')) if (sentTo.has(email)) bounced.push(email)
      continue
    }
    const sent = sentByThread.get(mail.threadId)
    if (!sent || emailFromHeader(mail.from) === self) continue
    const contact = store.db.contacts.find((c) => c.id === sent.contactId && c.orgId === conn.orgId)
    if (!contact || contact.attrs?.lastReplyMessageId === mail.id) continue
    const now = Date.now()
    const auto = isAutoReply(mail)
    store.update((db) => {
      const c = db.contacts.find((x) => x.id === contact.id)
      if (!c) return
      c.attrs = { ...(c.attrs ?? {}), lastReplyMessageId: mail.id }
      if (!auto) {
        c.status = 'replied'
        c.attrs.lastReplyAt = now
        c.updatedAt = now
        for (const m of db.messages) {
          if (m.contactId !== c.id || (m.status !== 'queued' && m.status !== 'draft')) continue
          m.status = 'cancelled'
          m.error = 'Contact replied'
          m.updatedAt = now
        }
      }
      const snippet = mail.snippet.replace(/\s+/g, ' ').trim().slice(0, 160)
      db.activities.unshift({
        id: uid('act'),
        orgId: c.orgId,
        projectId: c.projectId,
        contactId: c.id,
        kind: 'email',
        summary: auto
          ? `Auto-reply from ${c.name}: ${mail.subject}`
          : `${c.name} replied${snippet ? `: "${snippet}"` : ''}. Sequence stopped`,
        createdAt: now
      })
    })
    if (auto) counts.autoReplies += 1
    else counts.replies += 1
  }
  if (bounced.length) {
    const before = store.db.suppressions.length
    addSuppressions(
      store,
      bounced.map((value) => ({ orgId: null, kind: 'email' as const, value, reason: 'bounced' as const, source: `mailbox:${conn.id}` }))
    )
    counts.bounces = store.db.suppressions.length - before
  }
  return counts
}

const GMAIL_HEADERS = ['From', 'Subject', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'X-Auto-Response-Suppress', 'Precedence']

async function gmailInbound(
  fetcher: Fetcher,
  token: string,
  cursor: string,
  threads: Set<string>
): Promise<{ mails: InboundMail[]; cursor: string }> {
  const ids = new Map<string, string>()
  let pageToken: string | undefined
  let nextCursor = cursor
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${GMAIL_API}/history`)
    url.searchParams.set('startHistoryId', cursor)
    url.searchParams.set('historyTypes', 'messageAdded')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    let json: {
      historyId?: string
      nextPageToken?: string
      history?: Array<{ messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }> }>
    }
    try {
      json = await getJson(fetcher, url.toString(), token)
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        // Cursor older than Gmail keeps history for: restart from now.
        const profile = await getJson<{ historyId: string }>(fetcher, `${GMAIL_API}/profile`, token)
        console.warn('[jargon] Gmail history cursor expired; replies since the last poll may be missed')
        return { mails: [], cursor: String(profile.historyId) }
      }
      throw err
    }
    for (const h of json.history ?? []) {
      for (const { message } of h.messagesAdded ?? []) {
        if (message.labelIds?.includes('SENT') || !threads.has(message.threadId)) continue
        ids.set(message.id, message.threadId)
      }
    }
    if (json.historyId) nextCursor = String(json.historyId)
    pageToken = json.nextPageToken
    if (!pageToken) break
  }
  const mails: InboundMail[] = []
  for (const [id, threadId] of [...ids].slice(0, 100)) {
    const url = new URL(`${GMAIL_API}/messages/${id}`)
    url.searchParams.set('format', 'metadata')
    for (const name of GMAIL_HEADERS) url.searchParams.append('metadataHeaders', name)
    const msg = await getJson<{ snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } }>(
      fetcher,
      url.toString(),
      token
    )
    const headers: Record<string, string> = {}
    for (const { name, value } of msg.payload?.headers ?? []) headers[name.toLowerCase()] = value
    const mail: InboundMail = {
      id,
      threadId,
      from: headers.from ?? '',
      subject: headers.subject ?? '',
      snippet: msg.snippet ?? '',
      headers
    }
    if (isBounceNotice(mail)) {
      const raw = await getJson<{ raw?: string }>(fetcher, `${GMAIL_API}/messages/${id}?format=raw`, token)
      mail.raw = Buffer.from(raw.raw ?? '', 'base64url').toString('utf8')
    }
    mails.push(mail)
  }
  return { mails, cursor: nextCursor }
}

async function outlookInbound(
  fetcher: Fetcher,
  token: string,
  cursor: string,
  threads: Set<string>
): Promise<{ mails: InboundMail[]; cursor: string }> {
  // Graph wants %20 for spaces in OData params, not the "+" URLSearchParams produces.
  const query = Object.entries({
    $filter: `receivedDateTime gt ${cursor}`,
    $orderby: 'receivedDateTime asc',
    $top: '50',
    $select: 'id,conversationId,from,subject,bodyPreview,receivedDateTime,internetMessageHeaders'
  })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `${GRAPH}/mailFolders/inbox/messages?${query}`
  const json = await getJson<{
    value?: Array<{
      id: string
      conversationId?: string
      from?: { emailAddress?: { address?: string; name?: string } }
      subject?: string
      bodyPreview?: string
      receivedDateTime?: string
      internetMessageHeaders?: Array<{ name: string; value: string }>
    }>
  }>(fetcher, url.toString(), token)
  let nextCursor = cursor
  const mails: InboundMail[] = []
  for (const m of json.value ?? []) {
    if (m.receivedDateTime) nextCursor = m.receivedDateTime
    const headers: Record<string, string> = {}
    for (const { name, value } of m.internetMessageHeaders ?? []) headers[name.toLowerCase()] = value
    const from = m.from?.emailAddress?.address ?? ''
    const mail: InboundMail = {
      id: m.id,
      threadId: m.conversationId ?? '',
      from: m.from?.emailAddress?.name ? `${m.from.emailAddress.name} <${from}>` : from,
      subject: m.subject ?? '',
      snippet: m.bodyPreview ?? '',
      headers
    }
    const bounce = isBounceNotice(mail)
    if (!bounce && !threads.has(mail.threadId)) continue
    if (bounce) {
      const res = await fetcher(`${GRAPH}/messages/${encodeURIComponent(m.id)}/$value`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      mail.raw = res.ok ? await res.text() : ''
    }
    mails.push(mail)
  }
  return { mails, cursor: nextCursor }
}

/** Read new mail in every connected org mailbox and apply replies and bounces. */
export async function pollMailboxReplies(
  store: DataStore,
  config: ServerConfig,
  fetcher: Fetcher = fetch
): Promise<{ replies: number; autoReplies: number; bounces: number }> {
  const total = { replies: 0, autoReplies: 0, bounces: 0 }
  const mailboxes = store.db.connections.filter((c) => isMailboxProvider(c.provider) && c.status === 'connected')
  for (const conn of mailboxes) {
    try {
      const since = Date.now() - THREAD_WINDOW_MS
      const threads = new Set(
        store.db.messages
          .filter((m) => m.senderConnectionId === conn.id && m.providerThreadId && (m.sentAt ?? 0) >= since)
          .map((m) => m.providerThreadId!)
      )
      const token = await mailboxAccessToken(store, config, conn, fetcher)
      let cursor = conn.meta.cursor ?? ''
      let mails: InboundMail[] = []
      if (conn.provider === 'gmail') {
        if (!threads.size || !cursor) {
          cursor = String((await getJson<{ historyId: string }>(fetcher, `${GMAIL_API}/profile`, token)).historyId)
        } else {
          ;({ mails, cursor } = await gmailInbound(fetcher, token, cursor, threads))
        }
      } else if (!threads.size || !cursor) {
        cursor = new Date().toISOString()
      } else {
        ;({ mails, cursor } = await outlookInbound(fetcher, token, cursor, threads))
      }
      const counts = applyInboundMail(store, conn, mails)
      total.replies += counts.replies
      total.autoReplies += counts.autoReplies
      total.bounces += counts.bounces
      store.update((db) => {
        const row = db.connections.find((c) => c.id === conn.id)
        if (!row) return
        row.meta = { ...row.meta, cursor }
        row.lastSyncAt = Date.now()
      })
    } catch (err) {
      console.warn(
        `[jargon] Mailbox poll failed for ${conn.provider} ${conn.id}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
  return total
}

export function finishMailboxOAuthHtml(
  config: ServerConfig,
  provider: MailboxProvider,
  ok: boolean,
  message: string
): string {
  const next = `${config.appUrl}/data`
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? `${LABEL[provider]} connected` : `${LABEL[provider]} connection failed`}</h2>
  <p>${escapeEmailHtml(message)}</p>
  <p>Returning to Jargon…</p>
  <script>setTimeout(function(){location.href=${JSON.stringify(next)}},${ok ? 800 : 4000})</script>
  <p><a href="${escapeEmailHtml(next)}">Open Jargon</a></p>
  </body></html>`
}

export async function revokeMailbox(conn: Connection, fetcher: Fetcher = fetch): Promise<void> {
  if (conn.provider !== 'gmail') return
  try {
    const secrets = readSecrets(conn)
    const token = secrets.refreshToken ?? secrets.accessToken
    if (token) {
      await fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
    }
  } catch {
    /* best effort */
  }
}
