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

/** Comma-separated member emails from env. Unset falls back to the internal dogfood account. */
function emailFlag(name: string): Set<string> {
  const raw = process.env[name] ?? 'tara@jargonlabs.co'
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
}

export function countOrgTools(store: DataStore, orgId: string): number {
  return store.db.projects.filter((p) => p.orgId === orgId).length
}

function orgHasMemberIn(store: DataStore, orgId: string, emails: Set<string>): boolean {
  if (!emails.size) return false
  const memberIds = new Set(
    store.db.memberships.filter((membership) => membership.orgId === orgId).map((membership) => membership.userId)
  )
  return store.db.users.some((user) => memberIds.has(user.id) && emails.has(user.email.trim().toLowerCase()))
}

/** Orgs with a member in JARGON_UNLIMITED_TOOLS_EMAILS create tools with no plan cap. */
export function orgSkipsToolLimit(store: DataStore, orgId: string): boolean {
  return orgHasMemberIn(store, orgId, emailFlag('JARGON_UNLIMITED_TOOLS_EMAILS'))
}

/**
 * Orgs with a member in JARGON_HUBSPOT_ENRICHMENT_WAIT_EMAILS wait for Lusha to
 * write enrichment into HubSpot before enrolling. Customers never wait.
 */
export function orgWaitsForHubSpotEnrichment(store: DataStore, orgId: string): boolean {
  return orgHasMemberIn(store, orgId, emailFlag('JARGON_HUBSPOT_ENRICHMENT_WAIT_EMAILS'))
}

/** Enforce Free-tier maxTools before creating a tool. */
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
