import type { ServerConfig } from './config'
import type { JsonStore } from './store'
import { decryptJson, encryptJson, randomToken, uid } from './crypto'
import type { Connection, ConnectionProvider, ConnectionPublic, OAuthState } from './types'

export type ProviderSecrets = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  extra?: Record<string, string>
}

export function toPublicConnection(c: Connection): ConnectionPublic {
  return {
    id: c.id,
    provider: c.provider,
    status: c.status,
    accountLabel: c.accountLabel,
    meta: c.meta,
    lastSyncAt: c.lastSyncAt,
    error: c.error,
    updatedAt: c.updatedAt
  }
}

export function getConnection(store: JsonStore, orgId: string, provider: ConnectionProvider) {
  return store.db.connections.find((c) => c.orgId === orgId && c.provider === provider)
}

export function readSecrets(connection: Connection): ProviderSecrets {
  return decryptJson<ProviderSecrets>(connection.secretsCipher)
}

export function upsertConnection(
  store: JsonStore,
  input: {
    orgId: string
    provider: ConnectionProvider
    status: Connection['status']
    accountLabel?: string
    secrets: ProviderSecrets
    meta?: Record<string, string>
    error?: string
  }
): Connection {
  const now = Date.now()
  let result: Connection | undefined
  store.update((db) => {
    const existing = db.connections.find(
      (c) => c.orgId === input.orgId && c.provider === input.provider
    )
    if (existing) {
      existing.status = input.status
      existing.accountLabel = input.accountLabel
      existing.secretsCipher = encryptJson(input.secrets)
      existing.meta = input.meta ?? existing.meta
      existing.error = input.error
      existing.updatedAt = now
      result = existing
    } else {
      const created: Connection = {
        id: uid('conn'),
        orgId: input.orgId,
        provider: input.provider,
        status: input.status,
        accountLabel: input.accountLabel,
        secretsCipher: encryptJson(input.secrets),
        meta: input.meta ?? {},
        error: input.error,
        createdAt: now,
        updatedAt: now
      }
      db.connections.push(created)
      result = created
    }
  })
  return result!
}

export function createOAuthState(
  store: JsonStore,
  input: {
    orgId: string
    userId: string
    provider: ConnectionProvider
    codeVerifier?: string
  }
): OAuthState {
  const state: OAuthState = {
    id: randomToken(24),
    orgId: input.orgId,
    userId: input.userId,
    provider: input.provider,
    codeVerifier: input.codeVerifier,
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 15
  }
  store.update((db) => {
    db.oauthStates = db.oauthStates.filter((s) => s.expiresAt > Date.now())
    db.oauthStates.push(state)
  })
  return state
}

export function consumeOAuthState(store: JsonStore, id: string): OAuthState | null {
  const state = store.db.oauthStates.find((s) => s.id === id && s.expiresAt > Date.now())
  if (!state) return null
  store.update((db) => {
    db.oauthStates = db.oauthStates.filter((s) => s.id !== id)
  })
  return state
}

export function oauthRedirectUri(config: ServerConfig, provider: ConnectionProvider): string {
  return `${config.publicUrl}/oauth/${provider}/callback`
}

export function desktopDeepLink(config: ServerConfig, path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString()
  return `${config.deepLinkScheme}://${path}?${qs}`
}
