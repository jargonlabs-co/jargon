export { toE164 } from '../../../shared/phone'

export type DialerVoiceConnectOpts = {
  token: string
  to: string
  callId: string
  mode?: 'plivo'
  /** Plivo Browser SDK JWT (preferred). */
  accessToken?: string
  username?: string
  /** @deprecated Prefer accessToken. */
  password?: string
  onAccept: () => void
  onDisconnect: () => void
  onError: (message: string) => void
}

/** Browser softphone. Implemented by the website (landing), not src/renderer. */
export type DialerVoice = {
  connect: (opts: DialerVoiceConnectOpts) => Promise<void>
  hangup: () => Promise<void>
}
