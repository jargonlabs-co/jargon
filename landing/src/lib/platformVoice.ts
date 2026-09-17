import type { DialerVoice } from '../../../src/renderer/src/lib/dialerVoice'
import { plivoVoice } from './plivoVoice'
import { twilioVoice } from './twilioVoice'

async function connect(opts: Parameters<DialerVoice['connect']>[0]): Promise<void> {
  if (opts.mode === 'plivo' || opts.username) {
    await plivoVoice.connect(opts)
    return
  }
  await twilioVoice.connect(opts)
}

async function hangup(): Promise<void> {
  await Promise.allSettled([plivoVoice.hangup(), twilioVoice.hangup()])
}

export const platformVoice: DialerVoice = { connect, hangup }
