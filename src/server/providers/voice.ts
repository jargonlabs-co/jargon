import type { ServerConfig } from '../config'
import type { CallSession } from '../types'
import {
  createPlivoVoiceToken,
  hangupPlivoCall,
  inspectPlivoVoice,
  syncPlivoApplication
} from './plivo'
import { hangupTwilioPstn, inspectTwilioVoice, syncTwilioTwimlApp } from './twilio'

export type LiveVoiceProvider = 'plivo' | 'twilio'

export type VoiceToken = {
  token: string
  mode: LiveVoiceProvider
  identity: string
  username?: string
  password?: string
}

export function inspectLiveVoice(
  config: ServerConfig
): { ok: true; provider: LiveVoiceProvider } | { ok: false; error: string } {
  const plivo = inspectPlivoVoice(config)
  if (plivo.ok) return { ok: true, provider: 'plivo' }
  return { ok: false, error: plivo.error }
}

export function voiceIsLive(config: ServerConfig): boolean {
  return inspectLiveVoice(config).ok
}

export function createVoiceToken(config: ServerConfig, identity: string): VoiceToken {
  const live = inspectLiveVoice(config)
  if (!live.ok) {
    throw new Error(live.error)
  }
  return createPlivoVoiceToken(config, identity)
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
    if (!plivo.ok) {
      console.warn(`[jargon] Plivo application synced, but voice is not live: ${plivo.error}`)
    } else {
      console.log(`[jargon] Plivo answer URL: ${config.publicUrl.replace(/\/$/, '')}/voice/plivo/answer`)
    }
  }
  if (inspectTwilioVoice(config).ok || config.twilio.twimlAppSid) {
    await syncTwilioTwimlApp(config)
    if (inspectTwilioVoice(config).ok) {
      console.log(`[jargon] Twilio TwiML app voice URL: ${config.publicUrl.replace(/\/$/, '')}/voice/twiml`)
    }
  }
}
