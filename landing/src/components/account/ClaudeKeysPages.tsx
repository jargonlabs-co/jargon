import { getApiBase, getClaudeConnectorInstallUrl, getMcpUrl, type ApiKeyPublic, type ClaudeConnector } from '../../api'
import { formatWhen } from './nav'

export function ClaudePage({ claude }: { claude?: ClaudeConnector }) {
  const connectorUrl = claude?.connectorUrl ?? getClaudeConnectorInstallUrl()
  const mcpUrl = claude?.mcpUrl ?? getMcpUrl()
  const connected = Boolean(claude?.connected)

  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Claude connector</h1>
        <p className="section-lede">
          Jargon is an HTTP MCP connector. Add it in Claude, then Connect and sign in with this
          Jargon account. Claude can deploy tools, run outbound, and check credits from there.
        </p>
      </div>

      <article className="context-card claude-connector-card">
        <div className="context-card-top">
          <span className="context-role">Custom connector</span>
          <span className={`context-status ${connected ? 'ok' : ''}`}>
            {connected ? `Connected${claude?.connectedAt ? ` · ${formatWhen(claude.connectedAt)}` : ''}` : 'Not connected'}
          </span>
        </div>
        <h3>Add Jargon in Claude</h3>
        <ol className="claude-steps">
          <li>Click Connect Claude — Claude opens with Jargon prefilled.</li>
          <li>Add the connector, then click Connect.</li>
          <li>Sign in with this Jargon account when Claude sends you back.</li>
        </ol>
        <div className="key-actions">
          <a className="btn primary" href={connectorUrl} target="_blank" rel="noreferrer">
            {connected ? 'Reconnect Claude' : 'Connect Claude'}
          </a>
        </div>
        <p className="section-lede" style={{ marginTop: 16 }}>
          If Claude can&apos;t see the latest tools, remove Jargon under Connectors and click Connect
          Claude again.
        </p>
      </article>

      <div className="section-heading" style={{ marginTop: 36 }}>
        <h2>Claude Code</h2>
        <p className="section-lede">Same connector over HTTP. Then /mcp → Connect → this login.</p>
      </div>
      <pre className="connect-claude-cmd">{`claude mcp add --transport http --scope user jargon ${mcpUrl}`}</pre>
      <p className="section-lede" style={{ marginTop: 12 }}>
        Endpoint: <code>{mcpUrl}</code>
      </p>
    </section>
  )
}

export function KeysPage({
  apiKeys,
  lastKey,
  busy,
  onMint,
  onRevoke
}: {
  apiKeys: ApiKeyPublic[]
  lastKey: { key: string; environment: 'live' | 'sandbox' } | null
  busy: string | null
  onMint: (environment: 'live' | 'sandbox') => void
  onRevoke: (id: string) => void
}) {
  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>API keys</h1>
        <p className="section-lede">
          Prefer Connect Claude. Keys are the power-user fallback. Sandbox keys never reach real
          people and do not spend credits. Live keys send email, place calls, and debit credits.{' '}
          <a href={`${getApiBase()}/v1/openapi.json`} target="_blank" rel="noreferrer">
            OpenAPI spec
          </a>
        </p>
      </div>
      <div className="key-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={busy === 'apikey-sandbox'}
          onClick={() => onMint('sandbox')}
        >
          {busy === 'apikey-sandbox' ? 'Creating…' : 'Create sandbox key'}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy === 'apikey-live'}
          onClick={() => onMint('live')}
        >
          {busy === 'apikey-live' ? 'Creating…' : 'Create live key'}
        </button>
      </div>
      {lastKey ? (
        <p className={`deploy-result ${lastKey.environment === 'live' ? 'deploy-result-live' : ''}`}>
          Save this {lastKey.environment} key — it is shown once:
          <br />
          <code>{lastKey.key}</code>
          <br />
          <br />
          Add to Claude Code:
          <br />
          <code>
            claude mcp add --scope user --env JARGON_API_URL={getApiBase()} --env JARGON_API_KEY=
            {lastKey.key} jargon -- npx -y @jargon_labs/mcp
          </code>
        </p>
      ) : null}
      {apiKeys.length > 0 ? (
        <ul className="build-list key-list">
          {apiKeys.map((key) => (
            <li key={key.id} className="build-row">
              <div>
                <strong>{key.name}</strong>
                <p>
                  <span className={`key-badge key-badge-${key.environment ?? 'live'}`}>
                    {key.environment ?? 'live'}
                  </span>{' '}
                  {key.prefix}…
                </p>
              </div>
              <button
                type="button"
                className="btn ghost btn-sm"
                disabled={busy === `revoke-${key.id}`}
                onClick={() => onRevoke(key.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
