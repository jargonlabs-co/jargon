import { getApiBase, getClaudeConnectorInstallUrl, getMcpUrl, resolveMcpUrl, type ApiKeyPublic, type ClaudeConnector } from '../../api'
import { getChatGptConnectorUrl, launchChat, STARTER_PROMPT } from '../../lib/chatLaunch'
import { formatWhen } from './nav'
import { ChatGptMark } from '../ChatGptMark'
import { ClaudeMark } from '../ClaudeMark'
import { CONNECTOR_DESCRIPTION, CONNECTOR_TAGLINE } from '../ConnectorGallery'
import { StarterPrompt } from '../StarterPrompt'

export function ClaudePage({ claude }: { claude?: ClaudeConnector }) {
  const mcpUrl = resolveMcpUrl(claude?.mcpUrl) || getMcpUrl()
  const connectorUrl = getClaudeConnectorInstallUrl(mcpUrl)
  const connected = Boolean(claude?.connected)

  return (
    <section className="webapp-section connect-setup">
      <div className="section-heading">
        <p className="eyebrow">Connectors</p>
        <h1>Connect Jargon to Claude or ChatGPT</h1>
        <p className="section-lede">{CONNECTOR_TAGLINE}</p>
        <p className="section-lede">{CONNECTOR_DESCRIPTION}</p>
      </div>

      <article className="context-card connect-onboard-card">
        <div className="context-card-top">
          <span className="context-role">First prompt</span>
          <span className={`context-status ${connected ? 'ok' : ''}`}>
            {connected ? `Connected${claude?.connectedAt ? ` · ${formatWhen(claude.connectedAt)}` : ''}` : 'Paste this after you Allow'}
          </span>
        </div>
        <h3>Start with this prompt</h3>
        <p>
          Copy it into Claude or ChatGPT after you add the Jargon connector. It asks two qualifying
          questions, then stands up the queue from chat.
        </p>
        <StarterPrompt />
        <div className="connect-open-row">
          <button type="button" className="btn primary" onClick={() => launchChat('claude', STARTER_PROMPT)}>
            <ClaudeMark size={16} />
            Open in Claude
          </button>
          <button type="button" className="btn ghost" onClick={() => launchChat('chatgpt', STARTER_PROMPT)}>
            <ChatGptMark size={16} />
            Open in ChatGPT
          </button>
        </div>
      </article>

      <div className="account-split">
        <article className="context-card claude-connector-card">
          <div className="context-card-top">
            <span className="context-role">Claude</span>
            <span className={`context-status ${connected ? 'ok' : ''}`}>
              {connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <h3>Add Jargon in Claude</h3>
          <ol className="claude-steps">
            <li>Click Connect Claude — Claude opens with Jargon prefilled.</li>
            <li>Add the connector, then click Connect.</li>
            <li>Sign in with this Jargon account when Claude sends you back.</li>
            <li>Paste the prompt above and Allow.</li>
          </ol>
          <div className="key-actions">
            <a className="btn primary" href={connectorUrl} target="_blank" rel="noreferrer">
              {connected ? 'Reconnect Claude' : 'Connect Claude'}
            </a>
          </div>
        </article>
        <article className="context-card claude-connector-card">
          <div className="context-card-top">
            <span className="context-role">ChatGPT</span>
            <span className="context-status">MCP app</span>
          </div>
          <h3>Add Jargon in ChatGPT</h3>
          <ol className="claude-steps">
            <li>Open ChatGPT settings → Apps &amp; Connectors (Developer mode).</li>
            <li>Create a connector named Jargon with this MCP URL.</li>
            <li>Sign in with this Jargon account when ChatGPT sends you back.</li>
            <li>Paste the prompt above to start the first workspace.</li>
          </ol>
          <p className="section-lede">
            Endpoint: <code>{mcpUrl}</code>
          </p>
          <div className="key-actions">
            <a className="btn ghost" href={getChatGptConnectorUrl()} target="_blank" rel="noreferrer">
              Open ChatGPT connectors
            </a>
          </div>
        </article>
      </div>

      <div className="section-heading" style={{ marginTop: 36 }}>
        <h2>Claude Code</h2>
        <p className="section-lede">Same connector over HTTP. Then /mcp → Connect → this login.</p>
      </div>
      <pre className="connect-claude-cmd">{`claude mcp add --transport http --scope user jargon ${mcpUrl}`}</pre>
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
            claude mcp add --scope user --transport http jargon {getMcpUrl()} --header &quot;Authorization: Bearer{' '}
            {lastKey.key}&quot;
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
