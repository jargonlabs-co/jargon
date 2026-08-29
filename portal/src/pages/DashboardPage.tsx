import { useEffect, useState } from 'react'
import { api, type PortalBuild } from '../api'
import { useAuth } from '../auth'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function kindLabel(kind: string): string {
  if (kind === 'today') return 'Rep queue'
  if (kind === 'dialer') return 'Dialer'
  if (kind === 'sequencer') return 'Sequencer'
  return kind
}

export default function DashboardPage() {
  const { me } = useAuth()
  const [builds, setBuilds] = useState<PortalBuild[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    void api
      .builds()
      .then((res) => setBuilds(res.builds))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load builds'))
      .finally(() => setLoading(false))
  }, [])

  async function copyShareLink(projectId: string, projectName: string) {
    try {
      const share = await api.createShare(projectId, `${projectName} preview`)
      await navigator.clipboard.writeText(share.url)
      setCopiedId(projectId)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create share link')
    }
  }

  const billing = me?.billing

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Builds</h1>
          <p className="page-subtitle">UI tools deployed for your org — share links open the rep console.</p>
        </div>
        <a
          className="btn btn-secondary"
          href="https://github.com/jargonlabs-co/jargon/releases/latest"
          target="_blank"
          rel="noreferrer"
        >
          Download desktop
        </a>
      </header>

      {billing ? (
        <div className="usage-bar">
          <span>
            {billing.buildCount}
            {billing.buildLimit != null ? ` / ${billing.buildLimit}` : ''} builds
          </span>
          <span className="usage-plan">{billing.planName} plan</span>
        </div>
      ) : null}

      {loading ? <p className="muted">Loading builds…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {!loading && builds.length === 0 ? (
        <div className="empty-state">
          <h2>No builds yet</h2>
          <p>
            Deploy from the desktop app or CLI:{' '}
            <code>jargon deploy &quot;Find 20 prospects to contact today&quot;</code>
          </p>
        </div>
      ) : null}

      <div className="build-list">
        {builds.map((build) => (
          <article key={build.project.id} className="build-card">
            <div className="build-card-head">
              <div>
                <h2>{build.project.name}</h2>
                <p className="build-meta">
                  <span className="badge">{kindLabel(build.project.kind)}</span>
                  <span>{build.contactCount} contacts</span>
                  <span>Updated {formatDate(build.project.updatedAt)}</span>
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void copyShareLink(build.project.id, build.project.name)}
              >
                {copiedId === build.project.id ? 'Copied!' : 'Copy share link'}
              </button>
            </div>
            <p className="build-prompt">{build.project.prompt}</p>
            {build.shares.length > 0 ? (
              <div className="share-list">
                {build.shares.slice(0, 3).map((share) => (
                  <div key={share.id} className="share-row">
                    <span>{share.label}</span>
                    <span className="muted">
                      {share.revoked ? 'Revoked' : `Expires ${formatDate(share.expiresAt)}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
