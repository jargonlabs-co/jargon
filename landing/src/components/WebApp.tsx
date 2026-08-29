import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic, type PortalBuild } from '../api'
import { useAuth } from '../auth'
import { LogoMark } from './LogoMark'

const SUGGESTED_PROMPTS = [
  'Find 20 prospects to contact today',
  'Build a dialer for VP Sales in Austin',
  'Create a rep queue for SaaS founders in NYC'
]

const CONTEXT_PROVIDERS = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    role: 'CRM',
    blurb: 'Pull contacts and companies from your CRM.'
  },
  {
    id: 'crustdata',
    name: 'Crustdata',
    role: 'Enrichment',
    blurb: 'People search and talk tracks for outbound tools.'
  }
] as const

function statusLabel(conn: ConnectionPublic | undefined): string {
  if (!conn) return 'Not connected'
  if (conn.status === 'connected') return conn.accountLabel ?? 'Connected'
  return conn.status
}

export function WebApp({ preview = false }: { preview?: boolean }) {
  const auth = useAuth()
  const user = preview
    ? { name: 'Tara', email: 'demo@jargon.app' }
    : auth.user!
  const org = preview ? { name: 'Jargon Demo' } : auth.org!
  const signOut = preview ? () => window.location.assign('/') : auth.signOut
  const [connections, setConnections] = useState<ConnectionPublic[]>([])
  const [builds, setBuilds] = useState<PortalBuild[]>([])
  const [prompt, setPrompt] = useState(SUGGESTED_PROMPTS[0])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastDeploy, setLastDeploy] = useState<{ name: string; url: string; contacts: number } | null>(
    null
  )

  const refresh = useCallback(async () => {
    if (preview) {
      setConnections([
        { id: '1', provider: 'crustdata', status: 'connected', accountLabel: 'Crustdata live' },
        { id: '2', provider: 'hubspot', status: 'disconnected' }
      ])
      setBuilds([
        {
          project: {
            id: 'proj_demo',
            name: 'Today queue',
            kind: 'today',
            prompt: 'Find 20 prospects to contact today',
            updatedAt: Date.now() - 86400000
          },
          contactCount: 20,
          shares: [{ id: 's1', label: 'Today queue preview', expiresAt: Date.now() + 86400000 * 30, revoked: false }]
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
      setLastDeploy({
        name: 'Today queue',
        url: 'https://app.jargon.app/preview.html#demo',
        contacts: 20
      })
      setToast('Preview — deploy calls your hosted API in production')
      return
    }
    setBusy('deploy')
    setError(null)
    try {
      const result = await api.deploy(prompt.trim())
      if (result.shareUrl) {
        setLastDeploy({
          name: result.project.name,
          url: result.shareUrl,
          contacts: result.contactCount
        })
      }
      setToast(`Built "${result.project.name}" with ${result.contactCount} contacts`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed')
    } finally {
      setBusy(null)
    }
  }

  async function copyShare(projectId: string, name: string) {
    setBusy(`share-${projectId}`)
    try {
      const share = await api.createShare(projectId, `${name} preview`)
      await navigator.clipboard.writeText(share.url)
      setToast('Share link copied')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy link')
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
            <p className="eyebrow">Step 1</p>
            <h1>Connect your context layer</h1>
            <p className="section-lede">
              Wire CRM and enrichment so every tool you build runs on live data.
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
            <p className="eyebrow">Step 2</p>
            <h1>Create a tool</h1>
            <p className="section-lede">
              Describe what your team needs. Jargon builds a rep-ready workspace and share link.
            </p>
          </div>
          <form className="build-form" onSubmit={deploy}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Find 20 prospects to contact today…"
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

          {lastDeploy ? (
            <div className="deploy-result">
              <h3>{lastDeploy.name}</h3>
              <p>
                {lastDeploy.contacts} contacts ·{' '}
                <a href={lastDeploy.url} target="_blank" rel="noreferrer">
                  Open rep console
                </a>
              </p>
            </div>
          ) : null}
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
                    <p>{build.contactCount} contacts · {build.project.prompt}</p>
                  </div>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    disabled={busy === `share-${build.project.id}`}
                    onClick={() => void copyShare(build.project.id, build.project.name)}
                  >
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {error ? <p className="form-error webapp-error">{error}</p> : null}
        {toast ? <div className="webapp-toast">{toast}</div> : null}
      </main>
    </div>
  )
}
