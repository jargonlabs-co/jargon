import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { plivoSipUsername } from '../src/server/outboundPools.ts'

describe('plivo browser jwt', () => {
  it('uses the SIP user, not the full address', () => {
    assert.equal(plivoSipUsername('agent@phone.plivo.com'), 'agent')
    assert.equal(plivoSipUsername('sip:agent@phone.plivo.com'), 'agent')
    assert.equal(plivoSipUsername('  agent  '), 'agent')
  })
})
