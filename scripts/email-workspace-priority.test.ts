import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { BillingService } from '../src/server/billing/types.ts'
import type { ServerConfig } from '../src/server/config.ts'
import {
  fitWorkspaceView,
  getEmailWorkspace,
  JARGON_MCP_INSTRUCTIONS,
  jargonMcpInstructions,
  withoutDashboard,
  workspaceBrief
} from '../src/server/emailWorkspace.ts'
import { registerJargonTools } from '../src/server/mcpTools.ts'
import { isExistingSequenceEdit, updatePublicSequence } from '../src/server/publicApi.ts'
import type { DataStore } from '../src/server/store.ts'
import type { Contact, Database, Message, Project, SequenceStep } from '../src/server/types.ts'

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

describe('DNC call override is only for the internal account', () => {
  it('tells Claude to keep the phone on the call step for tara@jargonlabs.co', () => {
    const db = emptyDb()
    db.users.push({
      id: 'user_tara',
      email: 'tara@jargonlabs.co',
      name: 'Tara',
      createdAt: 1,
      updatedAt: 1
    })
    db.memberships.push({
      id: 'mem_tara',
      orgId: 'org_1',
      userId: 'user_tara',
      role: 'owner',
      createdAt: 1
    })
    const store = memoryStore(db)
    const tara = jargonMcpInstructions(store, 'org_1')
    assert.match(tara, /still include a call step/)
    assert.match(tara, /phone number/)
    assert.match(tara, /number is DNC/)
    assert.equal(jargonMcpInstructions(store, 'org_customer'), JARGON_MCP_INSTRUCTIONS)
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
    for (const name of ['get_sequence', 'resume_workspace', 'deploy_tool', 'import_list']) {
      assert.equal(opens(name), false, name)
    }
    for (const name of ['save_research', 'show_email_workspace', 'show_tasks', 'show_admin', 'start_sequence', 'enroll_hubspot']) {
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

  it('gives the app a workspace it can paint without another tool call', async () => {
    assert.match(JARGON_MCP_INSTRUCTIONS, /call show_tasks once/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /scheduled run cannot build or display/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /save_research enrolls everyone and opens the sequence/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /deploy_tool or import_list/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /Do not finish on a text summary alone/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /Do not ask questions and do not wait/)

    const db = emptyDb()
    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'Stalled deal champions',
      kind: 'sequencer',
      prompt: 'email the list',
      segment: '',
      team: '',
      description: '',
      answers: { goal: 'Re-open the stalled deal' },
      createdAt: 1,
      updatedAt: 1
    } as Project)
    db.contacts.push(contact({ id: 'c1', source: 'manual', email: 'ada@acme.com', company: 'Acme', title: 'VP Sales' }))

    type ToolDef = { description?: string; _meta?: { ui?: { resourceUri?: string } } }
    type ToolResult = {
      content: Array<{ text: string }>
      structuredContent?: { projectId?: string; contacts?: unknown[]; tasks?: unknown[] }
      _meta?: unknown
    }
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>()
    registerJargonTools(
      {
        registerTool: (name: string, _def: ToolDef, handler: (args: Record<string, unknown>) => Promise<ToolResult>) => {
          tools.set(name, handler)
        }
      } as unknown as Parameters<typeof registerJargonTools>[0],
      memoryStore(db),
      config,
      { userId: 'user_1', orgId: 'org_1', environment: 'live', via: 'oauth' },
      {} as BillingService
    )

    const shown = await tools.get('show_email_workspace')!({ projectId: 'proj_1' })
    const forModel = JSON.parse(shown.content[0].text)
    assert.equal(forModel.projectId, 'proj_1')
    assert.equal('contacts' in forModel, false)
    assert.equal(Array.isArray(shown.structuredContent?.contacts), true)
    assert.equal(Array.isArray(shown.structuredContent?.tasks), true)
    assert.equal('dashboardUrl' in (shown.structuredContent ?? {}), false)

    const html = readFileSync(new URL('../src/server/apps/emailWorkspace.html', import.meta.url), 'utf8')
    const handler = html.slice(html.indexOf('app.ontoolresult'), html.indexOf('app.onhostcontextchanged'))
    assert.equal(handler.includes('fetchWorkspace'), false)
    assert.match(handler, /display === false/)
    assert.match(handler, /requestTeardown/)
    assert.match(html, /await app\.connect\(\);\s*connected = true/)

    const huge = fitWorkspaceView({
      projectId: 'proj_1',
      contacts: Array.from({ length: 40 }, (_, i) => ({
        id: `c${i}`,
        name: `Person ${i}`,
        preview: { subject: 'Hello', body: 'x'.repeat(8000) }
      })),
      tasks: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, contactId: `c${i}`, body: 'y'.repeat(8000) })),
      messages: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, body: 'z'.repeat(8000) }))
    })
    assert.equal(Array.isArray(huge.contacts), true)
    assert.equal(Array.isArray(huge.tasks), true)
    assert.ok(JSON.stringify(huge).length <= 100_000)
    const hugeIds = new Set((huge.contacts as { id: string }[]).map((contact) => contact.id))
    for (const task of huge.tasks as { contactId: string }[]) {
      assert.equal(hugeIds.has(task.contactId), true)
    }
  })

  it('keeps a contact on every to-do when the workspace view is trimmed', () => {
    const contacts = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      name: `Person ${i}`,
      email: `p${i}@co.com`,
      company: 'Acme',
      title: 'VP',
      attrs: { bio: 'a'.repeat(5000) },
      context: ['c'.repeat(2000)],
      preview: { subject: 'Hi', body: 'p'.repeat(3000) }
    }))
    const tasks = contacts.flatMap((contact, i) => [
      {
        id: `t${i}-now`,
        contactId: contact.id,
        contactName: contact.name,
        state: 'due',
        owner: 'user',
        dueAt: i,
        stepOrder: 0,
        channel: 'linkedin',
        body: 'now '.repeat(400)
      },
      {
        id: `t${i}-later`,
        contactId: contact.id,
        contactName: contact.name,
        state: 'scheduled',
        owner: 'user',
        dueAt: 1000 + i,
        stepOrder: 1,
        channel: 'email',
        body: 'later '.repeat(400)
      }
    ])
    const fitted = fitWorkspaceView(
      { projectId: 'proj_1', contacts, tasks, messages: [], catalog: ['x'.repeat(5000)], calls: ['y'.repeat(5000)] },
      12_000
    )
    const ids = new Set((fitted.contacts as { id: string }[]).map((contact) => contact.id))
    const kept = fitted.tasks as { contactId: string; state: string }[]
    assert.ok(JSON.stringify(fitted).length <= 12_000)
    assert.ok(kept.length > 1)
    assert.ok(ids.size > 1)
    for (const task of kept) assert.equal(ids.has(task.contactId), true, task.contactId)
    assert.equal(ids.has('c0'), true)
    assert.equal(kept.some((task) => task.contactId === 'c0' && task.state === 'due'), true)
  })

  it('opens the sequence when a scheduled enroll starts people who already have copy', async () => {
    const db = emptyDb()
    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'Stalled deal champions',
      kind: 'sequencer',
      prompt: 'email the list',
      segment: '',
      team: '',
      description: '',
      answers: { goal: 'Re-open the stalled deal' },
      createdAt: 1,
      updatedAt: 1
    } as Project)
    db.steps.push({
      id: 'step_1',
      orgId: 'org_1',
      sequenceId: 'seq_1',
      projectId: 'proj_1',
      day: 0,
      channel: 'email',
      label: 'Re-engage',
      subject: 'Hi',
      body: 'Hello',
      order: 0
    } as SequenceStep)
    db.contacts.push({
      ...contact({ id: 'c1', source: 'manual', email: 'ada@acme.com', company: 'Acme', title: 'VP Sales' }),
      enrichedAt: 1
    })

    type ToolResult = {
      content: Array<{ text: string }>
      structuredContent?: { projectId?: string; contacts?: unknown[]; tasks?: unknown[] }
      _meta?: unknown
      isError?: boolean
    }
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>()
    registerJargonTools(
      {
        registerTool: (name: string, _def: unknown, handler: (args: Record<string, unknown>) => Promise<ToolResult>) => {
          tools.set(name, handler)
        }
      } as unknown as Parameters<typeof registerJargonTools>[0],
      memoryStore(db),
      config,
      { userId: 'user_1', orgId: 'org_1', environment: 'live', via: 'oauth' },
      {} as BillingService
    )

    const started = await tools.get('start_sequence')!({
      summary: 'Enroll Ada at Acme',
      projectId: 'proj_1'
    })
    assert.equal(started.isError, undefined)
    const forModel = JSON.parse(started.content[0].text)
    assert.match(forModel.nextAction, /sequence is open/)
    assert.equal(Array.isArray(started.structuredContent?.contacts), true)
    assert.equal(Array.isArray(started.structuredContent?.tasks), true)
    assert.ok(started._meta)

    const early = await tools.get('start_sequence')!({
      summary: 'Enroll the template',
      projectId: 'proj_1',
      contactIds: ['missing']
    })
    db.contacts[0].enrichedAt = undefined
    const pending = await tools.get('start_sequence')!({
      summary: 'Enroll before copy',
      projectId: 'proj_1'
    })
    assert.equal(pending.isError, true)
    assert.equal(pending.structuredContent, undefined)
    assert.equal(early.isError, true)
  })

  it('tells a scheduled run to build the sequence instead of stopping', async () => {
    const db = emptyDb()
    type ToolResult = { content: Array<{ text: string }>; isError?: boolean }
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>()
    registerJargonTools(
      {
        registerTool: (name: string, _def: unknown, handler: (args: Record<string, unknown>) => Promise<ToolResult>) => {
          tools.set(name, handler)
        }
      } as unknown as Parameters<typeof registerJargonTools>[0],
      memoryStore(db),
      config,
      { userId: 'user_1', orgId: 'org_1', environment: 'live', via: 'oauth' },
      {} as BillingService
    )

    const missing = await tools.get('resume_workspace')!({})
    assert.equal(missing.isError, true)
    assert.match(missing.content[0].text, /deploy_tool or import_list/)
    assert.match(missing.content[0].text, /scheduled run/)

    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'Stalled deal champions',
      kind: 'sequencer',
      prompt: 'email the list',
      segment: '',
      team: '',
      description: '',
      answers: { goal: 'Re-open the stalled deal' },
      brief: {
        goal: 'Re-open the stalled deal',
        warmthRule: '',
        summary: 'Stalled deals',
        scheduleChoice: 'accepted',
        unattended: 'accepted'
      },
      createdAt: 1,
      updatedAt: 1
    } as Project)
    db.contacts.push({
      ...contact({ id: 'c1', source: 'hubspot', email: 'ada@acme.com', company: 'Acme', title: 'VP Sales' }),
      enrichedAt: 1
    })
    const resumed = await tools.get('resume_workspace')!({})
    assert.equal(resumed.isError, undefined)
    const brief = JSON.parse(resumed.content[0].text)
    assert.match(brief.nextAction, /enroll_hubspot/)
    assert.match(brief.nextAction, /save_research/)
    assert.equal(/Do not enroll, research/.test(brief.nextAction), false)
  })
})

describe('editing an existing sequence', () => {
  it('treats copy and ladder edits as the current sequence', () => {
    assert.equal(isExistingSequenceEdit('Rewrite the sequence copy so the intro is shorter'), true)
    assert.equal(isExistingSequenceEdit('change the subject on this sequence'), true)
    assert.equal(isExistingSequenceEdit('Build an outbound dialer for GTM Engineers in the US'), false)
    assert.equal(isExistingSequenceEdit('Create another sequence for west coast AEs'), false)
  })

  it('refuses to deploy a second sequence when the user is editing one', async () => {
    const db = emptyDb()
    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'AE sequence',
      kind: 'sequencer',
      prompt: 'email the list',
      segment: '',
      team: '',
      description: '',
      answers: { goal: 'Book a meeting' },
      createdAt: 1,
      updatedAt: 1
    } as Project)
    type Tool = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
    const tools = new Map<string, Tool>()
    registerJargonTools(
      {
        registerTool: (name: string, _def: unknown, handler: Tool) => {
          tools.set(name, handler)
        }
      } as unknown as Parameters<typeof registerJargonTools>[0],
      memoryStore(db),
      config,
      { userId: 'user_1', orgId: 'org_1', environment: 'live', via: 'oauth' },
      {} as BillingService
    )
    const result = await tools.get('deploy_tool')!({
      summary: 'Rewrite the sequence copy',
      workspace: 'Rewrite the sequence copy so the intro email is shorter'
    })
    assert.equal(result.isError, true)
    assert.match(result.content[0]!.text, /Do not create a new sequence/)
    assert.match(result.content[0]!.text, /proj_1/)
    assert.match(result.content[0]!.text, /update_sequence/)
    assert.equal(db.projects.length, 1)
    assert.equal(db.projects[0]!.id, 'proj_1')
  })

  it('writes edited copy onto the same steps and template drafts', () => {
    const db = emptyDb()
    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'AE sequence',
      kind: 'sequencer',
      prompt: 'email the list',
      segment: 'AEs',
      team: '',
      description: '',
      answers: { goal: 'Book a meeting' },
      spec: {
        goal: 'Book a meeting',
        segment: 'AEs',
        primarySurface: 'sequence',
        channels: ['email'],
        kind: 'sequencer',
        steps: [{ day: 0, channel: 'email', label: 'Intro', subject: 'Old subject', body: 'Old body' }]
      },
      createdAt: 1,
      updatedAt: 1
    } as Project)
    db.sequences.push({
      id: 'seq_1',
      orgId: 'org_1',
      projectId: 'proj_1',
      name: 'Email · Book a meeting',
      goal: 'Book a meeting',
      createdAt: 1,
      updatedAt: 1
    })
    db.steps.push({
      id: 'step_1',
      orgId: 'org_1',
      sequenceId: 'seq_1',
      projectId: 'proj_1',
      day: 0,
      channel: 'email',
      label: 'Intro',
      subject: 'Old subject',
      body: 'Old body',
      order: 0
    } as SequenceStep)
    const draft = {
      id: 'msg_template',
      orgId: 'org_1',
      projectId: 'proj_1',
      contactId: 'c1',
      subject: 'Old subject',
      body: 'Old body',
      status: 'draft',
      channel: 'email',
      mode: 'demo',
      stepId: 'step_1',
      createdAt: 1,
      updatedAt: 1
    } as Message
    const personal = {
      ...draft,
      id: 'msg_personal',
      contactId: 'c2',
      subject: 'Ada, saw the round',
      body: 'Personal note for Ada'
    } as Message
    db.messages.push(draft, personal)

    const updated = updatePublicSequence(memoryStore(db), 'org_1', 'proj_1', {
      steps: [
        {
          day: 0,
          channel: 'email',
          label: 'Intro',
          subject: 'Shorter subject',
          body: 'The rewritten intro.'
        }
      ]
    })
    assert.equal(updated.ok, true)
    assert.equal(db.projects.length, 1)
    assert.equal(db.sequences.length, 1)
    assert.equal(db.sequences[0]!.id, 'seq_1')
    assert.equal(db.steps.length, 1)
    assert.equal(db.steps[0]!.id, 'step_1')
    assert.equal(db.steps[0]!.subject, 'Shorter subject')
    assert.equal(db.steps[0]!.body, 'The rewritten intro.')
    assert.equal(db.messages.find((m) => m.id === 'msg_template')!.body, 'The rewritten intro.')
    assert.equal(db.messages.find((m) => m.id === 'msg_personal')!.body, 'Personal note for Ada')
  })

  it('saves sequence-editor copy onto the steps', () => {
    const html = readFileSync(new URL('../src/server/apps/emailWorkspace.html', import.meta.url), 'utf8')
    const save = html.slice(html.indexOf('async function saveSequence'), html.indexOf('function activeTask'))
    assert.match(save, /copyChanged/)
    assert.match(save, /subject: nextSubject/)
    assert.match(save, /body: nextBody/)
    assert.equal(/body: original\.body/.test(save), false)
  })
})
