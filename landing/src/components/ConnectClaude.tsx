import { useState } from 'react'
import { api, getClaudeConnectorInstallUrl, getMcpUrl } from '../api'
import { useAuth } from '../auth'
import { LoginPanel } from './LoginPanel'
import { LogoMark } from './LogoMark'

export function ConnectClaude() {
  const { user, org, loading } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  const state = params.get('state') ?? undefined
  const hasOAuth = Boolean(clientId && redirectUri && codeChallenge)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.consentMcp({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state
      })
      window.location.assign(result.redirect)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect Claude')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  return (
    <div className="connect-claude">
      <header className="connect-claude-brand">
        <LogoMark size={28} />
        <div>
          <h1>Connect Claude to Jargon</h1>
          <p>Claude will use your Jargon account to deploy queues and run outbound.</p>
        </div>
      </header>

      {!user ? (
        <>
          <p className="connect-claude-lede">Sign in with the same account you use on jargonlabs.co.</p>
          <LoginPanel embedded />
        </>
      ) : !hasOAuth ? (
        <div className="connect-claude-card">
          <p>
            Signed in as <strong>{user.email}</strong>
            {org ? ` · ${org.name}` : ''}. Open Claude to add Jargon as a connector, then approve
            here when Claude sends you back.
          </p>
          <a
            className="btn primary"
            href={getClaudeConnectorInstallUrl()}
            target="_blank"
            rel="noreferrer"
          >
            Connect Claude
          </a>
          <pre className="connect-claude-cmd">{`claude mcp add --transport http --scope user jargon ${getMcpUrl()}`}</pre>
          <a className="btn ghost" href="/claude">
            Back to dashboard
          </a>
        </div>
      ) : (
        <div className="connect-claude-card">
          <p>
            <strong>Claude</strong> wants access to <strong>{org?.name ?? 'your workspace'}</strong> as{' '}
            {user.email}. This can send email and place calls on your plan.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="key-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void approve()}>
              {busy ? 'Connecting…' : 'Allow Claude'}
            </button>
            <a className="btn ghost" href="/claude">
              Cancel
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

