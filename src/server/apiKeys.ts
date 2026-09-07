import type { DataStore } from './store'
import { hashToken, randomToken, uid } from './crypto'
import type { ApiKey, ApiKeyEnvironment, ApiKeyPublic, Org, User } from './types'

const LIVE_PREFIX = 'jarg_'
const TEST_PREFIX = 'jarg_test_'

export function generateApiKeyToken(environment: ApiKeyEnvironment): string {
  const prefix = environment === 'sandbox' ? TEST_PREFIX : LIVE_PREFIX
  return `${prefix}${randomToken(24)}`
}

export function toPublicApiKey(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    environment: key.environment ?? 'live',
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt
  }
}

export function createApiKey(
  store: DataStore,
  input: { orgId: string; userId: string; name: string; environment?: ApiKeyEnvironment }
): { apiKey: ApiKey; token: string } {
  const environment = input.environment === 'sandbox' ? 'sandbox' : 'live'
  const token = generateApiKeyToken(environment)
  const now = Date.now()
  const apiKey: ApiKey = {
    id: uid('key'),
    orgId: input.orgId,
    userId: input.userId,
    name: input.name.trim() || 'CLI key',
    prefix: token.slice(0, environment === 'sandbox' ? 16 : 12),
    tokenHash: hashToken(token),
    environment,
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
  if (!token.startsWith(LIVE_PREFIX)) return null
  const tokenHash = hashToken(token)
  const apiKey = store.db.apiKeys.find((k) => k.tokenHash === tokenHash && !k.revokedAt)
  if (!apiKey) return null
  const user = store.db.users.find((u) => u.id === apiKey.userId)
  const org = store.db.orgs.find((o) => o.id === apiKey.orgId)
  if (!user || !org) return null
  if (!apiKey.environment) {
    apiKey.environment = token.startsWith(TEST_PREFIX) ? 'sandbox' : 'live'
  }
  const now = Date.now()
  store.update((db) => {
    const k = db.apiKeys.find((x) => x.id === apiKey.id)
    if (k) {
      k.lastUsedAt = now
      if (!k.environment) k.environment = apiKey.environment
    }
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
