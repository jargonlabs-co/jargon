import { useCallback, useEffect, useState } from 'react'
import { api, type ConnectionPublic, type ConnectionProvider } from '../../../api/client'

const OUTBOUND_PROVIDERS: Array<{
  id: ConnectionProvider
  title: string
  blurb: string
  role: 'context' | 'email' | 'voice'
}> = [
  {
    id: 'crustdata',
    title: 'Crustdata',
    blurb: 'People context — prospects and talk tracks for your outbound tools.',
    role: 'context'
  },
  {
    id: 'gmail',
    title: 'Gmail',
    blurb: 'Send email from rep surfaces you publish.',
    role: 'email'
  },
  {
    id: 'twilio',
    title: 'Twilio Voice',
    blurb: 'Place calls from dial surfaces you publish.',
    role: 'voice'
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

  useEffect(() => {
    const unsub = window.jargon?.onDeepLink?.((url) => {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === 'oauth' || parsed.pathname.includes('oauth')) {
          const status = parsed.searchParams.get('status')
          const provider = parsed.searchParams.get('provider')
          setToast(
            status === 'ok'
              ? `${provider ?? 'Provider'} connected`
              : parsed.searchParams.get('message') ?? 'OAuth failed'
          )
          void refresh()
        }
      } catch {
        /* ignore */
      }
    })
    return () => unsub?.()
  }, [refresh])

  async function connect(provider: ConnectionProvider) {
    setBusy(provider)
    setError(null)
    try {
      const result = await api.startConnection(provider)
      if (result.url) {
        await window.jargon?.openExternal?.(result.url)
        setToast(`Complete ${provider} in your browser`)
      } else if (result.connection) {
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

  const crustdata = items.find((c) => c.provider === 'crustdata')

  return (
    <div className="connections-page studio-context-page">
      <header>
        <p className="ide-eyebrow">Outbound stack</p>
        <h2>Connections</h2>
        <p>
          Crustdata supplies people context. Gmail and Twilio power the outbound actions in your
          tools — connect all three, then build from the chat.
        </p>
      </header>
      {error ? <p className="auth-error">{error}</p> : null}
      {toast ? <div className="toast">{toast}</div> : null}
      {crustdata?.status === 'connected' ? (
        <p className="connection-hint">
          Crustdata is live
          {crustdata.meta.creditsRemaining
            ? ` · ${Number(crustdata.meta.creditsRemaining).toLocaleString()} credits`
            : ''}
          . Today tools pull prospects automatically on create.
        </p>
      ) : (
        <p className="connection-hint">
          Add <code>CRUSTDATA_API_KEY</code> to <code>.env</code> and restart — it auto-connects on
          boot.
        </p>
      )}
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
                ) : p.id === 'crustdata' ? (
                  'Waiting for CRUSTDATA_API_KEY in .env'
                ) : (
                  'Not connected'
                )}
              </p>
              {p.id === 'crustdata' ? (
                <button type="button" onClick={() => void refresh()} disabled={busy === 'crustdata'}>
                  {crustdata?.status === 'connected' ? 'Refresh status' : 'Check .env + restart'}
                </button>
              ) : (
                <button type="button" onClick={() => void connect(p.id)} disabled={busy === p.id}>
                  {busy === p.id
                    ? 'Starting…'
                    : existing?.status === 'connected'
                      ? 'Reconnect'
                      : 'Connect'}
                </button>
              )}
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
                    {busy === 'gmail-test' ? 'Sending…' : 'Send test'}
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
