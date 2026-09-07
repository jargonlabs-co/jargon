import type { DataStore } from './store'
import { hashToken, uid } from './crypto'
import type { IdempotencyRecord } from './types'

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

function pruneExpired(store: DataStore, now: number): void {
  if (!store.db.idempotencyRecords?.some((r) => r.expiresAt <= now)) return
  store.update((db) => {
    db.idempotencyRecords = (db.idempotencyRecords ?? []).filter((r) => r.expiresAt > now)
  })
}

export function readIdempotency(
  store: DataStore,
  orgId: string,
  rawKey: string,
  method: string,
  path: string
):
  | { hit: true; status: number; body: unknown }
  | { hit: false }
  | { conflict: true } {
  const now = Date.now()
  pruneExpired(store, now)
  const keyHash = hashToken(rawKey)
  const row = (store.db.idempotencyRecords ?? []).find(
    (r) => r.orgId === orgId && r.keyHash === keyHash && r.expiresAt > now
  )
  if (!row) return { hit: false }
  if (row.method !== method || row.path !== path) return { conflict: true }
  return { hit: true, status: row.status, body: row.body }
}

export function writeIdempotency(
  store: DataStore,
  orgId: string,
  rawKey: string,
  method: string,
  path: string,
  status: number,
  body: unknown
): void {
  const now = Date.now()
  const keyHash = hashToken(rawKey)
  const record: IdempotencyRecord = {
    id: uid('idem'),
    orgId,
    keyHash,
    method,
    path,
    status,
    body,
    createdAt: now,
    expiresAt: now + IDEMPOTENCY_TTL_MS
  }
  store.update((db) => {
    if (!db.idempotencyRecords) db.idempotencyRecords = []
    db.idempotencyRecords = db.idempotencyRecords.filter(
      (r) => !(r.orgId === orgId && r.keyHash === keyHash)
    )
    db.idempotencyRecords.push(record)
    if (db.idempotencyRecords.length > 2000) {
      db.idempotencyRecords = db.idempotencyRecords
        .filter((r) => r.expiresAt > now)
        .slice(-1500)
    }
  })
}
