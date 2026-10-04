import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ServerConfig } from '../src/server/config.ts'
import {
  getEmailWorkspace,
  JARGON_MCP_INSTRUCTIONS,
  withoutDashboard,
  workspaceBrief
} from '../src/server/emailWorkspace.ts'
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

function contact(
  partial: Pick<Contact, 'id' | 'source' | 'email' | 'company' | 'title'> & Partial<Pick<Contact, 'phone' | 'name'>>
): Contact {
  return {
    orgId: 'org_1',
    projectId: 'proj_1',
    name: partial.name ?? partial.email,
    phone: partial.phone ?? '',
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
  it('ranks Railway, import, and HubSpot contacts and drops empty rows', () => {
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
      contact({ id: 'c1', source: 'manual', email: 'ada@acme.com', company: 'Acme', title: 'VP Sales' }),
      contact({ id: 'c2', source: 'postgres', email: 'bo@orbit.com', company: 'Orbit', title: 'CRO' }),
      contact({ id: 'c3', source: 'hubspot', email: 'cy@harbor.com', company: 'Harbor', title: 'Head of Growth' }),
      contact({
        id: 'c4',
        source: 'hubspot',
        name: 'HubSpot contact 4',
        email: '99@unknown.invalid',
        company: 'Unknown company',
        title: 'Contact'
      }),
      contact({ id: 'c5', source: 'seed', email: 'fake@acme.com', company: 'Acme', title: 'VP Sales' })
    )
    const ws = getEmailWorkspace(memoryStore(db), config, 'org_1', 'proj_1')
    assert.ok(ws)
    assert.equal(ws.contacts.length, 3)
    assert.equal(ws.contacts.some((row) => row.id === 'c4' || row.id === 'c5'), false)
    assert.equal(ws.contacts.every((row) => row.priority?.rank), true)
    assert.deepEqual(
      [...ws.contacts].map((row) => row.priority?.rank).sort((a, b) => (a ?? 0) - (b ?? 0)),
      [1, 2, 3]
    )
    assert.deepEqual(
      [...ws.contacts].map((row) => row.priority?.band).sort(),
      ['high', 'low', 'medium']
    )
    const brief = workspaceBrief(ws)
    assert.equal(brief.projectId, 'proj_1')
    assert.equal('contacts' in brief, false)
    assert.equal('messages' in brief, false)
    assert.equal('dashboardUrl' in brief, false)
    assert.equal('dashboardPath' in brief, false)
    assert.ok(JSON.stringify(brief).length < 4000)
  })
})

describe('Claude chat should not link the web workspace', () => {
  it('tells Claude to keep work in chat and send people to the dashboard only for billing, plans, or support', () => {
    assert.equal(/dashboardUrl is the full web tool/i.test(JARGON_MCP_INSTRUCTIONS), false)
    assert.equal(/After success, share dashboardUrl/i.test(JARGON_MCP_INSTRUCTIONS), false)
    assert.match(JARGON_MCP_INSTRUCTIONS, /Never share dashboardUrl/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /create_billing_link/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /jargonlabs\.co\/billing/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /contact support/)
  })

  it('strips web-workspace links from model JSON but keeps billingUrl', () => {
    const stripped = withoutDashboard({
      projectId: 'proj_1',
      dashboardUrl: 'https://jargonlabs.co/tools/proj_1',
      dashboardPath: '/tools/proj_1',
      billingUrl: 'https://jargonlabs.co/billing',
      project: {
        id: 'proj_1',
        dashboardUrl: 'https://jargonlabs.co/tools/proj_1',
        dashboardPath: '/tools/proj_1'
      }
    })
    assert.deepEqual(stripped, {
      projectId: 'proj_1',
      billingUrl: 'https://jargonlabs.co/billing',
      project: { id: 'proj_1' }
    })
  })
})
