import { getClaudeConnectorInstallUrl, resolveMcpUrl, type AccountSnapshot, type ConnectionPublic, type PortalBuild } from '../../api'
import { formatCredits, formatWhen, statusLabel } from './nav'

export function OverviewPage({
  snapshot,
  connections,
  builds,
  onNavigate,
  onOpenTool
}: {
  snapshot: AccountSnapshot
  connections: ConnectionPublic[]
  builds: PortalBuild[]
  onNavigate: (path: string) => void
  onOpenTool: (id: string) => void
}) {
  const { credits, usage, claude } = snapshot
  const hubspot = connections.find((c) => c.provider === 'hubspot')
  const railway = connections.find((c) => c.provider === 'railway')
  const dataReady =
    hubspot?.status === 'connected' ||
    (railway?.status === 'connected' && railway.meta?.needsBind !== '1' && !!railway.meta?.projectId)
  const connectorUrl = getClaudeConnectorInstallUrl(resolveMcpUrl(claude?.mcpUrl))
  const claudeConnected = Boolean(claude?.connected)

  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Overview</h1>
        <p className="section-lede">
          Deploy sales tools from Claude on top of your own data. Manage plan, credits, and usage
          here.
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
            <span className="context-role">Claude connector</span>
            <span className={`context-status ${claudeConnected ? 'ok' : ''}`}>
              {claudeConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <h3>Work from Claude</h3>
          <p>
            Add Jargon as a custom connector. Claude signs in with this account — no API key paste.
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
            <span className="context-role">Data</span>
            <span className={`context-status ${dataReady ? 'ok' : ''}`}>
              {dataReady ? 'Ready' : 'Connect a source'}
            </span>
          </div>
          <h3>Your sources</h3>
          <p>
            HubSpot: {statusLabel(hubspot)}. Railway: {statusLabel(railway)}.
          </p>
          <button type="button" className="btn ghost btn-sm" onClick={() => onNavigate('/data')}>
            Manage data
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
