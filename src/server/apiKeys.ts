import type { DataStore } from './store'
import { hashToken, randomToken, uid } from './crypto'
import type { ApiKey, ApiKeyPublic, Org, User } from './types'

const API_KEY_PREFIX = 'jarg_'

export function generateApiKeyToken(): string {
  return `${API_KEY_PREFIX}${randomToken(24)}`
}

export function toPublicApiKey(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt
  }
}

export function createApiKey(
  store: DataStore,
  input: { orgId: string; userId: string; name: string }
): { apiKey: ApiKey; token: string } {
  const token = generateApiKeyToken()
  const now = Date.now()
  const apiKey: ApiKey = {
    id: uid('key'),
    orgId: input.orgId,
    userId: input.userId,
    name: input.name.trim() || 'CLI key',
    prefix: token.slice(0, 12),
    tokenHash: hashToken(token),
    createdAt: now
  }
  store.update((db) => {
    db.apiKeys.push(apiKey)
  })
  return { apiKey, token }
}

export function resolveApiKeyAuth(
  store: DataStore,
  token: string
): { user: User; org: Org; apiKey: ApiKey } | null {
  if (!token.startsWith(API_KEY_PREFIX)) return null
  const tokenHash = hashToken(token)
  const apiKey = store.db.apiKeys.find((k) => k.tokenHash === tokenHash && !k.revokedAt)
  if (!apiKey) return null
  const user = store.db.users.find((u) => u.id === apiKey.userId)
  const org = store.db.orgs.find((o) => o.id === apiKey.orgId)
  if (!user || !org) return null
  const now = Date.now()
  store.update((db) => {
    const k = db.apiKeys.find((x) => x.id === apiKey.id)
    if (k) k.lastUsedAt = now
  })
  return { user, org, apiKey }
}

export function revokeApiKey(store: DataStore, orgId: string, keyId: string): boolean {
  let found = false
  store.update((db) => {
    const k = db.apiKeys.find((x) => x.id === keyId && x.orgId === orgId && !x.revokedAt)
    if (!k) return
    k.revokedAt = Date.now()
    found = true
  })
  return found
}

export function listApiKeys(store: DataStore, orgId: string): ApiKeyPublic[] {
  return store.db.apiKeys
    .filter((k) => k.orgId === orgId && !k.revokedAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublicApiKey)
}
