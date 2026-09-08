import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'
import { getSupabaseAdmin, supabaseConfigured } from '../providers/supabaseAuth'
import { uid } from '../crypto'
import {
  PLANS,
  TOPUP_EXPIRY_MS,
  periodEndFrom,
  type PlanId
} from './catalog'
import type {
  AccountCredits,
  AccountSnapshot,
  AccountUsage,
  BillingLinkInput,
  BillingLinkResult,
  BillingService,
  CreditLedgerRow,
  CreditLotRow,
  CreditWalletRow,
  DebitInput,
  DebitResult,
  GrantInput,
  OrgBillingRow
} from './types'
import { billingUrlFor, remainingFrom, toAccountCredits, toAccountUsage, toSnapshot } from './view'

function ms(value: string | null | undefined): number | undefined {
  return value ? Date.parse(value) : undefined
}

function isoOrNull(msValue: number | undefined): string | null {
  return msValue ? new Date(msValue).toISOString() : null
}

export async function supabaseBillingReady(config: ServerConfig): Promise<boolean> {
  if (!supabaseConfigured(config)) return false
  try {
    const client = getSupabaseAdmin(config)
    const { error } = await client.from('org_billing').select('org_id').limit(1)
    return !error
  } catch {
    return false
  }
}

export class SupabaseBillingService implements BillingService {
  backend = 'supabase' as const
  paymentsReady: boolean
  private client: SupabaseClient
  private createLink: (input: BillingLinkInput) => Promise<BillingLinkResult>
  private applyWebhook: (rawBody: Buffer, signature: string | undefined) => Promise<{ received: true }>

  constructor(
    config: ServerConfig,
    options: {
      paymentsReady: boolean
      createLink: (input: BillingLinkInput) => Promise<BillingLinkResult>
      applyWebhook: (rawBody: Buffer, signature: string | undefined) => Promise<{ received: true }>
    }
  ) {
    this.client = getSupabaseAdmin(config)
    this.paymentsReady = options.paymentsReady
    this.createLink = options.createLink
    this.applyWebhook = options.applyWebhook
    this.appUrl = config.appUrl
  }

  private appUrl: string

  private billingUrl(): string {
    return billingUrlFor(this.appUrl)
  }

  private async loadOrg(orgId: string): Promise<{
    org: OrgBillingRow
    wallets: CreditWalletRow[]
    lots: CreditLotRow[]
  } | null> {
    const { data: orgRow, error } = await this.client.from('org_billing').select('*').eq('org_id', orgId).maybeSingle()
    if (error) throw error
    if (!orgRow) return null
    const [{ data: wallets }, { data: lots }] = await Promise.all([
      this.client.from('credit_wallets').select('*').eq('org_id', orgId),
      this.client.from('credit_lots').select('*').eq('org_id', orgId)
    ])
    return {
      org: mapOrg(orgRow),
      wallets: (wallets ?? []).map(mapWallet),
      lots: (lots ?? []).map(mapLot)
    }
  }

  private viewFrom(loaded: { org: OrgBillingRow; wallets: CreditWalletRow[]; lots: CreditLotRow[] }): AccountCredits {
    return toAccountCredits({
      org: loaded.org,
      wallets: loaded.wallets,
      lots: loaded.lots,
      appUrl: this.appUrl,
      paymentsReady: this.paymentsReady
    })
  }

  async ensureOrg(orgId: string): Promise<AccountCredits> {
    const now = Date.now()
    let loaded = await this.loadOrg(orgId)
    if (!loaded) {
      const periodEnd = periodEndFrom(now)
      const grant = PLANS.free.monthlyCredits
      const { error: orgErr } = await this.client.from('org_billing').insert({
        org_id: orgId,
        plan: 'free',
        status: 'active',
        period_start: new Date(now).toISOString(),
        period_end: new Date(periodEnd).toISOString()
      })
      if (orgErr && !/duplicate/i.test(orgErr.message)) throw orgErr
      await this.client.from('credit_wallets').upsert(
        [
          { org_id: orgId, type: 'recurring', balance: grant, next_refresh_at: new Date(periodEnd).toISOString() },
          { org_id: orgId, type: 'topup', balance: 0 }
        ],
        { onConflict: 'org_id,type' }
      )
      await this.client.from('credit_ledger').insert({
        org_id: orgId,
        amount: grant,
        reason: 'grant'
      })
      loaded = await this.loadOrg(orgId)
    }
    if (!loaded) throw new Error('Could not provision billing')
    if (loaded.org.periodEnd && loaded.org.periodEnd <= now) {
      const nextEnd = periodEndFrom(now)
      const grant = PLANS[loaded.org.plan].monthlyCredits
      await this.client
        .from('org_billing')
        .update({
          period_start: new Date(now).toISOString(),
          period_end: new Date(nextEnd).toISOString(),
          updated_at: new Date(now).toISOString()
        })
        .eq('org_id', orgId)
      await this.client
        .from('credit_wallets')
        .update({ balance: grant, next_refresh_at: new Date(nextEnd).toISOString(), updated_at: new Date(now).toISOString() })
        .eq('org_id', orgId)
        .eq('type', 'recurring')
      await this.client.from('credit_ledger').insert({ org_id: orgId, amount: grant, reason: 'refresh' })
      loaded = await this.loadOrg(orgId)
    }
    return this.viewFrom(loaded!)
  }

  async getCredits(orgId: string): Promise<AccountCredits> {
    return this.ensureOrg(orgId)
  }

  async getUsage(orgId: string, projectNames?: Record<string, string>): Promise<AccountUsage> {
    await this.ensureOrg(orgId)
    const loaded = await this.loadOrg(orgId)
    const [{ data: daily }, { data: ledger }] = await Promise.all([
      this.client.from('usage_daily').select('*').eq('org_id', orgId),
      this.client.from('credit_ledger').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(2000)
    ])
    return toAccountUsage({
      org: loaded!.org,
      daily: (daily ?? []).map((row) => ({
        orgId: row.org_id as string,
        day: String(row.day).slice(0, 10),
        emails: Number(row.emails ?? 0),
        calls: Number(row.calls ?? 0),
        linkedin: Number(row.linkedin ?? 0),
        credits: Number(row.credits ?? 0)
      })),
      ledger: (ledger ?? []).map(mapLedger),
      projectNames
    })
  }

  async snapshot(orgId: string, projectNames?: Record<string, string>): Promise<AccountSnapshot> {
    const credits = await this.getCredits(orgId)
    const usage = await this.getUsage(orgId, projectNames)
    return toSnapshot(credits, usage)
  }

  async debit(input: DebitInput): Promise<DebitResult> {
    if (input.environment === 'sandbox' || input.amount <= 0) {
      const credits = await this.getCredits(input.orgId)
      return { ok: true, creditsUsed: 0, remaining: credits.credits }
    }
    await this.ensureOrg(input.orgId)
    const { data, error } = await this.client.rpc('debit_credits', {
      p_org_id: input.orgId,
      p_amount: input.amount,
      p_reason: input.reason,
      p_project_id: input.projectId ?? null,
      p_api_key_id: input.apiKeyId ?? null,
      p_environment: input.environment
    })
    if (error) {
      return this.debitInProcess(input)
    }
    const payload = data as { ok?: boolean; remaining?: number; creditsUsed?: number; code?: string }
    if (!payload?.ok) {
      const loaded = await this.loadOrg(input.orgId)
      return {
        ok: false,
        remaining: Number(payload?.remaining ?? remainingFrom(loaded?.wallets ?? [], loaded?.lots ?? [])),
        error: 'Insufficient credits. Add credits or upgrade your plan.',
        code: 'insufficient_credits',
        billingUrl: this.billingUrl()
      }
    }
    const credits = await this.getCredits(input.orgId)
    return { ok: true, creditsUsed: input.amount, remaining: credits.credits }
  }

  private async debitInProcess(input: DebitInput): Promise<DebitResult> {
    const loaded = await this.loadOrg(input.orgId)
    if (!loaded) {
      return {
        ok: false,
        remaining: 0,
        error: 'Insufficient credits. Add credits or upgrade your plan.',
        code: 'insufficient_credits',
        billingUrl: this.billingUrl()
      }
    }
    const remaining = remainingFrom(loaded.wallets, loaded.lots)
    if (remaining < input.amount) {
      return {
        ok: false,
        remaining,
        error: 'Insufficient credits. Add credits or upgrade your plan.',
        code: 'insufficient_credits',
        billingUrl: this.billingUrl()
      }
    }
    let left = input.amount
    const recurring = loaded.wallets.find((row) => row.type === 'recurring')
    if (recurring && recurring.balance > 0) {
      const take = Math.min(recurring.balance, left)
      recurring.balance -= take
      left -= take
      await this.client
        .from('credit_wallets')
        .update({ balance: recurring.balance, updated_at: new Date().toISOString() })
        .eq('org_id', input.orgId)
        .eq('type', 'recurring')
    }
    if (left > 0) {
      const ordered = loaded.lots
        .filter((lot) => lot.walletType === 'topup' && lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt > Date.now()))
        .sort((a, b) => (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER))
      for (const lot of ordered) {
        if (left <= 0) break
        const take = Math.min(lot.remaining, left)
        lot.remaining -= take
        left -= take
        await this.client.from('credit_lots').update({ remaining: lot.remaining }).eq('id', lot.id)
      }
      const topupBalance = loaded.lots
        .filter((lot) => lot.walletType === 'topup')
        .reduce((sum, lot) => sum + lot.remaining, 0)
      await this.client
        .from('credit_wallets')
        .update({ balance: topupBalance, updated_at: new Date().toISOString() })
        .eq('org_id', input.orgId)
        .eq('type', 'topup')
    }
    await this.client.from('credit_ledger').insert({
      org_id: input.orgId,
      amount: -input.amount,
      reason: input.reason,
      project_id: input.projectId ?? null,
      api_key_id: input.apiKeyId ?? null,
      environment: input.environment
    })
    const day = new Date().toISOString().slice(0, 10)
    const { data: existing } = await this.client
      .from('usage_daily')
      .select('*')
      .eq('org_id', input.orgId)
      .eq('day', day)
      .maybeSingle()
    if (existing) {
      await this.client
        .from('usage_daily')
        .update({
          emails: Number(existing.emails ?? 0) + (input.reason === 'email' ? 1 : 0),
          calls: Number(existing.calls ?? 0) + (input.reason === 'call' ? 1 : 0),
          linkedin: Number(existing.linkedin ?? 0) + (input.reason === 'linkedin' ? 1 : 0),
          credits: Number(existing.credits ?? 0) + input.amount
        })
        .eq('org_id', input.orgId)
        .eq('day', day)
    } else {
      await this.client.from('usage_daily').insert({
        org_id: input.orgId,
        day,
        emails: input.reason === 'email' ? 1 : 0,
        calls: input.reason === 'call' ? 1 : 0,
        linkedin: input.reason === 'linkedin' ? 1 : 0,
        credits: input.amount
      })
    }
    const next = await this.getCredits(input.orgId)
    return { ok: true, creditsUsed: input.amount, remaining: next.credits }
  }

  async grant(input: GrantInput): Promise<AccountCredits> {
    await this.ensureOrg(input.orgId)
    const now = Date.now()
    const expiresAt =
      input.expiresAt ??
      (input.source === 'purchase' || input.source === 'auto_topup' ? now + TOPUP_EXPIRY_MS : undefined)
    await this.client.from('credit_lots').insert({
      org_id: input.orgId,
      wallet_type: 'topup',
      source: input.source,
      granted: input.amount,
      remaining: input.amount,
      stripe_payment_id: input.stripePaymentId ?? null,
      expires_at: isoOrNull(expiresAt)
    })
    const { data: topup } = await this.client
      .from('credit_wallets')
      .select('balance')
      .eq('org_id', input.orgId)
      .eq('type', 'topup')
      .maybeSingle()
    if (topup) {
      await this.client
        .from('credit_wallets')
        .update({ balance: Number(topup.balance ?? 0) + input.amount, updated_at: new Date().toISOString() })
        .eq('org_id', input.orgId)
        .eq('type', 'topup')
    } else {
      await this.client.from('credit_wallets').insert({
        org_id: input.orgId,
        type: 'topup',
        balance: input.amount,
        expires_at: isoOrNull(expiresAt)
      })
    }
    await this.client.from('credit_ledger').insert({
      org_id: input.orgId,
      amount: input.amount,
      reason: input.reason ?? input.source
    })
    return this.getCredits(input.orgId)
  }

  async setPlan(
    orgId: string,
    plan: PlanId,
    stripe?: { customerId?: string; subscriptionId?: string; status?: OrgBillingRow['status'] }
  ): Promise<AccountCredits> {
    await this.ensureOrg(orgId)
    const loaded = await this.loadOrg(orgId)
    const now = Date.now()
    const changed = loaded?.org.plan !== plan
    const patch: Record<string, unknown> = {
      plan,
      status: stripe?.status ?? 'active',
      updated_at: new Date(now).toISOString()
    }
    if (stripe?.customerId) patch.stripe_customer_id = stripe.customerId
    if (stripe?.subscriptionId) patch.stripe_subscription_id = stripe.subscriptionId
    if (changed) {
      const periodEnd = periodEndFrom(now)
      patch.period_start = new Date(now).toISOString()
      patch.period_end = new Date(periodEnd).toISOString()
      const grant = PLANS[plan].monthlyCredits
      await this.client
        .from('credit_wallets')
        .update({ balance: grant, next_refresh_at: new Date(periodEnd).toISOString(), updated_at: new Date(now).toISOString() })
        .eq('org_id', orgId)
        .eq('type', 'recurring')
      await this.client.from('credit_ledger').insert({ org_id: orgId, amount: grant, reason: 'refresh' })
    }
    await this.client.from('org_billing').update(patch).eq('org_id', orgId)
    return this.getCredits(orgId)
  }

  async setStripeCustomer(orgId: string, customerId: string): Promise<void> {
    await this.ensureOrg(orgId)
    await this.client
      .from('org_billing')
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
  }

  async createBillingLink(input: BillingLinkInput): Promise<BillingLinkResult> {
    await this.ensureOrg(input.orgId)
    return this.createLink(input)
  }

  async applyStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    return this.applyWebhook(rawBody, signature)
  }
}

function mapOrg(row: Record<string, unknown>): OrgBillingRow {
  return {
    orgId: String(row.org_id),
    plan: (row.plan as PlanId) ?? 'free',
    status: (row.status as OrgBillingRow['status']) ?? 'active',
    stripeCustomerId: (row.stripe_customer_id as string | undefined) ?? undefined,
    stripeSubscriptionId: (row.stripe_subscription_id as string | undefined) ?? undefined,
    periodStart: ms(row.period_start as string | null),
    periodEnd: ms(row.period_end as string | null),
    createdAt: ms(row.created_at as string) ?? Date.now(),
    updatedAt: ms(row.updated_at as string) ?? Date.now()
  }
}

function mapWallet(row: Record<string, unknown>): CreditWalletRow {
  return {
    id: String(row.id ?? uid('wal')),
    orgId: String(row.org_id),
    type: row.type === 'topup' ? 'topup' : 'recurring',
    balance: Number(row.balance ?? 0),
    nextRefreshAt: ms(row.next_refresh_at as string | null),
    expiresAt: ms(row.expires_at as string | null)
  }
}

function mapLot(row: Record<string, unknown>): CreditLotRow {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    walletType: row.wallet_type === 'recurring' ? 'recurring' : 'topup',
    source: (row.source as CreditLotRow['source']) ?? 'grant',
    granted: Number(row.granted ?? 0),
    remaining: Number(row.remaining ?? 0),
    stripePaymentId: (row.stripe_payment_id as string | undefined) ?? undefined,
    grantedAt: ms(row.granted_at as string) ?? Date.now(),
    expiresAt: ms(row.expires_at as string | null)
  }
}

function mapLedger(row: Record<string, unknown>): CreditLedgerRow {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    amount: Number(row.amount ?? 0),
    reason: String(row.reason ?? ''),
    projectId: (row.project_id as string | undefined) ?? undefined,
    apiKeyId: (row.api_key_id as string | undefined) ?? undefined,
    environment: (row.environment as string | undefined) ?? undefined,
    createdAt: ms(row.created_at as string) ?? Date.now()
  }
}
