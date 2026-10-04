import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/server/config.ts'
import { deliverPublicMessage } from '../src/server/publicApi.ts'
import { runOutboundSchedulerTick } from '../src/server/scheduler.ts'
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

const config = loadConfig()

function fixture(status: Message['status'] = 'queued') {
  const contact: Contact = {
    id: 'ct_1',
    orgId: 'org_a',
    projectId: 'p1',
    name: 'Sam Lee',
    company: 'Acme',
    title: 'VP Sales',
    email: 'sam@acme.test',
    phone: '',
    city: '',
    status: 'queued',
    stepIndex: 0,
    notes: '',
    linkedinUrl: 'https://www.linkedin.com/in/samlee',
    createdAt: 0,
    updatedAt: 0
  }
  const message: Message = {
    id: 'msg_1',
    orgId: 'org_a',
    projectId: 'p1',
    contactId: 'ct_1',
    subject: '',
    body: 'Hi Sam',
    status,
    channel: 'linkedin',
    mode: 'demo',
    sandbox: true,
    sendAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
  return memoryStore(migrateDatabase({ contacts: [contact], messages: [message] }))
}

describe('send idempotency', () => {
  it('two concurrent sends of one message deliver it once', async () => {
    const store = fixture()
    const [a, b] = await Promise.all([
      deliverPublicMessage(store, config, 'org_a', 'msg_1', true),
      deliverPublicMessage(store, config, 'org_a', 'msg_1', true)
    ])
    assert.deepEqual([a.ok, b.ok].sort(), [false, true])
    const loser = a.ok ? b : a
    assert.equal(loser.status, 409)
    assert.equal(store.db.contacts[0].stepIndex, 1, 'step advanced once')
    const again = await deliverPublicMessage(store, config, 'org_a', 'msg_1', true)
    assert.equal(again.status, 409)
  })

  it('a manual send during a scheduler tick does not double-send', async () => {
    const store = fixture()
    const billing = {} as Parameters<typeof runOutboundSchedulerTick>[2]
    const [manual, sent] = await Promise.all([
      deliverPublicMessage(store, config, 'org_a', 'msg_1', true),
      runOutboundSchedulerTick(store, config, billing)
    ])
    assert.equal(Number(manual.ok) + sent, 1)
    assert.equal(store.db.contacts[0].stepIndex, 1)
  })

  it('never sends a cancelled message', async () => {
    const store = fixture('cancelled')
    const res = await deliverPublicMessage(store, config, 'org_a', 'msg_1', true)
    assert.equal(res.status, 409)
    assert.equal(store.db.messages[0].status, 'cancelled')
    assert.equal(store.db.contacts[0].stepIndex, 0)
  })
})
