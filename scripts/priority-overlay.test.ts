import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPriorityPipelinePrompt,
  isSalesExecTitle,
  rankHubSpotLeads,
  salesExecContactIds,
  scoreLead
} from '../src/shared/priorityOverlay'

describe('priority pipeline prompt', () => {
  const prompt =
    'pull in sales exec contacts from my list of target accounts in hubspot. build a priority pipeline for this week'

  it('recognizes the HubSpot priority pipeline ask', () => {
    assert.equal(isPriorityPipelinePrompt(prompt), true)
    assert.equal(isPriorityPipelinePrompt('build an email cadence for webinar leads'), false)
  })

  it('keeps sales exec titles and skips a thin match', () => {
    assert.equal(isSalesExecTitle('VP Sales'), true)
    assert.equal(isSalesExecTitle('Head of Growth'), true)
    assert.equal(isSalesExecTitle('CRO'), true)
    assert.equal(isSalesExecTitle('BDR'), false)
    const few = salesExecContactIds([
      { id: 'a', title: 'VP Sales' },
      { id: 'b', title: 'Intern' }
    ])
    assert.equal(few, null)
    const enough = salesExecContactIds([
      { id: 'a', title: 'VP Sales' },
      { id: 'b', title: 'CRO' },
      { id: 'c', title: 'Head of Growth' },
      { id: 'd', title: 'Intern' }
    ])
    assert.deepEqual(enough, ['a', 'b', 'c'])
  })
})

describe('scoreLead', () => {
  it('keeps the same motion and signals for the same person', () => {
    const a = scoreLead({ seed: 'ada@acme.com', company: 'Acme', title: 'VP Sales' })
    const b = scoreLead({ seed: 'Ada@acme.com', company: 'Acme', title: 'VP Sales' })
    assert.deepEqual(a, b)
  })

  it('does not name a missing company', () => {
    const scored = scoreLead({ seed: 'no-company@x.com', company: 'Unknown company', title: 'Contact' })
    assert.equal(scored.signals.some((line) => /unknown company/i.test(line)), false)
  })
})

describe('rankHubSpotLeads', () => {
  it('sorts higher scores first and numbers the ranks', () => {
    const people = Array.from({ length: 24 }, (_, i) => ({
      email: `person${i}@example.com`,
      company: `Company ${i}`,
      title: 'VP Sales'
    }))
    const ranked = rankHubSpotLeads(people, (row) => ({
      seed: row.email,
      company: row.company,
      title: row.title
    }))
    const scores = ranked.map((row) => row.priority?.score ?? 0)
    assert.deepEqual(ranked.map((row) => row.priority?.rank), people.map((_, i) => i + 1))
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
    const motions = new Set(ranked.map((row) => row.priority?.motion))
    assert.equal(motions.has('inbound'), true)
    assert.equal(motions.has('outbound'), true)
  })

  it('leaves non-hubspot rows unranked after the queue', () => {
    const rows = [
      { id: 'a', seed: 'a@x.com', company: 'A' },
      { id: 'b', seed: null, company: 'B' }
    ]
    const ranked = rankHubSpotLeads(rows, (row) => (row.seed ? { seed: row.seed, company: row.company } : null))
    assert.equal(ranked[0]?.id, 'a')
    assert.equal(ranked[0]?.priority?.rank, 1)
    assert.equal(ranked[1]?.priority, undefined)
  })
})
