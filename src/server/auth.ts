import type { Request, Response, NextFunction } from 'express'
import type { JsonStore } from './store'
import { hashToken, uid } from './crypto'
import type { AuthPayload, Org, PublicUser, Session, User } from './types'
import { resolveApiKeyAuth } from './apiKeys'

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export interface AuthContext {
  user: User
  org: Org
  session?: Session
  token: string
  via: 'session' | 'api_key'
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
  store: JsonStore,
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

export function authPayload(store: JsonStore, token: string, user: User, org: Org): AuthPayload {
  return { token, user: toPublicUser(user), org }
}

export function resolveAuth(store: JsonStore, header?: string | null): AuthContext | null {
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

export function requireAuth(store: JsonStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = resolveAuth(store, req.header('authorization'))
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    req.auth = auth
    next()
  }
}

export function destroySession(store: JsonStore, token: string): void {
  const tokenHash = hashToken(token)
  store.update((db) => {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash)
  })
}
