import { uid } from '../crypto'
import type { DataStore } from '../store'
import {
  CREDIT_COSTS,
  PLANS,
  TOPUP_EXPIRY_MS,
  periodEndFrom,
  utcDay,
  type BillableReason,
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
import { billingUrlFor, remainingFrom, roundCredits, toAccountCredits, toAccountUsage, toSnapshot } from './view'

function emptyOrg(orgId: string, now: number): OrgBillingRow {
  const periodEnd = periodEndFrom(now)
  return {
    orgId,
    plan: 'free',
    status: 'active',
    periodStart: now,
    periodEnd,
    createdAt: now,
    updatedAt: now
  }
}

function emptyWallets(orgId: string, now: number, plan: PlanId): CreditWalletRow[] {
  const periodEnd = periodEndFrom(now)
  return [
    {
      id: uid('wal'),
      orgId,
      type: 'recurring',
      balance: PLANS[plan].monthlyCredits,
      nextRefreshAt: periodEnd
    },
    {
      id: uid('wal'),
      orgId,
      type: 'topup',
      balance: 0
    }
  ]
}

export class StoreBillingService implements BillingService {
  backend = 'local' as const
  paymentsReady: boolean
  private createLink: (input: BillingLinkInput) => Promise<BillingLinkResult>
  private applyWebhook: (rawBody: Buffer, signature: string | undefined) => Promise<{ received: true }>

  constructor(
    private store: DataStore,
    private appUrl: string,
    options: {
      paymentsReady: boolean
      createLink: (input: BillingLinkInput) => Promise<BillingLinkResult>
      applyWebhook: (rawBody: Buffer, signature: string | undefined) => Promise<{ received: true }>
    }
  ) {
    this.paymentsReady = options.paymentsReady
    this.createLink = options.createLink
    this.applyWebhook = options.applyWebhook
  }

  private billingUrl(): string {
    return billingUrlFor(this.appUrl)
  }

  private orgRows(orgId: string) {
    const db = this.store.db
    return {
      org: db.orgBilling.find((row) => row.orgId === orgId),
      wallets: db.creditWallets.filter((row) => row.orgId === orgId),
      lots: db.creditLots.filter((row) => row.orgId === orgId),
      ledger: db.creditLedger.filter((row) => row.orgId === orgId),
      daily: db.usageDaily.filter((row) => row.orgId === orgId)
    }
  }

  private view(orgId: string): AccountCredits {
    const { org, wallets, lots } = this.orgRows(orgId)
    if (!org) {
      throw new Error(`Billing not provisioned for ${orgId}`)
    }
    return toAccountCredits({
      org,
      wallets,
      lots,
      appUrl: this.appUrl,
      paymentsReady: this.paymentsReady
    })
  }

  async ensureOrg(orgId: string): Promise<AccountCredits> {
    const now = Date.now()
    this.store.update((db) => {
      let org = db.orgBilling.find((row) => row.orgId === orgId)
      if (!org) {
        org = emptyOrg(orgId, now)
        db.orgBilling.push(org)
        db.creditWallets.push(...emptyWallets(orgId, now, org.plan))
        db.creditLedger.unshift({
          id: uid('led'),
          orgId,
          amount: PLANS[org.plan].monthlyCredits,
          reason: 'grant',
          createdAt: now
        })
      }
      if (org.periodEnd && org.periodEnd <= now) {
        const nextEnd = periodEndFrom(now)
        org.periodStart = now
        org.periodEnd = nextEnd
        org.updatedAt = now
        const recurring = db.creditWallets.find((row) => row.orgId === orgId && row.type === 'recurring')
        const grant = PLANS[org.plan].monthlyCredits
        if (recurring) {
          recurring.balance = grant
          recurring.nextRefreshAt = nextEnd
        }
        db.creditLedger.unshift({
          id: uid('led'),
          orgId,
          amount: grant,
          reason: 'refresh',
          createdAt: now
        })
      }
    })
    return this.view(orgId)
  }

  async getCredits(orgId: string): Promise<AccountCredits> {
    await this.ensureOrg(orgId)
    return this.view(orgId)
  }

  async getUsage(orgId: string, projectNames?: Record<string, string>): Promise<AccountUsage> {
    await this.ensureOrg(orgId)
    const { org, daily, ledger } = this.orgRows(orgId)
    return toAccountUsage({ org: org!, daily, ledger, projectNames })
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
    const now = Date.now()
    let result: DebitResult | null = null
    this.store.update((db) => {
      const wallets = db.creditWallets.filter((row) => row.orgId === input.orgId)
      const lots = db.creditLots.filter((row) => row.orgId === input.orgId)
      const remaining = remainingFrom(wallets, lots, now)
      if (remaining < input.amount) {
        result = {
          ok: false,
          remaining,
          error: 'Insufficient credits. Add credits or upgrade your plan.',
          code: 'insufficient_credits',
          billingUrl: this.billingUrl()
        }
        return
      }
      let left = input.amount
      const recurring = wallets.find((row) => row.type === 'recurring')
      if (recurring && recurring.balance > 0) {
        const take = Math.min(recurring.balance, left)
        recurring.balance = roundCredits(recurring.balance - take)
        left = roundCredits(left - take)
      }
      if (left > 0) {
        const ordered = lots
          .filter(
            (lot) =>
              lot.walletType === 'topup' && lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt > now)
          )
          .sort((a, b) => (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER))
        for (const lot of ordered) {
          if (left <= 0) break
          const take = Math.min(lot.remaining, left)
          lot.remaining = roundCredits(lot.remaining - take)
          left = roundCredits(left - take)
        }
        const topup = wallets.find((row) => row.type === 'topup')
        if (topup) {
          topup.balance = roundCredits(
            lots.filter((lot) => lot.walletType === 'topup').reduce((sum, lot) => sum + lot.remaining, 0)
          )
        }
      }
      db.creditLedger.unshift({
        id: uid('led'),
        orgId: input.orgId,
        amount: -input.amount,
        reason: input.reason,
        projectId: input.projectId,
        apiKeyId: input.apiKeyId,
        environment: input.environment,
        createdAt: now
      })
      bumpUsage(db.usageDaily, input.orgId, input.reason, input.amount, now)
      const nextRemaining = remainingFrom(
        db.creditWallets.filter((row) => row.orgId === input.orgId),
        db.creditLots.filter((row) => row.orgId === input.orgId),
        now
      )
      result = { ok: true, creditsUsed: input.amount, remaining: nextRemaining }
    })
    return result ?? { ok: false, remaining: 0, error: 'Debit failed', code: 'insufficient_credits', billingUrl: this.billingUrl() }
  }

  async grant(input: GrantInput): Promise<AccountCredits> {
    await this.ensureOrg(input.orgId)
    const now = Date.now()
    this.store.update((db) => {
      const expiresAt = input.expiresAt ?? (input.source === 'purchase' || input.source === 'auto_topup' ? now + TOPUP_EXPIRY_MS : undefined)
      const lot: CreditLotRow = {
        id: uid('lot'),
        orgId: input.orgId,
        walletType: 'topup',
        source: input.source,
        granted: input.amount,
        remaining: input.amount,
        stripePaymentId: input.stripePaymentId,
        grantedAt: now,
        expiresAt
      }
      db.creditLots.push(lot)
      const topup = db.creditWallets.find((row) => row.orgId === input.orgId && row.type === 'topup')
      if (topup) topup.balance = roundCredits(topup.balance + input.amount)
      else {
        db.creditWallets.push({
          id: uid('wal'),
          orgId: input.orgId,
          type: 'topup',
          balance: input.amount,
          expiresAt
        })
      }
      db.creditLedger.unshift({
        id: uid('led'),
        orgId: input.orgId,
        amount: input.amount,
        reason: input.reason ?? input.source,
        createdAt: now
      })
    })
    return this.view(input.orgId)
  }

  async setPlan(
    orgId: string,
    plan: PlanId,
    stripe?: { customerId?: string; subscriptionId?: string; status?: OrgBillingRow['status'] }
  ): Promise<AccountCredits> {
    await this.ensureOrg(orgId)
    const now = Date.now()
    this.store.update((db) => {
      const org = db.orgBilling.find((row) => row.orgId === orgId)
      if (!org) return
      const changed = org.plan !== plan
      org.plan = plan
      org.status = stripe?.status ?? 'active'
      if (stripe?.customerId) org.stripeCustomerId = stripe.customerId
      if (stripe?.subscriptionId) org.stripeSubscriptionId = stripe.subscriptionId
      org.updatedAt = now
      if (changed) {
        org.periodStart = now
        org.periodEnd = periodEndFrom(now)
        const recurring = db.creditWallets.find((row) => row.orgId === orgId && row.type === 'recurring')
        const grant = PLANS[plan].monthlyCredits
        if (recurring) {
          recurring.balance = grant
          recurring.nextRefreshAt = org.periodEnd
        }
        db.creditLedger.unshift({
          id: uid('led'),
          orgId,
          amount: grant,
          reason: 'refresh',
          createdAt: now
        })
      }
    })
    return this.view(orgId)
  }

  async setStripeCustomer(orgId: string, customerId: string): Promise<void> {
    await this.ensureOrg(orgId)
    this.store.update((db) => {
      const org = db.orgBilling.find((row) => row.orgId === orgId)
      if (org) {
        org.stripeCustomerId = customerId
        org.updatedAt = Date.now()
      }
    })
  }

  async createBillingLink(input: BillingLinkInput): Promise<BillingLinkResult> {
    await this.ensureOrg(input.orgId)
    return this.createLink({
      ...input,
      name: this.store.db.orgs.find((org) => org.id === input.orgId)?.name ?? input.name
    })
  }

  async applyStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    return this.applyWebhook(rawBody, signature)
  }
}

function bumpUsage(
  rows: { orgId: string; day: string; emails: number; calls: number; linkedin: number; credits: number }[],
  orgId: string,
  reason: BillableReason,
  amount: number,
  now: number
) {
  const day = utcDay(now)
  let row = rows.find((item) => item.orgId === orgId && item.day === day)
  if (!row) {
    row = { orgId, day, emails: 0, calls: 0, linkedin: 0, credits: 0 }
    rows.push(row)
  }
  row.credits = roundCredits(row.credits + amount)
  if (reason === 'email') row.emails += 1
  if (reason === 'call') row.calls += 1
  if (reason === 'linkedin') row.linkedin += 1
}

export const BILLABLE_COST = CREDIT_COSTS
