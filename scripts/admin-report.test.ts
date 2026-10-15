import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAdminReport } from '../src/server/adminReport.ts'
import { loadConfig } from '../src/server/config.ts'
import { registerJargonTools } from '../src/server/mcpTools.ts'
import type { DataStore } from '../src/server/store.ts'
import type { BillingService } from '../src/server/billing/types.ts'
import type { CallSession, Contact, Database, Message, Project, User } from '../src/server/types.ts'

const NOW = Date.UTC(2026, 9, 14)
const IN_QUARTER = Date.UTC(2026, 8, 15)
const OUTSIDE = Date.UTC(2026, 9, 2)

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
    poolAssignments: [],
    mcpOAuthClients: [],
    mcpAuthCodes: [],
    mcpAccessTokens: [],
    suppressions: [],
    hubspotOutbox: []
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

function user(id: string, name: string): User {
  return { id, email: `${id}@northwind.test`, name, createdAt: 1, updatedAt: 1 }
}

function project(id: string, name: string): Project {
  return {
    id,
    orgId: 'org_1',
    name,
    kind: 'sequencer',
    prompt: '',
    segment: '',
    team: '',
    description: '',
    answers: {},
    createdAt: 1,
    updatedAt: 1
  }
}

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'ct_1',
    orgId: 'org_1',
    projectId: 'proj_gtm',
    name: 'Alex Chen',
    company: 'Northwind',
    title: 'GTM',
    email: 'alex@northwind.test',
    phone: '',
    city: '',
    status: 'meeting_booked',
    stepIndex: 1,
    notes: '',
    createdAt: 1,
    updatedAt: IN_QUARTER,
    ...overrides
  }
}

describe('admin report', () => {
  it('uses the previous calendar quarter for last quarter', () => {
    const db = emptyDb()
    db.orgs.push({ id: 'org_1', name: 'Northwind', slug: 'northwind', createdAt: 1, updatedAt: 1 })
    db.users.push(user('user_maya', 'Maya Chen'))
    db.projects.push(project('proj_gtm', 'GTM Engineers · US'))
    db.messages.push({
      id: 'msg_in',
      orgId: 'org_1',
      projectId: 'proj_gtm',
      contactId: 'ct_1',
      subject: 'Intro',
      body: 'Hi',
      status: 'sent',
      channel: 'email',
      mode: 'gmail',
      createdAt: IN_QUARTER,
      updatedAt: IN_QUARTER,
      sentAt: IN_QUARTER,
      userId: 'user_maya'
    } satisfies Message)
    db.messages.push({
      id: 'msg_out',
      orgId: 'org_1',
      projectId: 'proj_gtm',
      contactId: 'ct_1',
      subject: 'Later',
      body: 'Hi',
      status: 'sent',
      channel: 'email',
      mode: 'gmail',
      createdAt: OUTSIDE,
      updatedAt: OUTSIDE,
      sentAt: OUTSIDE,
      userId: 'user_maya'
    })
    db.calls.push({
      id: 'call_1',
      orgId: 'org_1',
      projectId: 'proj_gtm',
      contactId: 'ct_1',
      phase: 'completed',
      disposition: 'interested',
      mode: 'plivo',
      startedAt: Date.UTC(2026, 7, 1),
      connectedAt: Date.UTC(2026, 7, 1),
      userId: 'user_maya'
    } satisfies CallSession)
    db.calls.push({
      id: 'call_miss',
      orgId: 'org_1',
      projectId: 'proj_gtm',
      contactId: 'ct_1',
      phase: 'completed',
      disposition: 'no_answer',
      mode: 'plivo',
      startedAt: Date.UTC(2026, 7, 2)
    })
    db.activities.push({
      id: 'act_reply',
      orgId: 'org_1',
      projectId: 'proj_gtm',
      contactId: 'ct_1',
      kind: 'email',
      summary: 'Alex Chen replied: "yes". Sequence stopped',
      createdAt: Date.UTC(2026, 8, 20)
    })
    db.activities.push({
      id: 'act_auto',
      orgId: 'org_1',
      projectId: 'proj_gtm',
      contactId: 'ct_1',
      kind: 'email',
      summary: 'Auto-reply from Alex Chen: out of office',
      createdAt: IN_QUARTER
    })
    db.contacts.push(
      contact({
        meeting: {
          provider: 'gmail',
          eventId: 'evt_1',
          start: '2026-10-20T17:00:00.000Z',
          end: '2026-10-20T17:30:00.000Z',
          title: 'Intro',
          bookedAt: Date.UTC(2026, 8, 18),
          userId: 'user_maya'
        }
      })
    )

    const built = buildAdminReport(memoryStore(db), 'org_1', { range: 'quarter', focus: 'reps' }, NOW)
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.report.rangeLabel, 'Jul 1 – Sep 30, 2026')
    assert.equal(built.report.totals.emails, 1)
    assert.equal(built.report.totals.calls, 2)
    assert.equal(built.report.totals.connects, 1)
    assert.equal(built.report.totals.replies, 1)
    assert.equal(built.report.totals.meetings, 1)
    assert.equal(built.report.reps[0]?.name, 'Maya Chen')
    assert.equal(built.report.reps[0]?.meetings, 1)
    assert.equal(built.report.reps[0]?.replies, 1)
    assert.equal(built.report.reps.find((row) => row.id === 'unassigned')?.calls, 1)
    assert.match(built.report.summary, /Last quarter, Northwind booked 1 meeting/)
    assert.equal(built.report.view, 'admin')
  })

  it('opens from show_admin', async () => {
    const db = emptyDb()
    db.orgs.push({ id: 'org_1', name: 'Northwind', slug: 'northwind', createdAt: 1, updatedAt: 1 })
    type ToolDef = { description?: string; _meta?: { ui?: { resourceUri?: string } } }
    type Tool = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; _meta?: unknown }>
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
      loadConfig(),
      { userId: 'user_1', orgId: 'org_1', environment: 'live', via: 'oauth' },
      {} as BillingService
    )
    const def = defs.get('show_admin')
    assert.match(def?.description || '', /last quarter/)
    assert.ok(def?._meta?.ui?.resourceUri)
    const result = await tools.get('show_admin')!({ range: 'quarter', focus: 'reps' })
    const body = JSON.parse(result.content[0]!.text) as { view: string; summary: string }
    assert.equal(body.view, 'admin')
    assert.match(body.summary, /no outbound activity/)
    assert.ok(result._meta)
  })
})
