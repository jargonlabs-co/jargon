import type { DialerVoice, DialerVoiceConnectOpts } from '../../../src/renderer/src/lib/dialerVoice'

type PlivoClient = {
  client: {
    on: (event: string, cb: (...args: unknown[]) => void) => void
    login: (username: string, password: string) => boolean
    logout: () => boolean
    call: (phoneNumber: string, extraHeaders?: Record<string, string>) => boolean
    hangup: () => boolean
  }
}

let sdk: PlivoClient | null = null
let loggedInUser: string | null = null
let active: DialerVoiceConnectOpts | null = null

function errorMessage(reason: unknown, fallback: string): string {
  if (typeof reason === 'string' && reason.trim()) return reason
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function bindClient(client: PlivoClient): void {
  client.client.on('onCallAnswered', () => {
    active?.onAccept()
  })
  client.client.on('onCallTerminated', () => {
    const current = active
    active = null
    current?.onDisconnect()
  })
  client.client.on('onCallFailed', (reason) => {
    const current = active
    active = null
    current?.onError(errorMessage(reason, 'Call failed'))
  })
}

async function ensureClient(username: string, password: string): Promise<PlivoClient> {
  if (sdk && loggedInUser === username) return sdk
  if (sdk) {
    try {
      sdk.client.hangup()
      sdk.client.logout()
    } catch {
      /* already torn down */
    }
    sdk = null
    loggedInUser = null
  }
  const mod = (await import('plivo-browser-sdk')) as { default?: unknown }
  const PlivoCtor = (mod.default ?? mod) as new (options: Record<string, unknown>) => PlivoClient
  const next = new PlivoCtor({
    debug: 'ERROR',
    permOnClick: true,
    closeProtection: true,
    enableTracking: true
  })
  bindClient(next)
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Plivo login timed out')), 15000)
    next.client.on('onLogin', () => {
      window.clearTimeout(timer)
      resolve()
    })
    next.client.on('onLoginFailed', (reason) => {
      window.clearTimeout(timer)
      reject(new Error(errorMessage(reason, 'Plivo login failed')))
    })
    if (!next.client.login(username, password)) {
      window.clearTimeout(timer)
      reject(new Error('Plivo login was rejected'))
    }
  })
  sdk = next
  loggedInUser = username
  return next
}

async function connect(opts: DialerVoiceConnectOpts): Promise<void> {
  const username = opts.username?.trim()
  const password = opts.password ?? ''
  if (!username || !password) {
    throw new Error('Plivo endpoint credentials are missing')
  }
  try {
    sdk?.client.hangup()
  } catch {
    /* no active call */
  }
  const client = await ensureClient(username, password)
  active = opts
  const started = client.client.call(opts.to, {
    'X-PH-CallId': opts.callId,
    'X-PH-To': opts.to
  })
  if (!started) {
    active = null
    throw new Error('Plivo could not start the call')
  }
}

async function hangup(): Promise<void> {
  try {
    sdk?.client.hangup()
  } catch {
    /* already ended */
  }
}

export const plivoVoice: DialerVoice = { connect, hangup }
