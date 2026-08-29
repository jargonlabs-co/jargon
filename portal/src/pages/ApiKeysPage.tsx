import { useEffect, useState } from 'react'
import { api, type ApiKeyPublic } from '../api'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyPublic[]>([])
  const [name, setName] = useState('Claude Code')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      setKeys(await api.listApiKeys())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreatedKey(null)
    try {
      const row = await api.createApiKey(name.trim() || 'API key')
      setCreatedKey(row.key)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create key')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    setError(null)
    try {
      await api.revokeApiKey(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke key')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>API keys</h1>
          <p className="page-subtitle">Use with the CLI or Claude Code — prefix <code>jarg_</code></p>
        </div>
      </header>

      <form className="inline-form" onSubmit={createKey}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name"
          aria-label="Key name"
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Create key
        </button>
      </form>

      {createdKey ? (
        <div className="banner banner-warning">
          <p>Copy this key now — it won&apos;t be shown again:</p>
          <code className="key-display">{createdKey}</code>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}

      {loading ? <p className="muted">Loading…</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td>
                  <code>{key.prefix}…</code>
                </td>
                <td className="muted">{new Date(key.createdAt).toLocaleDateString()}</td>
                <td>
                  {key.revokedAt ? (
                    <span className="muted">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void revoke(key.id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && keys.length === 0 ? <p className="muted table-empty">No API keys yet.</p> : null}
      </div>
    </div>
  )
}
