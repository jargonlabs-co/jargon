import type { DialerVoice, DialerVoiceConnectOpts } from '../../../src/renderer/src/lib/dialerVoice'

type PlivoClient = {
  client: {
    on: (event: string, cb: (...args: unknown[]) => void) => void
    login: (username: string, password: string) => boolean
    loginWithAccessToken?: (accessToken: string) => boolean
    logout: () => boolean
    call: (phoneNumber: string, extraHeaders?: Record<string, string>) => boolean
    hangup: () => boolean
  }
}

let sdk: PlivoClient | null = null
let loggedInKey: string | null = null
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

async function ensureClient(opts: {
  accessToken?: string
  username?: string
  password?: string
}): Promise<PlivoClient> {
  const accessToken = opts.accessToken?.trim()
  const username = opts.username?.trim()
  const password = opts.password ?? ''
  const sessionKey = accessToken ? `jwt:${accessToken.slice(0, 24)}` : `pwd:${username}`
  if (sdk && loggedInKey === sessionKey) return sdk
  if (sdk) {
    try {
      sdk.client.hangup()
      sdk.client.logout()
    } catch {
      /* already torn down */
    }
    sdk = null
    loggedInKey = null
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
    let started = false
    if (accessToken && typeof next.client.loginWithAccessToken === 'function') {
      started = next.client.loginWithAccessToken(accessToken)
    } else if (username && password) {
      started = next.client.login(username, password)
    }
    if (!started) {
      window.clearTimeout(timer)
      reject(
        new Error(
          accessToken
            ? 'Plivo JWT login was rejected (upgrade plivo-browser-sdk for loginWithAccessToken)'
            : 'Plivo login was rejected'
        )
      )
    }
  })
  sdk = next
  loggedInKey = sessionKey
  return next
}

async function connect(opts: DialerVoiceConnectOpts): Promise<void> {
  const accessToken = opts.accessToken?.trim()
  const username = opts.username?.trim()
  const password = opts.password ?? ''
  if (!accessToken && (!username || !password)) {
    throw new Error('Plivo access token is missing')
  }
  try {
    sdk?.client.hangup()
  } catch {
    /* no active call */
  }
  const client = await ensureClient({ accessToken, username, password })
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
