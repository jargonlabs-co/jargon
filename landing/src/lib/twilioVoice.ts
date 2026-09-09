import type { Call, Device } from '@twilio/voice-sdk'
import type { DialerVoice } from '../../../src/renderer/src/lib/dialerVoice'

let device: Device | null = null
let activeCall: Call | null = null

async function connect(opts: Parameters<DialerVoice['connect']>[0]): Promise<void> {
  await hangup()
  const { Device } = await import('@twilio/voice-sdk')
  const next = new Device(opts.token, { closeProtection: true, logLevel: 'error' })
  device = next
  next.on('error', (err) => opts.onError(err.message || 'Twilio voice error'))
  try {
    await next.register()
  } catch {
    /* outgoing Device.connect still works if incoming registration fails */
  }
  const call = await next.connect({
    params: { To: opts.to, Phone: opts.to, CallId: opts.callId }
  })
  activeCall = call
  call.on('accept', () => opts.onAccept())
  call.on('disconnect', () => opts.onDisconnect())
  call.on('cancel', () => opts.onDisconnect())
  call.on('error', (err) => opts.onError(err.message || 'Call failed'))
}

async function hangup(): Promise<void> {
  try {
    activeCall?.disconnect()
  } catch {
    /* already ended */
  }
  activeCall = null
  if (!device) return
  try {
    device.disconnectAll()
    await device.unregister()
  } catch {
    /* ignore */
  }
  device.destroy()
  device = null
}

export const twilioVoice: DialerVoice = { connect, hangup }
