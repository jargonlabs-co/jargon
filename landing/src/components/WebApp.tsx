import { useCallback, useEffect, useState } from 'react'
import { api, getApiBase, type ApiKeyPublic, type ConnectionPublic, type PortalBuild } from '../api'
import { useAuth } from '../auth'
import { LogoMark } from './LogoMark'

const SUGGESTED_PROMPTS = [
  'Build a dialer for my AE book',
  'Create an outbound sequencer',
  'Today queue for my HubSpot contacts'
]

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
  const [apiKeys, setApiKeys] = useState<ApiKeyPublic[]>([])
  const [lastKey, setLastKey] = useState<{ key: string; environment: 'live' | 'sandbox' } | null>(
    null
  )
  const [pgTable, setPgTable] = useState('jargon_prospects')
  const [railwayProjects, setRailwayProjects] = useState<
    Array<{
      projectId: string
      projectName: string
      environmentId: string
      environmentName: string
      postgresServices: Array<{ serviceId: string; serviceName: string }>
    }>
  >([])
  const [selectedKey, setSelectedKey] = useState('')

  const refresh = useCallback(async () => {
    if (preview) {
      setConnections([
        { id: '1', provider: 'hubspot', status: 'connected', accountLabel: 'Acme HubSpot' },
        {
          id: '2',
          provider: 'railway',
          status: 'connected',
          accountLabel: 'outbound-ops · Postgres · jargon_prospects',
          meta: { rowCount: '50', table: 'jargon_prospects', projectId: 'demo' }
        }
      ])
      setRailwayProjects([
        {
          projectId: 'demo',
          projectName: 'outbound-ops',
          environmentId: 'env',
          environmentName: 'production',
          postgresServices: [{ serviceId: 'pg', serviceName: 'Postgres' }]
        }
      ])
      setSelectedKey('demo|env|pg')
      setBuilds([
        {
          project: {
            id: 'proj_demo',
            name: 'Outbound sequencer',
            kind: 'today',
            prompt: 'Create an outbound sequencer',
            updatedAt: Date.now() - 86400000
          },
          contactCount: 0
        }
      ])
      setApiKeys([
        {
          id: 'key_live',
          name: 'Claude Code',
          prefix: 'jarg_a1b2c3d4',
          environment: 'live',
          createdAt: Date.now()
        },
        {
          id: 'key_test',
          name: 'dev',
          prefix: 'jarg_test_ab',
          environment: 'sandbox',
          createdAt: Date.now()
        }
      ])
      return
    }
    const [conns, buildRes, keys] = await Promise.all([
      api.connections(),
      api.builds(),
      api.listApiKeys().catch(() => [] as ApiKeyPublic[])
    ])
    setApiKeys(keys)
    setConnections(conns)
    setBuilds(buildRes.builds)
    const railway = conns.find((c) => c.provider === 'railway')
    if (railway?.status === 'connected') {
      try {
        const { projects } = await api.listRailwayResources()
        setRailwayProjects(projects)
        if (projects[0]) {
          const svc = projects[0].postgresServices[0]
          setSelectedKey(
            `${projects[0].projectId}|${projects[0].environmentId}|${svc?.serviceId || ''}`
          )
        }
      } catch {
        setRailwayProjects([])
      }
    } else {
      setRailwayProjects([])
    }
  }, [preview])

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message))
  }, [refresh])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('railway') === 'connected') {
      setToast('Railway signed in — choose a Postgres project')
      params.delete('railway')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    } else if (params.get('railway') === 'error') {
      setError('Railway connection failed')
      params.delete('railway')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    }
  }, [])

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

  async function syncHubSpot() {
    if (preview) {
      setToast('Would reload HubSpot contacts')
      return
    }
    setBusy('sync')
    setError(null)
    try {
      const result = await api.syncHubSpot()
      setToast(`Loaded ${result.count} contacts into your tools`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function bindRailway() {
    if (preview) {
      setToast('Would bind Railway Postgres')
      return
    }
    const [projectId, environmentId, serviceId] = selectedKey.split('|')
    const project = railwayProjects.find(
      (p) => p.projectId === projectId && p.environmentId === environmentId
    )
    if (!project) {
      setError('Choose a Railway project')
      return
    }
    const service = project.postgresServices.find((s) => s.serviceId === serviceId)
    setBusy('bind-railway')
    setError(null)
    try {
      await api.bindRailway({
        projectId: project.projectId,
        environmentId: project.environmentId,
        serviceId: service?.serviceId,
        projectName: project.projectName,
        serviceName: service?.serviceName,
        table: pgTable.trim() || 'jargon_prospects'
      })
      setToast('Railway Postgres ready')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bind failed')
    } finally {
      setBusy(null)
    }
  }

  async function syncRailway() {
    if (preview) {
      setToast('Would reload Railway prospects')
      return
    }
    setBusy('sync-railway')
    setError(null)
    try {
      const result = await api.syncRailway()
      setToast(`Loaded ${result.count} contacts from Railway`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
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
      setToast(`Built "${result.project.name}" · ${result.contactCount} contacts`)
      await refresh()
      onOpenTool?.(result.projectId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed')
    } finally {
      setBusy(null)
    }
  }

  async function mintKey(environment: 'live' | 'sandbox') {
    if (preview) {
      setToast('API keys are created after login')
      return
    }
    setBusy(`apikey-${environment}`)
    setError(null)
    try {
      const created = await api.createApiKey(
        environment === 'sandbox' ? 'Claude sandbox' : 'Claude Code',
        environment
      )
      setLastKey({ key: created.key, environment: created.environment })
      setApiKeys(await api.listApiKeys())
      setToast(
        environment === 'live'
          ? 'Live key created — it can send real email and place real calls'
          : 'Sandbox key created — sends and dials do not reach real people'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create API key')
    } finally {
      setBusy(null)
    }
  }

  async function revokeKey(id: string) {
    if (preview) return
    setBusy(`revoke-${id}`)
    try {
      await api.revokeApiKey(id)
      setApiKeys((keys) => keys.filter((k) => k.id !== id))
      setToast('API key revoked')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke key')
    } finally {
      setBusy(null)
    }
  }

  const hubspot = connections.find((c) => c.provider === 'hubspot')
  const hubspotOk = hubspot?.status === 'connected'
  const railway = connections.find((c) => c.provider === 'railway')
  const railwayAuthed = railway?.status === 'connected'
  const railwayBound =
    railwayAuthed && railway?.meta?.needsBind !== '1' && !!railway?.meta?.projectId
  const optionEntries = railwayProjects.flatMap((p) => {
    const services =
      p.postgresServices.length > 0
        ? p.postgresServices
        : [{ serviceId: '', serviceName: '(project vars)' }]
    return services.map((s) => ({
      key: `${p.projectId}|${p.environmentId}|${s.serviceId}`,
      label: `${p.projectName} · ${s.serviceName} · ${p.environmentName}`
    }))
  })

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
            <p className="eyebrow">Your data</p>
            <h1>Connect your sources</h1>
            <p className="section-lede">
              Tools load people from HubSpot or Railway Postgres. Email, calling, and LinkedIn are
              sent by Jargon — you don’t connect those.
            </p>
          </div>
          <div className="context-grid">
            <article className="context-card">
              <div className="context-card-top">
                <span className="context-role">CRM</span>
                <span className={`context-status ${hubspotOk ? 'ok' : ''}`}>
                  {statusLabel(hubspot)}
                </span>
              </div>
              <h3>HubSpot</h3>
              <p>People in your portal become the queue in every tool.</p>
              {!hubspotOk ? (
                <button
                  type="button"
                  className="btn primary btn-sm"
                  disabled={busy === 'hubspot'}
                  onClick={() => void connect('hubspot')}
                >
                  {busy === 'hubspot' ? 'Connecting…' : 'Connect HubSpot'}
                </button>
              ) : (
                <>
                  <span className="context-connected">Ready</span>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    disabled={busy === 'sync'}
                    onClick={() => void syncHubSpot()}
                  >
                    {busy === 'sync' ? 'Syncing…' : 'Reload contacts'}
                  </button>
                </>
              )}
            </article>

            <article className="context-card">
              <div className="context-card-top">
                <span className="context-role">Warehouse</span>
                <span className={`context-status ${railwayBound ? 'ok' : ''}`}>
                  {railwayBound
                    ? statusLabel(railway)
                    : railwayAuthed
                      ? 'Choose project'
                      : 'Not connected'}
                </span>
              </div>
              <h3>Railway</h3>
              <p>Sign in with Railway and pick the Postgres that holds your prospects table.</p>
              {!railwayAuthed ? (
                <button
                  type="button"
                  className="btn primary btn-sm"
                  disabled={busy === 'railway'}
                  onClick={() => void connect('railway')}
                >
                  {busy === 'railway' ? 'Connecting…' : 'Connect Railway'}
                </button>
              ) : (
                <>
                  {railwayBound ? (
                    <span className="context-connected">
                      Ready
                      {railway?.meta?.rowCount ? ` · ${railway.meta.rowCount} rows` : ''}
                    </span>
                  ) : null}
                  {optionEntries.length > 0 ? (
                    <label className="context-field">
                      Project / service
                      <select
                        value={selectedKey}
                        onChange={(e) => setSelectedKey(e.target.value)}
                      >
                        {optionEntries.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="section-lede">No projects shared — reconnect and select one.</p>
                  )}
                  <label className="context-field">
                    Table
                    <input
                      type="text"
                      value={pgTable}
                      onChange={(e) => setPgTable(e.target.value)}
                      placeholder="jargon_prospects"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn primary btn-sm"
                    disabled={busy === 'bind-railway' || !selectedKey}
                    onClick={() => void bindRailway()}
                  >
                    {busy === 'bind-railway'
                      ? 'Saving…'
                      : railwayBound
                        ? 'Update database'
                        : 'Use this database'}
                  </button>
                  {railwayBound ? (
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      disabled={busy === 'sync-railway'}
                      onClick={() => void syncRailway()}
                    >
                      {busy === 'sync-railway' ? 'Syncing…' : 'Reload contacts'}
                    </button>
                  ) : null}
                </>
              )}
            </article>
          </div>
        </section>

        <section className="webapp-section">
          <div className="section-heading">
            <p className="eyebrow">Create</p>
            <h1>Deploy a tool</h1>
            <p className="section-lede">
              From the website or <code>jargon deploy</code>. Connect HubSpot or Railway so the queue
              has people to work. Outbound always goes through Jargon.
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
            <h2>API keys</h2>
            <p className="section-lede">
              Claude Code and Cowork use a bearer key. Sandbox keys never reach real people. Live keys
              send email and place calls.{' '}
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
              onClick={() => void mintKey('sandbox')}
            >
              {busy === 'apikey-sandbox' ? 'Creating…' : 'Create sandbox key'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy === 'apikey-live'}
              onClick={() => void mintKey('live')}
            >
              {busy === 'apikey-live' ? 'Creating…' : 'Create live key'}
            </button>
          </div>
          {lastKey ? (
            <p className={`deploy-result ${lastKey.environment === 'live' ? 'deploy-result-live' : ''}`}>
              Save this {lastKey.environment} key — it is shown once:
              <br />
              <code>{lastKey.key}</code>
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
                    onClick={() => void revokeKey(key.id)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {error ? <p className="form-error webapp-error">{error}</p> : null}
        {toast ? <div className="webapp-toast">{toast}</div> : null}
      </main>
    </div>
  )
}

export { toolPath }
