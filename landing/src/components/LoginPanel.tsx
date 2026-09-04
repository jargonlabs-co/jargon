import { useState } from 'react'
import { api, setStoredToken } from '../api'
import { useAuth } from '../auth'
import { LogoMark } from './LogoMark'

interface Props {
  onClose: () => void
  initialMode?: 'login' | 'register'
}

export function LoginPanel({ onClose, initialMode = 'login' }: Props) {
  const { refresh } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      setStoredToken(payload.token)
      await refresh()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auth failed'
      if (/already registered/i.test(message) && mode === 'register') {
        setError('That email is already registered — switch to Sign in.')
        setMode('login')
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="login-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'login' ? 'Sign in' : 'Create account'}
    >
      <button type="button" className="login-backdrop" aria-label="Close" onClick={onClose} />
      <div className="login-panel">
        <button type="button" className="login-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="login-brand">
          <LogoMark size={28} />
          <div>
            {mode === 'login' ? (
              <>
                <h2>Welcome back</h2>
                <p>Sign in to connect your CRM and build tools.</p>
              </>
            ) : (
              <>
                <h2>Create your account</h2>
                <p>Sign up to connect your data and deploy tools.</p>
              </>
            )}
          </div>
        </div>
        <div className="login-tabs">
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
            Create account
          </button>
        </div>
        <form onSubmit={submit} className="login-form">
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
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="btn primary btn-full" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Continue' : 'Create account'}
          </button>
        </form>
        <p className="login-hint">
          Already have an account? Use <strong>Sign in</strong>. Demo:{' '}
          <code>demo@jargon.app</code> / <code>jargon-demo</code>
        </p>
      </div>
    </div>
  )
}
