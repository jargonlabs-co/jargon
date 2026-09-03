import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic } from '../../../api/client'

export function ConnectionsPage() {
  const [items, setItems] = useState<ConnectionPublic[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await api.listConnections()
    setItems(list.filter((c) => c.provider === 'hubspot'))
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

  async function sync() {
    setBusy('sync')
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

  const hubspot = items.find((c) => c.provider === 'hubspot')

  return (
    <div className="connections-page studio-context-page">
      <header>
        <p className="ide-eyebrow">Your data</p>
        <h2>HubSpot</h2>
        <p>
          Tools load people from your HubSpot portal. Email, calling, and LinkedIn are sent by
          Jargon — you don’t connect those.
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
            <button type="button" onClick={() => void sync()} disabled={busy === 'sync'}>
              {busy === 'sync' ? 'Syncing…' : 'Reload contacts'}
            </button>
          ) : null}
        </article>
      </div>
    </div>
  )
}
