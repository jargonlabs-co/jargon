import { createHmac } from 'crypto'
import type { ServerConfig } from '../config'
import { upsertConnection } from '../connections'
import type { DataStore } from '../store'

export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

function xmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function twilioBasicAuth(config: ServerConfig): string {
  return Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64')
}

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

export function voiceTwiml(to: string, fromNumber: string, statusUrl?: string): string {
  const dest = toE164(to)
  const from = toE164(fromNumber) ?? fromNumber
  if (!dest) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>The destination number is invalid.</Say></Response>`
  }
  const status = statusUrl
    ? ` statusCallback="${xmlAttr(statusUrl)}" statusCallbackEvent="initiated ringing answered completed"`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${xmlAttr(from)}" answerOnBridge="true">
    <Number${status}>${xmlAttr(dest)}</Number>
  </Dial>
</Response>`
}

export async function hangupTwilioPstn(config: ServerConfig, callSid: string): Promise<void> {
  if (!config.twilio.accountSid || !config.twilio.authToken || !callSid) return
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls/${encodeURIComponent(callSid)}.json`
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${twilioBasicAuth(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'Status=completed'
  })
}

/** Point the TwiML app at JARGON_PUBLIC_URL (www.jargonlabs.co), not the Vercel apex. */
export async function syncTwilioTwimlApp(config: ServerConfig): Promise<void> {
  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.twimlAppSid) return
  const voiceUrl = `${config.publicUrl.replace(/\/$/, '')}/voice/twiml`
  const statusUrl = `${config.publicUrl.replace(/\/$/, '')}/voice/status`
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Applications/${config.twilio.twimlAppSid}.json`
  const body = new URLSearchParams({
    VoiceUrl: voiceUrl,
    VoiceMethod: 'POST',
    StatusCallback: statusUrl,
    StatusCallbackMethod: 'POST',
    SmsUrl: ''
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${twilioBasicAuth(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio TwiML app update failed (${res.status}): ${text.slice(0, 240)}`)
  }
}

export function ensureTwilioConnection(store: DataStore, orgId: string, serverConfig: ServerConfig) {
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
