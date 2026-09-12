import twilio from 'twilio'
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

export function inspectTwilioVoice(
  config: ServerConfig
): { ok: true } | { ok: false; error: string } {
  const { accountSid, apiKeySid, apiKeySecret, twimlAppSid, fromNumber } = config.twilio
  if (!accountSid && !apiKeySid && !apiKeySecret && !twimlAppSid) {
    return { ok: false, error: 'Twilio is not configured' }
  }
  if (!accountSid.startsWith('AC') || accountSid.length !== 34) {
    return { ok: false, error: 'TWILIO_ACCOUNT_SID must be the AC… Account SID' }
  }
  if (!apiKeySid.startsWith('SK') || apiKeySid.length !== 34) {
    return {
      ok: false,
      error:
        'TWILIO_API_KEY_SID must be the SK… API Key SID from Twilio Console → API keys. It is missing or a placeholder.'
    }
  }
  if (apiKeySecret.startsWith('SK') || apiKeySecret.length < 16) {
    return {
      ok: false,
      error:
        'TWILIO_API_KEY_SECRET looks like an SID, not a secret. Paste the API Key Secret from that same key — not the SK… SID.'
    }
  }
  if (!twimlAppSid.startsWith('AP') || twimlAppSid.length !== 34) {
    return { ok: false, error: 'TWILIO_TWIML_APP_SID must be the AP… TwiML App SID' }
  }
  if (!toE164(fromNumber)) {
    return {
      ok: false,
      error:
        'TWILIO_FROM_NUMBER must be a real E.164 number on this Twilio account (for example +15551234567), not a placeholder.'
    }
  }
  return { ok: true }
}

export function createTwilioVoiceToken(
  config: ServerConfig,
  identity: string
): { token: string; mode: 'demo' | 'twilio'; identity: string } {
  const ready = inspectTwilioVoice(config)
  if (!ready.ok) {
    throw new Error(ready.error)
  }
  const AccessToken = twilio.jwt.AccessToken
  const token = new AccessToken(
    config.twilio.accountSid,
    config.twilio.apiKeySid,
    config.twilio.apiKeySecret,
    { identity, ttl: 3600 }
  )
  token.addGrant(
    new AccessToken.VoiceGrant({
      outgoingApplicationSid: config.twilio.twimlAppSid,
      incomingAllow: true
    })
  )
  return { token: token.toJwt(), mode: 'twilio', identity }
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
