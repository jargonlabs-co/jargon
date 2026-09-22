import { createHmac, randomUUID } from 'crypto'
import { uid } from './crypto'
import type { ServerConfig } from './config'
import type { DataStore } from './store'
import type { PoolAssignment, PoolChannel, RateWindow } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
/** Plivo default max call duration — phantoms past this are swept. */
export const CALL_PHANTOM_TTL_MS = 4 * 60 * 60 * 1000

export class PoolBudgetError extends Error {
  readonly code = 'pool_budget'
  readonly status = 429

  constructor(message: string) {
    super(message)
    this.name = 'PoolBudgetError'
  }
}

function utcDayStart(now = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function ensureAssignments(store: DataStore): void {
  if (!store.db.poolAssignments) {
    store.update((db) => {
      db.poolAssignments = []
    })
  }
}

/** Email / LinkedIn: sticky least-loaded (shared members OK). */
function stickyLeastLoaded<T extends { id: string }>(
  store: DataStore,
  orgId: string,
  channel: Exclude<PoolChannel, 'voice'>,
  members: T[]
): T | null {
  if (!members.length) return null
  ensureAssignments(store)
  const existing = store.db.poolAssignments.find(
    (a) => a.orgId === orgId && a.channel === channel
  )
  if (existing) {
    const match = members.find((m) => m.id === existing.memberId)
    if (match) return match
  }

  const counts = new Map<string, number>()
  for (const m of members) counts.set(m.id, 0)
  for (const a of store.db.poolAssignments) {
    if (a.channel !== channel) continue
    counts.set(a.memberId, (counts.get(a.memberId) ?? 0) + 1)
  }
  let best = members[0]
  let bestCount = counts.get(best.id) ?? 0
  for (const m of members.slice(1)) {
    const c = counts.get(m.id) ?? 0
    if (c < bestCount) {
      best = m
      bestCount = c
    }
  }
  persistAssignment(store, orgId, channel, best.id)
  return best
}

/**
 * Voice DIDs: exclusive sticky — one org per DID.
 * Sharing a DID poisons STIR/SHAKEN reputation and makes inbound ambiguous.
 * Exhaustion does not fall back to sharing; add inventory (or auto-provision later).
 */
function stickyExclusive<T extends { id: string }>(
  store: DataStore,
  orgId: string,
  members: T[]
): T {
  if (!members.length) {
    throw new Error('Plivo voice is not configured on this Jargon server.')
  }
  ensureAssignments(store)
  const existing = store.db.poolAssignments.find(
    (a) => a.orgId === orgId && a.channel === 'voice'
  )
  if (existing) {
    const match = members.find((m) => m.id === existing.memberId)
    if (match) return match
  }

  const taken = new Set(
    store.db.poolAssignments.filter((a) => a.channel === 'voice').map((a) => a.memberId)
  )
  const free = members.find((m) => !taken.has(m.id))
  if (!free) {
    throw new PoolBudgetError(
      'No free Plivo DIDs in the voice pool. Add a number to PLIVO_POOL_JSON (use the username Plivo returns after create — it appends a 12-digit suffix). Auto-provision is not enabled yet.'
    )
  }
  persistAssignment(store, orgId, 'voice', free.id)
  return free
}

function persistAssignment(
  store: DataStore,
  orgId: string,
  channel: PoolChannel,
  memberId: string
): void {
  const now = Date.now()
  store.update((db) => {
    db.poolAssignments = (db.poolAssignments ?? []).filter(
      (a) => !(a.orgId === orgId && a.channel === channel)
    )
    const row: PoolAssignment = {
      id: uid('pool'),
      orgId,
      channel,
      memberId,
      createdAt: now
    }
    db.poolAssignments.push(row)
  })
}

function consumeDailyBudget(
  store: DataStore,
  orgId: string,
  action: 'pool_email' | 'pool_linkedin' | 'pool_voice',
  limit: number,
  label: string
): void {
  if (limit <= 0) return
  const windowStart = utcDayStart()

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
        (w) => w.windowStart >= windowStart - DAY_MS
      )
      db.rateWindows.push(created)
    })
    window = store.db.rateWindows.find((w) => w.id === created.id)!
  }

  if (window.count >= limit) {
    throw new PoolBudgetError(
      `Daily ${label} budget reached (${limit}/day on managed infrastructure). Try again tomorrow or upgrade.`
    )
  }

  store.update((db) => {
    const row = db.rateWindows.find((w) => w.id === window!.id)
    if (row) row.count += 1
  })
}

export function isLiveCallPhase(phase: string): boolean {
  return phase === 'dialing' || phase === 'ringing' || phase === 'connected'
}

/** Mark abandoned live calls as failed (missed hangup webhooks). */
export function sweepPhantomCalls(store: DataStore, now = Date.now()): number {
  let swept = 0
  store.update((db) => {
    for (const call of db.calls) {
      if (!isLiveCallPhase(call.phase)) continue
      if (now - call.startedAt < CALL_PHANTOM_TTL_MS) continue
      call.phase = 'failed'
      call.endedAt = now
      swept += 1
    }
  })
  return swept
}

export function countLiveCallsForOrg(store: DataStore, orgId: string): number {
  sweepPhantomCalls(store)
  return store.db.calls.filter((c) => c.orgId === orgId && isLiveCallPhase(c.phase)).length
}

export function countLiveCallsForMember(store: DataStore, memberId: string): number {
  sweepPhantomCalls(store)
  return store.db.calls.filter(
    (c) => c.poolMemberId === memberId && isLiveCallPhase(c.phase)
  ).length
}

/**
 * Enforce concurrent + daily voice budgets at call-create (not at token mint).
 * Returns the exclusive DID/SIP endpoint for this org.
 */
export function beginManagedVoiceCall(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): {
  id: string
  fromNumber: string
  endpointUsername: string
} {
  sweepPhantomCalls(store)
  const live = countLiveCallsForOrg(store, orgId)
  if (live >= config.outboundPools.concurrentCallsPerOrg) {
    throw new PoolBudgetError(
      `Concurrent call limit reached (${config.outboundPools.concurrentCallsPerOrg}). End an active call and retry.`
    )
  }
  consumeDailyBudget(
    store,
    orgId,
    'pool_voice',
    config.outboundPools.voiceDailyPerOrg,
    'voice'
  )
  return allocateVoiceEndpoint(store, config, orgId)
}

/** Allocate a managed Gmail mailbox for this org (sticky least-loaded) + daily budget. */
export function allocateEmailMailbox(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): { id: string; refreshToken: string; label: string } {
  const members = config.outboundPools.emailMailboxes
  const mailbox = stickyLeastLoaded(store, orgId, 'email', members)
  if (!mailbox) {
    throw new Error('Gmail is not configured on this Jargon server.')
  }
  consumeDailyBudget(
    store,
    orgId,
    'pool_email',
    config.outboundPools.emailDailyPerOrg,
    'email'
  )
  return mailbox
}

/**
 * Exclusive sticky DID for this org.
 * fromNumber must be a Plivo-rented DID on this account (STIR/SHAKEN attestation A).
 */
export function allocateVoiceEndpoint(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): {
  id: string
  fromNumber: string
  endpointUsername: string
} {
  const members = config.outboundPools.voiceEndpoints
  return stickyExclusive(store, orgId, members)
}

/** Soft resolve — for JWT minting without consuming daily/concurrent budgets. */
export function resolveVoiceEndpointForOrg(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): {
  id: string
  fromNumber: string
  endpointUsername: string
} {
  return allocateVoiceEndpoint(store, config, orgId)
}

/** Allocate a managed HeyReach LinkedIn seat (sticky least-loaded) + daily budget. */
export function allocateLinkedInSeat(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): { id: string; accountId: string } | null {
  const seats = config.outboundPools.linkedinSeats
  if (!seats.length) return null
  const seat = stickyLeastLoaded(store, orgId, 'linkedin', seats)
  if (!seat) return null
  consumeDailyBudget(
    store,
    orgId,
    'pool_linkedin',
    config.outboundPools.linkedinDailyPerOrg,
    'LinkedIn'
  )
  return seat
}

/** Short-lived Plivo Browser SDK JWT — never ship endpoint passwords to the client. */
export function mintPlivoAccessToken(
  config: ServerConfig,
  endpointUsername: string,
  opts?: { lifetimeSec?: number; uid?: string }
): string {
  const authId = config.plivo.authId.trim()
  const authToken = config.plivo.authToken.trim()
  const username = endpointUsername.trim()
  if (!authId || !authToken || !username) {
    throw new Error('Plivo JWT mint requires authId, authToken, and endpoint username')
  }
  const lifetime = opts?.lifetimeSec ?? 3600
  const now = Math.floor(Date.now() / 1000)
  const header = {
    typ: 'JWT',
    alg: 'HS256',
    cty: 'plivo;v=1'
  }
  const payload = {
    jti: opts?.uid ?? `${username}-${randomUUID()}`,
    iss: authId,
    sub: username,
    nbf: now,
    exp: now + lifetime,
    grants: {
      voice: {
        incoming_allow: false,
        outgoing_allow: true
      }
    }
  }
  const enc = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  const data = `${enc(header)}.${enc(payload)}`
  const sig = createHmac('sha256', authToken)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${data}.${sig}`
}

export function poolHealth(
  store: DataStore,
  config: ServerConfig
): {
  emailMailboxes: number
  voiceEndpoints: number
  linkedinSeats: number
  emailDailyPerOrg: number
  linkedinDailyPerOrg: number
  voiceDailyPerOrg: number
  concurrentCallsPerOrg: number
  voiceMembers: Array<{
    id: string
    fromNumber: string
    orgId: string | null
    liveCalls: number
  }>
} {
  sweepPhantomCalls(store)
  const assignments = store.db.poolAssignments ?? []
  return {
    emailMailboxes: config.outboundPools.emailMailboxes.length,
    voiceEndpoints: config.outboundPools.voiceEndpoints.length,
    linkedinSeats: config.outboundPools.linkedinSeats.length,
    emailDailyPerOrg: config.outboundPools.emailDailyPerOrg,
    linkedinDailyPerOrg: config.outboundPools.linkedinDailyPerOrg,
    voiceDailyPerOrg: config.outboundPools.voiceDailyPerOrg,
    concurrentCallsPerOrg: config.outboundPools.concurrentCallsPerOrg,
    voiceMembers: config.outboundPools.voiceEndpoints.map((m) => {
      const holder = assignments.find((a) => a.channel === 'voice' && a.memberId === m.id)
      return {
        id: m.id,
        fromNumber: m.fromNumber,
        orgId: holder?.orgId ?? null,
        liveCalls: countLiveCallsForMember(store, m.id)
      }
    })
  }
}
