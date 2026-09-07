import type { DataStore } from './store'
import { uid } from './crypto'
import type { ApiKeyEnvironment, RateWindow } from './types'

const WINDOW_MS = 15 * 60 * 1000

const LIMITS: Record<ApiKeyEnvironment, Record<RateWindow['action'], number>> = {
  live: { message: 60, call: 30 },
  sandbox: { message: 120, call: 60 }
}

export function consumeRateLimit(
  store: DataStore,
  orgId: string,
  action: RateWindow['action'],
  environment: ApiKeyEnvironment
): { ok: true } | { ok: false; retryAfterSec: number; limit: number } {
  const now = Date.now()
  const limit = LIMITS[environment][action]
  const windowStart = now - (now % WINDOW_MS)
  if (!store.db.rateWindows) {
    store.update((db) => {
      db.rateWindows = []
    })
  }

  let window = store.db.rateWindows.find(
    (w) => w.orgId === orgId && w.action === action && w.windowStart === windowStart
  )

  if (!window) {
    const created: RateWindow = {
      id: uid('rate'),
      orgId,
      action,
      windowStart,
      count: 0
    }
    store.update((db) => {
      db.rateWindows = (db.rateWindows ?? []).filter(
        (w) => w.windowStart >= windowStart - WINDOW_MS
      )
      db.rateWindows.push(created)
    })
    window = store.db.rateWindows.find((w) => w.id === created.id)!
  }

  if (window.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000))
    return { ok: false, retryAfterSec, limit }
  }

  store.update((db) => {
    const row = db.rateWindows.find((w) => w.id === window!.id)
    if (row) row.count += 1
  })
  return { ok: true }
}
