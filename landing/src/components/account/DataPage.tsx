import type { ConnectionPublic } from '../../api'
import { statusLabel } from './nav'

export function DataPage({
  connections,
  railwayProjects,
  selectedKey,
  pgTable,
  busy,
  onPgTable,
  onSelectedKey,
  onConnect,
  onSyncHubSpot,
  onBindRailway,
  onSyncRailway
}: {
  connections: ConnectionPublic[]
  railwayProjects: Array<{
    projectId: string
    projectName: string
    environmentId: string
    environmentName: string
    postgresServices: Array<{ serviceId: string; serviceName: string }>
  }>
  selectedKey: string
  pgTable: string
  busy: string | null
  onPgTable: (value: string) => void
  onSelectedKey: (value: string) => void
  onConnect: (provider: string) => void
  onSyncHubSpot: () => void
  onBindRailway: () => void
  onSyncRailway: () => void
}) {
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
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Data</h1>
        <p className="section-lede">
          Tools load people from HubSpot or Railway Postgres. Email, calling, and LinkedIn are sent
          by Jargon.
        </p>
      </div>
      <div className="context-grid">
        <article className="context-card">
          <div className="context-card-top">
            <span className="context-role">CRM</span>
            <span className={`context-status ${hubspotOk ? 'ok' : ''}`}>{statusLabel(hubspot)}</span>
          </div>
          <h3>HubSpot</h3>
          <p>People in your portal become the queue in every tool.</p>
          {!hubspotOk ? (
            <button
              type="button"
              className="btn primary btn-sm"
              disabled={busy === 'hubspot'}
              onClick={() => onConnect('hubspot')}
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
                onClick={onSyncHubSpot}
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
              onClick={() => onConnect('railway')}
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
                  <select value={selectedKey} onChange={(e) => onSelectedKey(e.target.value)}>
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
                  onChange={(e) => onPgTable(e.target.value)}
                  placeholder="jargon_prospects"
                />
              </label>
              <button
                type="button"
                className="btn primary btn-sm"
                disabled={busy === 'bind-railway' || !selectedKey}
                onClick={onBindRailway}
              >
                {busy === 'bind-railway' ? 'Saving…' : railwayBound ? 'Update database' : 'Use this database'}
              </button>
              {railwayBound ? (
                <button
                  type="button"
                  className="btn ghost btn-sm"
                  disabled={busy === 'sync-railway'}
                  onClick={onSyncRailway}
                >
                  {busy === 'sync-railway' ? 'Syncing…' : 'Reload contacts'}
                </button>
              ) : null}
            </>
          )}
        </article>
      </div>
    </section>
  )
}
