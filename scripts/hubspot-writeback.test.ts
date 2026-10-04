import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
const base = loadConfig()
import { encryptJson, decryptJson } from '../src/server/crypto.ts'
import { enqueueHubSpotActivity, flushHubSpotOutbox } from '../src/server/hubspotWriteback.ts'
import { addPublicNote, applyDisposition, completePublicCall } from '../src/server/publicApi.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Contact, Database } from '../src/server/types.ts'

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

const config: ServerConfig = { ...base, hubspot: { ...base.hubspot, clientId: 'hs_client', clientSecret: 'hs_secret' } }

function contact(id: string, source: Contact['source']): Contact {
  return {
    id,
    orgId: 'org_a',
    projectId: 'p1',
    name: 'Ana Ruiz',
    company: 'Acme',
    title: 'VP Sales',
    email: 'ana@acme.test',
    phone: '+15551234567',
    city: '',
    status: 'active',
    stepIndex: 0,
    notes: '',
    source,
    externalId: source === 'hubspot' ? '901' : undefined,
    createdAt: 0,
    updatedAt: 0
  }
}

function fixture(secrets: Record<string, unknown> = { accessToken: 'live-token', refreshToken: 'r1', expiresAt: Date.now() + 3600_000 }, meta: Record<string, string> = {}) {
  return memoryStore(
    migrateDatabase({
      contacts: [contact('ct_hs', 'hubspot'), contact('ct_pg', 'postgres')],
      connections: [
        {
          id: 'conn_hs',
          orgId: 'org_a',
          provider: 'hubspot',
          status: 'connected',
          secretsCipher: encryptJson(secrets),
          meta,
          createdAt: 0,
          updatedAt: 0
        }
      ]
    })
  )
}

type Call = { url: string; body: any; auth?: string }
function fakeHubSpot(respond: (url: string) => { status: number; json?: unknown } = () => ({ status: 201, json: { id: '1' } })) {
  const calls: Call[] = []
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const body = typeof init?.body === 'string' ? (u.includes('/oauth/') ? init.body : JSON.parse(init.body)) : String(init?.body ?? '')
    calls.push({ url: u, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization })
    const r = respond(u)
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status })
  }) as typeof fetch
  return { calls, fetcher }
}

describe('HubSpot writeback', () => {
  it('only queues activity for contacts that came from HubSpot, and respects the off switch', () => {
    const store = fixture()
    assert.equal(enqueueHubSpotActivity(store, store.db.contacts[1], { kind: 'note', body: 'x' }), false)
    assert.equal(enqueueHubSpotActivity(store, store.db.contacts[0], { kind: 'note', body: 'x' }), true)
    const off = fixture(undefined, { writeback: 'off' })
    assert.equal(enqueueHubSpotActivity(off, off.db.contacts[0], { kind: 'note', body: 'x' }), false)
  })

  it('logs notes, dispositions, and live calls; skips demo calls', () => {
    const store = fixture()
    addPublicNote(store, 'ct_hs', 'Asked for pricing')
    applyDisposition(store, 'ct_hs', { status: 'meeting_booked', note: 'Tue 2pm' })
    store.update((db) => {
      db.calls.push({ id: 'call_live', orgId: 'org_a', projectId: 'p1', contactId: 'ct_hs', phase: 'connected', mode: 'plivo', startedAt: Date.now() - 90_000, connectedAt: Date.now() - 60_000 })
      db.calls.push({ id: 'call_demo', orgId: 'org_a', projectId: 'p1', contactId: 'ct_hs', phase: 'connected', mode: 'demo', startedAt: Date.now() })
    })
    completePublicCall(store, 'call_live', 'interested')
    completePublicCall(store, 'call_demo', 'interested')
    completePublicCall(store, 'call_live', 'interested')
    const kinds = store.db.hubspotOutbox.map((i) => i.kind)
    assert.deepEqual(kinds, ['note', 'note', 'call'], 'one call, logged once')
    assert.match(store.db.hubspotOutbox[1].properties.hs_note_body, /meeting booked[\s\S]*Tue 2pm/)
    const call = store.db.hubspotOutbox[2].properties
    assert.equal(call.hs_call_status, 'COMPLETED')
    assert.ok(Number(call.hs_call_duration) >= 59_000)
  })

  it('posts each activity associated to the HubSpot contact and clears the outbox', async () => {
    const store = fixture()
    enqueueHubSpotActivity(store, store.db.contacts[0], { kind: 'email', subject: 'Hi', body: 'Hello Ana' })
    const hs = fakeHubSpot()
    const result = await flushHubSpotOutbox(store, config, hs.fetcher)
    assert.deepEqual(result, { sent: 1, failed: 0 })
    assert.equal(store.db.hubspotOutbox.length, 0)
    assert.match(hs.calls[0].url, /\/crm\/v3\/objects\/emails$/)
    assert.equal(hs.calls[0].auth, 'Bearer live-token')
    assert.equal(hs.calls[0].body.associations[0].to.id, '901')
    assert.equal(hs.calls[0].body.associations[0].types[0].associationTypeId, 198)
    assert.equal(hs.calls[0].body.properties.hs_email_subject, 'Hi')
  })

  it('refreshes an expired token first and saves the new one', async () => {
    const store = fixture({ accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1000 })
    enqueueHubSpotActivity(store, store.db.contacts[0], { kind: 'note', body: 'x' })
    const hs = fakeHubSpot((url) =>
      url.includes('/oauth/v1/token') ? { status: 200, json: { access_token: 'fresh', refresh_token: 'r2', expires_in: 1800 } } : { status: 201 }
    )
    await flushHubSpotOutbox(store, config, hs.fetcher)
    assert.match(hs.calls[0].url, /oauth\/v1\/token/)
    assert.equal(hs.calls[1].auth, 'Bearer fresh')
    const saved = decryptJson<{ accessToken: string; refreshToken: string }>(store.db.connections[0].secretsCipher)
    assert.equal(saved.accessToken, 'fresh')
    assert.equal(saved.refreshToken, 'r2')
  })

  it('backs off on 5xx and flags a missing scope on 403', async () => {
    const store = fixture()
    enqueueHubSpotActivity(store, store.db.contacts[0], { kind: 'note', body: 'x' })
    const down = fakeHubSpot(() => ({ status: 503 }))
    const now = Date.now()
    await flushHubSpotOutbox(store, config, down.fetcher, now)
    assert.equal(store.db.hubspotOutbox.length, 1)
    assert.equal(store.db.hubspotOutbox[0].attempts, 1)
    assert.ok(store.db.hubspotOutbox[0].nextAttemptAt > now)
    assert.equal((await flushHubSpotOutbox(store, config, down.fetcher, now)).sent, 0, 'not retried before the backoff')

    const forbidden = fakeHubSpot(() => ({ status: 403 }))
    await flushHubSpotOutbox(store, config, forbidden.fetcher, now + 24 * 3600_000)
    assert.equal(store.db.hubspotOutbox.length, 0)
    assert.match(store.db.connections[0].meta.writebackError ?? '', /Reconnect HubSpot/)
  })
})
