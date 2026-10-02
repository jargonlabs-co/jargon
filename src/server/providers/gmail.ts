import type { ServerConfig } from '../config'
import { createOAuthState, oauthRedirectUri, type ProviderSecrets } from '../connections'
import type { DataStore } from '../store'

export function gmailAuthUrl(
  store: DataStore,
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
    throw new Error('Gmail authorization expired.')
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
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`)
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

/** Claude's app bridge has been seen dropping U+0020 in tool args; the widget sends NBSP instead. */
export function restoreCopiedSpaces(text: string): string {
  return String(text ?? '').replace(/\u00A0/g, ' ')
}

export function escapeEmailHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Turn outbound copy into HTML so iOS Mail keeps spaces, paragraphs, and wrapping. */
export function plainTextToEmailHtml(body: string): string {
  const text = restoreCopiedSpaces(body).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const paragraphs = text.split(/\n{2,}/)
  const inner = paragraphs
    .map((p) => {
      const html = escapeEmailHtml(p).replace(/\n/g, '<br>\n')
      return `<p style="margin:0 0 1em 0;word-spacing:normal;">${html || '&nbsp;'}</p>`
    })
    .join('\n')
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;word-spacing:normal;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;">
${inner}
</body>
</html>`
}

function foldBase64(value: string): string {
  return value.replace(/(.{76})/g, '$1\r\n').trim()
}

function encodeSubject(value: string): string {
  const cleaned = restoreCopiedSpaces(value).replace(/[\r\n]+/g, ' ')
  if (/^[\x20-\x7E]*$/.test(cleaned)) return cleaned
  return `=?UTF-8?B?${Buffer.from(cleaned, 'utf8').toString('base64')}?=`
}

export function buildGmailRawMime(input: { to: string; subject: string; body: string }): string {
  const plain = restoreCopiedSpaces(input.body)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r\n')
  const html = plainTextToEmailHtml(input.body)
  const boundary = 'jargon_alt_001'
  return [
    `To: ${input.to.trim()}`,
    `Subject: ${encodeSubject(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(plain, 'utf8').toString('base64')),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(html, 'utf8').toString('base64')),
    `--${boundary}--`,
    ''
  ].join('\r\n')
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

  const encoded = Buffer.from(buildGmailRawMime(input), 'utf8')
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
  if (!res.ok) throw new Error(`Gmail send failed (${res.status})`)
  const json = (await res.json()) as { id: string }
  return { id: json.id, mode: 'gmail' }
}

export function platformGmailReady(config: ServerConfig): boolean {
  return Boolean(
    config.google.clientId &&
      config.google.clientSecret &&
      (config.google.refreshToken || config.outboundPools.emailMailboxes.length > 0)
  )
}

/** Send from Jargon's managed mailbox pool (never customer OAuth). */
export async function sendPlatformGmail(
  config: ServerConfig,
  input: { to: string; subject: string; body: string; refreshToken?: string }
): Promise<{ id: string; mode: 'gmail' }> {
  const to = input.to.trim()
  if (!to || !to.includes('@')) {
    throw new Error('This contact has no email address.')
  }
  const refreshToken =
    input.refreshToken?.trim() ||
    config.outboundPools.emailMailboxes[0]?.refreshToken ||
    config.google.refreshToken
  if (!config.google.clientId || !config.google.clientSecret || !refreshToken) {
    throw new Error('Gmail is not configured on this Jargon server.')
  }
  try {
    const secrets = await refreshGmailAccessToken(config, {
      accessToken: 'pending',
      refreshToken
    })
    const result = await sendGmailMessage({
      accessToken: secrets.accessToken,
      to,
      subject: input.subject,
      body: input.body,
      demo: false
    })
    console.log('[jargon] Gmail send ok')
    return { id: result.id, mode: 'gmail' }
  } catch (err) {
    console.warn('[jargon] Gmail send failed')
    throw err
  }
}

export function finishGmailOAuthHtml(config: ServerConfig, ok: boolean, message: string): string {
  const next = `${config.appUrl}/`
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? 'Gmail connected' : 'Gmail connection failed'}</h2>
  <p>${message}</p>
  <p>Returning to Jargon…</p>
  <script>location.href=${JSON.stringify(next)}</script>
  <p><a href="${next}">Open Jargon</a></p>
  </body></html>`
}
