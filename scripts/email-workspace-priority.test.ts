import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ServerConfig } from '../src/server/config.ts'
import { getEmailWorkspace } from '../src/server/emailWorkspace.ts'
import type { DataStore } from '../src/server/store.ts'
import type { Contact, Database, Project } from '../src/server/types.ts'

function emptyDb(): Database {
  return {
    users: [],
    orgs: [],
    memberships: [],
    sessions: [],
    apiKeys: [],
    subscriptions: [],
    orgBilling: [],
    creditWallets: [],
    creditLots: [],
    creditLedger: [],
    usageDaily: [],
    connections: [],
    oauthStates: [],
    projects: [],
    campaigns: [],
    sequences: [],
    steps: [],
    contacts: [],
    calls: [],
    messages: [],
    activities: [],
    shareLinks: [],
    previewComments: [],
    idempotencyRecords: [],
    rateWindows: [],
    mcpOAuthClients: [],
    mcpAuthCodes: [],
    mcpAccessTokens: []
  }
}

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

const config = {
  appUrl: 'https://jargonlabs.co',
  google: { clientId: '', clientSecret: '', refreshToken: '' },
  outboundPools: { emailMailboxes: [], voiceEndpoints: [] },
  heyreach: { apiKey: '' },
  plivo: { authId: '', authToken: '' }
} as ServerConfig

function contact(partial: Pick<Contact, 'id' | 'source' | 'email' | 'company' | 'title'>): Contact {
  return {
    orgId: 'org_1',
    projectId: 'proj_1',
    name: partial.email,
    phone: '',
    city: '',
    status: 'queued',
    stepIndex: 0,
    notes: '',
    createdAt: 1,
    updatedAt: 1,
    ...partial
  }
}

describe('workspace priority', () => {
  it('ranks seed, postgres, and HubSpot contacts together', () => {
    const db = emptyDb()
    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'Outbound',
      kind: 'sequencer',
      prompt: 'email the list',
      segment: '',
      team: '',
      description: '',
      answers: { goal: 'Book a meeting' },
      createdAt: 1,
      updatedAt: 1
    } as Project)
    db.contacts.push(
      contact({ id: 'c1', source: 'seed', email: 'ada@acme.com', company: 'Acme', title: 'VP Sales' }),
      contact({ id: 'c2', source: 'postgres', email: 'bo@orbit.com', company: 'Orbit', title: 'CRO' }),
      contact({ id: 'c3', source: 'hubspot', email: 'cy@harbor.com', company: 'Harbor', title: 'Head of Growth' })
    )
    const ws = getEmailWorkspace(memoryStore(db), config, 'org_1', 'proj_1')
    assert.ok(ws)
    assert.equal(ws.contacts.length, 3)
    assert.equal(ws.contacts.every((row) => row.priority?.rank), true)
    assert.deepEqual(
      [...ws.contacts].map((row) => row.priority?.rank).sort((a, b) => (a ?? 0) - (b ?? 0)),
      [1, 2, 3]
    )
    assert.deepEqual(
      [...ws.contacts].map((row) => row.priority?.band).sort(),
      ['high', 'low', 'medium']
    )
  })
})
