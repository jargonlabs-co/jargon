import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic } from '../../../api/client'

type RailwayProjectOption = {
  projectId: string
  projectName: string
  environmentId: string
  environmentName: string
  postgresServices: Array<{ serviceId: string; serviceName: string }>
}

export function ConnectionsPage() {
  const [items, setItems] = useState<ConnectionPublic[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [table, setTable] = useState('jargon_prospects')
  const [railwayProjects, setRailwayProjects] = useState<RailwayProjectOption[]>([])
  const [selectedKey, setSelectedKey] = useState('')

  const refresh = useCallback(async () => {
    const list = await api.listConnections()
    setItems(
      list.filter(
        (c) =>
          c.provider === 'hubspot' || c.provider === 'postgres' || c.provider === 'railway'
      )
    )
  }, [])

  const loadRailwayProjects = useCallback(async () => {
    const railway = (await api.listConnections()).find((c) => c.provider === 'railway')
    if (railway?.status !== 'connected') {
      setRailwayProjects([])
      return
    }
    const { projects } = await api.listRailwayResources()
    setRailwayProjects(projects)
    setSelectedKey((prev) => {
      if (prev || !projects[0]) return prev
      const svc = projects[0].postgresServices[0]
      return `${projects[0].projectId}|${projects[0].environmentId}|${svc?.serviceId || ''}`
    })
  }, [])

  useEffect(() => {
    void refresh()
      .then(() => loadRailwayProjects())
      .catch((err: Error) => setError(err.message))
  }, [refresh, loadRailwayProjects])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(id)
  }, [toast])

  async function connectHubSpot() {
    setBusy('hubspot')
    setError(null)
    try {
      const result = await api.startConnection('hubspot')
      if (result.url) {
        window.location.href = result.url
        return
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function connectRailway() {
    setBusy('railway')
    setError(null)
    try {
      const result = await api.startConnection('railway')
      if (result.url) {
        window.location.href = result.url
        return
      }
      await refresh()
      await loadRailwayProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Railway connect failed')
    } finally {
      setBusy(null)
    }
  }

  async function bindRailway() {
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
        table: table.trim() || 'jargon_prospects'
      })
      setToast('Railway Postgres bound')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bind failed')
    } finally {
      setBusy(null)
    }
  }

  async function syncHubSpot() {
    setBusy('sync-hubspot')
    setError(null)
    try {
      await api.syncHubSpot()
      setToast('Contacts refreshed from HubSpot')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function syncRailway() {
    setBusy('sync-railway')
    setError(null)
    try {
      const result = await api.syncRailway()
      const count = 'count' in result ? result.count : 0
      setToast(`Contacts refreshed from Railway · ${count}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  const hubspot = items.find((c) => c.provider === 'hubspot')
  const railway = items.find((c) => c.provider === 'railway')
  const railwayAuthed = railway?.status === 'connected'
  const railwayBound = railwayAuthed && railway?.meta?.needsBind !== '1' && !!railway?.meta?.projectId

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
    <div className="connections-page studio-context-page">
      <header>
        <p className="ide-eyebrow">Your data</p>
        <h2>Data sources</h2>
        <p>
          Tools load people from HubSpot or Railway Postgres. Email, calling, and LinkedIn are sent
          by Jargon — you don’t connect those.
        </p>
      </header>
      {error ? <p className="auth-error">{error}</p> : null}
      {toast ? <div className="toast">{toast}</div> : null}
      <div className="connection-grid">
        <article className="connection-card">
          <p className="connection-role">CRM</p>
          <h3>HubSpot</h3>
          <p>Contacts and companies in your portal become the queue in every tool.</p>
          <p className="connection-status">
            {hubspot?.status === 'connected' ? (
              <>Connected{hubspot.accountLabel ? ` · ${hubspot.accountLabel}` : ''}</>
            ) : (
              'Not connected'
            )}
          </p>
          <button type="button" onClick={() => void connectHubSpot()} disabled={busy === 'hubspot'}>
            {busy === 'hubspot'
              ? 'Starting…'
              : hubspot?.status === 'connected'
                ? 'Reconnect'
                : 'Connect HubSpot'}
          </button>
          {hubspot?.status === 'connected' ? (
            <button
              type="button"
              onClick={() => void syncHubSpot()}
              disabled={busy === 'sync-hubspot'}
            >
              {busy === 'sync-hubspot' ? 'Syncing…' : 'Reload contacts'}
            </button>
          ) : null}
        </article>

        <article className="connection-card">
          <p className="connection-role">Warehouse</p>
          <h3>Railway</h3>
          <p>
            Sign in with Railway, pick the Postgres project that holds your prospects table. Used
            first on deploy when connected.
          </p>
          <p className="connection-status">
            {railwayBound ? (
              <>
                Connected
                {railway?.accountLabel ? ` · ${railway.accountLabel}` : ''}
                {railway?.meta?.rowCount ? ` · ${railway.meta.rowCount} rows` : ''}
              </>
            ) : railwayAuthed ? (
              'Signed in — choose a Postgres project'
            ) : (
              'Not connected'
            )}
          </p>
          {!railwayAuthed ? (
            <button
              type="button"
              onClick={() => void connectRailway()}
              disabled={busy === 'railway'}
            >
              {busy === 'railway' ? 'Starting…' : 'Connect Railway'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void connectRailway()}
                disabled={busy === 'railway'}
              >
                {busy === 'railway' ? 'Starting…' : 'Re-authorize'}
              </button>
              {optionEntries.length > 0 ? (
                <label>
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
                <p className="connection-status">No projects shared — re-authorize and select one.</p>
              )}
              <label>
                Table
                <input
                  type="text"
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                  placeholder="jargon_prospects"
                />
              </label>
              <button
                type="button"
                onClick={() => void bindRailway()}
                disabled={busy === 'bind-railway' || !selectedKey}
              >
                {busy === 'bind-railway' ? 'Binding…' : railwayBound ? 'Update binding' : 'Use this database'}
              </button>
              {railwayBound ? (
                <button
                  type="button"
                  onClick={() => void syncRailway()}
                  disabled={busy === 'sync-railway'}
                >
                  {busy === 'sync-railway' ? 'Syncing…' : 'Reload contacts'}
                </button>
              ) : null}
            </>
          )}
        </article>
      </div>
    </div>
  )
}
