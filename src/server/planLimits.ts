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

export function countOrgTools(store: DataStore, orgId: string): number {
  return store.db.projects.filter((p) => p.orgId === orgId).length
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

  const used = countOrgTools(store, orgId)
  if (used >= plan.maxTools) {
    throw new PlanLimitError(
      `${plan.name} plan allows ${plan.maxTools} tool${plan.maxTools === 1 ? '' : 's'}. Upgrade to create more.`
    )
  }
}
