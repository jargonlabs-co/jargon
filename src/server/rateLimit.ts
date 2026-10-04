import type { RequestHandler } from 'express'
import type { DataStore } from './store'
import { uid } from './crypto'
import type { ApiKeyEnvironment, RateWindow } from './types'

const WINDOW_MS = 15 * 60 * 1000

const LIMITS: Record<ApiKeyEnvironment, Record<'message' | 'call', number>> = {
  live: { message: 60, call: 30 },
  sandbox: { message: 120, call: 60 }
}

/**
 * Per-IP fixed window, in process memory. Unauthenticated endpoints only;
 * per-replica counts are acceptable for abuse throttling.
 */
export function ipRateLimit(name: string, max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { windowStart: number; count: number }>()
  return (req, res, next) => {
    const now = Date.now()
    const windowStart = now - (now % windowMs)
    const key = req.ip ?? 'unknown'
    let entry = hits.get(key)
    if (!entry || entry.windowStart !== windowStart) {
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.windowStart !== windowStart) hits.delete(k)
      }
      entry = { windowStart, count: 0 }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      res.status(429).json({ error: `Too many ${name} attempts. Try again in ${retryAfterSec}s.` })
      return
    }
    next()
  }
}

export function consumeRateLimit(
  store: DataStore,
  orgId: string,
  action: 'message' | 'call',
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
