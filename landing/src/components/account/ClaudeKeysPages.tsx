import { getApiBase, getClaudeConnectorInstallUrl, getMcpUrl, resolveMcpUrl, type ApiKeyPublic, type ClaudeConnector } from '../../api'
import { launchChat, STARTER_PROMPT } from '../../lib/chatLaunch'
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
          <a className="btn primary" href={connectorUrl} target="_blank" rel="noreferrer">
            <ClaudeMark size={16} />
            Open in Claude
          </a>
          <button type="button" className="btn ghost" onClick={() => launchChat('chatgpt', STARTER_PROMPT)}>
            <ChatGptMark size={16} />
            Open in ChatGPT
          </button>
        </div>
      </article>
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
