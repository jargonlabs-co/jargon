export type PlanId = 'free' | 'team' | 'scale'
export type BillableReason = 'email' | 'call' | 'linkedin'
export type CreditWalletType = 'recurring' | 'topup'
export type CreditSource = 'grant' | 'purchase' | 'auto_topup' | 'adjustment' | 'refund' | 'refresh'
export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

export interface PlanCatalog {
  id: PlanId
  name: string
  monthlyCredits: number
  amountCents: number
  interval: 'month' | null
  maxTools: number | null
  maxMembers: number | null
  maxDataSources: number | null
  description: string
}

export interface TopupPack {
  id: string
  credits: number
  amountCents: number
  label: string
}

export const CREDIT_COSTS: Record<BillableReason, number> = {
  email: 1,
  call: 5,
  linkedin: 2
}

export const PLANS: Record<PlanId, PlanCatalog> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyCredits: 100,
    amountCents: 0,
    interval: 'month',
    maxTools: 2,
    maxMembers: 1,
    maxDataSources: 1,
    description: 'Connect Claude, ship a couple of tools, and try live outbound.'
  },
  team: {
    id: 'team',
    name: 'Team',
    monthlyCredits: 2000,
    amountCents: 4900,
    interval: 'month',
    maxTools: null,
    maxMembers: null,
    maxDataSources: null,
    description: 'Monthly credits, live outbound, and credit top-ups for the revenue team.'
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    monthlyCredits: 20000,
    amountCents: 0,
    interval: null,
    maxTools: null,
    maxMembers: null,
    maxDataSources: null,
    description: 'Custom grant, invoicing, and higher concurrency. Talk to us.'
  }
}

export const TOPUP_PACKS: TopupPack[] = [
  { id: 'credits_500', credits: 500, amountCents: 2000, label: '500 credits' },
  { id: 'credits_2000', credits: 2000, amountCents: 6000, label: '2,000 credits' },
  { id: 'credits_10000', credits: 10000, amountCents: 25000, label: '10,000 credits' }
]

export const TOPUP_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000

export function isPlanId(value: string | undefined): value is PlanId {
  return value === 'free' || value === 'team' || value === 'scale'
}

export function isBillableReason(value: string | undefined): value is BillableReason {
  return value === 'email' || value === 'call' || value === 'linkedin'
}

export function findTopupPack(id: string | undefined): TopupPack | undefined {
  return TOPUP_PACKS.find((pack) => pack.id === id)
}

export function periodEndFrom(startMs: number): number {
  const start = new Date(startMs)
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()))
  return end.getTime()
}

export function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
