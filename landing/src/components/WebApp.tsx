import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic, type PortalBuild } from '../api'
import { useAuth } from '../auth'
import { LogoMark } from './LogoMark'

const SUGGESTED_PROMPTS = [
  'Build a dialer for VP Sales in Austin',
  'Create an outbound sequencer for SaaS founders',
  'Today queue for mid-market accounts'
]

const CONTEXT_PROVIDERS = [
  {
    id: 'gmail',
    name: 'Gmail',
    role: 'Email',
    blurb: 'Send from sequencers and inbox.'
  },
  {
    id: 'twilio',
    name: 'Twilio',
    role: 'Voice',
    blurb: 'Call from the dial console.'
  },
  {
    id: 'heyreach',
    name: 'HeyReach',
    role: 'LinkedIn',
    blurb: 'Message prospects on LinkedIn.'
  }
] as const

function statusLabel(conn: ConnectionPublic | undefined): string {
  if (!conn) return 'Not connected'
  if (conn.status === 'connected') return conn.accountLabel ?? 'Connected'
  return conn.status
}

function toolPath(projectId: string): string {
  return `/tools/${projectId}`
}

export function WebApp({
  preview = false,
  onOpenTool
}: {
  preview?: boolean
  onOpenTool?: (projectId: string) => void
}) {
  const auth = useAuth()
  const user = preview ? { name: 'Tara', email: 'demo@jargon.app' } : auth.user!
  const org = preview ? { name: 'Jargon Demo' } : auth.org!
  const signOut = preview ? () => window.location.assign('/') : auth.signOut
  const [connections, setConnections] = useState<ConnectionPublic[]>([])
  const [builds, setBuilds] = useState<PortalBuild[]>([])
  const [prompt, setPrompt] = useState(SUGGESTED_PROMPTS[0])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastKey, setLastKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (preview) {
      setConnections([
        { id: '1', provider: 'gmail', status: 'connected', accountLabel: 'demo@jargon.app' },
        { id: '2', provider: 'twilio', status: 'disconnected' },
        { id: '3', provider: 'heyreach', status: 'disconnected' }
      ])
      setBuilds([
        {
          project: {
            id: 'proj_demo',
            name: 'Outbound sequencer',
            kind: 'today',
            prompt: 'Create an outbound sequencer',
            updatedAt: Date.now() - 86400000
          },
          contactCount: 20
        }
      ])
      return
    }
    const [conns, buildRes] = await Promise.all([api.connections(), api.builds()])
    setConnections(conns)
    setBuilds(buildRes.builds)
  }, [preview])

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message))
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  async function connect(provider: string) {
    if (preview) {
      setToast(`${provider} connect opens OAuth in production`)
      return
    }
    setBusy(provider)
    setError(null)
    try {
      const result = await api.startConnection(provider)
      if (result.url) {
        window.location.href = result.url
        return
      }
      setToast(`${provider} connected`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setBusy(null)
    }
  }

  async function deploy(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim()) return
    if (preview) {
      setToast('Preview — deploy calls your hosted API in production')
      return
    }
    setBusy('deploy')
    setError(null)
    try {
      const result = await api.deploy(prompt.trim())
      setToast(`Built "${result.project.name}" with ${result.contactCount} contacts`)
      await refresh()
      onOpenTool?.(result.projectId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed')
    } finally {
      setBusy(null)
    }
  }

  async function mintKey() {
    if (preview) {
      setToast('API keys are created after login')
      return
    }
    setBusy('apikey')
    try {
      const created = await api.createApiKey('CLI')
      setLastKey(created.key)
      setToast('API key created — copy it now, it is shown once')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create API key')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="webapp">
      <header className="webapp-header">
        <div className="webapp-brand">
          <LogoMark size={24} />
          <span>Jargon</span>
        </div>
        <div className="webapp-meta">
          <span className="webapp-org">{org?.name}</span>
          <span className="webapp-user">{user?.email}</span>
        </div>
        <button type="button" className="btn ghost btn-sm" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <main className="webapp-main">
        <section className="webapp-section">
          <div className="section-heading">
            <p className="eyebrow">Connections</p>
            <h1>Gmail, Twilio, HeyReach</h1>
            <p className="section-lede">
              Tools you deploy from the CLI send email, place calls, and message LinkedIn through
              these accounts.
            </p>
          </div>
          <div className="context-grid">
            {CONTEXT_PROVIDERS.map((provider) => {
              const conn = connections.find((c) => c.provider === provider.id)
              const connected = conn?.status === 'connected'
              return (
                <article key={provider.id} className="context-card">
                  <div className="context-card-top">
                    <span className="context-role">{provider.role}</span>
                    <span className={`context-status ${connected ? 'ok' : ''}`}>
                      {statusLabel(conn)}
                    </span>
                  </div>
                  <h3>{provider.name}</h3>
                  <p>{provider.blurb}</p>
                  {!connected ? (
                    <button
                      type="button"
                      className="btn primary btn-sm"
                      disabled={busy === provider.id}
                      onClick={() => void connect(provider.id)}
                    >
                      {busy === provider.id ? 'Connecting…' : 'Connect'}
                    </button>
                  ) : (
                    <span className="context-connected">Ready</span>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        <section className="webapp-section">
          <div className="section-heading">
            <p className="eyebrow">Create</p>
            <h1>Deploy a tool</h1>
            <p className="section-lede">
              From the website or <code>jargon deploy</code> in your terminal. Open the UI here after
              login — no share links.
            </p>
          </div>
          <form className="build-form" onSubmit={deploy}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Build a dialer for inbound leads…"
            />
            <div className="prompt-chips">
              {SUGGESTED_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  className="prompt-chip"
                  onClick={() => setPrompt(sample)}
                >
                  {sample}
                </button>
              ))}
            </div>
            <button type="submit" className="btn primary" disabled={busy === 'deploy'}>
              {busy === 'deploy' ? 'Building…' : 'Build tool'}
            </button>
          </form>
        </section>

        {builds.length > 0 ? (
          <section className="webapp-section">
            <div className="section-heading">
              <h2>Your tools</h2>
            </div>
            <ul className="build-list">
              {builds.map((build) => (
                <li key={build.project.id} className="build-row">
                  <div>
                    <strong>{build.project.name}</strong>
                    <p>
                      {build.contactCount} contacts · {build.project.prompt}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn primary btn-sm"
                    onClick={() => onOpenTool?.(build.project.id)}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="webapp-section">
          <div className="section-heading">
            <h2>CLI</h2>
            <p className="section-lede">
              <code>jargon login --api-key …</code> then{' '}
              <code>jargon deploy &quot;Build a dialer…&quot;</code>
            </p>
          </div>
          <button type="button" className="btn ghost" disabled={busy === 'apikey'} onClick={() => void mintKey()}>
            {busy === 'apikey' ? 'Creating…' : 'Create API key'}
          </button>
          {lastKey ? (
            <p className="deploy-result">
              Save this key — it is shown once:
              <br />
              <code>{lastKey}</code>
            </p>
          ) : null}
        </section>

        {error ? <p className="form-error webapp-error">{error}</p> : null}
        {toast ? <div className="webapp-toast">{toast}</div> : null}
      </main>
    </div>
  )
}

export { toolPath }
