import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addSuppression,
  addSuppressions,
  callBlockReason,
  doNotCallNote,
  findSuppression,
  readUnsubscribeToken,
  unsubscribeUrl
} from '../src/server/compliance.ts'
import { parseHardBounces } from '../src/server/bounces.ts'
import { prospectsToContacts } from '../src/server/providers/prospects.ts'
import { buildGmailRawMime } from '../src/server/providers/gmail.ts'
import { deliverPublicMessage, sendPublicMessage } from '../src/server/publicApi.ts'
import { loadConfig } from '../src/server/config.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Contact, Database, Message } from '../src/server/types.ts'

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

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'ct_1',
    orgId: 'org_a',
    projectId: 'p1',
    name: 'Alex Rivera',
    company: 'Northwind',
    title: 'VP Sales',
    email: 'Alex@Northwind.io',
    phone: '(415) 555-0100',
    city: 'SF',
    status: 'queued',
    stepIndex: 0,
    notes: '',
    linkedinUrl: 'https://www.linkedin.com/in/alexrivera/',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function queued(id: string, channel: Message['channel'], c: Contact): Message {
  return {
    id,
    orgId: c.orgId,
    projectId: c.projectId,
    contactId: c.id,
    subject: 'Hi',
    body: 'Hello',
    status: 'queued',
    channel,
    mode: 'demo',
    createdAt: 0,
    updatedAt: 0,
    sendAt: 0
  } as Message
}

describe('prospect context', () => {
  it('non-HubSpot contacts get only real facts, never invented tenure, funding, or hiring', () => {
    const [c] = prospectsToContacts(
      'org_a',
      'p1',
      [
        {
          externalId: 'row_1',
          name: 'Sam Lee',
          company: 'Acme',
          title: 'VP Sales',
          email: 'sam@acme.com',
          phone: '',
          city: 'Denver',
          accountName: 'Acme',
          companySize: '120'
        }
      ],
      'postgres'
    )
    assert.deepEqual(c.context, ['VP Sales at Acme', '120 employees', 'Denver'])
  })
})

describe('suppression list', () => {
  it('blocks by email, domain, phone, and LinkedIn, normalized', () => {
    const store = memoryStore(migrateDatabase({}))
    const c = contact()
    addSuppression(store, { orgId: 'org_a', kind: 'email', value: ' alex@northwind.IO ', reason: 'unsubscribed' })
    assert.equal(findSuppression(store.db, 'org_a', 'email', c)?.reason, 'unsubscribed')
    assert.equal(findSuppression(store.db, 'org_a', 'call', c), undefined)

    addSuppression(store, { orgId: 'org_a', kind: 'phone', value: '+1 415 555 0100', reason: 'do_not_call' })
    assert.equal(findSuppression(store.db, 'org_a', 'call', c)?.reason, 'do_not_call')

    addSuppression(store, { orgId: 'org_a', kind: 'linkedin', value: 'linkedin.com/in/alexrivera', reason: 'manual' })
    assert.equal(findSuppression(store.db, 'org_a', 'linkedin', c)?.reason, 'manual')

    const other = contact({ email: 'sam@blocked.com' })
    addSuppression(store, { orgId: 'org_a', kind: 'domain', value: '@Blocked.com', reason: 'manual' })
    assert.equal(findSuppression(store.db, 'org_a', 'email', other)?.kind, 'domain')
  })

  it('keeps org suppressions inside the org, global ones apply everywhere', () => {
    const store = memoryStore(migrateDatabase({}))
    addSuppression(store, { orgId: 'org_a', kind: 'email', value: 'alex@northwind.io', reason: 'unsubscribed' })
    assert.equal(findSuppression(store.db, 'org_b', 'email', contact({ orgId: 'org_b' })), undefined)
    addSuppression(store, { orgId: null, kind: 'email', value: 'alex@northwind.io', reason: 'bounced' })
    assert.equal(findSuppression(store.db, 'org_b', 'email', contact({ orgId: 'org_b' }))?.reason, 'bounced')
  })

  it('treats a CRM opt-out as unsubscribed for email only', () => {
    const store = memoryStore(migrateDatabase({}))
    const c = contact({ attrs: { email_opt_out: true } })
    assert.equal(findSuppression(store.db, 'org_a', 'email', c)?.reason, 'unsubscribed')
    assert.equal(findSuppression(store.db, 'org_a', 'linkedin', c), undefined)
  })

  it('cancels queued messages on that channel and dedupes', () => {
    const c = contact()
    const db = migrateDatabase({ contacts: [c], messages: [queued('m1', 'email', c), queued('m2', 'linkedin', c)] })
    const store = memoryStore(db)
    const rows = addSuppressions(store, [
      { orgId: 'org_a', kind: 'email', value: 'alex@northwind.io', reason: 'unsubscribed' },
      { orgId: 'org_a', kind: 'email', value: 'ALEX@northwind.io', reason: 'unsubscribed' },
      { orgId: 'org_a', kind: 'email', value: 'not-an-email', reason: 'unsubscribed' }
    ])
    assert.equal(rows.length, 2)
    assert.equal(store.db.suppressions.length, 1)
    assert.equal(store.db.messages.find((m) => m.id === 'm1')?.status, 'cancelled')
    assert.equal(store.db.messages.find((m) => m.id === 'm2')?.status, 'queued')
  })
})

describe('send paths respect suppression', () => {
  const config = loadConfig()

  it('refuses a new send to a suppressed address without creating a message', async () => {
    const c = contact()
    const store = memoryStore(migrateDatabase({ contacts: [c] }))
    addSuppression(store, { orgId: 'org_a', kind: 'email', value: c.email, reason: 'unsubscribed' })
    const result = await sendPublicMessage(store, config, c, { subject: 'x', body: 'y', status: 'sent' })
    assert.equal(result.ok, false)
    assert.equal(result.status, 409)
    assert.equal(store.db.messages.length, 0)
  })

  it('cancels a queued message at delivery time', async () => {
    const c = contact()
    const store = memoryStore(migrateDatabase({ contacts: [c], messages: [queued('m1', 'email', c)] }))
    store.db.suppressions.push({
      id: 's1',
      orgId: null,
      kind: 'email',
      value: 'alex@northwind.io',
      reason: 'bounced',
      createdAt: 0
    })
    const result = await deliverPublicMessage(store, config, 'org_a', 'm1')
    assert.equal(result.ok, false)
    assert.equal(result.status, 409)
    assert.equal(store.db.messages[0].status, 'cancelled')
    assert.equal(store.db.messages[0].error, 'Address bounced')
  })
})

describe('unsubscribe links', () => {
  const config = { publicUrl: 'https://api.jargonlabs.co' }

  it('round-trips the org and email and rejects tampering', () => {
    const url = unsubscribeUrl(config, 'org_a', 'Alex@Northwind.io')
    const token = url.split('/u/')[1]
    assert.deepEqual(readUnsubscribeToken(token), { orgId: 'org_a', email: 'alex@northwind.io' })
    const [body, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ o: 'org_b', e: 'x@y.com' })).toString('base64url')
    assert.equal(readUnsubscribeToken(`${forged}.${mac}`), null)
    assert.equal(readUnsubscribeToken(`${body}.AAAA`), null)
  })

  it('adds RFC 8058 headers and a footer to the MIME message', () => {
    const mime = buildGmailRawMime({
      to: 'alex@northwind.io',
      subject: 'Hi',
      body: 'Hello',
      unsubscribeUrl: 'https://api.jargonlabs.co/u/abc',
      footer: '\n--\nUnsubscribe: https://api.jargonlabs.co/u/abc'
    })
    assert.match(mime, /^List-Unsubscribe: <https:\/\/api\.jargonlabs\.co\/u\/abc>$/m)
    assert.match(mime, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m)
    const plainPart = mime.split('Content-Transfer-Encoding: base64')[1].split('--jargon_alt_001')[0].replace(/\s/g, '')
    assert.match(Buffer.from(plainPart, 'base64').toString('utf8'), /Unsubscribe: https:\/\/api\.jargonlabs\.co\/u\/abc/)
  })
})

describe('pre-dial checks', () => {
  it('allows a call at any hour and blocks only do-not-call', () => {
    const c = contact({ attrs: {} })
    const db = migrateDatabase({})
    assert.equal(callBlockReason(db, c), null)
    db.suppressions.push({ id: 's', orgId: 'org_a', kind: 'phone', value: '+14155550100', reason: 'do_not_call', createdAt: 0 })
    assert.match(callBlockReason(db, c) ?? '', /do-not-call/)
    assert.match(doNotCallNote(db, 'org_a', c) ?? '', /do-not-call/)
    assert.equal(callBlockReason(db, c, { allowDoNotCall: true }), null)
    assert.match(doNotCallNote(db, 'org_a', c) ?? '', /Number is on the do-not-call list/)
  })
})

describe('bounce parsing', () => {
  it('reads Gmail X-Failed-Recipients', () => {
    const raw = 'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nX-Failed-Recipients: Ghost@Example.com\r\n\r\nAddress not found'
    assert.deepEqual(parseHardBounces(raw), ['ghost@example.com'])
  })

  it('takes 5.x.x and ignores 4.x.x delivery-status blocks', () => {
    const raw = [
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; mx.example.com',
      '',
      'Final-Recipient: rfc822; hard@example.com',
      'Action: failed',
      'Status: 5.1.1',
      '',
      'Final-Recipient: rfc822; soft@example.com',
      'Action: delayed',
      'Status: 4.2.2'
    ].join('\n')
    assert.deepEqual(parseHardBounces(raw), ['hard@example.com'])
  })
})
