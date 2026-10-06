import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BillingService } from '../src/server/billing/types.ts'
import type { ServerConfig } from '../src/server/config.ts'
import {
  getEmailWorkspace,
  JARGON_MCP_INSTRUCTIONS,
  withoutDashboard,
  workspaceBrief
} from '../src/server/emailWorkspace.ts'
import { registerJargonTools } from '../src/server/mcpTools.ts'
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

describe('a build opens one workspace', () => {
  it('does not render the template sequence before personalized copy is saved', async () => {
    assert.equal(/After a sequence is created, keep the user in Claude \(show_email_workspace/i.test(JARGON_MCP_INSTRUCTIONS), false)
    assert.match(JARGON_MCP_INSTRUCTIONS, /save_research enrolls everyone and opens the one workspace/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /Do not call show_email_workspace, show_tasks, or get_sequence to preview the template/)

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
    db.contacts.push(contact({ id: 'c1', source: 'manual', email: 'ada@acme.com', company: 'Acme', title: 'VP Sales' }))

    type ToolDef = { description?: string; _meta?: { ui?: { resourceUri?: string }; 'ui/resourceUri'?: string } }
    type Tool = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; _meta?: unknown; isError?: boolean }>
    const defs = new Map<string, ToolDef>()
    const tools = new Map<string, Tool>()
    registerJargonTools(
      {
        registerTool: (name: string, def: ToolDef, handler: Tool) => {
          defs.set(name, def)
          tools.set(name, handler)
        }
      } as unknown as Parameters<typeof registerJargonTools>[0],
      memoryStore(db),
      config,
      { userId: 'user_1', orgId: 'org_1', environment: 'live', via: 'oauth' },
      {} as BillingService
    )

    const opens = (name: string) => {
      const meta = defs.get(name)?._meta
      return Boolean(meta?.ui?.resourceUri || meta?.['ui/resourceUri'])
    }
    for (const name of ['get_sequence', 'resume_workspace', 'deploy_tool', 'import_list', 'start_sequence', 'enroll_hubspot']) {
      assert.equal(opens(name), false, name)
    }
    for (const name of ['save_research', 'show_email_workspace', 'show_tasks']) {
      assert.equal(opens(name), true, name)
    }

    const sequence = await tools.get('get_sequence')!({ projectId: 'proj_1' })
    assert.equal(sequence._meta, undefined)
    assert.equal(sequence.isError, undefined)
    const resumed = await tools.get('resume_workspace')!({})
    assert.equal(resumed._meta, undefined)
    assert.equal(resumed.isError, undefined)
    const brief = JSON.parse(resumed.content[0].text)
    assert.equal(brief.projectId, 'proj_1')
    assert.equal(brief.researchPending, true)
    assert.match(brief.nextAction, /Do not open a workspace/)
  })
})
