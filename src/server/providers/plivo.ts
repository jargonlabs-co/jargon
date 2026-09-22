import type { ServerConfig } from '../config'
import { plivoSipUsername } from '../outboundPools'
import { toE164 } from './twilio'

export type PlivoVoiceReady = { ok: true } | { ok: false; error: string }

function xmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function plivoBasicAuth(config: ServerConfig): string {
  return Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64')
}

function plivoApi(config: ServerConfig, path: string): string {
  const authId = encodeURIComponent(config.plivo.authId)
  return `https://api.plivo.com/v1/Account/${authId}${path}`
}

export function inspectPlivoVoice(config: ServerConfig): PlivoVoiceReady {
  const { authId, authToken, fromNumber, endpointUsername } = config.plivo
  const pool = config.outboundPools.voiceEndpoints
  if (!authId && !authToken && !fromNumber && !endpointUsername && !pool.length) {
    return { ok: false, error: 'Plivo is not configured' }
  }
  if (!authId.trim()) {
    return { ok: false, error: 'PLIVO_AUTH_ID is missing' }
  }
  if (!authToken.trim() || authToken.length < 16) {
    return { ok: false, error: 'PLIVO_AUTH_TOKEN is missing or looks invalid' }
  }
  if (pool.length > 0) {
    for (const member of pool) {
      if (!toE164(member.fromNumber)) {
        return {
          ok: false,
          error: `Voice pool member ${member.id}: fromNumber must be a Plivo-rented E.164 DID`
        }
      }
      if (!member.endpointUsername.trim()) {
        return {
          ok: false,
          error: `Voice pool member ${member.id}: endpointUsername missing (use the username Plivo returns after create)`
        }
      }
    }
    return { ok: true }
  }
  if (!toE164(fromNumber)) {
    return {
      ok: false,
      error: 'PLIVO_FROM_NUMBER must be a voice-enabled E.164 number (for example +15551234567)'
    }
  }
  if (!endpointUsername.trim()) {
    return {
      ok: false,
      error:
        'PLIVO_ENDPOINT_USERNAME is missing. Create a SIP endpoint in the Plivo console and paste the full returned username (Plivo appends a 12-digit suffix).'
    }
  }
  return { ok: true }
}

/**
 * Ask Plivo to sign a browser-SDK JWT. A locally signed token is rejected
 * as INVALID_ACCESS_TOKEN; their registrar only accepts tokens from this API,
 * and the SDK reads permissions from `per`, not `grants`.
 */
export async function issuePlivoAccessToken(
  config: ServerConfig,
  endpointUsername: string,
  opts?: { lifetimeSec?: number }
): Promise<string> {
  const authId = config.plivo.authId.trim()
  const username = plivoSipUsername(endpointUsername)
  if (!authId || !config.plivo.authToken.trim() || !username) {
    throw new Error('Plivo JWT mint requires authId, authToken, and endpoint username')
  }
  const lifetime = Math.min(86_400, Math.max(180, opts?.lifetimeSec ?? 3600))
  const now = Math.floor(Date.now() / 1000)
  const body: Record<string, unknown> = {
    iss: authId,
    sub: username,
    nbf: now,
    exp: now + lifetime,
    per: {
      voice: {
        incoming_allow: false,
        outgoing_allow: true
      }
    }
  }
  const appId = config.plivo.appId.trim()
  if (appId) body.app = appId
  const res = await fetch(plivoApi(config, '/JWT/Token/'), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${plivoBasicAuth(config)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let json: PlivoJson = {}
  try {
    json = text ? (JSON.parse(text) as PlivoJson) : {}
  } catch {
    json = {}
  }
  if (!res.ok) {
    throw new Error(`Plivo JWT failed (${res.status}): ${text.slice(0, 240)}`)
  }
  const token = String(json.token ?? json.jwt ?? '')
  if (!token) {
    throw new Error('Plivo JWT response did not include a token')
  }
  return token
}

/** @deprecated Prefer issuePlivoAccessToken — do not ship endpoint passwords to browsers. */
export function createPlivoVoiceToken(
  config: ServerConfig,
  identity: string,
  endpoint?: { endpointUsername: string }
): { token: string; mode: 'plivo'; identity: string; username: string } {
  const username = endpoint?.endpointUsername ?? config.plivo.endpointUsername
  if (!config.plivo.authId || !config.plivo.authToken) {
    throw new Error('Plivo is not configured')
  }
  if (!username.trim()) {
    const ready = inspectPlivoVoice(config)
    if (!ready.ok) throw new Error(ready.error)
  }
  return {
    token: `plivo:${username}`,
    mode: 'plivo',
    identity,
    username
  }
}

export function plivoDialXml(to: string, fromNumber: string, callbackUrl?: string): string {
  const dest = toE164(to)
  const from = toE164(fromNumber) ?? fromNumber
  if (!dest) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>The destination number is invalid.</Speak></Response>`
  }
  const callback = callbackUrl
    ? ` callbackUrl="${xmlAttr(callbackUrl)}" callbackMethod="POST"`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${xmlAttr(from)}"${callback}>
    <Number>${xmlAttr(dest)}</Number>
  </Dial>
</Response>`
}

export async function hangupPlivoCall(config: ServerConfig, callUuid: string): Promise<void> {
  if (!config.plivo.authId || !config.plivo.authToken || !callUuid) return
  const res = await fetch(plivoApi(config, `/Call/${encodeURIComponent(callUuid)}/`), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${plivoBasicAuth(config)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'hangup' })
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text()
    throw new Error(`Plivo hangup failed (${res.status}): ${text.slice(0, 240)}`)
  }
}

type PlivoJson = Record<string, unknown>

async function plivoRequest(
  config: ServerConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, string>
): Promise<{ status: number; json: PlivoJson }> {
  const res = await fetch(plivoApi(config, path), {
    method,
    headers: {
      Authorization: `Basic ${plivoBasicAuth(config)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json: PlivoJson = {}
  try {
    json = text ? (JSON.parse(text) as PlivoJson) : {}
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`Plivo ${method} ${path} failed (${res.status}): ${text.slice(0, 240)}`)
  }
  return { status: res.status, json }
}

function voiceUrls(config: ServerConfig): { answerUrl: string; hangupUrl: string; dialUrl: string } {
  const base = config.publicUrl.replace(/\/$/, '')
  return {
    answerUrl: `${base}/voice/plivo/answer`,
    hangupUrl: `${base}/voice/plivo/hangup`,
    dialUrl: `${base}/voice/plivo/dial`
  }
}

/** Point the Plivo XML application (and endpoint) at JARGON_PUBLIC_URL. */
export async function syncPlivoApplication(config: ServerConfig): Promise<void> {
  if (!config.plivo.authId || !config.plivo.authToken) return
  const { answerUrl, hangupUrl } = voiceUrls(config)
  const payload = {
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  }
  let appId = config.plivo.appId.trim()
  if (!appId) {
    const listed = await plivoRequest(config, 'GET', '/Application/')
    const objects = Array.isArray(listed.json.objects) ? (listed.json.objects as PlivoJson[]) : []
    const existing = objects.find((app) => String(app.app_name ?? '') === 'Jargon Voice')
    appId = existing ? String(existing.app_id ?? '') : ''
    if (!appId) {
      const created = await plivoRequest(config, 'POST', '/Application/', {
        app_name: 'Jargon Voice',
        ...payload
      })
      appId = String(created.json.app_id ?? '')
      if (!appId) {
        throw new Error('Plivo created an application but did not return app_id')
      }
      console.log(`[jargon] Created Plivo application ${appId}. Set PLIVO_APP_ID=${appId}`)
    }
  }
  await plivoRequest(config, 'POST', `/Application/${encodeURIComponent(appId)}/`, payload)

  const username = config.plivo.endpointUsername.trim()
  if (!username) return
  const listed = await plivoRequest(config, 'GET', '/Endpoint/')
  const endpoints = Array.isArray(listed.json.objects) ? (listed.json.objects as PlivoJson[]) : []
  const endpoint = endpoints.find((row) => String(row.username ?? '') === username)
  const endpointId = endpoint ? String(endpoint.endpoint_id ?? '') : ''
  if (!endpointId) {
    console.warn(
      `[jargon] Plivo endpoint ${username} was not found. Create it in Voice → Endpoints and attach the Jargon Voice application.`
    )
    return
  }
  await plivoRequest(config, 'POST', `/Endpoint/${encodeURIComponent(endpointId)}/`, { app_id: appId })
}

export function plivoFormValue(body: Record<string, unknown>, ...keys: string[]): string {
  const lower = new Map<string, unknown>()
  for (const [key, value] of Object.entries(body)) {
    lower.set(key.toLowerCase(), value)
  }
  for (const key of keys) {
    const value = body[key] ?? lower.get(key.toLowerCase())
    if (value != null && String(value).trim()) return String(value)
  }
  return ''
}
