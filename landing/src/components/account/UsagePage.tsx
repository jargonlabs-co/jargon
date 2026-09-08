import type { AccountSnapshot } from '../../api'
import { formatCredits, formatWhen } from './nav'

export function UsagePage({ snapshot }: { snapshot: AccountSnapshot }) {
  const { usage, catalog } = snapshot
  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Usage</h1>
        <p className="section-lede">
          Live email is {catalog.costs.email} credit, a call is {catalog.costs.call}, LinkedIn is{' '}
          {catalog.costs.linkedin}. Reads, deploys, and sandbox keys are free. Period{' '}
          {formatWhen(usage.periodStart)} – {formatWhen(usage.periodEnd)}.
        </p>
      </div>
      <div className="account-stat-grid">
        <article className="account-stat">
          <p className="account-stat-label">Credits spent</p>
          <p className="account-stat-value">{formatCredits(usage.totals.credits)}</p>
        </article>
        <article className="account-stat">
          <p className="account-stat-label">Emails</p>
          <p className="account-stat-value">{usage.totals.emails}</p>
        </article>
        <article className="account-stat">
          <p className="account-stat-label">Calls</p>
          <p className="account-stat-value">{usage.totals.calls}</p>
        </article>
        <article className="account-stat">
          <p className="account-stat-label">LinkedIn</p>
          <p className="account-stat-value">{usage.totals.linkedin}</p>
        </article>
      </div>

      <div className="section-heading" style={{ marginTop: 36 }}>
        <h2>By tool</h2>
      </div>
      {usage.byProject.length === 0 ? (
        <p className="section-lede">No live usage yet this period.</p>
      ) : (
        <ul className="build-list">
          {usage.byProject.map((row) => (
            <li key={row.projectId} className="build-row">
              <div>
                <strong>{row.projectName}</strong>
                <p>
                  {row.emails} email · {row.calls} calls · {row.linkedin} LinkedIn
                </p>
              </div>
              <span className="account-inline-metric">{formatCredits(row.credits)} cr</span>
            </li>
          ))}
        </ul>
      )}

      <div className="section-heading" style={{ marginTop: 36 }}>
        <h2>Daily</h2>
      </div>
      {usage.daily.length === 0 ? (
        <p className="section-lede">No daily totals yet.</p>
      ) : (
        <ul className="build-list">
          {usage.daily.map((row) => (
            <li key={row.day} className="build-row">
              <div>
                <strong>{row.day}</strong>
                <p>
                  {row.emails} email · {row.calls} calls · {row.linkedin} LinkedIn
                </p>
              </div>
              <span className="account-inline-metric">{formatCredits(row.credits)} cr</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
