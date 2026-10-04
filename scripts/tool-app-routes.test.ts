import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import { createApi } from '../src/server/index.ts'
import { loadConfig } from '../src/server/config.ts'
import { createSession, provisionWorkspace } from '../src/server/auth.ts'
import { uid } from '../src/server/crypto.ts'
import { seedProject } from '../src/server/seed.ts'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec.ts'
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

function person(orgId: string, name: string, status: Contact['status']): Contact {
  return {
    id: uid('ct'),
    orgId,
    projectId: '',
    name,
    company: 'Acme',
    title: 'VP Sales',
    email: `${name.toLowerCase()}@acme.test`,
    phone: '+15557654321',
    city: '',
    status,
    stepIndex: 0,
    notes: '',
    createdAt: 0,
    updatedAt: 0
  }
}

describe('tool app (session) routes', () => {
  const store = memoryStore(migrateDatabase({}))
  let server: Server
  let baseUrl = ''
  let token = ''
  let replied: Contact
  let open: Contact
  let callId = ''

  before(async () => {
    const ws = provisionWorkspace(store, { email: 'rep@acme.test', name: 'Rep', orgName: 'Acme', supabaseUserId: 'sb_rep' })
    token = createSession(store, ws.user.id, ws.org.id).token
    replied = person(ws.org.id, 'Rita', 'replied')
    open = person(ws.org.id, 'Omar', 'queued')
    store.update((db) => {
      const project = seedProject(db, {
        orgId: ws.org.id,
        prompt: 'Build an outbound dialer',
        kind: 'dialer',
        answers: {},
        contacts: [replied, open],
        spec: compileWorkspaceSpec('Build an outbound dialer')
      })
      db.messages.push({
        id: 'msg_follow_up',
        orgId: ws.org.id,
        projectId: project.id,
        contactId: open.id,
        subject: 'Following up',
        body: 'Hi Omar',
        status: 'queued',
        stepId: 'step_2',
        channel: 'email',
        mode: 'demo',
        sendAt: Date.now() + 86_400_000,
        createdAt: 0,
        updatedAt: 0
      })
      callId = uid('call')
      db.calls.push({ id: callId, orgId: ws.org.id, projectId: project.id, contactId: open.id, phase: 'connected', mode: 'demo', startedAt: Date.now() })
    })
    const app = await createApi(store, loadConfig())
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })

  after(() => server?.close())

  function call(method: string, path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  it('selecting a contact does not erase their outcome', async () => {
    const res = await call('PATCH', `/contacts/${replied.id}`, { status: 'active' })
    assert.equal(res.status, 200)
    assert.equal(store.db.contacts.find((c) => c.id === replied.id)!.status, 'replied')
  })

  it('an outcome set through PATCH cancels queued follow-ups', async () => {
    const res = await call('PATCH', `/contacts/${open.id}`, { status: 'not_interested' })
    assert.equal(res.status, 200)
    assert.equal(store.db.contacts.find((c) => c.id === open.id)!.status, 'not_interested')
    assert.equal(store.db.messages.find((m) => m.id === 'msg_follow_up')!.status, 'cancelled')
  })

  it('rejects unknown dispositions and channels', async () => {
    assert.equal((await call('POST', `/calls/${callId}/complete`, { disposition: 'whatever' })).status, 400)
    assert.equal((await call('POST', `/contacts/${open.id}/messages`, { body: 'x', channel: 'sms' })).status, 400)
  })
})
