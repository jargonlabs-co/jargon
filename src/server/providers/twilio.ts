import { createHmac } from 'crypto'
import type { ServerConfig } from '../config'
import { upsertConnection } from '../connections'
import type { JsonStore } from '../store'

/**
 * Twilio Client capability token (JWT) for softphone.
 * Uses API Key credentials when configured; otherwise returns a demo token marker.
 */
export function createTwilioVoiceToken(
  config: ServerConfig,
  identity: string
): { token: string; mode: 'demo' | 'twilio'; identity: string } {
  if (
    !config.twilio.accountSid ||
    !config.twilio.apiKeySid ||
    !config.twilio.apiKeySecret ||
    !config.twilio.twimlAppSid
  ) {
    return { token: 'demo-twilio-token', mode: 'demo', identity }
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' }
  const grants = {
    identity,
    voice: {
      incoming: { allow: true },
      outgoing: { application_sid: config.twilio.twimlAppSid }
    }
  }
  const payload = {
    jti: `${config.twilio.apiKeySid}-${now}`,
    iss: config.twilio.apiKeySid,
    sub: config.twilio.accountSid,
    nbf: now,
    exp: now + 60 * 60,
    grants
  }

  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${enc(header)}.${enc(payload)}`
  const sig = createHmac('sha256', config.twilio.apiKeySecret)
    .update(unsigned)
    .digest('base64url')
  return { token: `${unsigned}.${sig}`, mode: 'twilio', identity }
}

export function voiceTwiml(to: string, fromNumber: string): string {
  const escaped = to.replace(/[<>&'"]/g, '')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${fromNumber}">
    <Number>${escaped}</Number>
  </Dial>
</Response>`
}

export function ensureTwilioConnection(store: JsonStore, orgId: string, serverConfig: ServerConfig) {
  const existing = store.db.connections.find((c) => c.orgId === orgId && c.provider === 'twilio')
  if (existing) return existing
  return upsertConnection(store, {
    orgId,
    provider: 'twilio',
    status: 'connected',
    accountLabel: serverConfig.twilio.fromNumber
      ? `Twilio ${serverConfig.twilio.fromNumber}`
      : 'Twilio',
    secrets: {
      accessToken: 'connected',
      extra: {
        accountSid: serverConfig.twilio.accountSid || 'demo'
      }
    },
    meta: { mode: serverConfig.twilio.accountSid ? 'live' : 'demo' }
  })
}
