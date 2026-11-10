import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/server/config.ts'
import { createProjectRecord } from '../src/server/projectCreate.ts'
import { seedProject } from '../src/server/seed.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import { sequenceTitle } from '../src/shared/sequenceTitle.ts'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec.ts'

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

describe('sequence titles', () => {
  it('describes a dialer by the audience, not the tool label alone', () => {
    const prompt = 'Build an outbound dialer for GTM Engineers in the US'
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(sequenceTitle(prompt, spec), 'Outbound calls for GTM engineers in the US')
  })

  it('describes an email sequence', () => {
    const prompt = 'Create an email sequence for Series B founders'
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(sequenceTitle(prompt, spec), 'Email sequence for Series B founders')
  })

  it('describes a multi-channel cadence', () => {
    const prompt = 'Build an outbound cadence for VP Sales'
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(sequenceTitle(prompt, spec), 'Email, call, and LinkedIn cadence for VP sales')
  })

  it('describes the length of a stepped sequence', () => {
    const prompt = 'Build a 7-step sequence over 10 days for VP Sales'
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(
      sequenceTitle(prompt, spec),
      '7-touch email, call, and LinkedIn cadence over 10 days for VP sales'
    )
  })

  it('describes a call-first sequence for vet offices', () => {
    const prompt =
      'build an phone heavy outbound sequencer for this list of vet offices. determine the best time of day to call the prospect and sort them from first to last'
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(sequenceTitle(prompt, spec), 'Calls with an email follow-up for Vet offices')
  })

  it('keeps a specific goal in the title', () => {
    const prompt = 'Recruiting email sequence for Series B founders'
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(
      sequenceTitle(prompt, spec),
      'Email sequence for Series B founders to book a recruiting conversation'
    )
  })

  it('drops a pasted company list and uses the audience from the prompt', () => {
    const prompt = 'Build an outbound cadence for vet offices'
    const spec = compileWorkspaceSpec(prompt, {
      segment: 'Stedi, Vendasta, Corgi, Deardoc'
    })
    assert.equal(spec.segment, 'Vet Offices')
    assert.equal(sequenceTitle(prompt, spec), 'Email, call, and LinkedIn cadence for Vet offices')
    assert.equal(/Stedi|Vendasta|Corgi|Deardoc/.test(sequenceTitle(prompt, spec)), false)
  })

  it('does not name the sequence after companies on the contact list', async () => {
    const db = migrateDatabase({})
    const prompt = 'Multi-channel cadence. Email, LinkedIn, and call.'
    const created = await createProjectRecord(memoryStore(db), loadConfig(), {
      orgId: 'org_1',
      prompt,
      kind: 'cadence',
      contacts: [
        { name: 'Ada', company: 'Stedi', title: 'VP Sales' },
        { name: 'Bea', company: 'Vendasta', title: 'CRO' },
        { name: 'Cam', company: 'Corgi', title: 'Head of Growth' },
        { name: 'Dee', company: 'Deardoc', title: 'Founder' },
        { name: 'Eli', company: 'Candela Medical', title: 'Director' }
      ]
    })
    const project = db.projects.find((row) => row.id === created.projectId)
    assert.ok(project)
    assert.equal(/Stedi|Vendasta|Corgi|Deardoc|Candela/.test(project.name), false)
    assert.equal(project.name, 'Email, LinkedIn, and call cadence')
    const sequence = db.sequences.find((row) => row.projectId === project.id)
    assert.equal(sequence?.name, project.name)
  })

  it('stores the same title on the project and the sequence', () => {
    const db = migrateDatabase({})
    const prompt = 'Build an outbound dialer for GTM Engineers in the US'
    const project = seedProject(db, {
      orgId: 'org_1',
      prompt,
      kind: 'dialer',
      answers: {},
      spec: compileWorkspaceSpec(prompt)
    })
    assert.equal(project.name, 'Outbound calls for GTM engineers in the US')
    assert.equal(db.sequences[0]?.name, project.name)
  })
})
