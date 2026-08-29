import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { PlanId, Subscription, SubscriptionStatus } from './types'
import { uid } from './crypto'

export const PLAN_CATALOG: Record<
  PlanId,
  {
    id: PlanId
    name: string
    priceMonthly: number
    description: string
    buildLimit: number | null
    features: string[]
  }
> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    description: 'Try Jargon with your team',
    buildLimit: 5,
    features: ['5 UI builds', 'Share links', 'Crustdata context', 'Desktop + CLI']
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 49,
    description: 'Deploy outbound UIs org-wide',
    buildLimit: null,
    features: [
      'Unlimited builds',
      'Priority support',
      'Gmail + Twilio outbound',
      'API keys for Claude Code'
    ]
  }
}

export function ensureSubscription(store: DataStore, orgId: string): Subscription {
  let sub = store.db.subscriptions.find((s) => s.orgId === orgId)
  if (sub) return sub
  const now = Date.now()
  sub = {
    id: uid('sub'),
    orgId,
    plan: 'free',
    status: 'active',
    createdAt: now,
    updatedAt: now
  }
  store.update((db) => {
    db.subscriptions.push(sub!)
  })
  return sub
}

export function orgBuildCount(store: DataStore, orgId: string): number {
  return store.db.projects.filter((p) => p.orgId === orgId).length
}

export function billingSnapshot(store: DataStore, orgId: string, config: ServerConfig) {
  const sub = ensureSubscription(store, orgId)
  const plan = PLAN_CATALOG[sub.plan]
  const builds = orgBuildCount(store, orgId)
  return {
    plan: sub.plan,
    status: sub.status,
    planName: plan.name,
    priceMonthly: plan.priceMonthly,
    buildCount: builds,
    buildLimit: plan.buildLimit,
    currentPeriodEnd: sub.currentPeriodEnd,
    stripeConfigured: Boolean(config.stripe.secretKey && config.stripe.pricePro),
    plans: Object.values(PLAN_CATALOG)
  }
}

export function updateSubscription(
  store: DataStore,
  orgId: string,
  patch: Partial<Pick<Subscription, 'plan' | 'status' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'currentPeriodEnd'>>
): Subscription {
  const sub = ensureSubscription(store, orgId)
  store.update((db) => {
    const row = db.subscriptions.find((s) => s.id === sub.id)!
    Object.assign(row, patch, { updatedAt: Date.now() })
  })
  return store.db.subscriptions.find((s) => s.orgId === orgId)!
}

async function stripeClient(secretKey: string) {
  const { default: Stripe } = await import('stripe')
  return new Stripe(secretKey)
}

export async function createCheckoutSession(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  userEmail: string
): Promise<{ url: string }> {
  if (!config.stripe.secretKey || !config.stripe.pricePro) {
    throw new Error('Billing is not configured on this server')
  }
  const sub = ensureSubscription(store, orgId)
  const stripe = await stripeClient(config.stripe.secretKey)

  let customerId = sub.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { orgId }
    })
    customerId = customer.id
    updateSubscription(store, orgId, { stripeCustomerId: customerId })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: config.stripe.pricePro, quantity: 1 }],
    success_url: `${config.portalUrl}/billing?upgraded=1`,
    cancel_url: `${config.portalUrl}/billing`,
    metadata: { orgId }
  })
  if (!session.url) throw new Error('Could not create checkout session')
  return { url: session.url }
}

export async function createBillingPortalSession(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): Promise<{ url: string }> {
  if (!config.stripe.secretKey) {
    throw new Error('Billing is not configured on this server')
  }
  const sub = ensureSubscription(store, orgId)
  if (!sub.stripeCustomerId) {
    throw new Error('No billing account yet — upgrade to Pro first')
  }
  const stripe = await stripeClient(config.stripe.secretKey)
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${config.portalUrl}/billing`
  })
  return { url: session.url }
}

export async function handleStripeWebhook(
  store: DataStore,
  config: ServerConfig,
  rawBody: Buffer,
  signature: string | undefined
): Promise<void> {
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
    throw new Error('Stripe webhook not configured')
  }
  const stripe = await stripeClient(config.stripe.secretKey)
  const event = stripe.webhooks.constructEvent(rawBody, signature ?? '', config.stripe.webhookSecret)

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { metadata?: { orgId?: string }; subscription?: string }
    const orgId = session.metadata?.orgId
    if (orgId) {
      updateSubscription(store, orgId, {
        plan: 'pro',
        status: 'active',
        stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : undefined
      })
    }
    return
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as {
      id: string
      status: string
      metadata?: { orgId?: string }
      current_period_end?: number
    }
    const orgId = subscription.metadata?.orgId
    if (!orgId) {
      const match = store.db.subscriptions.find((s) => s.stripeSubscriptionId === subscription.id)
      if (!match) return
      applyStripeSubscriptionStatus(
        store,
        match.orgId,
        mapStripeStatus(subscription.status),
        subscription.current_period_end
      )
      return
    }
    applyStripeSubscriptionStatus(store, orgId, mapStripeStatus(subscription.status), subscription.current_period_end)
  }
}

function mapStripeStatus(status: string): SubscriptionStatus {
  if (status === 'active') return 'active'
  if (status === 'trialing') return 'trialing'
  if (status === 'past_due') return 'past_due'
  if (status === 'canceled' || status === 'unpaid') return 'canceled'
  return 'none'
}

function applyStripeSubscriptionStatus(
  store: DataStore,
  orgId: string,
  status: SubscriptionStatus,
  currentPeriodEnd?: number
): void {
  const plan: PlanId = status === 'active' || status === 'trialing' || status === 'past_due' ? 'pro' : 'free'
  updateSubscription(store, orgId, {
    plan,
    status,
    currentPeriodEnd: currentPeriodEnd ? currentPeriodEnd * 1000 : undefined
  })
}
