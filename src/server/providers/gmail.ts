import type { ServerConfig } from '../config'
import {
  createOAuthState,
  desktopDeepLink,
  oauthRedirectUri,
  type ProviderSecrets
} from '../connections'
import type { JsonStore } from '../store'

export function gmailAuthUrl(
  store: JsonStore,
  config: ServerConfig,
  orgId: string,
  userId: string
): string {
  if (!config.google.clientId) {
    const state = createOAuthState(store, { orgId, userId, provider: 'gmail' })
    return `${config.publicUrl}/oauth/gmail/callback?code=demo&state=${state.id}`
  }
  const state = createOAuthState(store, { orgId, userId, provider: 'gmail' })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', config.google.clientId)
  url.searchParams.set('redirect_uri', oauthRedirectUri(config, 'gmail'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.google.scopes)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state.id)
  return url.toString()
}

export async function exchangeGmailCode(
  config: ServerConfig,
  code: string
): Promise<ProviderSecrets & { accountLabel: string }> {
  if (code === 'demo' || !config.google.clientId) {
    return {
      accessToken: 'demo-gmail-token',
      refreshToken: 'demo-refresh',
      accountLabel: 'demo@jargon.app'
    }
  }
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: oauthRedirectUri(config, 'gmail'),
    grant_type: 'authorization_code'
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }

  let accountLabel = 'Gmail'
  try {
    const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${json.access_token}` }
    })
    if (me.ok) {
      const info = (await me.json()) as { email?: string }
      if (info.email) accountLabel = info.email
    }
  } catch {
    /* ignore */
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    tokenType: json.token_type,
    accountLabel
  }
}

export async function refreshGmailAccessToken(
  config: ServerConfig,
  secrets: ProviderSecrets
): Promise<ProviderSecrets> {
  if (!secrets.refreshToken) {
    throw new Error('Gmail authorization expired. Reconnect Gmail under Connections.')
  }

  const body = new URLSearchParams({
    refresh_token: secrets.refreshToken,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    grant_type: 'refresh_token'
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    expires_in?: number
    token_type?: string
  }

  return {
    ...secrets,
    accessToken: json.access_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    tokenType: json.token_type ?? secrets.tokenType
  }
}

export async function sendGmailMessage(input: {
  accessToken: string
  to: string
  subject: string
  body: string
  fromLabel?: string
  demo: boolean
}): Promise<{ id: string; mode: 'demo' | 'gmail' }> {
  if (input.demo || input.accessToken === 'demo-gmail-token') {
    return { id: `demo_mail_${Date.now()}`, mode: 'demo' }
  }

  const raw = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body
  ].join('\r\n')

  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encoded })
  })
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`)
  const json = (await res.json()) as { id: string }
  return { id: json.id, mode: 'gmail' }
}

export function finishGmailOAuthHtml(config: ServerConfig, ok: boolean, message: string): string {
  const deep = desktopDeepLink(config, 'oauth', {
    provider: 'gmail',
    status: ok ? 'ok' : 'error',
    message
  })
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? 'Gmail connected' : 'Gmail connection failed'}</h2>
  <p>${message}</p>
  <p>Returning to Jargon…</p>
  <script>location.href=${JSON.stringify(deep)}</script>
  <p><a href="${deep}">Open Jargon</a></p>
  </body></html>`
}
