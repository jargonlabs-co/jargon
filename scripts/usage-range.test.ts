import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseUsageRange, toAccountUsage } from '../src/server/billing/view.ts'
import type { CreditLedgerRow, OrgBillingRow, UsageDailyRow } from '../src/server/billing/types.ts'

const at = (iso: string) => Date.parse(iso)

const org: OrgBillingRow = {
  orgId: 'org_1',
  plan: 'free',
  status: 'active',
  periodStart: at('2026-09-20T12:00:00Z'),
  periodEnd: at('2026-10-20T12:00:00Z'),
  createdAt: 0,
  updatedAt: 0
}

const day = (d: string, credits: number, emails: number): UsageDailyRow => ({
  orgId: 'org_1',
  day: d,
  emails,
  calls: 0,
  linkedin: 0,
  credits
})

const debit = (iso: string, projectId: string): CreditLedgerRow => ({
  id: iso,
  orgId: 'org_1',
  amount: -1,
  reason: 'email',
  projectId,
  createdAt: at(iso)
})

const daily = [day('2026-08-15', 4, 4), day('2026-09-01', 2, 2), day('2026-09-25', 3, 3), day('2026-10-02', 5, 5)]
const ledger = [
  debit('2026-08-15T10:00:00Z', 'p_old'),
  debit('2026-09-01T23:59:00Z', 'p_a'),
  debit('2026-09-25T09:00:00Z', 'p_a'),
  debit('2026-10-02T00:00:01Z', 'p_b')
]

describe('parseUsageRange', () => {
  it('defaults to the billing period when no dates are given', () => {
    assert.deepEqual(parseUsageRange({}), { ok: true })
  })

  it('accepts an inclusive day range', () => {
    assert.deepEqual(parseUsageRange({ from: '2026-09-01', to: '2026-09-30' }), {
      ok: true,
      range: { from: '2026-09-01', to: '2026-09-30' }
    })
  })

  it('rejects partial, malformed, impossible, reversed, and oversized ranges', () => {
    assert.equal(parseUsageRange({ from: '2026-09-01' }).ok, false)
    assert.equal(parseUsageRange({ from: '09/01/2026', to: '2026-09-30' }).ok, false)
    assert.equal(parseUsageRange({ from: '2026-02-30', to: '2026-03-01' }).ok, false)
    assert.equal(parseUsageRange({ from: '2026-09-30', to: '2026-09-01' }).ok, false)
    assert.equal(parseUsageRange({ from: '2024-01-01', to: '2026-01-01' }).ok, false)
    assert.equal(parseUsageRange({ from: ['2026-09-01'], to: '2026-09-30' }).ok, false)
  })
})

describe('toAccountUsage with a range', () => {
  it('uses the billing period without a range', () => {
    const usage = toAccountUsage({ org, daily, ledger })
    assert.equal(usage.range, null)
    assert.deepEqual(
      usage.daily.map((r) => r.day),
      ['2026-09-25', '2026-10-02']
    )
    assert.equal(usage.totals.credits, 8)
  })

  it('filters daily rows and ledger entries to the inclusive window', () => {
    const range = { from: '2026-08-01', to: '2026-09-01' }
    const usage = toAccountUsage({ org, daily, ledger, range, projectNames: { p_a: 'Sequence A' } })
    assert.deepEqual(usage.range, range)
    assert.deepEqual(
      usage.daily.map((r) => r.day),
      ['2026-08-15', '2026-09-01']
    )
    assert.equal(usage.totals.credits, 6)
    assert.equal(usage.totals.emails, 6)
    assert.deepEqual(
      usage.byProject.map((r) => [r.projectName, r.emails]).sort(),
      [
        ['Sequence A', 1],
        ['p_old', 1]
      ]
    )
    assert.equal(usage.periodStart, '2026-09-20T12:00:00.000Z')
  })
})
