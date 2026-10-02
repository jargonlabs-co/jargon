import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasReachableContact,
  isFixtureContact,
  isPriorityContact,
  isPriorityPipelinePrompt,
  isSalesExecTitle,
  leadIdentity,
  priorityBand,
  rankLeads,
  salesExecContactIds,
  scoreLead
} from '../src/shared/priorityOverlay'

describe('priority pipeline prompt', () => {
  const prompt =
    'pull in sales exec contacts from my list of target accounts in hubspot. build a priority pipeline for this week'

  it('recognizes a priority pipeline from any source', () => {
    assert.equal(isPriorityPipelinePrompt(prompt), true)
    assert.equal(isPriorityPipelinePrompt('build a priority pipeline for this week'), true)
    assert.equal(isPriorityPipelinePrompt('prioritize these Railway contacts'), true)
    assert.equal(isPriorityPipelinePrompt('build an email cadence for webinar leads'), false)
  })

  it('keeps reachable people and drops fixture or empty HubSpot rows', () => {
    assert.equal(hasReachableContact({ email: 'ada@acme.com' }), true)
    assert.equal(hasReachableContact({ phone: '+1 415 555 0142' }), true)
    assert.equal(hasReachableContact({ linkedinUrl: 'https://www.linkedin.com/in/ada' }), true)
    assert.equal(hasReachableContact({ email: '123@unknown.invalid', name: 'HubSpot contact 4' }), false)
    assert.equal(isFixtureContact({ source: 'seed', email: 'ada@acme.com' }), true)
    assert.equal(isPriorityContact({ source: 'postgres', email: 'bo@orbit.com' }), true)
    assert.equal(isPriorityContact({ source: 'hubspot', email: '99@unknown.invalid' }), false)
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

  it('ranks Lusha intent above people with no signals and shows those facts', () => {
    const hot = scoreLead({
      seed: 'ada@acme.com',
      company: 'Acme',
      title: 'VP Sales',
      facts: ['Intent: outbound dialers', 'VP'],
      attrs: { intent_score: 82, gtm_initiative: ['Intent: outbound dialers'], seniority: 'VP' }
    })
    const cold = scoreLead({
      seed: 'bo@orbit.com',
      company: 'Orbit',
      title: 'VP Sales'
    })
    assert.equal(hot.motion, 'inbound')
    assert.ok(hot.score > cold.score)
    assert.ok(hot.signals.some((line) => /intent/i.test(line)))
  })
})

describe('rankLeads', () => {
  it('sorts higher scores first and numbers the ranks', () => {
    const people = Array.from({ length: 24 }, (_, i) => ({
      email: `person${i}@acme.com`,
      company: `Company ${i}`,
      title: 'VP Sales'
    }))
    const ranked = rankLeads(people, leadIdentity)
    const scores = ranked.map((row) => row.priority?.score ?? 0)
    assert.deepEqual(ranked.map((row) => row.priority?.rank), people.map((_, i) => i + 1))
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
    const motions = new Set(ranked.map((row) => row.priority?.motion))
    assert.equal(motions.has('inbound'), true)
    assert.equal(motions.has('outbound'), true)
  })

  it('ranks HubSpot, Railway, and imported rows together', () => {
    const rows = [
      { id: 'hs', source: 'hubspot', email: 'a@x.com', company: 'Acme', title: 'VP Sales' },
      { id: 'pg', source: 'postgres', email: 'b@y.com', company: 'Orbit', title: 'CRO' },
      { id: 'imp', source: 'import', email: 'c@z.com', company: 'Harbor', title: 'Head of Growth' }
    ]
    const ranked = rankLeads(rows, leadIdentity)
    assert.equal(ranked.every((row) => row.priority?.rank), true)
    assert.deepEqual(
      ranked.map((row) => row.priority?.rank).sort((a, b) => (a ?? 0) - (b ?? 0)),
      [1, 2, 3]
    )
  })

  it('leaves rows without an identity unranked after the queue', () => {
    const rows = [
      { id: 'a', seed: 'a@x.com', company: 'A' },
      { id: 'b', seed: null, company: 'B' }
    ]
    const ranked = rankLeads(rows, (row) => (row.seed ? { seed: row.seed, company: row.company } : null))
    assert.equal(ranked[0]?.id, 'a')
    assert.equal(ranked[0]?.priority?.rank, 1)
    assert.equal(ranked[1]?.priority, undefined)
  })

  it('assigns low / medium / high from rank', () => {
    assert.equal(priorityBand(1, 1), 'high')
    assert.equal(priorityBand(1, 2), 'high')
    assert.equal(priorityBand(2, 2), 'medium')
    assert.deepEqual([1, 2, 3].map((rank) => priorityBand(rank, 3)), ['high', 'medium', 'low'])
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => priorityBand(rank, 8)),
      ['high', 'high', 'high', 'medium', 'medium', 'medium', 'low', 'low']
    )
    const ranked = rankLeads(
      [
        { email: 'a@x.com', company: 'A' },
        { email: 'b@y.com', company: 'B' },
        { email: 'c@z.com', company: 'C' }
      ],
      leadIdentity
    )
    assert.deepEqual(
      ranked.map((row) => row.priority?.band).sort(),
      ['high', 'low', 'medium']
    )
  })

  it('ranks HubSpot people with Lusha intent first and shows those signals', () => {
    const ranked = rankLeads(
      [
        { email: 'cold@x.com', company: 'Acme', title: 'VP Sales' },
        {
          email: 'hot@x.com',
          company: 'Orbit',
          title: 'VP Sales',
          attrs: {
            intent_score: 90,
            gtm_initiative: ['Intent: sales engagement'],
            seniority: 'VP'
          }
        }
      ],
      leadIdentity
    )
    assert.equal(ranked[0]?.email, 'hot@x.com')
    assert.equal(ranked[0]?.priority?.motion, 'inbound')
    assert.ok(ranked[0]?.priority?.signals.some((line) => /Intent: sales engagement/i.test(line)))
  })
})
