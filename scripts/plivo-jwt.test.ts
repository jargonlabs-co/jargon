import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { plivoSipUsername } from '../src/server/outboundPools.ts'
import { plivoEndpointMatches, plivoWebhookBase } from '../src/server/providers/plivo.ts'
import type { ServerConfig } from '../src/server/config.ts'

describe('plivo browser jwt', () => {
  it('uses the SIP user, not the full address', () => {
    assert.equal(plivoSipUsername('agent@phone.plivo.com'), 'agent')
    assert.equal(plivoSipUsername('sip:agent@phone.plivo.com'), 'agent')
    assert.equal(plivoSipUsername('  agent  '), 'agent')
  })

  it('matches an endpoint stored as a SIP address', () => {
    const row = {
      username: 'agent120910234567',
      sip_uri: 'sip:agent120910234567@phone.plivo.com'
    }
    assert.equal(plivoEndpointMatches('agent120910234567@phone.plivo.com', row), true)
    assert.equal(plivoEndpointMatches('sip:agent120910234567@phone.plivo.com', row), true)
    assert.equal(plivoEndpointMatches('someoneelse', row), false)
  })

  it('sends Plivo webhooks to the API, not the website', () => {
    const prevRailway = process.env.RAILWAY_PUBLIC_DOMAIN
    const prevOverride = process.env.JARGON_VOICE_PUBLIC_URL
    delete process.env.JARGON_VOICE_PUBLIC_URL
    process.env.RAILWAY_PUBLIC_DOMAIN = 'jargon-api-production.up.railway.app'
    try {
      assert.equal(
        plivoWebhookBase({ publicUrl: 'https://www.jargonlabs.co' } as ServerConfig),
        'https://jargon-api-production.up.railway.app'
      )
    } finally {
      if (prevRailway === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN
      else process.env.RAILWAY_PUBLIC_DOMAIN = prevRailway
      if (prevOverride === undefined) delete process.env.JARGON_VOICE_PUBLIC_URL
      else process.env.JARGON_VOICE_PUBLIC_URL = prevOverride
    }
  })
})
