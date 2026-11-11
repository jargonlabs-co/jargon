import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/server/config.ts'
import { createProjectRecord } from '../src/server/projectCreate.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import {
  matchDealStage,
  objectionFromCall,
  parsePlay,
  quietWindowFromPeriods
} from '../src/shared/play.ts'

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

const PROMPT =
  'Build a play for stage-2 deals with no activity in 30 days. Open with the objection from their last call, and schedule calls for when each office is quietest, based on their Google Business Profile.'

describe('play variables', () => {
  it('reads the audience and both variable sources from the sentence', () => {
    const play = parsePlay(PROMPT)
    assert.ok(play)
    assert.equal(play.audience?.stage, 'stage 2')
    assert.equal(play.audience?.inactiveDays, 30)
    assert.deepEqual(
      play.variables.map((variable) => [variable.key, variable.party, variable.source]),
      [
        ['last_call_objection', 'first', 'HubSpot calls'],
        ['quiet_window', 'third', 'Google Business Profile']
      ]
    )
  })

  it('keeps the objection that was actually on the call', () => {
    assert.equal(
      objectionFromCall('Talked through pricing. Budget is frozen until the new wing opens. Will revisit in Q3.'),
      'Budget is frozen until the new wing opens.'
    )
    assert.equal(objectionFromCall('   '), '')
  })

  it('uses the first 90 minutes of posted weekday hours', () => {
    const window = quietWindowFromPeriods(
      [
        { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
        { open: { day: 0, hour: 10, minute: 0 }, close: { day: 0, hour: 14, minute: 0 } }
      ],
      'America/Chicago'
    )
    assert.ok(window)
    assert.match(window.label, /^8:00–9:30am\b/)
  })

  it('matches a numbered stage by position when the portal uses its own label', () => {
    const stage = matchDealStage(
      [
        { id: 'a', label: 'Appointment scheduled', displayOrder: 0 },
        { id: 'b', label: 'Qualified to buy', displayOrder: 1 }
      ],
      'stage 2'
    )
    assert.equal(stage?.id, 'b')
  })

  it('stores the variable contract on the sequence', async () => {
    const db = migrateDatabase({})
    const store = memoryStore(db)
    const created = await createProjectRecord(store, loadConfig(), {
      orgId: 'org_1',
      prompt: PROMPT,
      kind: 'cadence'
    })
    const project = db.projects.find((row) => row.id === created.projectId)
    const steps = db.steps.filter((step) => step.projectId === created.projectId)
    assert.equal(project?.play?.audience?.inactiveDays, 30)
    assert.equal(project?.play?.notice, undefined)
    assert.ok(steps.some((step) => step.channel === 'call' && step.body?.includes('{{last_call_objection}}')))
    assert.ok(steps.some((step) => step.body?.includes('{{quiet_window}}')))
    const contacts = db.contacts.filter((row) => row.projectId === created.projectId)
    assert.deepEqual(
      contacts.map((row) => row.name),
      ['Ada Morales', 'Owen Briggs', 'Noah Patel']
    )
    assert.ok(contacts.every((row) => row.attrs?.last_call_objection && row.attrs?.quiet_window))
  })

  it('turns a new audience and new fields into a filled sequence', async () => {
    const prompt =
      'Build a play for stalled renewals with no activity in 14 days. Open with the competitor they mentioned on the last call, and mention the discount that matches their plan.'
    const play = parsePlay(prompt)
    assert.ok(play)
    assert.equal(play.audience?.kind, 'custom')
    assert.equal(play.audience?.inactiveDays, 14)
    assert.equal(play.audience?.label, 'Stalled renewals with no activity in 14 days')
    assert.deepEqual(
      play.variables.map((variable) => [variable.key, variable.use, variable.source]),
      [
        ['competitor_mentioned_last_call', 'open', 'HubSpot calls'],
        ['discount_matches_plan', 'position', 'Account']
      ]
    )
    const db = migrateDatabase({})
    const created = await createProjectRecord(memoryStore(db), loadConfig(), {
      orgId: 'org_1',
      prompt,
      kind: 'cadence'
    })
    const steps = db.steps.filter((step) => step.projectId === created.projectId)
    const contacts = db.contacts.filter((row) => row.projectId === created.projectId)
    assert.equal(contacts.length, 3)
    assert.ok(
      contacts.every((row) => row.attrs?.competitor_mentioned_last_call && row.attrs?.discount_matches_plan)
    )
    assert.ok(steps.some((step) => step.body?.includes('{{competitor_mentioned_last_call}}')))
    assert.ok(steps.some((step) => step.body?.includes('{{discount_matches_plan}}')))
    assert.equal(/\{\{/.test(contacts.map((row) => Object.values(row.attrs ?? {}).join(' ')).join(' ')), false)
  })

  it('builds an upsell play from the last Attention call, the brand add-on, and store hours', async () => {
    const prompt =
      'Build a play for open upsell opportunities with no activity in 30 days. Open with the pain point or objection from the customer’s last Attention call, and position the add-on that fits their brand. Schedule calls for when each store is quietest, based on their Google Business Profile.'
    const play = parsePlay(prompt)
    assert.ok(play)
    assert.equal(play.audience?.kind, 'upsell')
    assert.equal(play.audience?.inactiveDays, 30)
    assert.equal(play.audience?.label, 'Open upsell opportunities with no activity in 30 days')
    assert.deepEqual(
      play.variables.map((variable) => [variable.key, variable.party, variable.source]),
      [
        ['attention_pain', 'first', 'Attention'],
        ['brand_addon', 'first', 'Brand'],
        ['quiet_window', 'third', 'Google Business Profile']
      ]
    )
    const db = migrateDatabase({})
    const created = await createProjectRecord(memoryStore(db), loadConfig(), {
      orgId: 'org_1',
      prompt,
      kind: 'cadence'
    })
    const project = db.projects.find((row) => row.id === created.projectId)
    const steps = db.steps.filter((step) => step.projectId === created.projectId)
    const contacts = db.contacts.filter((row) => row.projectId === created.projectId)
    assert.equal(project?.play?.notice, undefined)
    assert.equal(contacts.length, 3)
    assert.ok(contacts.every((row) => row.attrs?.attention_pain && row.attrs?.brand_addon && row.attrs?.quiet_window))
    assert.ok(steps.some((step) => step.channel === 'call' && step.body?.includes('{{attention_pain}}') && step.body?.includes('{{brand_addon}}')))
    assert.ok(steps.some((step) => step.channel === 'email' && step.body?.includes('{{brand_addon}}') && step.body?.includes('store')))
  })
})
