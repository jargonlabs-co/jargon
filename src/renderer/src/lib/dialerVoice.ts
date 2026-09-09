export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

export type DialerVoiceConnectOpts = {
  token: string
  to: string
  callId: string
  onAccept: () => void
  onDisconnect: () => void
  onError: (message: string) => void
}

/** Browser softphone. Implemented by the website (landing), not src/renderer. */
export type DialerVoice = {
  connect: (opts: DialerVoiceConnectOpts) => Promise<void>
  hangup: () => Promise<void>
}
