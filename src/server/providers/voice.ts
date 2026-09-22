import type { ServerConfig } from '../config'
import type { CallSession } from '../types'
import type { DataStore } from '../store'
import {
  mintPlivoAccessToken,
  resolveVoiceEndpointForOrg
} from '../outboundPools'
import {
  hangupPlivoCall,
  inspectPlivoVoice,
  syncPlivoApplication
} from './plivo'
import { hangupTwilioPstn, inspectTwilioVoice, syncTwilioTwimlApp } from './twilio'

export type LiveVoiceProvider = 'plivo' | 'twilio'

export type VoiceToken = {
  /** Opaque session id for logs; browser auth is accessToken (JWT). */
  token: string
  mode: LiveVoiceProvider
  identity: string
  /** Plivo Browser SDK JWT — prefer this over username/password. */
  accessToken?: string
  /** Endpoint username (sub claim); optional for clients that only need JWT. */
  username?: string
  /** @deprecated Endpoint passwords are not sent; use accessToken. */
  password?: string
  fromNumber?: string
  poolMemberId?: string
}

export function inspectLiveVoice(
  config: ServerConfig
): { ok: true; provider: LiveVoiceProvider } | { ok: false; error: string } {
  if (
    config.outboundPools.voiceEndpoints.length > 0 &&
    config.plivo.authId &&
    config.plivo.authToken
  ) {
    return { ok: true, provider: 'plivo' }
  }
  const plivo = inspectPlivoVoice(config)
  if (plivo.ok) return { ok: true, provider: 'plivo' }
  return { ok: false, error: plivo.error }
}

export function voiceIsLive(config: ServerConfig): boolean {
  return inspectLiveVoice(config).ok
}

/**
 * Mint a short-lived Plivo JWT for the org's exclusive DID/SIP endpoint.
 * Does not consume concurrent/daily call budgets — those apply at call-create.
 */
export function createVoiceToken(
  config: ServerConfig,
  identity: string,
  opts?: { store?: DataStore; orgId?: string }
): VoiceToken {
  const live = inspectLiveVoice(config)
  if (!live.ok) {
    throw new Error(live.error)
  }
  if (opts?.store && opts.orgId) {
    const endpoint = resolveVoiceEndpointForOrg(opts.store, config, opts.orgId)
    const accessToken = mintPlivoAccessToken(config, endpoint.endpointUsername, {
      lifetimeSec: 3600
    })
    return {
      token: `plivo-jwt:${endpoint.id}`,
      mode: 'plivo',
      identity,
      accessToken,
      username: endpoint.endpointUsername,
      fromNumber: endpoint.fromNumber,
      poolMemberId: endpoint.id
    }
  }
  const username = config.plivo.endpointUsername
  if (!username) {
    throw new Error('PLIVO_ENDPOINT_USERNAME is missing')
  }
  const accessToken = mintPlivoAccessToken(config, username, { lifetimeSec: 3600 })
  return {
    token: `plivo-jwt:default`,
    mode: 'plivo',
    identity,
    accessToken,
    username,
    fromNumber: config.plivo.fromNumber
  }
}

export async function hangupLiveCall(
  config: ServerConfig,
  call: Pick<CallSession, 'mode' | 'providerCallSid'>
): Promise<void> {
  if (!call.providerCallSid) return
  if (call.mode === 'plivo') {
    await hangupPlivoCall(config, call.providerCallSid)
    return
  }
  if (call.mode === 'twilio') {
    await hangupTwilioPstn(config, call.providerCallSid)
  }
}

export async function syncVoiceProvider(config: ServerConfig): Promise<void> {
  const plivo = inspectPlivoVoice(config)
  if (config.plivo.authId && config.plivo.authToken) {
    await syncPlivoApplication(config)
    if (!plivo.ok && config.outboundPools.voiceEndpoints.length === 0) {
      console.warn(`[jargon] Plivo application synced, but voice is not live: ${plivo.error}`)
    } else {
      console.log(`[jargon] Plivo answer URL: ${config.publicUrl.replace(/\/$/, '')}/voice/plivo/answer`)
      console.log(
        `[jargon] Voice pool: ${config.outboundPools.voiceEndpoints.length} exclusive DID(s); JWT softphone auth`
      )
    }
  }
  if (inspectTwilioVoice(config).ok || config.twilio.twimlAppSid) {
    await syncTwilioTwimlApp(config)
    if (inspectTwilioVoice(config).ok) {
      console.log(`[jargon] Twilio TwiML app voice URL: ${config.publicUrl.replace(/\/$/, '')}/voice/twiml`)
    }
  }
}
