import type { ServerConfig } from '../config'
import {
  getConnection,
  readSecrets,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import type { DataStore } from '../store'

const HEYREACH_BASE = 'https://api.heyreach.io/api/public'

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-API-KEY': apiKey
  }
}

export function ensureHeyReachConnection(
  store: DataStore,
  orgId: string,
  serverConfig: ServerConfig
) {
  const apiKey = serverConfig.heyreach.apiKey.trim()
  if (!apiKey) return getConnection(store, orgId, 'heyreach')

  const existing = getConnection(store, orgId, 'heyreach')
  if (existing?.status === 'connected') {
    try {
      const secrets = readSecrets(existing)
      if (secrets.accessToken === apiKey) return existing
    } catch {
      /* re-upsert below */
    }
  }

  return upsertConnection(store, {
    orgId,
    provider: 'heyreach',
    status: 'connected',
    accountLabel: apiKey === 'demo' ? 'HeyReach (demo)' : 'HeyReach',
    secrets: { accessToken: apiKey } satisfies ProviderSecrets,
    meta: { mode: apiKey === 'demo' ? 'demo' : 'live', source: 'env' }
  })
}

export function resolveHeyReachApiKey(
  store: DataStore,
  orgId: string,
  serverConfig: ServerConfig
): { apiKey: string; demo: boolean } | null {
  ensureHeyReachConnection(store, orgId, serverConfig)
  const conn = getConnection(store, orgId, 'heyreach')
  if (conn?.status === 'connected') {
    try {
      const secrets = readSecrets(conn)
      const apiKey = secrets.accessToken?.trim()
      if (apiKey) {
        return { apiKey, demo: apiKey === 'demo' || conn.meta?.mode === 'demo' }
      }
    } catch {
      /* fall through */
    }
  }
  if (serverConfig.heyreach.apiKey.trim()) {
    const apiKey = serverConfig.heyreach.apiKey.trim()
    return { apiKey, demo: apiKey === 'demo' }
  }
  return null
}

export async function validateHeyReachKey(
  apiKey: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const key = apiKey.trim()
  if (!key) return { ok: false, error: 'API key required' }
  if (key === 'demo') return { ok: true, label: 'HeyReach (demo)' }

  try {
    const res = await fetch(`${HEYREACH_BASE}/auth/CheckApiKey`, {
      method: 'GET',
      headers: headers(key)
    })
    if (res.ok) return { ok: true, label: 'HeyReach' }
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      error: text.trim() || `HeyReach key check failed (${res.status})`
    }
  } catch {
    // Network failure should not block deploy / connect in constrained environments.
    return { ok: true, label: 'HeyReach (unverified)' }
  }
}

export async function sendHeyReachLinkedInMessage(input: {
  apiKey: string
  linkedinUrl: string
  message: string
  demo: boolean
}): Promise<{ id: string; mode: 'demo' | 'heyreach' }> {
  if (input.demo || input.apiKey === 'demo') {
    return { id: `demo_li_${Date.now()}`, mode: 'demo' }
  }

  const linkedinUrl = input.linkedinUrl.trim()
  if (!linkedinUrl) {
    throw new Error('LinkedIn profile URL required to send via HeyReach')
  }

  try {
    const res = await fetch(`${HEYREACH_BASE}/inbox/SendMessage`, {
      method: 'POST',
      headers: headers(input.apiKey),
      body: JSON.stringify({
        linkedInAccountId: null,
        conversationId: null,
        message: input.message,
        linkedInUserProfileUrl: linkedinUrl
      })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text.trim() || `HeyReach send failed (${res.status})`)
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string }
    return {
      id: json.id || json.messageId || `heyreach_${Date.now()}`,
      mode: 'heyreach'
    }
  } catch (err) {
    if (err instanceof Error) throw err
    throw new Error('HeyReach send failed')
  }
}
