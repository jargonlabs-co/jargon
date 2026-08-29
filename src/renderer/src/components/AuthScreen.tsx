import { useState } from 'react'
import { api, setClientAuthToken, type AuthPayload } from '../api/client'
import { LogoMark } from './LogoMark'

interface Props {
  onAuthed: (payload: AuthPayload) => void
}

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('demo@jargon.app')
  const [password, setPassword] = useState('jargon-demo')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload =
        mode === 'login'
          ? await api.login(email.trim(), password)
          : await api.register({
              email: email.trim(),
              password,
              name: name.trim() || undefined,
              orgName: orgName.trim() || undefined
            })
      setClientAuthToken(payload.token)
      await window.jargon?.setAuthToken?.(payload.token)
      onAuthed(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auth failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <LogoMark size={32} />
          <h1>Jargon</h1>
        </div>
        <p className="auth-lede">
          Studio for RevOps and GTM engineers — compose beautiful, data-bound tools your reps
          actually use.
        </p>
        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Create org
          </button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' ? (
            <>
              <label>
                Your name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tara" />
              </label>
              <label>
                Organization
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Outbound"
                />
              </label>
            </>
          ) : null}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Enter studio' : 'Create studio'}
          </button>
        </form>
        <p className="auth-hint">
          Sign in with <code>demo@jargon.app</code> / <code>jargon-demo</code>
        </p>
      </div>
    </div>
  )
}
