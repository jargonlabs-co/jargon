import { PLANS, TOPUP_PACKS, type PlanId } from './catalog'
import type {
  AccountCredits,
  AccountSnapshot,
  AccountUsage,
  CreditLedgerRow,
  CreditLotRow,
  CreditWalletRow,
  OrgBillingRow,
  UsageDailyRow
} from './types'

export function billingUrlFor(appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/billing`
}

export function iso(ms: number | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null
}

export function remainingFrom(wallets: CreditWalletRow[], lots: CreditLotRow[], now = Date.now()): number {
  const recurring = wallets.find((w) => w.type === 'recurring')?.balance ?? 0
  const topup = lots
    .filter((lot) => lot.walletType === 'topup' && lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt > now))
    .reduce((sum, lot) => sum + lot.remaining, 0)
  return roundCredits(recurring + topup)
}

export function roundCredits(value: number): number {
  return Math.round(value * 100) / 100
}

export function toAccountCredits(input: {
  org: OrgBillingRow
  wallets: CreditWalletRow[]
  lots: CreditLotRow[]
  appUrl: string
  paymentsReady: boolean
  now?: number
}): AccountCredits {
  const now = input.now ?? Date.now()
  const plan = PLANS[input.org.plan]
  const lots = input.lots
    .filter((lot) => lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt > now))
    .sort((a, b) => (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER))
  const recurring = input.wallets.find((w) => w.type === 'recurring')
  const topupBalance = lots
    .filter((lot) => lot.walletType === 'topup')
    .reduce((sum, lot) => sum + lot.remaining, 0)

  return {
    orgId: input.org.orgId,
    plan: input.org.plan,
    planName: plan.name,
    status: input.org.status,
    credits: remainingFrom(input.wallets, input.lots, now),
    included: plan.monthlyCredits,
    periodStart: iso(input.org.periodStart),
    periodEnd: iso(input.org.periodEnd),
    billingUrl: billingUrlFor(input.appUrl),
    payments: {
      provider: input.paymentsReady ? 'stripe' : 'pending',
      ready: input.paymentsReady
    },
    wallets: [
      {
        type: 'recurring',
        credits: roundCredits(recurring?.balance ?? 0),
        nextRefreshAt: iso(recurring?.nextRefreshAt ?? input.org.periodEnd),
        expiresAt: null
      },
      {
        type: 'topup',
        credits: roundCredits(topupBalance),
        nextRefreshAt: null,
        expiresAt: lots.find((lot) => lot.walletType === 'topup')?.expiresAt
          ? iso(lots.filter((lot) => lot.walletType === 'topup').at(-1)?.expiresAt)
          : null
      }
    ],
    creditTopups: lots
      .filter((lot) => lot.walletType === 'topup')
      .map((lot) => ({
        id: lot.id,
        type: lot.source === 'purchase' ? 'purchase' : lot.source === 'auto_topup' ? 'auto_topup' : 'granted',
        grantedCredits: lot.granted,
        remainingCredits: lot.remaining,
        grantedAt: new Date(lot.grantedAt).toISOString(),
        expiresAt: iso(lot.expiresAt)
      })),
    stripeCustomerId: input.org.stripeCustomerId,
    stripeSubscriptionId: input.org.stripeSubscriptionId
  }
}

export function emptyUsage(periodStart: string | null, periodEnd: string | null): AccountUsage {
  return {
    periodStart,
    periodEnd,
    totals: { credits: 0, emails: 0, calls: 0, linkedin: 0 },
    daily: [],
    byProject: []
  }
}

export function toAccountUsage(input: {
  org: OrgBillingRow
  daily: UsageDailyRow[]
  ledger: CreditLedgerRow[]
  projectNames?: Record<string, string>
}): AccountUsage {
  const periodStart = input.org.periodStart ?? 0
  const periodEnd = input.org.periodEnd ?? Date.now()
  const daily = input.daily
    .filter((row) => {
      const t = Date.parse(`${row.day}T00:00:00.000Z`)
      return t >= periodStart && t <= periodEnd
    })
    .sort((a, b) => a.day.localeCompare(b.day))
  const totals = daily.reduce(
    (acc, row) => ({
      credits: acc.credits + row.credits,
      emails: acc.emails + row.emails,
      calls: acc.calls + row.calls,
      linkedin: acc.linkedin + row.linkedin
    }),
    { credits: 0, emails: 0, calls: 0, linkedin: 0 }
  )
  const byProject = new Map<string, AccountUsage['byProject'][number]>()
  for (const entry of input.ledger) {
    if (entry.createdAt < periodStart || entry.createdAt > periodEnd) continue
    if (entry.amount >= 0) continue
    const projectId = entry.projectId ?? '_account'
    const row = byProject.get(projectId) ?? {
      projectId,
      projectName: input.projectNames?.[projectId] ?? (projectId === '_account' ? 'Account' : projectId),
      credits: 0,
      emails: 0,
      calls: 0,
      linkedin: 0
    }
    row.credits += Math.abs(entry.amount)
    if (entry.reason === 'email') row.emails += 1
    if (entry.reason === 'call') row.calls += 1
    if (entry.reason === 'linkedin') row.linkedin += 1
    byProject.set(projectId, row)
  }
  return {
    periodStart: iso(input.org.periodStart),
    periodEnd: iso(input.org.periodEnd),
    totals: {
      credits: roundCredits(totals.credits),
      emails: totals.emails,
      calls: totals.calls,
      linkedin: totals.linkedin
    },
    daily: daily.map((row) => ({
      day: row.day,
      credits: roundCredits(row.credits),
      emails: row.emails,
      calls: row.calls,
      linkedin: row.linkedin
    })),
    byProject: [...byProject.values()].sort((a, b) => b.credits - a.credits)
  }
}

export function toSnapshot(
  credits: AccountCredits,
  usage: AccountUsage
): AccountSnapshot {
  return {
    credits,
    usage,
    catalog: {
      plans: (Object.keys(PLANS) as PlanId[]).map((id) => {
        const plan = PLANS[id]
        return {
          id: plan.id,
          name: plan.name,
          monthlyCredits: plan.monthlyCredits,
          amountCents: plan.amountCents,
          description: plan.description
        }
      }),
      packs: TOPUP_PACKS.map((pack) => ({
        id: pack.id,
        credits: pack.credits,
        amountCents: pack.amountCents,
        label: pack.label
      })),
      costs: { email: 1, call: 5, linkedin: 2 }
    }
  }
}
