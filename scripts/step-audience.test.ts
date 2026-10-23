import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { updatePublicSequence } from '../src/server/publicApi.ts'
import type { DataStore } from '../src/server/store.ts'
import type { Contact, Database, Message, Project, SequenceStep } from '../src/server/types.ts'
import { buildWorkspaceTasks } from '../src/server/workspaceTasks.ts'
import { motionComplete, nextChannel } from '../src/shared/workspaceSpec.ts'

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

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'andrew',
    orgId: 'org_1',
    projectId: 'proj_1',
    name: 'Andrew Suh',
    company: 'Acme',
    title: 'AE',
    email: 'andrew@acme.test',
    phone: '',
    city: '',
    status: 'active',
    stepIndex: 0,
    notes: '',
    createdAt: 1,
    updatedAt: 1,
    attrs: { _enrolledAt: 1_000 },
    ...overrides
  }
}

function project(): Project {
  return {
    id: 'proj_1',
    orgId: 'org_1',
    name: 'AE sequence',
    kind: 'cadence',
    prompt: 'email then call',
    segment: 'AEs',
    team: '',
    description: '',
    answers: { goal: 'Book a meeting' },
    spec: {
      goal: 'Book a meeting',
      segment: 'AEs',
      primarySurface: 'sequence',
      channels: ['email', 'call'],
      kind: 'cadence',
      steps: [
        { day: 0, channel: 'email', label: 'Intro', subject: 'Hi', body: 'Hello' },
        { day: 2, channel: 'call', label: 'Call' }
      ]
    },
    createdAt: 1,
    updatedAt: 1
  }
}

describe('a step can belong to specific contacts', () => {
  const spec = project().spec!

  it('leaves a limited call off everyone else, including people with no phone', () => {
    const andrew = contact()
    const tara = contact({
      id: 'tara',
      name: 'Tara Debek',
      email: 'tara@acme.test',
      phone: '+15551230000'
    })
    const tasks = buildWorkspaceTasks({
      contacts: [andrew, tara],
      steps: [
        { id: 'email', day: 0, channel: 'email', label: 'Intro', order: 0, mode: 'manual' },
        { id: 'call', day: 2, channel: 'call', label: 'Call', order: 1, mode: 'manual', contactIds: ['tara'] }
      ],
      messages: [],
      calls: [],
      now: Date.now()
    })
    const andrewTasks = tasks.filter((task) => task.contactId === 'andrew')
    const taraCall = tasks.find((task) => task.contactId === 'tara' && task.channel === 'call')
    assert.deepEqual(andrewTasks.map((task) => task.channel), ['email'])
    assert.equal(taraCall?.state, 'due')
    assert.equal(taraCall?.reason, undefined)
    assert.equal(
      nextChannel(andrew, {
        ...spec,
        steps: [
          spec.steps[0]!,
          { ...spec.steps[1]!, contactIds: ['tara'] }
        ]
      }),
      'email'
    )
    assert.equal(
      motionComplete({ ...andrew, channelsDone: ['email'] }, {
        ...spec,
        steps: [spec.steps[0]!, { ...spec.steps[1]!, contactIds: ['tara'] }]
      }),
      true
    )
  })

  it('resolves a name onto the call step and keeps the other steps on everyone', () => {
    const db = emptyDb()
    db.projects.push(project())
    db.sequences.push({
      id: 'seq_1',
      orgId: 'org_1',
      projectId: 'proj_1',
      name: 'Email + Phone · Book a meeting',
      goal: 'Book a meeting',
      createdAt: 1,
      updatedAt: 1
    })
    db.steps.push(
      {
        id: 'step_email',
        orgId: 'org_1',
        sequenceId: 'seq_1',
        projectId: 'proj_1',
        day: 0,
        channel: 'email',
        label: 'Intro',
        subject: 'Hi',
        body: 'Hello',
        order: 0
      } as SequenceStep,
      {
        id: 'step_call',
        orgId: 'org_1',
        sequenceId: 'seq_1',
        projectId: 'proj_1',
        day: 2,
        channel: 'call',
        label: 'Call',
        order: 1
      } as SequenceStep
    )
    db.contacts.push(
      contact(),
      contact({ id: 'tara', name: 'Tara Debek', email: 'tara@acme.test', phone: '+15551230000' })
    )
    const andrewDraft = {
      id: 'msg_andrew',
      orgId: 'org_1',
      projectId: 'proj_1',
      contactId: 'andrew',
      subject: 'Hi',
      body: 'Hello',
      status: 'draft',
      channel: 'email',
      mode: 'demo',
      stepId: 'step_email',
      createdAt: 1,
      updatedAt: 1
    } as Message
    db.messages.push(andrewDraft)

    const updated = updatePublicSequence(memoryStore(db), 'org_1', 'proj_1', {
      steps: [
        { day: 0, channel: 'email', label: 'Intro', subject: 'Hi', body: 'Hello' },
        { day: 2, channel: 'call', label: 'Call', contactIds: ['Tara'] }
      ]
    })
    assert.equal(updated.ok, true)
    if (!updated.ok) return
    const call = db.steps.find((step) => step.id === 'step_call')
    assert.deepEqual(call?.contactIds, ['tara'])
    assert.equal(db.steps.find((step) => step.id === 'step_email')?.contactIds, undefined)
    assert.equal(andrewDraft.status, 'draft')

    const tasks = buildWorkspaceTasks({
      contacts: db.contacts,
      steps: updated.sequence.steps.filter((step) => step != null),
      messages: [],
      calls: [],
      now: Date.now()
    })
    assert.equal(tasks.some((task) => task.contactId === 'andrew' && task.channel === 'call'), false)
    assert.equal(tasks.some((task) => task.contactId === 'tara' && task.channel === 'call'), true)
  })

  it('keeps the audience when a later edit does not mention it', () => {
    const db = emptyDb()
    db.projects.push(project())
    db.sequences.push({
      id: 'seq_1',
      orgId: 'org_1',
      projectId: 'proj_1',
      name: 'Email + Phone · Book a meeting',
      goal: 'Book a meeting',
      createdAt: 1,
      updatedAt: 1
    })
    db.steps.push({
      id: 'step_call',
      orgId: 'org_1',
      sequenceId: 'seq_1',
      projectId: 'proj_1',
      day: 2,
      channel: 'call',
      label: 'Call',
      contactIds: ['tara'],
      order: 0
    } as SequenceStep)
    db.contacts.push(contact({ id: 'tara', name: 'Tara Debek', email: 'tara@acme.test', phone: '+15551230000' }))
    const updated = updatePublicSequence(memoryStore(db), 'org_1', 'proj_1', {
      steps: [{ day: 2, channel: 'call', label: 'Call Tara', body: 'Talk track' }]
    })
    assert.equal(updated.ok, true)
    assert.deepEqual(db.steps[0]?.contactIds, ['tara'])
    assert.equal(db.projects[0]?.spec?.steps[0]?.contactIds?.[0], 'tara')
  })

  it('cancels an open email for someone taken off the step, and restores it when the step is for everyone again', () => {
    const db = emptyDb()
    db.projects.push(project())
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
      id: 'step_email',
      orgId: 'org_1',
      sequenceId: 'seq_1',
      projectId: 'proj_1',
      day: 0,
      channel: 'email',
      label: 'Intro',
      subject: 'Hi',
      body: 'Hello',
      order: 0
    } as SequenceStep)
    db.contacts.push(
      contact(),
      contact({ id: 'tara', name: 'Tara Debek', email: 'tara@acme.test', phone: '+15551230000' })
    )
    const andrewDraft = {
      id: 'msg_andrew',
      orgId: 'org_1',
      projectId: 'proj_1',
      contactId: 'andrew',
      subject: 'Hi',
      body: 'Hello',
      status: 'draft',
      channel: 'email',
      mode: 'demo',
      stepId: 'step_email',
      createdAt: 1,
      updatedAt: 1
    } as Message
    db.messages.push(andrewDraft)

    const limited = updatePublicSequence(memoryStore(db), 'org_1', 'proj_1', {
      steps: [{ day: 0, channel: 'email', label: 'Intro', subject: 'Hi', body: 'Hello', contactIds: ['tara'] }]
    })
    assert.equal(limited.ok, true)
    assert.equal(andrewDraft.status, 'cancelled')
    assert.equal(andrewDraft.error, 'Not on this step')

    const everyone = updatePublicSequence(memoryStore(db), 'org_1', 'proj_1', {
      steps: [{ day: 0, channel: 'email', label: 'Intro', subject: 'Hi', body: 'Hello', contactIds: [] }]
    })
    assert.equal(everyone.ok, true)
    assert.equal(db.steps[0]?.contactIds, undefined)
    assert.equal(andrewDraft.status, 'draft')
    assert.equal(andrewDraft.error, undefined)
  })

  it('refuses a name that is not in the workspace', () => {
    const db = emptyDb()
    db.projects.push(project())
    db.sequences.push({
      id: 'seq_1',
      orgId: 'org_1',
      projectId: 'proj_1',
      name: 'Email + Phone · Book a meeting',
      goal: 'Book a meeting',
      createdAt: 1,
      updatedAt: 1
    })
    db.steps.push({
      id: 'step_call',
      orgId: 'org_1',
      sequenceId: 'seq_1',
      projectId: 'proj_1',
      day: 2,
      channel: 'call',
      label: 'Call',
      order: 0
    } as SequenceStep)
    db.contacts.push(contact())
    const updated = updatePublicSequence(memoryStore(db), 'org_1', 'proj_1', {
      steps: [{ day: 2, channel: 'call', label: 'Call', contactIds: ['Tara Debek'] }]
    })
    assert.equal(updated.ok, false)
    if (updated.ok) return
    assert.match(updated.error, /No contact named Tara Debek/)
    assert.equal(db.steps[0]?.contactIds, undefined)
    assert.equal(db.steps[0]?.label, 'Call')
  })

  it('lets the sequence editor add people to a step', () => {
    const html = readFileSync(new URL('../src/server/apps/emailWorkspace.html', import.meta.url), 'utf8')
    const save = html.slice(html.indexOf('async function saveSequence'), html.indexOf('function activeTask'))
    assert.match(save, /contactIds/)
    assert.match(html, /id="add-person"/)
    assert.match(html, /Only these people get this step/)
  })
})
