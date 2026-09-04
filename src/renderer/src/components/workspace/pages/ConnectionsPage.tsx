import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic } from '../../../api/client'

export function ConnectionsPage() {
  const [items, setItems] = useState<ConnectionPublic[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [table, setTable] = useState('jargon_prospects')

  const refresh = useCallback(async () => {
    const list = await api.listConnections()
    setItems(list.filter((c) => c.provider === 'hubspot' || c.provider === 'postgres'))
  }, [])

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message))
  }, [refresh])

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

  async function connectPostgres() {
    setBusy('postgres')
    setError(null)
    try {
      const result = await api.connectPostgres({
        databaseUrl: databaseUrl.trim(),
        table: table.trim() || 'jargon_prospects'
      })
      setToast(`Connected · ${result.rowCount} rows`)
      setDatabaseUrl('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Postgres connect failed')
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

  async function syncPostgres() {
    setBusy('sync-postgres')
    setError(null)
    try {
      const result = await api.syncPostgres()
      const count = 'count' in result ? result.count : 0
      setToast(`Contacts refreshed from Postgres · ${count}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  const hubspot = items.find((c) => c.provider === 'hubspot')
  const postgres = items.find((c) => c.provider === 'postgres')

  return (
    <div className="connections-page studio-context-page">
      <header>
        <p className="ide-eyebrow">Your data</p>
        <h2>Data sources</h2>
        <p>
          Tools load people from HubSpot or a Postgres prospects table. Email, calling, and LinkedIn
          are sent by Jargon — you don’t connect those.
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
          <h3>Prospects database</h3>
          <p>
            Connect any Postgres table of prospects (Neon, Supabase, Railway). Prefer a read-only
            role. Used first on deploy when connected.
          </p>
          <p className="connection-status">
            {postgres?.status === 'connected' ? (
              <>
                Connected
                {postgres.accountLabel ? ` · ${postgres.accountLabel}` : ''}
                {postgres.meta?.rowCount ? ` · ${postgres.meta.rowCount} rows` : ''}
              </>
            ) : (
              'Not connected'
            )}
          </p>
          <label>
            Connection string
            <input
              type="password"
              autoComplete="off"
              placeholder="postgresql://user:pass@host:5432/db"
              value={databaseUrl}
              onChange={(e) => setDatabaseUrl(e.target.value)}
            />
          </label>
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
            onClick={() => void connectPostgres()}
            disabled={busy === 'postgres' || !databaseUrl.trim()}
          >
            {busy === 'postgres'
              ? 'Connecting…'
              : postgres?.status === 'connected'
                ? 'Reconnect'
                : 'Connect Postgres'}
          </button>
          {postgres?.status === 'connected' ? (
            <button
              type="button"
              onClick={() => void syncPostgres()}
              disabled={busy === 'sync-postgres'}
            >
              {busy === 'sync-postgres' ? 'Syncing…' : 'Reload contacts'}
            </button>
          ) : null}
        </article>
      </div>
    </div>
  )
}
