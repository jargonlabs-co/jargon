import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { BillingService } from './billing/types'
import type { Connection, Database } from './types'
import { toPublicApiKey } from './apiKeys'
import { toPublicUser } from './auth'
import { isMailboxProvider, revokeMailbox } from './mailboxes'
import { getSupabaseAdmin, supabaseConfigured } from './providers/supabaseAuth'

/** Credentials and short-lived auth state: never exported, always deleted with the org. */
const SECRET_COLLECTIONS = new Set<keyof Database>([
  'sessions',
  'oauthStates',
  'mcpAuthCodes',
  'mcpAccessTokens',
  'idempotencyRecords',
  'rateWindows'
])

function orgRows(db: Database, orgId: string): Partial<Record<keyof Database, unknown[]>> {
  const out: Partial<Record<keyof Database, unknown[]>> = {}
  for (const name of Object.keys(db) as Array<keyof Database>) {
    const rows = db[name]
    if (!Array.isArray(rows)) continue
    const mine = (rows as unknown[]).filter(
      (r) => r && typeof r === 'object' && (r as { orgId?: unknown }).orgId === orgId
    )
    if (mine.length) out[name] = mine
  }
  return out
}

function publicConnection(c: Connection) {
  const { secretsCipher: _secret, ...rest } = c
  return rest
}

/** Everything Jargon stores for an org, minus credentials. */
export function exportOrgData(store: DataStore, orgId: string) {
  const db = store.db
  const org = db.orgs.find((o) => o.id === orgId)
  if (!org) return null
  const rows = orgRows(db, orgId)
  const memberIds = new Set(db.memberships.filter((m) => m.orgId === orgId).map((m) => m.userId))
  const records: Record<string, unknown[]> = {}
  for (const [name, list] of Object.entries(rows) as Array<[keyof Database, unknown[]]>) {
    if (SECRET_COLLECTIONS.has(name) || name === 'orgs') continue
    if (name === 'apiKeys') records.apiKeys = (list as Database['apiKeys']).map(toPublicApiKey)
    else if (name === 'connections') records.connections = (list as Connection[]).map(publicConnection)
    else records[name] = list
  }
  return {
    exportedAt: new Date().toISOString(),
    org,
    members: db.users.filter((u) => memberIds.has(u.id)).map(toPublicUser),
    ...records
  }
}

export class DeleteBlockedError extends Error {
  constructor(
    message: string,
    readonly billingUrl?: string
  ) {
    super(message)
  }
}

/**
 * Permanently removes an org, its records, and members who belong to no other org.
 * Revokes mailbox tokens and deletes the Supabase login. Global hard-bounce suppressions stay.
 */
export async function deleteOrg(
  store: DataStore,
  config: ServerConfig,
  billing: BillingService,
  orgId: string
): Promise<{ deletedUsers: number; deletedRecords: number }> {
  const credits = await billing.getCredits(orgId)
  if (credits.plan !== 'free' && credits.status !== 'canceled') {
    throw new DeleteBlockedError(
      'Cancel your paid plan before deleting this workspace.',
      credits.billingUrl
    )
  }

  const db = store.db
  for (const conn of db.connections.filter((c) => c.orgId === orgId && isMailboxProvider(c.provider))) {
    await revokeMailbox(conn).catch(() => undefined)
  }

  const memberIds = db.memberships.filter((m) => m.orgId === orgId).map((m) => m.userId)
  const orphanIds = new Set(
    memberIds.filter((userId) => !db.memberships.some((m) => m.userId === userId && m.orgId !== orgId))
  )
  const orphans = db.users.filter((u) => orphanIds.has(u.id))

  let deletedRecords = 0
  store.update((d) => {
    for (const name of Object.keys(d) as Array<keyof Database>) {
      const rows = d[name]
      if (!Array.isArray(rows)) continue
      const kept = (rows as unknown[]).filter((r) => {
        const row = r as { orgId?: unknown; userId?: unknown; id?: unknown }
        if (row.orgId === orgId) return false
        if (name === 'orgs') return row.id !== orgId
        if (name === 'users') return !orphanIds.has(row.id as string)
        if (typeof row.userId === 'string' && orphanIds.has(row.userId)) return false
        return true
      })
      deletedRecords += rows.length - kept.length
      ;(d as unknown as Record<string, unknown[]>)[name] = kept
    }
  })

  if (supabaseConfigured(config)) {
    const admin = getSupabaseAdmin(config)
    for (const user of orphans) {
      if (!user.supabaseUserId) continue
      const { error } = await admin.auth.admin.deleteUser(user.supabaseUserId)
      if (error) console.warn(`[jargon] Could not delete Supabase user ${user.id}: ${error.message}`)
    }
  }
  console.log(`[jargon] Deleted org ${orgId}: ${deletedRecords} record(s), ${orphans.length} user(s)`)
  return { deletedUsers: orphans.length, deletedRecords }
}
