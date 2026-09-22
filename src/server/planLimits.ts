import { PLANS, type PlanId } from './billing/catalog'
import type { BillingService } from './billing/types'
import type { DataStore } from './store'

export class PlanLimitError extends Error {
  readonly code = 'plan_limit'
  readonly status = 403

  constructor(message: string) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

/** Workspaces that can create tools with no Free-plan cap. */
const UNLIMITED_TOOLS_EMAILS = new Set(['tara@jargonlabs.co'])

export function countOrgTools(store: DataStore, orgId: string): number {
  return store.db.projects.filter((p) => p.orgId === orgId).length
}

export function orgSkipsToolLimit(store: DataStore, orgId: string): boolean {
  const memberIds = new Set(
    store.db.memberships.filter((membership) => membership.orgId === orgId).map((membership) => membership.userId)
  )
  return store.db.users.some(
    (user) => memberIds.has(user.id) && UNLIMITED_TOOLS_EMAILS.has(user.email.trim().toLowerCase())
  )
}

/** Enforce Free-tier maxTools (and future maxDataSources) before creating a tool. */
export async function assertCanCreateTool(
  billing: BillingService,
  store: DataStore,
  orgId: string
): Promise<void> {
  const credits = await billing.getCredits(orgId)
  const planId = (credits.plan ?? 'free') as PlanId
  const plan = PLANS[planId] ?? PLANS.free
  if (plan.maxTools == null) return
  if (orgSkipsToolLimit(store, orgId)) return

  const used = countOrgTools(store, orgId)
  if (used >= plan.maxTools) {
    throw new PlanLimitError(
      `${plan.name} plan allows ${plan.maxTools} tool${plan.maxTools === 1 ? '' : 's'}. Upgrade to create more.`
    )
  }
}
