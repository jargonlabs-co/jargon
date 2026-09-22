import { getClaudeConnectorInstallUrl, resolveMcpUrl, type AccountSnapshot, type PortalBuild } from '../../api'
import { formatCredits, formatWhen } from './nav'

export function OverviewPage({
  snapshot,
  builds,
  onNavigate,
  onOpenTool
}: {
  snapshot: AccountSnapshot
  connections?: unknown
  builds: PortalBuild[]
  onNavigate: (path: string) => void
  onOpenTool: (id: string) => void
}) {
  const { credits, usage, claude } = snapshot
  const connectorUrl = getClaudeConnectorInstallUrl(resolveMcpUrl(claude?.mcpUrl))
  const claudeConnected = Boolean(claude?.connected)

  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Overview</h1>
        <p className="section-lede">
          Connect Claude, bring your list, and run outbound. Manage plan and credits here.
        </p>
      </div>

      <div className="account-stat-grid">
        <article className="account-stat">
          <p className="account-stat-label">Credits</p>
          <p className="account-stat-value">{formatCredits(credits.credits)}</p>
          <p className="account-stat-meta">
            {formatCredits(credits.included)} included · resets {formatWhen(credits.periodEnd)}
          </p>
          <button type="button" className="btn ghost btn-sm" onClick={() => onNavigate('/billing')}>
            Buy credits
          </button>
        </article>
        <article className="account-stat">
          <p className="account-stat-label">Plan</p>
          <p className="account-stat-value">{credits.planName}</p>
          <p className="account-stat-meta">{credits.payments.ready ? 'Billing on' : 'Payments coming online'}</p>
          <button type="button" className="btn primary btn-sm" onClick={() => onNavigate('/billing')}>
            {credits.plan === 'free' ? 'Upgrade' : 'Manage plan'}
          </button>
        </article>
        <article className="account-stat">
          <p className="account-stat-label">This period</p>
          <p className="account-stat-value">{formatCredits(usage.totals.credits)}</p>
          <p className="account-stat-meta">
            {usage.totals.emails} email · {usage.totals.calls} calls · {usage.totals.linkedin} LinkedIn
          </p>
          <button type="button" className="btn ghost btn-sm" onClick={() => onNavigate('/usage')}>
            View usage
          </button>
        </article>
      </div>

      <div className="account-split">
        <article className="context-card">
          <div className="context-card-top">
            <span className="context-role">First step</span>
            <span className={`context-status ${claudeConnected ? 'ok' : ''}`}>
              {claudeConnected ? 'Connected' : 'Required'}
            </span>
          </div>
          <h3>Connect Claude</h3>
          <p>
            Add Jargon as a custom connector. Bring lists from your other Claude tools — no CRM OAuth
            required inside Jargon.
          </p>
          <div className="key-actions">
            <a className="btn primary btn-sm" href={connectorUrl} target="_blank" rel="noreferrer">
              {claudeConnected ? 'Reconnect Claude' : 'Connect Claude'}
            </a>
            <button type="button" className="btn ghost btn-sm" onClick={() => onNavigate('/claude')}>
              Setup
            </button>
          </div>
        </article>
        <article className="context-card">
          <div className="context-card-top">
            <span className="context-role">Outbound</span>
            <span className="context-status">Live</span>
          </div>
          <h3>How lists enter</h3>
          <p>
            In Claude, call import_list with a markdown table or CSV. Email, phone, and LinkedIn are
            sent on Jargon&apos;s managed infrastructure — no outbound API keys to connect.
          </p>
          <button type="button" className="btn ghost btn-sm" onClick={() => onNavigate('/claude')}>
            Claude setup
          </button>
        </article>
      </div>

      <div className="section-heading" style={{ marginTop: 40 }}>
        <h2>Tools</h2>
      </div>
      {builds.length === 0 ? (
        <p className="section-lede">No tools yet. Deploy from Claude or the CLI.</p>
      ) : (
        <ul className="build-list">
          {builds.slice(0, 4).map((build) => (
            <li key={build.project.id} className="build-row">
              <div>
                <strong>{build.project.name}</strong>
                <p>
                  {build.contactCount} contacts · {build.project.prompt}
                </p>
              </div>
              <button type="button" className="btn primary btn-sm" onClick={() => onOpenTool(build.project.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
      {builds.length > 0 ? (
        <button type="button" className="btn ghost btn-sm" style={{ marginTop: 12 }} onClick={() => onNavigate('/tools')}>
          All tools
        </button>
      ) : null}
    </section>
  )
}
