import type { DataStore } from './store'
import { hashPassword, uid } from './crypto'
import type { Membership, Org, User } from './types'

/** Create a demo owner account on first boot so desktop can sign in immediately. */
export function ensureBootstrapTenant(store: DataStore): void {
  if (store.db.users.length > 0) return

  const now = Date.now()
  const { hash, salt } = hashPassword('jargon-demo')
  const user: User = {
    id: uid('user'),
    email: 'demo@jargon.app',
    name: 'Tara',
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now
  }
  const org: Org = {
    id: uid('org'),
    name: 'Jargon Demo',
    slug: 'jargon-demo',
    createdAt: now,
    updatedAt: now
  }
  const membership: Membership = {
    id: uid('mem'),
    orgId: org.id,
    userId: user.id,
    role: 'owner',
    createdAt: now
  }

  store.update((db) => {
    db.users.push(user)
    db.orgs.push(org)
    db.memberships.push(membership)
  })

  console.log('[jargon] Bootstrapped demo tenant demo@jargon.app / jargon-demo')
}
