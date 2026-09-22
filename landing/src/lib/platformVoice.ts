import type { DialerVoice } from '../../../src/renderer/src/lib/dialerVoice'
import { plivoVoice } from './plivoVoice'

async function connect(opts: Parameters<DialerVoice['connect']>[0]): Promise<void> {
  if (opts.mode === 'plivo' || opts.accessToken || opts.username) {
    await plivoVoice.connect(opts)
    return
  }
  throw new Error('Calling requires Plivo')
}

async function hangup(): Promise<void> {
  await plivoVoice.hangup()
}

export const platformVoice: DialerVoice = { connect, hangup }
