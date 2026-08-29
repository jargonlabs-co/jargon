import { useEffect, useState } from 'react'
import { api, type BillingSnapshot } from '../api'
import { useAuth } from '../auth'

export default function BillingPage() {
  const { me, refresh } = useAuth()
  const [billing, setBilling] = useState<BillingSnapshot | null>(me?.billing ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const upgraded = new URLSearchParams(window.location.search).get('upgraded') === '1'

  useEffect(() => {
    void api.billing().then(setBilling).catch(() => {
      /* fallback to cached */
    })
  }, [])

  async function upgrade() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await api.checkout()
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout unavailable')
    } finally {
      setBusy(false)
    }
  }

  async function manage() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await api.billingPortal()
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing portal unavailable')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (upgraded) void refresh()
  }, [upgraded, refresh])

  const current = billing ?? me?.billing

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Billing</h1>
          <p className="page-subtitle">Manage your subscription and usage.</p>
        </div>
      </header>

      {upgraded ? (
        <div className="banner banner-success">Welcome to Pro — your plan is updating.</div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}

      {current ? (
        <div className="plan-current">
          <div>
            <span className="plan-label">Current plan</span>
            <h2>{current.planName}</h2>
            <p className="muted">
              {current.buildCount}
              {current.buildLimit != null ? ` / ${current.buildLimit}` : ''} builds used
              {current.currentPeriodEnd
                ? ` · Renews ${new Date(current.currentPeriodEnd).toLocaleDateString()}`
                : ''}
            </p>
          </div>
          <div className="plan-actions">
            {current.plan === 'pro' ? (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void manage()}>
                Manage subscription
              </button>
            ) : current.stripeConfigured ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void upgrade()}>
                Upgrade to Pro
              </button>
            ) : (
              <a className="btn btn-secondary" href="mailto:hello@jargon.app?subject=Pro%20plan">
                Contact us to upgrade
              </a>
            )}
          </div>
        </div>
      ) : null}

      <div className="plan-grid">
        {(current?.plans ?? []).map((plan) => (
          <article
            key={plan.id}
            className={current?.plan === plan.id ? 'plan-card plan-card-active' : 'plan-card'}
          >
            <h3>{plan.name}</h3>
            <p className="plan-price">
              {plan.priceMonthly === 0 ? 'Free' : `$${plan.priceMonthly}`}
              {plan.priceMonthly > 0 ? <span>/mo</span> : null}
            </p>
            <p className="muted">{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  )
}
