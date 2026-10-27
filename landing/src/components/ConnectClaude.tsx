import { useState } from 'react'
import { api, getClaudeConnectorInstallUrl } from '../api'
import { useAuth } from '../auth'
import { ChatGptMark } from './ChatGptMark'
import { ClaudeMark } from './ClaudeMark'
import { LoginPanel } from './LoginPanel'
import { LogoMark } from './LogoMark'
import { StarterPrompt } from './StarterPrompt'
import { CONNECTOR_TAGLINE } from './ConnectorGallery'
import { detectChatHost, hostLabel, type ChatDestination } from '../lib/chatLaunch'

function ConnectShell({
  title,
  subtitle,
  destination = 'claude',
  wide,
  children
}: {
  title: string
  subtitle: string
  destination?: ChatDestination
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
            <span className={`connect-claude-tile${destination === 'claude' ? ' bare' : ''}`}>
              {destination === 'chatgpt' ? <ChatGptMark size={22} /> : <ClaudeMark size={44} />}
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
  const previewConsent = import.meta.env.DEV && params.get('preview') === 'consent'
  const hasOAuth = previewConsent || Boolean(clientId && redirectUri && codeChallenge)
  const destination = detectChatHost(redirectUri || (previewConsent ? 'https://claude.ai/callback' : ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')

  const host = hostLabel(destination)
  const partner = destination === 'chatgpt' ? 'ChatGPT' : 'Claude'

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
      setError(err instanceof Error ? err.message : `Could not connect ${partner}`)
    } finally {
      setBusy(false)
    }
  }

  const previewUser = previewConsent
    ? { email: user?.email ?? 'tara@jargonlabs.co', name: user?.name ?? 'Tara' }
    : user
  const previewOrg = previewConsent ? { name: org?.name ?? 'Jargon Demo' } : org

  if (loading && !previewConsent) {
    return <div className="page-loading">Loading…</div>
  }

  if (!hasOAuth) {
    return (
      <ConnectShell title="Add Jargon to Claude" subtitle={CONNECTOR_TAGLINE}>
        <div className="connect-claude-card connect-claude-offer">
          <p>
            Run outbound with Jargon inside Claude: turn a list into a dialer, a cadence, or today’s
            tasks, and work them from the chat.
          </p>
          <a className="btn primary" href={getClaudeConnectorInstallUrl()} target="_blank" rel="noreferrer">
            Add connector in Claude
          </a>
        </div>
      </ConnectShell>
    )
  }

  if (!previewUser) {
    return (
      <ConnectShell
        title={`Connect ${partner} to Jargon`}
        subtitle={
          authMode === 'login'
            ? `Sign in so ${partner} can build sequences and work today’s tasks in your workspace.`
            : `Create a Jargon workspace so ${partner} can run contacts, sequences, and tasks from chat.`
        }
        destination={destination}
      >
        <LoginPanel embedded showBrand={false} onModeChange={setAuthMode} />
        <p className="connect-claude-foot">
          {authMode === 'login' ? (
            <>
              New to Jargon? Choose <strong>Create account</strong> above.
            </>
          ) : (
            <>You&apos;ll come straight back here to approve {partner}.</>
          )}
        </p>
      </ConnectShell>
    )
  }

  return (
    <ConnectShell
      title={`Connect Jargon to ${partner}`}
      subtitle={`Access Jargon’s queues, cadences, and dialer right inside ${partner}.`}
      destination={destination}
    >
      <p className="connect-claude-sent">
        Access code will be sent to: <strong>{host}</strong>
      </p>
      <div className="connect-claude-card connect-onboard-card">
        <div className="connect-claude-identity">
          <span className="connect-claude-avatar" aria-hidden="true">
            {previewUser.email.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{previewUser.email}</strong>
            {previewOrg ? <span>{previewOrg.name}</span> : null}
          </div>
          <button type="button" className="connect-claude-switch" onClick={() => void signOut()}>
            Switch
          </button>
        </div>
        <StarterPrompt />
        <p className="connect-privacy">
          Please check your AI provider&apos;s privacy settings before sharing any personal
          information through this connection. Make sure your provider does not train on the data
          you submit to receive Jargon contact information.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="connect-onboard-actions">
          <a className="btn ghost" href="/">
            Cancel
          </a>
          <button
            type="button"
            className="btn primary"
            disabled={busy || previewConsent}
            onClick={() => void approve()}
          >
            {busy ? 'Connecting…' : 'Allow'}
          </button>
        </div>
      </div>
      <p className="connect-claude-foot">You can revoke {partner}&apos;s access any time from your dashboard.</p>
    </ConnectShell>
  )
}
