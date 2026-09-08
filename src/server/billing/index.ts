import type { ServerConfig } from '../config'
import type { DataStore } from '../store'
import { CREDIT_COSTS, type BillableReason } from './catalog'
import { StoreBillingService } from './storeBilling'
import { createStripeAdapter, stripeConfigured } from './stripe'
import { supabaseBillingReady, SupabaseBillingService } from './supabaseBilling'
import type { BillingService, DebitResult } from './types'

export async function createBillingService(store: DataStore, config: ServerConfig): Promise<BillingService> {
  let service: BillingService | null = null
  const stripe = createStripeAdapter(config, () => {
    if (!service) throw new Error('Billing service not ready')
    return service
  })
  const options = {
    paymentsReady: stripeConfigured(config),
    createLink: stripe.createBillingLink,
    applyWebhook: stripe.applyStripeWebhook
  }
  if (await supabaseBillingReady(config)) {
    service = new SupabaseBillingService(config, options)
    console.log('[jargon] Billing: supabase')
  } else {
    service = new StoreBillingService(store, config.appUrl, options)
    console.log('[jargon] Billing: local store (run docs/supabase-billing.sql to use Supabase)')
  }
  if (options.paymentsReady) console.log('[jargon] Stripe: live')
  else console.log('[jargon] Stripe: pending (set STRIPE_SECRET_KEY after Atlas)')
  return service
}

export function projectNamesFor(store: DataStore, orgId: string): Record<string, string> {
  const names: Record<string, string> = {}
  for (const project of store.db.projects) {
    if (project.orgId === orgId) names[project.id] = project.name
  }
  return names
}

export async function chargeIfLive(
  billing: BillingService,
  input: {
    orgId: string
    sandbox: boolean
    reason: BillableReason
    projectId?: string
    apiKeyId?: string
  }
): Promise<DebitResult> {
  if (input.sandbox) {
    const credits = await billing.getCredits(input.orgId)
    return { ok: true, creditsUsed: 0, remaining: credits.credits }
  }
  return billing.debit({
    orgId: input.orgId,
    amount: CREDIT_COSTS[input.reason],
    reason: input.reason,
    projectId: input.projectId,
    apiKeyId: input.apiKeyId,
    environment: 'live'
  })
}

export async function refundCredits(
  billing: BillingService,
  orgId: string,
  amount: number,
  reason: string
): Promise<void> {
  if (amount <= 0) return
  await billing.grant({ orgId, amount, source: 'refund', reason })
}

export function meBillingFields(credits: Awaited<ReturnType<BillingService['getCredits']>>) {
  return {
    plan: {
      id: credits.plan,
      name: credits.planName,
      creditsIncluded: credits.included,
      status: credits.status
    },
    credits: {
      remaining: credits.credits,
      included: credits.included,
      periodStart: credits.periodStart,
      periodEnd: credits.periodEnd,
      billingUrl: credits.billingUrl,
      wallets: credits.wallets,
      creditTopups: credits.creditTopups
    },
    payments: credits.payments
  }
}
