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
    assert.equal(project?.play?.notice, 'Connect HubSpot to pull these deals and the last call.')
    assert.ok(steps.some((step) => step.channel === 'call' && step.body?.includes('{{last_call_objection}}')))
    assert.ok(steps.some((step) => step.body?.includes('{{quiet_window}}')))
  })
})
