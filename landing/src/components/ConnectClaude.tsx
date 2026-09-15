import { useState } from 'react'
import { api, getClaudeConnectorInstallUrl, getMcpUrl } from '../api'
import { useAuth } from '../auth'
import { ClaudeMark } from './ClaudeMark'
import { LoginPanel } from './LoginPanel'
import { LogoMark } from './LogoMark'
import { CONNECTOR_DESCRIPTION, CONNECTOR_TAGLINE, ConnectorGallery } from './ConnectorGallery'

function ConnectShell({
  title,
  subtitle,
  wide,
  children
}: {
  title: string
  subtitle: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <main className={`connect-claude${wide ? ' wide' : ''}`}>
      <div className={`connect-claude-inner${wide ? ' wide' : ''}`}>
        <header className="connect-claude-head">
          <div className="connect-claude-pair">
            <span className="connect-claude-tile">
              <LogoMark size={22} />
            </span>
            <span className="connect-claude-wire" aria-hidden="true" />
            <span className="connect-claude-tile bare">
              <ClaudeMark size={44} />
            </span>
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </header>
        {children}
      </div>
    </main>
  )
}

export function ConnectClaude() {
  const { user, org, loading, signOut } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  const state = params.get('state') ?? undefined
  const hasOAuth = Boolean(clientId && redirectUri && codeChallenge)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')

  const command = `claude mcp add --transport http --scope user jargon ${getMcpUrl()}`

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

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  if (!hasOAuth) {
    return (
      <ConnectShell title="Add Jargon to Claude" subtitle={CONNECTOR_TAGLINE} wide>
        <p className="connect-claude-head-desc">{CONNECTOR_DESCRIPTION}</p>
        <ConnectorGallery className="connect-claude-gallery" />
        {user ? (
          <div className="connect-claude-card">
            <div className="connect-claude-identity">
              <span className="connect-claude-avatar" aria-hidden="true">
                {user.email.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{user.email}</strong>
                {org ? <span>{org.name}</span> : null}
              </div>
              <button type="button" className="connect-claude-switch" onClick={() => void signOut()}>
                Switch
              </button>
            </div>
            <ol className="connect-claude-steps">
              <li>
                <span className="connect-claude-step-label">Claude desktop or web</span>
                <a
                  className="btn primary btn-full"
                  href={getClaudeConnectorInstallUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  Add connector in Claude
                </a>
              </li>
              <li>
                <span className="connect-claude-step-label">Claude Code</span>
                <div className="connect-claude-cmd">
                  <code>{command}</code>
                  <button type="button" className="connect-claude-copy" onClick={() => void copyCommand()}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </li>
            </ol>
          </div>
        ) : (
          <>
            <LoginPanel embedded showBrand={false} onModeChange={setAuthMode} />
            <p className="connect-claude-foot">
              {authMode === 'login' ? (
                <>
                  New to Jargon? Choose <strong>Create account</strong> above.
                </>
              ) : (
                <>You&apos;ll come straight back here to connect Claude.</>
              )}
            </p>
          </>
        )}
        {user ? (
          <p className="connect-claude-foot">
            <a href="/claude">Back to dashboard</a>
          </p>
        ) : null}
      </ConnectShell>
    )
  }

  if (!user) {
    return (
      <ConnectShell
        title="Connect Claude to Jargon"
        subtitle={
          authMode === 'login'
            ? 'Sign in to your Jargon account so Claude can deploy queues and run outbound on your behalf.'
            : 'Create a Jargon workspace for Claude to deploy queues and run outbound in.'
        }
      >
        <LoginPanel embedded showBrand={false} onModeChange={setAuthMode} />
        <p className="connect-claude-foot">
          {authMode === 'login' ? (
            <>
              New to Jargon? Choose <strong>Create account</strong> above.
            </>
          ) : (
            <>You&apos;ll come straight back here to approve Claude.</>
          )}
        </p>
      </ConnectShell>
    )
  }

  return (
    <ConnectShell
      title="Claude wants access to Jargon"
      subtitle={`Approve to let Claude work inside ${org?.name ?? 'your workspace'}.`}
    >
      <div className="connect-claude-card">
        <div className="connect-claude-identity">
          <span className="connect-claude-avatar" aria-hidden="true">
            {user.email.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user.email}</strong>
            {org ? <span>{org.name}</span> : null}
          </div>
          <button type="button" className="connect-claude-switch" onClick={() => void signOut()}>
            Switch
          </button>
        </div>
        <ul className="connect-claude-scopes">
          <li>Read your contacts, queues, and tool configuration</li>
          <li>Deploy and update tools in your workspace</li>
          <li>Send email and place calls billed to your plan</li>
        </ul>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="connect-claude-actions">
          <button type="button" className="btn primary btn-full" disabled={busy} onClick={() => void approve()}>
            {busy ? 'Connecting…' : 'Allow access'}
          </button>
          <a className="btn ghost btn-full" href="/claude">
            Cancel
          </a>
        </div>
      </div>
      <p className="connect-claude-foot">You can revoke Claude&apos;s access any time from your dashboard.</p>
    </ConnectShell>
  )
}
