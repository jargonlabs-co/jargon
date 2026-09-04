import type { DataStore } from './store'
import { uid } from './crypto'
import type { Membership, Org, User } from './types'

/**
 * Ensure a demo workspace row exists for empty stores.
 * Passwords are NOT stored here — demo credentials live in Supabase Auth only.
 */
export function ensureBootstrapTenant(store: DataStore): void {
  if (store.db.users.length > 0) return

  const now = Date.now()
  const user: User = {
    id: uid('user'),
    email: 'demo@jargon.app',
    name: 'Tara',
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

  console.log('[jargon] Bootstrapped demo workspace for demo@jargon.app (Auth via Supabase)')
}
