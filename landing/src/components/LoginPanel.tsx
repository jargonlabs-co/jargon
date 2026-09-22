import { useState } from 'react'
import { api, setStoredToken } from '../api'
import { useAuth } from '../auth'
import { LogoMark } from './LogoMark'

interface Props {
  onClose?: () => void
  initialMode?: 'login' | 'register'
  embedded?: boolean
  showBrand?: boolean
  onModeChange?: (mode: 'login' | 'register') => void
}

export function LoginPanel({
  onClose,
  initialMode = 'login',
  embedded = false,
  showBrand = true,
  onModeChange
}: Props) {
  const { refresh } = useAuth()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode)

  function switchMode(next: 'login' | 'register' | 'forgot') {
    setMode(next)
    if (next === 'login' || next === 'register') onModeChange?.(next)
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'forgot') {
        const result = await api.forgotPassword(email.trim())
        setInfo(result.message)
        return
      }
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
      if (mode === 'register') {
        window.history.pushState({}, '', '/claude')
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auth failed'
      if (/already registered/i.test(message) && mode === 'register') {
        setError('That email is already registered — switch to Sign in.')
        switchMode('login')
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={embedded ? 'login-embedded' : 'login-overlay'}
      role="dialog"
      aria-modal={!embedded}
      aria-label={mode === 'login' ? 'Sign in' : 'Create account'}
    >
      {embedded ? null : (
        <button type="button" className="login-backdrop" aria-label="Close" onClick={() => onClose?.()} />
      )}
      <div className="login-panel">
        {embedded ? null : (
        <button type="button" className="login-close" onClick={() => onClose?.()} aria-label="Close">
          ×
        </button>
        )}
        {showBrand ? (
          <div className="login-brand">
            <LogoMark size={28} />
            <div>
              {mode === 'login' ? (
                <>
                  <h2>Welcome back</h2>
                  <p>Sign in to connect Claude and run outbound.</p>
                </>
              ) : mode === 'forgot' ? (
                <>
                  <h2>Forgot password</h2>
                  <p>We will email you a reset link.</p>
                </>
              ) : (
                <>
                  <h2>Create your account</h2>
                  <p>Sign up, connect Claude, and bring your list.</p>
                </>
              )}
            </div>
          </div>
        ) : null}
        {mode !== 'forgot' ? (
          <div className="login-tabs">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => switchMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => switchMode('register')}
            >
              Create account
            </button>
          </div>
        ) : null}
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
          {mode !== 'forgot' ? (
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
          ) : null}
          {mode === 'login' ? (
            <button type="button" className="btn ghost btn-sm" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          ) : null}
          {mode === 'forgot' ? (
            <button type="button" className="btn ghost btn-sm" onClick={() => switchMode('login')}>
              Back to sign in
            </button>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          {info ? <p className="section-lede">{info}</p> : null}
          <button type="submit" className="btn primary btn-full" disabled={busy}>
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Continue'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
