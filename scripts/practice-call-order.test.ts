import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/server/config.ts'
import { deployPublicTool } from '../src/server/publicApi.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import { buildWorkspaceTasks } from '../src/server/workspaceTasks.ts'
import { readCallWindow } from '../src/shared/callWindow.ts'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec.ts'
import { VETERINARY_PRACTICES } from '../src/shared/veterinaryPractices.ts'

const PROMPT =
  'build an phone heavy outbound sequencer for this list of vet offices. determine the best time of day to call the prospect and sort them from first to last'

function memoryStore(db: ReturnType<typeof migrateDatabase>): DataStore {
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

describe('phone-heavy practice call order', () => {
  it('compiles a call-first sequence for veterinary practices', () => {
    const spec = compileWorkspaceSpec(PROMPT)
    assert.equal(spec.segment, 'Vet offices')
    assert.deepEqual(
      spec.steps.map((step) => `${step.day}:${step.channel}`),
      ['0:call', '2:call', '5:email']
    )
  })

  it('loads the practices, reads their hours, and orders the next call first', async () => {
    const db = migrateDatabase({})
    const store = memoryStore(db)
    const deployed = await deployPublicTool(store, loadConfig(), 'org_1', PROMPT)
    assert.equal(deployed.ok, true)
    if (!deployed.ok) return
    assert.equal(deployed.body.contactCount, VETERINARY_PRACTICES.length)
    assert.match(deployed.body.nextAction || '', /show_tasks/)
    assert.equal(deployed.body.researchPending, undefined)
    assert.equal(deployed.body.people?.length, VETERINARY_PRACTICES.length)

    for (const practice of VETERINARY_PRACTICES) {
      const contact = db.contacts.find((row) => row.company === practice.company)
      assert.ok(contact, practice.company)
      assert.ok(contact.phone)
      assert.equal(contact.companyIndustry, 'Veterinary')
      assert.equal(contact.enrichedAt != null, true)
      const window = readCallWindow(contact.attrs)
      assert.equal(window?.startLocal, practice.startLocal)
      assert.equal(window?.timezone, practice.timezone)
      assert.match(window?.reason || '', /slowest/i)
      const email = db.messages.find((message) => message.contactId === contact.id && message.channel === 'email')
      assert.match(email?.subject || '', /Software for/)
      assert.match(email?.body || '', /scheduling, medical records, and client follow-up/)
      assert.match(email?.body || '', new RegExp(practice.company))
      assert.equal(/I called for/.test(email?.body || ''), false)
      assert.equal(/\{\{first_name\}\}/.test(email?.body || ''), false)
    }

    const project = db.projects[0]
    assert.ok(project)
    const steps = db.steps
      .filter((step) => db.sequences.some((sequence) => sequence.id === step.sequenceId && sequence.projectId === project.id))
      .sort((a, b) => a.day - b.day || a.order - b.order)
    const tasks = buildWorkspaceTasks({
      contacts: db.contacts.map((row) => ({ ...row })),
      steps: steps.map((step, order) => ({ ...step, order })),
      messages: db.messages.map((message) => ({ ...message })),
      calls: [],
      now: Date.parse('2026-11-06T22:00:00.000Z')
    })
    const firstCalls = tasks.filter((task) => task.channel === 'call' && task.day === 0).map((task) => task.contactName)
    assert.equal(firstCalls[0], 'Hannah Brooks')
    assert.ok(firstCalls.indexOf('Noah Patel') < firstCalls.indexOf('Lena Cho'))
    assert.ok(firstCalls.indexOf('Elena Voss') < firstCalls.indexOf('Lena Cho'))
    assert.equal(/mock|demo|fixture|seed/i.test(JSON.stringify(deployed.body.people)), false)
  })
})
