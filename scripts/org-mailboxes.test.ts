import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  MailboxAuthError,
  applyInboundMail,
  getOrgMailbox,
  isAutoReply,
  isBounceNotice,
  pollMailboxReplies,
  sendFromMailbox,
  type InboundMail
} from '../src/server/mailboxes.ts'
import { readSecrets } from '../src/server/connections.ts'
import { encryptJson } from '../src/server/crypto.ts'
import { sendPublicMessage } from '../src/server/publicApi.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Connection, Contact, Database, Message } from '../src/server/types.ts'

function memoryStore(db: Database): DataStore {
  return {
    get db() {
      return db
    },
    persist() {},
    update(mutator) {
      mutator(db)
      return db
    }
  }
}

// Loads .env (and so the encryption key) before any fixture secrets are encrypted.
const base = loadConfig()

function testConfig(overrides: Partial<ServerConfig['mailboxes']> = {}): ServerConfig {
  return {
    ...base,
    google: { ...base.google, clientId: 'g-id', clientSecret: 'g-secret', refreshToken: '' },
    microsoft: { clientId: 'm-id', clientSecret: 'm-secret' },
    mailboxes: { requireOrgMailbox: false, dailyLimit: 200, ...overrides }
  }
}

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'ct_1',
    orgId: 'org_a',
    projectId: 'p1',
    name: 'Alex Rivera',
    company: 'Northwind',
    title: 'VP Sales',
    email: 'alex@northwind.io',
    phone: '',
    city: '',
    status: 'contacted',
    stepIndex: 1,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function mailbox(provider: 'gmail' | 'outlook', overrides: Partial<Connection> = {}): Connection {
  return {
    id: `conn_${provider}`,
    orgId: 'org_a',
    provider,
    status: 'connected',
    accountLabel: 'rep@acme.com',
    secretsCipher: encryptJson({ accessToken: 'fresh', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 }),
    meta: { email: 'rep@acme.com', cursor: '100' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  } as Connection
}

function sentMessage(conn: Connection, threadId: string, c: Contact, extra: Partial<Message> = {}): Message {
  return {
    id: `msg_${threadId}`,
    orgId: c.orgId,
    projectId: c.projectId,
    contactId: c.id,
    subject: 'Quick question',
    body: 'Hi',
    status: 'sent',
    channel: 'email',
    mode: conn.provider,
    providerThreadId: threadId,
    senderConnectionId: conn.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sentAt: Date.now(),
    ...extra
  } as Message
}

type Call = { url: string; method: string; headers: Record<string, string>; body: string }

function fakeFetch(routes: Array<[RegExp, (call: Call) => Response | Promise<Response>]>) {
  const calls: Call[] = []
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body == null ? '' : String(init.body)
    }
    calls.push(call)
    for (const [pattern, handler] of routes) {
      if (pattern.test(`${call.method} ${call.url}`)) return handler(call)
    }
    return new Response(`unrouted ${call.method} ${call.url}`, { status: 599 })
  }) as typeof fetch
  return { fetcher, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('sending from an org mailbox', () => {
  it('refreshes an expired Gmail token, sends MIME with List-Unsubscribe, and returns the thread', async () => {
    const conn = mailbox('gmail', {
      secretsCipher: encryptJson({ accessToken: 'old', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    })
    const store = memoryStore(migrateDatabase({ connections: [conn] }))
    const { fetcher, calls } = fakeFetch([
      [/POST https:\/\/oauth2\.googleapis\.com\/token/, () => json({ access_token: 'new-token', expires_in: 3600 })],
      [/POST .*gmail\/v1\/users\/me\/messages\/send/, () => json({ id: 'g1', threadId: 't1' })]
    ])
    const result = await sendFromMailbox(
      store,
      testConfig(),
      conn,
      { to: 'alex@northwind.io', subject: 'Hi', body: 'Hello', unsubscribeUrl: 'https://api.test/u/abc' },
      fetcher
    )
    assert.deepEqual(result, { id: 'g1', threadId: 't1', mode: 'gmail' })
    const send = calls.find((c) => c.url.endsWith('/messages/send'))!
    assert.equal(send.headers.authorization, 'Bearer new-token')
    const mime = Buffer.from(JSON.parse(send.body).raw, 'base64url').toString('utf8')
    assert.match(mime, /List-Unsubscribe: <https:\/\/api\.test\/u\/abc>/)
    assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/)
    const saved = readSecrets(store.db.connections[0])
    assert.equal(saved.accessToken, 'new-token')
    assert.equal(saved.refreshToken, 'refresh-1', 'keeps the refresh token when Google omits it')
  })

  it('sends through Outlook as a MIME draft, then sends the draft', async () => {
    const conn = mailbox('outlook')
    const store = memoryStore(migrateDatabase({ connections: [conn] }))
    const { fetcher, calls } = fakeFetch([
      [/POST https:\/\/graph\.microsoft\.com\/v1\.0\/me\/messages$/, () => json({ id: 'd1', conversationId: 'conv1' }, 201)],
      [/POST .*\/me\/messages\/d1\/send$/, () => new Response(null, { status: 202 })]
    ])
    const result = await sendFromMailbox(store, testConfig(), conn, { to: 'a@b.co', subject: 'Hi', body: 'Hello' }, fetcher)
    assert.deepEqual(result, { id: 'd1', threadId: 'conv1', mode: 'outlook' })
    assert.equal(calls[0].headers['content-type'], 'text/plain')
    assert.match(Buffer.from(calls[0].body, 'base64').toString('utf8'), /To: a@b\.co/)
  })

  it('marks the mailbox for reconnect when the grant is revoked', async () => {
    const conn = mailbox('gmail', {
      secretsCipher: encryptJson({ accessToken: 'old', refreshToken: 'revoked', expiresAt: 0 })
    })
    const store = memoryStore(migrateDatabase({ connections: [conn] }))
    const { fetcher } = fakeFetch([[/oauth2\.googleapis\.com\/token/, () => json({ error: 'invalid_grant' }, 400)]])
    await assert.rejects(
      sendFromMailbox(store, testConfig(), conn, { to: 'a@b.co', subject: 'Hi', body: 'x' }, fetcher),
      MailboxAuthError
    )
    assert.equal(store.db.connections[0].status, 'error')
    assert.throws(() => getOrgMailbox(store, 'org_a'), MailboxAuthError)
  })

  it('enforces the daily per-mailbox limit', async () => {
    const conn = mailbox('gmail')
    const store = memoryStore(migrateDatabase({ connections: [conn] }))
    const { fetcher } = fakeFetch([[/messages\/send/, () => json({ id: 'g', threadId: 't' })]])
    const config = testConfig({ dailyLimit: 1 })
    await sendFromMailbox(store, config, conn, { to: 'a@b.co', subject: 'Hi', body: 'x' }, fetcher)
    await assert.rejects(sendFromMailbox(store, config, conn, { to: 'c@d.co', subject: 'Hi', body: 'x' }, fetcher))
  })
})

describe('sender selection', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('sends from the org mailbox and records it on the message', async () => {
    const conn = mailbox('gmail')
    const c = contact()
    const store = memoryStore(migrateDatabase({ connections: [conn], contacts: [c] }))
    globalThis.fetch = fakeFetch([[/messages\/send/, () => json({ id: 'g9', threadId: 't9' })]]).fetcher
    const result = await sendPublicMessage(store, testConfig(), c, { subject: 'Hi', body: 'Hello', status: 'sent' })
    assert.equal(result.ok, true)
    const row = store.db.messages[0]
    assert.equal(row.mode, 'gmail')
    assert.equal(row.senderConnectionId, conn.id)
    assert.equal(row.providerThreadId, 't9')
  })

  it('refuses the shared pool when org mailboxes are required', async () => {
    const c = contact()
    const store = memoryStore(migrateDatabase({ contacts: [c] }))
    const result = await sendPublicMessage(store, testConfig({ requireOrgMailbox: true }), c, {
      subject: 'Hi',
      body: 'Hello',
      status: 'sent'
    })
    assert.equal(result.ok, false)
    assert.match(result.body.error, /Connect your Gmail or Outlook mailbox/)
  })

  it('does not fall back to the pool when the org mailbox needs reconnecting', async () => {
    const c = contact()
    const store = memoryStore(migrateDatabase({ connections: [mailbox('gmail', { status: 'error' })], contacts: [c] }))
    const result = await sendPublicMessage(store, testConfig(), c, { subject: 'Hi', body: 'Hello', status: 'sent' })
    assert.equal(result.ok, false)
    assert.match(result.body.error, /Reconnect your Gmail mailbox/)
  })
})

describe('inbound mail', () => {
  const mail = (overrides: Partial<InboundMail> = {}): InboundMail => ({
    id: 'in1',
    threadId: 't1',
    from: 'Alex Rivera <alex@northwind.io>',
    subject: 'Re: Quick question',
    snippet: 'Sure, Tuesday works',
    headers: {},
    ...overrides
  })

  it('classifies auto-replies and bounce notices', () => {
    assert.equal(isAutoReply({ headers: { 'auto-submitted': 'auto-replied' }, subject: 'Re: hi' }), true)
    assert.equal(isAutoReply({ headers: {}, subject: 'Automatic reply: Quick question' }), true)
    assert.equal(isAutoReply({ headers: {}, subject: 'Re: Quick question' }), false)
    assert.equal(isBounceNotice({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'x' }), true)
    assert.equal(isBounceNotice({ from: 'postmaster@outlook.com', subject: 'Undeliverable: Hi' }), true)
  })

  it('a reply marks the contact replied and stops the rest of the sequence', () => {
    const conn = mailbox('gmail')
    const c = contact()
    const followUp = { ...sentMessage(conn, 'tx', c), id: 'msg_next', status: 'queued', providerThreadId: undefined } as Message
    const store = memoryStore(
      migrateDatabase({ connections: [conn], contacts: [c], messages: [sentMessage(conn, 't1', c), followUp] })
    )
    assert.deepEqual(applyInboundMail(store, conn, [mail()]), { replies: 1, autoReplies: 0, bounces: 0 })
    assert.equal(store.db.contacts[0].status, 'replied')
    assert.equal(store.db.messages.find((m) => m.id === 'msg_next')?.status, 'cancelled')
    assert.match(store.db.activities[0].summary, /replied: "Sure, Tuesday works"/)

    assert.deepEqual(applyInboundMail(store, conn, [mail()]), { replies: 0, autoReplies: 0, bounces: 0 }, 'idempotent')
  })

  it('auto-replies and our own messages do not stop the sequence', () => {
    const conn = mailbox('gmail')
    const c = contact()
    const store = memoryStore(migrateDatabase({ connections: [conn], contacts: [c], messages: [sentMessage(conn, 't1', c)] }))
    const counts = applyInboundMail(store, conn, [
      mail({ id: 'own', from: 'Rep <REP@acme.com>' }),
      mail({ id: 'ooo', subject: 'Out of office', headers: { 'auto-submitted': 'auto-replied' } }),
      mail({ id: 'other', threadId: 'unrelated' })
    ])
    assert.deepEqual(counts, { replies: 0, autoReplies: 1, bounces: 0 })
    assert.equal(store.db.contacts[0].status, 'contacted')
  })

  it('suppresses hard bounces only for addresses this mailbox sent to', () => {
    const conn = mailbox('gmail')
    const c = contact()
    const store = memoryStore(migrateDatabase({ connections: [conn], contacts: [c], messages: [sentMessage(conn, 't1', c)] }))
    const raw = [
      'Content-Type: message/delivery-status',
      '',
      'Final-Recipient: rfc822; alex@northwind.io',
      'Action: failed',
      'Status: 5.1.1',
      '',
      'Final-Recipient: rfc822; stranger@else.com',
      'Action: failed',
      'Status: 5.1.1'
    ].join('\r\n')
    const counts = applyInboundMail(store, conn, [
      mail({ id: 'b1', from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', raw })
    ])
    assert.equal(counts.bounces, 1)
    assert.deepEqual(
      store.db.suppressions.map((s) => [s.orgId, s.value, s.reason]),
      [[null, 'alex@northwind.io', 'bounced']]
    )
  })

  it('polls Gmail history for tracked threads and advances the cursor', async () => {
    const conn = mailbox('gmail')
    const c = contact()
    const store = memoryStore(migrateDatabase({ connections: [conn], contacts: [c], messages: [sentMessage(conn, 't1', c)] }))
    const { fetcher, calls } = fakeFetch([
      [
        /GET .*\/history\?/,
        () =>
          json({
            historyId: '250',
            history: [
              { messagesAdded: [{ message: { id: 'mine', threadId: 't1', labelIds: ['SENT'] } }] },
              { messagesAdded: [{ message: { id: 'in1', threadId: 't1', labelIds: ['INBOX'] } }] },
              { messagesAdded: [{ message: { id: 'news', threadId: 'other', labelIds: ['INBOX'] } }] }
            ]
          })
      ],
      [
        /GET .*\/messages\/in1\?format=metadata/,
        () =>
          json({
            snippet: 'Sounds good',
            payload: { headers: [{ name: 'From', value: 'alex@northwind.io' }, { name: 'Subject', value: 'Re: Hi' }] }
          })
      ]
    ])
    const totals = await pollMailboxReplies(store, testConfig(), fetcher)
    assert.equal(totals.replies, 1)
    assert.equal(store.db.connections[0].meta.cursor, '250')
    assert.match(calls[0].url, /startHistoryId=100/)
    assert.equal(calls.filter((c) => c.url.includes('/messages/')).length, 1, 'only fetches tracked inbound messages')
  })

  it('restarts from the current history id when the Gmail cursor has expired', async () => {
    const conn = mailbox('gmail')
    const c = contact()
    const store = memoryStore(migrateDatabase({ connections: [conn], contacts: [c], messages: [sentMessage(conn, 't1', c)] }))
    const { fetcher } = fakeFetch([
      [/\/history\?/, () => json({ error: { code: 404 } }, 404)],
      [/\/profile$/, () => json({ emailAddress: 'rep@acme.com', historyId: '999' })]
    ])
    await pollMailboxReplies(store, testConfig(), fetcher)
    assert.equal(store.db.connections[0].meta.cursor, '999')
  })

  it('polls the Outlook inbox by received time', async () => {
    const conn = mailbox('outlook', { meta: { email: 'rep@acme.com', cursor: '2026-10-01T00:00:00Z' } })
    const c = contact()
    const store = memoryStore(
      migrateDatabase({ connections: [conn], contacts: [c], messages: [sentMessage(conn, 'conv1', c)] })
    )
    const { fetcher, calls } = fakeFetch([
      [
        /mailFolders\/inbox\/messages/,
        () =>
          json({
            value: [
              {
                id: 'o1',
                conversationId: 'conv1',
                from: { emailAddress: { address: 'alex@northwind.io', name: 'Alex' } },
                subject: 'RE: Hi',
                bodyPreview: 'Yes',
                receivedDateTime: '2026-10-02T10:00:00Z'
              }
            ]
          })
      ]
    ])
    const totals = await pollMailboxReplies(store, testConfig(), fetcher)
    assert.equal(totals.replies, 1)
    assert.match(decodeURIComponent(calls[0].url), /receivedDateTime gt 2026-10-01T00:00:00Z/)
    assert.equal(store.db.connections[0].meta.cursor, '2026-10-02T10:00:00Z')
  })
})
