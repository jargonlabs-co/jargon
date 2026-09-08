import type {
  BillableReason,
  BillingStatus,
  CreditSource,
  CreditWalletType,
  PlanId
} from './catalog'

export interface CreditWalletView {
  type: CreditWalletType
  credits: number
  nextRefreshAt: string | null
  expiresAt: string | null
}

export interface CreditTopupView {
  id: string
  type: 'purchase' | 'granted' | 'auto_topup'
  grantedCredits: number
  remainingCredits: number
  grantedAt: string
  expiresAt: string | null
}

export interface AccountCredits {
  orgId: string
  plan: PlanId
  planName: string
  status: BillingStatus
  credits: number
  included: number
  periodStart: string | null
  periodEnd: string | null
  billingUrl: string
  payments: {
    provider: 'stripe' | 'pending'
    ready: boolean
  }
  wallets: CreditWalletView[]
  creditTopups: CreditTopupView[]
  stripeCustomerId?: string
  stripeSubscriptionId?: string
}

export interface UsageTotals {
  credits: number
  emails: number
  calls: number
  linkedin: number
}

export interface UsageDayRow extends UsageTotals {
  day: string
}

export interface UsageProjectRow extends UsageTotals {
  projectId: string
  projectName: string
}

export interface AccountUsage {
  periodStart: string | null
  periodEnd: string | null
  totals: UsageTotals
  daily: UsageDayRow[]
  byProject: UsageProjectRow[]
}

export interface AccountSnapshot {
  credits: AccountCredits
  usage: AccountUsage
  catalog: {
    plans: Array<{
      id: PlanId
      name: string
      monthlyCredits: number
      amountCents: number
      description: string
    }>
    packs: Array<{
      id: string
      credits: number
      amountCents: number
      label: string
    }>
    costs: Record<BillableReason, number>
  }
}

export interface DebitInput {
  orgId: string
  amount: number
  reason: BillableReason
  projectId?: string
  apiKeyId?: string
  environment: 'live' | 'sandbox'
}

export type DebitResult =
  | {
      ok: true
      creditsUsed: number
      remaining: number
    }
  | {
      ok: false
      remaining: number
      error: string
      code: 'insufficient_credits'
      billingUrl: string
    }

export interface GrantInput {
  orgId: string
  amount: number
  source: CreditSource
  reason?: string
  stripePaymentId?: string
  expiresAt?: number
}

export interface BillingLinkInput {
  orgId: string
  email?: string
  name?: string
  intent: 'upgrade' | 'topup' | 'portal'
  plan?: PlanId
  packId?: string
}

export interface BillingLinkResult {
  url: string
  provider: 'stripe' | 'pending'
  message?: string
}

export interface OrgBillingRow {
  orgId: string
  plan: PlanId
  status: BillingStatus
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  periodStart?: number
  periodEnd?: number
  createdAt: number
  updatedAt: number
}

export interface CreditWalletRow {
  id: string
  orgId: string
  type: CreditWalletType
  balance: number
  nextRefreshAt?: number
  expiresAt?: number
}

export interface CreditLotRow {
  id: string
  orgId: string
  walletType: CreditWalletType
  source: CreditSource
  granted: number
  remaining: number
  stripePaymentId?: string
  grantedAt: number
  expiresAt?: number
}

export interface CreditLedgerRow {
  id: string
  orgId: string
  amount: number
  reason: string
  projectId?: string
  apiKeyId?: string
  environment?: string
  createdAt: number
}

export interface UsageDailyRow {
  orgId: string
  day: string
  emails: number
  calls: number
  linkedin: number
  credits: number
}

export interface BillingService {
  backend: 'supabase' | 'local'
  paymentsReady: boolean
  ensureOrg(orgId: string): Promise<AccountCredits>
  getCredits(orgId: string): Promise<AccountCredits>
  getUsage(orgId: string, projectNames?: Record<string, string>): Promise<AccountUsage>
  snapshot(orgId: string, projectNames?: Record<string, string>): Promise<AccountSnapshot>
  debit(input: DebitInput): Promise<DebitResult>
  grant(input: GrantInput): Promise<AccountCredits>
  setPlan(
    orgId: string,
    plan: PlanId,
    stripe?: { customerId?: string; subscriptionId?: string; status?: BillingStatus }
  ): Promise<AccountCredits>
  setStripeCustomer(orgId: string, customerId: string): Promise<void>
  createBillingLink(input: BillingLinkInput): Promise<BillingLinkResult>
  applyStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }>
}
