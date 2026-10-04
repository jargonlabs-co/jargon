import { createHash } from 'crypto'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { hashToken, randomToken, uid } from './crypto'
import { resolveApiKeyAuth } from './apiKeys'
import type { ApiKeyEnvironment } from './types'

const CODE_TTL_MS = 10 * 60 * 1000
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
/** Sliding: each refresh issues a new refresh token good for this long. */
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000

type TokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
}

export type McpActor = {
  userId: string
  orgId: string
  environment: ApiKeyEnvironment
  via: 'api_key' | 'oauth'
}

export function issuerUrl(config: ServerConfig): string {
  return config.publicUrl.replace(/\/$/, '')
}

/** The configured origin the client called (a legacy alias, or the canonical public URL). */
export function originFor(config: ServerConfig, host?: string): string {
  const h = (host ?? '').toLowerCase()
  const alias = h ? config.publicUrlAliases.find((url) => new URL(url).host.toLowerCase() === h) : undefined
  return alias ?? issuerUrl(config)
}

export function mcpResourceUrl(config: ServerConfig): string {
  return `${issuerUrl(config)}/mcp`
}

export function claudeConnectorInstallUrl(mcpUrl: string): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: 'Jargon',
    connectorUrl: mcpUrl
  })
  return `https://claude.ai/customize/connectors?${params.toString()}`
}

export function claudeConnectorStatus(store: DataStore, config: ServerConfig, orgId: string) {
  const now = Date.now()
  const token = store.db.mcpAccessTokens
    .filter((row) => row.orgId === orgId && Math.max(row.expiresAt, row.refreshExpiresAt ?? 0) > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const mcpUrl = mcpResourceUrl(config)
  return {
    connected: Boolean(token),
    connectedAt: token ? new Date(token.createdAt).toISOString() : null,
    mcpUrl,
    connectorUrl: claudeConnectorInstallUrl(mcpUrl)
  }
}

export function protectedResourceMetadata(config: ServerConfig, issuer = issuerUrl(config)) {
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: ['jargon'],
    bearer_methods_supported: ['header'],
    resource_name: 'Jargon GTM execution'
  }
}

export function authorizationServerMetadata(config: ServerConfig, issuer = issuerUrl(config)) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['jargon']
  }
}

export function wwwAuthenticate(config: ServerConfig, issuer = issuerUrl(config)): string {
  const meta = `${issuer}/.well-known/oauth-protected-resource`
  return `Bearer realm="jargon", resource_metadata="${meta}", scope="jargon"`
}

function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function registerMcpClient(
  store: DataStore,
  input: { client_name?: string; redirect_uris?: string[] }
): { client_id: string; redirect_uris: string[] } {
  const redirectUris = (input.redirect_uris ?? []).filter((u) => typeof u === 'string' && u.length > 0)
  if (!redirectUris.length) {
    throw new Error('redirect_uris required')
  }
  if (redirectUris.length > 10 || redirectUris.some((u) => u.length > 2048)) {
    throw new Error('redirect_uris too large')
  }
  const clientName = input.client_name?.trim().slice(0, 200) || 'Claude'
  const sameUris = (a: string[]) =>
    a.length === redirectUris.length && a.every((u, i) => u === redirectUris[i])
  const existing = store.db.mcpOAuthClients.find(
    (c) => c.clientName === clientName && sameUris(c.redirectUris)
  )
  if (existing) return { client_id: existing.clientId, redirect_uris: existing.redirectUris }
  const clientId = `mcp_${randomToken(16)}`
  store.update((db) => {
    db.mcpOAuthClients.push({
      id: uid('mcpcli'),
      clientId,
      clientName,
      redirectUris,
      createdAt: Date.now()
    })
  })
  return { client_id: clientId, redirect_uris: redirectUris }
}

export function issueAuthCode(
  store: DataStore,
  input: {
    clientId: string
    userId: string
    orgId: string
    redirectUri: string
    codeChallenge: string
    state?: string
  }
): string {
  const client = store.db.mcpOAuthClients.find((c) => c.clientId === input.clientId)
  if (!client) throw new Error('Unknown client')
  if (!client.redirectUris.includes(input.redirectUri)) throw new Error('redirect_uri mismatch')
  const code = randomToken(24)
  const now = Date.now()
  store.update((db) => {
    db.mcpAuthCodes = db.mcpAuthCodes.filter((c) => c.expiresAt > now)
    db.mcpAuthCodes.push({
      id: uid('mcpcode'),
      codeHash: hashToken(code),
      clientId: input.clientId,
      userId: input.userId,
      orgId: input.orgId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      state: input.state,
      createdAt: now,
      expiresAt: now + CODE_TTL_MS
    })
  })
  return code
}

export function exchangeAuthCode(
  store: DataStore,
  input: {
    code: string
    clientId: string
    redirectUri: string
    codeVerifier: string
  }
): TokenResponse {
  const now = Date.now()
  const row = store.db.mcpAuthCodes.find(
    (c) => c.codeHash === hashToken(input.code) && c.expiresAt > now
  )
  if (!row) throw new Error('Invalid or expired code')
  if (row.clientId !== input.clientId) throw new Error('client_id mismatch')
  if (row.redirectUri !== input.redirectUri) throw new Error('redirect_uri mismatch')
  if (pkceS256(input.codeVerifier) !== row.codeChallenge) throw new Error('PKCE verification failed')
  return issueTokens(store, row, { consumeCodeId: row.id })
}

/** Rotate: the presented refresh token is spent and a new access + refresh pair is issued. */
export function refreshAccessToken(
  store: DataStore,
  input: { refreshToken: string; clientId?: string }
): TokenResponse {
  const now = Date.now()
  const hash = hashToken(input.refreshToken)
  const row = store.db.mcpAccessTokens.find((t) => t.refreshHash === hash && (t.refreshExpiresAt ?? 0) > now)
  if (!row) throw new Error('Invalid or expired refresh token')
  if (input.clientId && input.clientId !== row.clientId) throw new Error('client_id mismatch')
  const stillMember = store.db.memberships.some((m) => m.userId === row.userId && m.orgId === row.orgId)
  if (!stillMember) throw new Error('Invalid or expired refresh token')
  return issueTokens(store, row, { replaceTokenId: row.id })
}

function issueTokens(
  store: DataStore,
  owner: { clientId: string; userId: string; orgId: string },
  opts: { consumeCodeId?: string; replaceTokenId?: string }
): TokenResponse {
  const now = Date.now()
  const access = `mcp_${randomToken(24)}`
  const refresh = `mcpr_${randomToken(32)}`
  store.update((db) => {
    if (opts.consumeCodeId) db.mcpAuthCodes = db.mcpAuthCodes.filter((c) => c.id !== opts.consumeCodeId)
    db.mcpAccessTokens = db.mcpAccessTokens.filter(
      (t) => t.id !== opts.replaceTokenId && Math.max(t.expiresAt, t.refreshExpiresAt ?? 0) > now
    )
    db.mcpAccessTokens.push({
      id: uid('mcptok'),
      tokenHash: hashToken(access),
      clientId: owner.clientId,
      userId: owner.userId,
      orgId: owner.orgId,
      createdAt: now,
      expiresAt: now + TOKEN_TTL_MS,
      refreshHash: hashToken(refresh),
      refreshExpiresAt: now + REFRESH_TTL_MS
    })
  })
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    refresh_token: refresh
  }
}

export function resolveMcpBearer(store: DataStore, header?: string | null): McpActor | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  if (token.startsWith('jarg_')) {
    const key = resolveApiKeyAuth(store, token)
    if (!key) return null
    return {
      userId: key.user.id,
      orgId: key.org.id,
      environment: key.apiKey.environment ?? 'live',
      via: 'api_key'
    }
  }

  const now = Date.now()
  const row = store.db.mcpAccessTokens.find(
    (t) => t.tokenHash === hashToken(token) && t.expiresAt > now
  )
  if (!row) return null
  return {
    userId: row.userId,
    orgId: row.orgId,
    environment: 'live',
    via: 'oauth'
  }
}
