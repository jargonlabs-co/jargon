import type { AccountSnapshot, BillingLink, PlanId } from '../../api'
import { formatCredits, formatUsd, formatWhen } from './nav'

export function BillingPage({
  snapshot,
  busy,
  onCheckout
}: {
  snapshot: AccountSnapshot
  busy: string | null
  onCheckout: (intent: 'upgrade' | 'topup' | 'portal', plan?: PlanId, packId?: string) => void
}) {
  const { credits, catalog } = snapshot
  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Billing</h1>
        <p className="section-lede">
          {formatCredits(credits.credits)} credits remaining · {credits.planName} · resets{' '}
          {formatWhen(credits.periodEnd)}.
        </p>
      </div>

      {!credits.payments.ready ? (
        <p className="account-banner">
          Card checkout is wired and waiting on Stripe Atlas. Upgrade and top-up buttons will open
          Stripe as soon as keys are set — until then they land back on this page.
        </p>
      ) : null}

      <div className="account-plan-grid">
        {catalog.plans.map((plan) => {
          const current = plan.id === credits.plan
          return (
            <article key={plan.id} className={`account-plan ${current ? 'is-current' : ''}`}>
              <p className="context-role">{current ? 'Current plan' : 'Plan'}</p>
              <h3>{plan.name}</h3>
              <p className="account-plan-price">
                {plan.amountCents > 0 ? `${formatUsd(plan.amountCents)}/mo` : plan.id === 'scale' ? 'Custom' : 'Free'}
              </p>
              <p>{formatCredits(plan.monthlyCredits)} credits each month</p>
              <p className="section-lede">{plan.description}</p>
              {plan.id === 'free' || current ? null : (
                <button
                  type="button"
                  className="btn primary btn-sm"
                  disabled={busy === `upgrade-${plan.id}`}
                  onClick={() => onCheckout('upgrade', plan.id)}
                >
                  {busy === `upgrade-${plan.id}` ? 'Opening…' : `Upgrade to ${plan.name}`}
                </button>
              )}
            </article>
          )
        })}
      </div>

      <div className="section-heading" style={{ marginTop: 40 }}>
        <h2>Credit top-ups</h2>
        <p className="section-lede">Purchased credits roll over for 12 months. Recurring plan credits reset each period and are spent first.</p>
      </div>
      <div className="account-plan-grid">
        {catalog.packs.map((pack) => (
          <article key={pack.id} className="account-plan">
            <h3>{pack.label}</h3>
            <p className="account-plan-price">{formatUsd(pack.amountCents)}</p>
            <button
              type="button"
              className="btn primary btn-sm"
              disabled={busy === `topup-${pack.id}`}
              onClick={() => onCheckout('topup', undefined, pack.id)}
            >
              {busy === `topup-${pack.id}` ? 'Opening…' : 'Buy'}
            </button>
          </article>
        ))}
      </div>

      {credits.creditTopups.length > 0 ? (
        <>
          <div className="section-heading" style={{ marginTop: 40 }}>
            <h2>Active top-ups</h2>
          </div>
          <ul className="build-list">
            {credits.creditTopups.map((lot) => (
              <li key={lot.id} className="build-row">
                <div>
                  <strong>{formatCredits(lot.remainingCredits)} left</strong>
                  <p>
                    {lot.type} · expires {formatWhen(lot.expiresAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {credits.payments.ready ? (
        <button type="button" className="btn ghost" style={{ marginTop: 28 }} onClick={() => onCheckout('portal')}>
          Invoices and payment method
        </button>
      ) : null}
    </section>
  )
}

export function checkoutToast(link: BillingLink): string {
  if (link.provider === 'pending') {
    return link.message ?? 'Payments go live when Stripe is connected.'
  }
  return 'Redirecting to checkout…'
}
