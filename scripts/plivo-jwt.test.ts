import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mintPlivoAccessToken, plivoSipUsername } from '../src/server/outboundPools.ts'
import type { ServerConfig } from '../src/server/config.ts'

function payloadOf(token: string): { sub: string; per: { voice: { outgoing_allow: boolean } } } {
  const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(Buffer.from(body, 'base64').toString('utf8'))
}

const config = {
  plivo: { authId: 'MAAAAAAAAAAAAAAAAAAA', authToken: 'secret-token-value-123456' }
} as ServerConfig

describe('plivo browser jwt', () => {
  it('uses the SIP user, not the full address', () => {
    assert.equal(plivoSipUsername('agent@phone.plivo.com'), 'agent')
    assert.equal(plivoSipUsername('sip:agent@phone.plivo.com'), 'agent')
    assert.equal(plivoSipUsername('  agent  '), 'agent')
    const token = mintPlivoAccessToken(config, 'agent@phone.plivo.com', { uid: 'fixed' })
    const payload = payloadOf(token)
    assert.equal(payload.sub, 'agent')
    assert.equal(payload.per.voice.outgoing_allow, true)
  })
})
