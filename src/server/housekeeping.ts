import type { DataStore } from './store'

const DAY_MS = 24 * 60 * 60 * 1000
/** Rate windows are per minute or per UTC day; anything older than this is dead. */
const RATE_WINDOW_KEEP_MS = 2 * DAY_MS
/** OAuth clients that never got (or no longer have) a token. */
const IDLE_CLIENT_MS = 30 * DAY_MS

/** Drop expired sessions, OAuth codes/tokens/states, idempotency records, old rate windows, and idle MCP clients. */
export function sweepExpired(store: DataStore, now = Date.now()): number {
  const db = store.db
  const liveClients = new Set([
    ...db.mcpAccessTokens.filter((t) => Math.max(t.expiresAt, t.refreshExpiresAt ?? 0) > now).map((t) => t.clientId),
    ...db.mcpAuthCodes.filter((c) => c.expiresAt > now).map((c) => c.clientId)
  ])
  const keep = {
    sessions: db.sessions.filter((s) => s.expiresAt > now),
    mcpAuthCodes: db.mcpAuthCodes.filter((c) => c.expiresAt > now),
    mcpAccessTokens: db.mcpAccessTokens.filter((t) => Math.max(t.expiresAt, t.refreshExpiresAt ?? 0) > now),
    oauthStates: db.oauthStates.filter((s) => s.expiresAt > now),
    idempotencyRecords: db.idempotencyRecords.filter((r) => r.expiresAt > now),
    rateWindows: db.rateWindows.filter((w) => w.windowStart > now - RATE_WINDOW_KEEP_MS),
    mcpOAuthClients: db.mcpOAuthClients.filter((c) => liveClients.has(c.clientId) || c.createdAt > now - IDLE_CLIENT_MS)
  }
  let removed = 0
  for (const [key, rows] of Object.entries(keep)) removed += (db[key as keyof typeof keep] as unknown[]).length - rows.length
  if (removed) store.update((d) => Object.assign(d, keep))
  return removed
}
