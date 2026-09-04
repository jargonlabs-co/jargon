import type { Request, Response, NextFunction } from 'express'
import type { DataStore } from './store'
import { hashToken, uid } from './crypto'
import type { AuthPayload, Org, PublicUser, Session, User } from './types'
import { resolveApiKeyAuth } from './apiKeys'
import type { ServerConfig } from './config'
import {
  getSupabaseUserFromToken,
  supabaseConfigured
} from './providers/supabaseAuth'

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export interface AuthContext {
  user: User
  org: Org
  session?: Session
  token: string
  via: 'session' | 'api_key' | 'supabase'
  apiKeyId?: string
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name }
}

export function createSession(
  store: DataStore,
  userId: string,
  orgId: string
): { token: string; session: Session } {
  const token = uid('tok').replace(/^tok_/, '') + uid('x').slice(-12)
  const now = Date.now()
  const session: Session = {
    id: uid('sess'),
    userId,
    orgId,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  }
  store.update((db) => {
    db.sessions = db.sessions.filter((s) => s.expiresAt > now)
    db.sessions.push(session)
  })
  return { token, session }
}

export function authPayload(store: DataStore, token: string, user: User, org: Org): AuthPayload {
  return { token, user: toPublicUser(user), org }
}

function orgForUser(store: DataStore, userId: string): Org | null {
  const membership = store.db.memberships.find((m) => m.userId === userId)
  if (!membership) return null
  return store.db.orgs.find((o) => o.id === membership.orgId) ?? null
}

export function resolveAuth(store: DataStore, header?: string | null): AuthContext | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  const apiKeyAuth = resolveApiKeyAuth(store, token)
  if (apiKeyAuth) {
    return {
      user: apiKeyAuth.user,
      org: apiKeyAuth.org,
      token,
      via: 'api_key',
      apiKeyId: apiKeyAuth.apiKey.id
    }
  }

  const tokenHash = hashToken(token)
  const now = Date.now()
  const session = store.db.sessions.find((s) => s.tokenHash === tokenHash && s.expiresAt > now)
  if (!session) return null
  const user = store.db.users.find((u) => u.id === session.userId)
  const org = store.db.orgs.find((o) => o.id === session.orgId)
  if (!user || !org) return null
  return { user, org, session, token, via: 'session' }
}

export async function resolveAuthAsync(
  store: DataStore,
  config: ServerConfig,
  header?: string | null
): Promise<AuthContext | null> {
  const sync = resolveAuth(store, header)
  if (sync) return sync
  if (!header?.startsWith('Bearer ') || !supabaseConfigured(config)) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token || token.startsWith('jarg_')) return null

  const supabaseUser = await getSupabaseUserFromToken(config, token)
  if (!supabaseUser?.email) return null

  let user =
    store.db.users.find((u) => u.supabaseUserId === supabaseUser.id) ??
    store.db.users.find((u) => u.email === supabaseUser.email!.toLowerCase())

  if (!user) return null

  if (!user.supabaseUserId) {
    store.update((db) => {
      const row = db.users.find((u) => u.id === user!.id)
      if (row) {
        row.supabaseUserId = supabaseUser.id
        row.updatedAt = Date.now()
      }
    })
    user = store.db.users.find((u) => u.id === user!.id)!
  }

  const org = orgForUser(store, user.id)
  if (!org) return null
  return { user, org, token, via: 'supabase' }
}

export function requireAuth(store: DataStore, config?: ServerConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const auth = config
        ? await resolveAuthAsync(store, config, req.header('authorization'))
        : resolveAuth(store, req.header('authorization'))
      if (!auth) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      req.auth = auth
      next()
    })().catch((err) => {
      next(err)
    })
  }
}

export function destroySession(store: DataStore, token: string): void {
  const tokenHash = hashToken(token)
  store.update((db) => {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash)
  })
}

/** Create app workspace (org) after Supabase Auth — not used for passwords. */
export function provisionWorkspace(
  store: DataStore,
  input: {
    email: string
    name?: string
    orgName?: string
    supabaseUserId: string
  }
): { user: User; org: Org } {
  const normalized = input.email.trim().toLowerCase()
  const existing = store.db.users.find((u) => u.email === normalized)
  if (existing) {
    if (!existing.supabaseUserId) {
      store.update((db) => {
        const row = db.users.find((u) => u.id === existing.id)
        if (row) {
          row.supabaseUserId = input.supabaseUserId
          row.passwordHash = undefined
          row.passwordSalt = undefined
          row.updatedAt = Date.now()
        }
      })
    }
    const org = orgForUser(store, existing.id)
    if (!org) throw new Error('No organization for user')
    return { user: store.db.users.find((u) => u.id === existing.id)!, org }
  }

  const now = Date.now()
  const userId = uid('user')
  const orgId = uid('org')
  store.update((db) => {
    db.users.push({
      id: userId,
      email: normalized,
      name: input.name?.trim() || normalized.split('@')[0],
      supabaseUserId: input.supabaseUserId,
      createdAt: now,
      updatedAt: now
    })
    db.orgs.push({
      id: orgId,
      name: input.orgName?.trim() || `${input.name || 'My'} Workspace`,
      slug: `${normalized.split('@')[0]}-${orgId.slice(-6)}`,
      createdAt: now,
      updatedAt: now
    })
    db.memberships.push({
      id: uid('mem'),
      orgId,
      userId,
      role: 'owner',
      createdAt: now
    })
  })
  return {
    user: store.db.users.find((u) => u.id === userId)!,
    org: store.db.orgs.find((o) => o.id === orgId)!
  }
}

/** @deprecated Use provisionWorkspace */
export const provisionLocalTenant = provisionWorkspace

