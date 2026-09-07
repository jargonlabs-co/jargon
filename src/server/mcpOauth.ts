import { createHash } from 'crypto'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { hashToken, randomToken, uid } from './crypto'
import { resolveApiKeyAuth } from './apiKeys'
import type { ApiKeyEnvironment } from './types'

const CODE_TTL_MS = 10 * 60 * 1000
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type McpActor = {
  userId: string
  orgId: string
  environment: ApiKeyEnvironment
  via: 'api_key' | 'oauth'
}

export function issuerUrl(config: ServerConfig): string {
  return config.publicUrl.replace(/\/$/, '')
}

export function mcpResourceUrl(config: ServerConfig): string {
  return `${issuerUrl(config)}/mcp`
}

export function protectedResourceMetadata(config: ServerConfig) {
  const issuer = issuerUrl(config)
  return {
    resource: mcpResourceUrl(config),
    authorization_servers: [issuer],
    scopes_supported: ['jargon'],
    bearer_methods_supported: ['header'],
    resource_name: 'Jargon GTM execution'
  }
}

export function authorizationServerMetadata(config: ServerConfig) {
  const issuer = issuerUrl(config)
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['jargon']
  }
}

export function wwwAuthenticate(config: ServerConfig): string {
  const meta = `${issuerUrl(config)}/.well-known/oauth-protected-resource`
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
  const clientId = `mcp_${randomToken(16)}`
  store.update((db) => {
    db.mcpOAuthClients.push({
      id: uid('mcpcli'),
      clientId,
      clientName: input.client_name?.trim() || 'Claude',
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
): { access_token: string; token_type: 'Bearer'; expires_in: number } {
  const now = Date.now()
  const row = store.db.mcpAuthCodes.find(
    (c) => c.codeHash === hashToken(input.code) && c.expiresAt > now
  )
  if (!row) throw new Error('Invalid or expired code')
  if (row.clientId !== input.clientId) throw new Error('client_id mismatch')
  if (row.redirectUri !== input.redirectUri) throw new Error('redirect_uri mismatch')
  if (pkceS256(input.codeVerifier) !== row.codeChallenge) throw new Error('PKCE verification failed')

  const token = `mcp_${randomToken(24)}`
  store.update((db) => {
    db.mcpAuthCodes = db.mcpAuthCodes.filter((c) => c.id !== row.id)
    db.mcpAccessTokens = db.mcpAccessTokens.filter((t) => t.expiresAt > now)
    db.mcpAccessTokens.push({
      id: uid('mcptok'),
      tokenHash: hashToken(token),
      clientId: row.clientId,
      userId: row.userId,
      orgId: row.orgId,
      createdAt: now,
      expiresAt: now + TOKEN_TTL_MS
    })
  })
  return { access_token: token, token_type: 'Bearer', expires_in: Math.floor(TOKEN_TTL_MS / 1000) }
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
