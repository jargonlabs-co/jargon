import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseWarmthFilter, scoreWarmth } from '../src/shared/warmth'

const now = Date.parse('2026-09-25T18:00:00Z')
const days = (n: number) => now - n * 86_400_000

describe('scoreWarmth', () => {
  it('treats a recent reply as hot', () => {
    assert.equal(scoreWarmth({ lastReplyAt: days(3) }, now), 'hot')
  })

  it('treats a qualified lead with older activity as warm', () => {
    assert.equal(
      scoreWarmth({ lifecycleStage: 'marketingqualifiedlead', lastActivityAt: days(40) }, now),
      'warm'
    )
  })

  it('treats a subscriber with no recent activity as cold', () => {
    assert.equal(scoreWarmth({ lifecycleStage: 'subscriber', lastActivityAt: days(200) }, now), 'cold')
  })

  it('leaves a contact with no signals unknown', () => {
    assert.equal(scoreWarmth({}, now), 'unknown')
  })
})

describe('parseWarmthFilter', () => {
  it('reads a warmth bucket', () => {
    assert.deepEqual(parseWarmthFilter('hot, warm'), ['hot', 'warm'])
  })

  it('treats all as every bucket', () => {
    assert.equal(parseWarmthFilter('all'), 'all')
  })
})
