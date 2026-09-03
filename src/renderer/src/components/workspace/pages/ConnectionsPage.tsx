import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic, type ConnectionProvider } from '../../../api/client'

const OUTBOUND_PROVIDERS: Array<{
  id: ConnectionProvider
  title: string
  blurb: string
  role: 'email' | 'voice' | 'linkedin'
}> = [
  {
    id: 'gmail',
    title: 'Gmail',
    blurb: 'Send email from dialers and sequencers.',
    role: 'email'
  },
  {
    id: 'twilio',
    title: 'Twilio Voice',
    blurb: 'Place calls from dial surfaces.',
    role: 'voice'
  },
  {
    id: 'heyreach',
    title: 'HeyReach',
    blurb: 'Send LinkedIn messages from sequences.',
    role: 'linkedin'
  }
]

export function ConnectionsPage() {
  const [items, setItems] = useState<ConnectionPublic[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testEmail, setTestEmail] = useState('')

  const refresh = useCallback(async () => {
    const list = await api.listConnections()
    setItems(list)
  }, [])

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message))
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(id)
  }, [toast])

  async function connect(provider: ConnectionProvider) {
    setBusy(provider)
    setError(null)
    try {
      const result = await api.startConnection(provider)
      if (result.url) {
        window.location.href = result.url
        return
      }
      if (result.connection) {
        setToast(`${provider} ready`)
        await refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function sendGmailTest() {
    if (!testEmail.trim()) return
    setBusy('gmail-test')
    setError(null)
    try {
      const result = await api.testGmail(testEmail.trim())
      setToast(
        result.mode === 'gmail'
          ? `Test email sent to ${testEmail.trim()}`
          : `Test email queued for ${testEmail.trim()}`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test send failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="connections-page studio-context-page">
      <header>
        <p className="ide-eyebrow">Outbound stack</p>
        <h2>Connections</h2>
        <p>Gmail, Twilio, and HeyReach power email, calling, and LinkedIn in tools you deploy from the CLI.</p>
      </header>
      {error ? <p className="auth-error">{error}</p> : null}
      {toast ? <div className="toast">{toast}</div> : null}
      <div className="connection-grid">
        {OUTBOUND_PROVIDERS.map((p) => {
          const existing = items.find((c) => c.provider === p.id)
          return (
            <article key={p.id} className="connection-card">
              <p className="connection-role">{p.role}</p>
              <h3>{p.title}</h3>
              <p>{p.blurb}</p>
              <p className="connection-status">
                {existing?.status === 'connected' ? (
                  <>Connected{existing.accountLabel ? ` · ${existing.accountLabel}` : ''}</>
                ) : (
                  'Not connected'
                )}
              </p>
              <button type="button" onClick={() => void connect(p.id)} disabled={busy === p.id}>
                {busy === p.id
                  ? 'Starting…'
                  : existing?.status === 'connected'
                    ? 'Reconnect'
                    : 'Connect'}
              </button>
              {p.id === 'gmail' && existing?.status === 'connected' ? (
                <div className="connection-test">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(event) => setTestEmail(event.target.value)}
                    placeholder="Send test to…"
                    aria-label="Test email recipient"
                  />
                  <button
                    type="button"
                    onClick={() => void sendGmailTest()}
                    disabled={busy === 'gmail-test' || !testEmail.trim()}
                  >
                    Send test
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}
