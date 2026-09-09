import type { Call, Device } from '@twilio/voice-sdk'

let device: Device | null = null
let activeCall: Call | null = null

export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

export async function connectTwilioCall(opts: {
  token: string
  to: string
  callId: string
  onAccept: () => void
  onDisconnect: () => void
  onError: (message: string) => void
}): Promise<void> {
  await hangupTwilioCall()
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

export async function hangupTwilioCall(): Promise<void> {
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
