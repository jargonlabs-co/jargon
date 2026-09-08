import { createHmac, timingSafeEqual } from 'crypto'
import type { ServerConfig } from '../config'
import { findTopupPack, formatUsd, isPlanId, PLANS, type PlanId } from './catalog'
import type { BillingLinkInput, BillingLinkResult, BillingService } from './types'
import { billingUrlFor } from './view'

interface StripeSession {
  id: string
  mode?: string
  customer?: string | { id: string }
  metadata?: Record<string, string>
  amount_total?: number
  payment_intent?: string
  subscription?: string | { id: string }
}

function customerId(value: string | { id: string } | undefined): string | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? value : value.id
}

function subscriptionId(value: string | { id: string } | undefined): string | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? value : value.id
}

export function stripeConfigured(config: ServerConfig): boolean {
  return Boolean(config.stripe.secretKey)
}

export function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.split('=')
      return [key.trim(), rest.join('=')]
    })
  )
  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(Number(timestamp)) || age > 60 * 5) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function stripeForm(
  secretKey: string,
  path: string,
  fields: Record<string, string>
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(fields)
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const message =
      typeof json.error === 'object' && json.error && 'message' in json.error
        ? String((json.error as { message: string }).message)
        : `Stripe ${path} failed`
    throw new Error(message)
  }
  return json
}

async function ensureStripeCustomer(
  secretKey: string,
  input: { customerId?: string; email?: string; name?: string; orgId: string }
): Promise<string> {
  if (input.customerId) return input.customerId
  const created = await stripeForm(secretKey, 'customers', {
    email: input.email ?? '',
    name: input.name ?? '',
    'metadata[org_id]': input.orgId
  })
  return String(created.id)
}

export function createStripeAdapter(config: ServerConfig, billing: () => BillingService) {
  const pendingMessage =
    'Card payments go live when Stripe is connected. Review plans here; checkout will start automatically once Atlas is done.'

  async function createBillingLink(input: BillingLinkInput): Promise<BillingLinkResult> {
    const appBilling = billingUrlFor(config.appUrl)
    if (!config.stripe.secretKey) {
      const params = new URLSearchParams({ intent: input.intent })
      if (input.plan) params.set('plan', input.plan)
      if (input.packId) params.set('pack', input.packId)
      return {
        url: `${appBilling}?${params.toString()}`,
        provider: 'pending',
        message: pendingMessage
      }
    }

    const credits = await billing().getCredits(input.orgId)
    const customer = await ensureStripeCustomer(config.stripe.secretKey, {
      customerId: credits.stripeCustomerId,
      email: input.email,
      name: input.name,
      orgId: input.orgId
    })
    if (customer !== credits.stripeCustomerId) {
      await billing().setStripeCustomer(input.orgId, customer)
    }

    if (input.intent === 'portal') {
      const session = await stripeForm(config.stripe.secretKey, 'billing_portal/sessions', {
        customer,
        return_url: appBilling
      })
      return { url: String(session.url), provider: 'stripe' }
    }

    if (input.intent === 'upgrade') {
      const plan: PlanId = input.plan && isPlanId(input.plan) && input.plan !== 'free' ? input.plan : 'team'
      const catalog = PLANS[plan]
      if (!catalog.amountCents) {
        return {
          url: appBilling,
          provider: 'pending',
          message: 'Scale is billed with a custom invoice. Email tara@jargonlabs.co to upgrade.'
        }
      }
      const session = await stripeForm(config.stripe.secretKey, 'checkout/sessions', {
        mode: 'subscription',
        customer,
        success_url: `${appBilling}?checkout=success`,
        cancel_url: `${appBilling}?checkout=cancel`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(catalog.amountCents),
        'line_items[0][price_data][product_data][name]': `Jargon ${catalog.name}`,
        'line_items[0][price_data][product_data][description]': `${catalog.monthlyCredits.toLocaleString()} credits / month`,
        'line_items[0][price_data][recurring][interval]': 'month',
        'metadata[org_id]': input.orgId,
        'metadata[intent]': 'upgrade',
        'metadata[plan]': plan,
        'subscription_data[metadata][org_id]': input.orgId,
        'subscription_data[metadata][plan]': plan
      })
      return { url: String(session.url), provider: 'stripe' }
    }

    const pack = findTopupPack(input.packId) ?? findTopupPack('credits_2000')
    if (!pack) throw new Error('Unknown credit pack')
    const session = await stripeForm(config.stripe.secretKey, 'checkout/sessions', {
      mode: 'payment',
      customer,
      success_url: `${appBilling}?checkout=success`,
      cancel_url: `${appBilling}?checkout=cancel`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(pack.amountCents),
      'line_items[0][price_data][product_data][name]': `Jargon ${pack.label}`,
      'line_items[0][price_data][product_data][description]': `${formatUsd(pack.amountCents)} · expires in 12 months`,
      'metadata[org_id]': input.orgId,
      'metadata[intent]': 'topup',
      'metadata[pack_id]': pack.id,
      'metadata[credits]': String(pack.credits)
    })
    return { url: String(session.url), provider: 'stripe' }
  }

  async function applyStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    if (!config.stripe.webhookSecret || !config.stripe.secretKey) {
      throw Object.assign(new Error('Stripe webhooks are not configured yet'), { status: 503 })
    }
    if (!verifyStripeSignature(rawBody, signature, config.stripe.webhookSecret)) {
      throw Object.assign(new Error('Invalid Stripe signature'), { status: 400 })
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      type?: string
      data?: { object?: StripeSession & { metadata?: Record<string, string>; status?: string } }
    }
    const object = event.data?.object
    const metadata = object?.metadata ?? {}
    const orgId = metadata.org_id
    if (!orgId) return { received: true }

    if (event.type === 'checkout.session.completed' && object) {
      const customer = customerId(object.customer)
      if (customer) await billing().setStripeCustomer(orgId, customer)
      if (metadata.intent === 'topup') {
        const credits = Number(metadata.credits ?? 0)
        if (credits > 0) {
          await billing().grant({
            orgId,
            amount: credits,
            source: 'purchase',
            stripePaymentId: typeof object.payment_intent === 'string' ? object.payment_intent : object.id
          })
        }
      }
      if (metadata.intent === 'upgrade' && isPlanId(metadata.plan)) {
        await billing().setPlan(orgId, metadata.plan, {
          customerId: customer,
          subscriptionId: subscriptionId(object.subscription),
          status: 'active'
        })
      }
    }

    if (event.type === 'customer.subscription.deleted' && orgId) {
      await billing().setPlan(orgId, 'free', { status: 'canceled' })
    }

    if (event.type === 'customer.subscription.updated' && orgId) {
      const plan = isPlanId(metadata.plan) ? metadata.plan : undefined
      const status = object && 'status' in object ? String(object.status) : 'active'
      const mapped =
        status === 'past_due' || status === 'unpaid'
          ? 'past_due'
          : status === 'canceled'
            ? 'canceled'
            : status === 'trialing'
              ? 'trialing'
              : 'active'
      if (plan) {
        await billing().setPlan(orgId, plan, {
          customerId: customerId(object?.customer),
          subscriptionId: subscriptionId(object && 'id' in object ? String(object.id) : undefined),
          status: mapped
        })
      }
    }

    return { received: true }
  }

  return { createBillingLink, applyStripeWebhook }
}
