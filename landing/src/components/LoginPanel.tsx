import { useEffect, useState } from 'react'
import { api, setStoredToken } from '../api'
import { useAuth } from '../auth'
import { LogoMark } from './LogoMark'

interface Props {
  onClose?: () => void
  initialMode?: 'login' | 'register'
  embedded?: boolean
  showBrand?: boolean
  showTabs?: boolean
  registerLead?: string
  onModeChange?: (mode: 'login' | 'register') => void
}

const AUTH_INFO_KEY = 'jargon-auth-info'
const AUTH_ERROR_KEY = 'jargon-auth-error'
const AUTH_CONFIRM_KEY = 'jargon-auth-confirm'
const AUTH_EMAIL_KEY = 'jargon-auth-email'

function peekStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function stashAuthFlash(notice: { info?: string; error?: string; confirm?: boolean; email?: string }) {
  if (window.location.pathname.replace(/\/$/, '') !== '/signup') return
  try {
    if (notice.info) sessionStorage.setItem(AUTH_INFO_KEY, notice.info)
    if (notice.error) sessionStorage.setItem(AUTH_ERROR_KEY, notice.error)
    if (notice.confirm) sessionStorage.setItem(AUTH_CONFIRM_KEY, '1')
    if (notice.email) sessionStorage.setItem(AUTH_EMAIL_KEY, notice.email)
  } catch {
    /* private mode */
  }
}

export function LoginPanel({
  onClose,
  initialMode = 'login',
  embedded = false,
  showBrand = true,
  showTabs = true,
  registerLead = 'Sign up, then open a prompt in Claude or ChatGPT.',
  onModeChange
}: Props) {
  const { refresh } = useAuth()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode)

  useEffect(() => {
    setMode((current) => {
      if (current === initialMode) return current
      if (current === 'forgot' && initialMode === 'login') return current
      return initialMode
    })
  }, [initialMode])

  function switchMode(next: 'login' | 'register' | 'forgot') {
    setMode(next)
    if (next === 'login' || next === 'register') onModeChange?.(next)
  }

  function onAuthTabClick(e: React.MouseEvent<HTMLAnchorElement>, next: 'login' | 'register') {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    switchMode(next)
  }

  const authPath = window.location.pathname.replace(/\/$/, '')
  const onAuthRoute = authPath === '/login' || authPath === '/signup'
  const [email, setEmail] = useState(() => peekStorage(AUTH_EMAIL_KEY) ?? '')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(() => peekStorage(AUTH_ERROR_KEY))
  const [info, setInfo] = useState<string | null>(() => {
    const flashed = peekStorage(AUTH_INFO_KEY)
    if (flashed) return flashed
    return new URLSearchParams(window.location.search).get('verified') === '1'
      ? 'Email confirmed. Sign in to finish setting up.'
      : null
  })
  const [busy, setBusy] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(() => peekStorage(AUTH_CONFIRM_KEY) === '1')

  useEffect(() => {
    try {
      sessionStorage.removeItem(AUTH_INFO_KEY)
      sessionStorage.removeItem(AUTH_ERROR_KEY)
      sessionStorage.removeItem(AUTH_CONFIRM_KEY)
      sessionStorage.removeItem(AUTH_EMAIL_KEY)
    } catch {
      /* private mode */
    }
  }, [])

  async function resend() {
    setBusy(true)
    setError(null)
    try {
      setInfo((await api.resendVerification(email.trim())).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend')
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    setNeedsConfirm(false)
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
      if ('verificationRequired' in payload) {
        stashAuthFlash({ info: payload.message, confirm: true, email: email.trim() })
        switchMode('login')
        setPassword('')
        setNeedsConfirm(true)
        setInfo(payload.message)
        return
      }
      setStoredToken(payload.token)
      await refresh()
      if (mode === 'register') {
        window.history.pushState({}, '', '/')
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auth failed'
      if (/already registered/i.test(message) && mode === 'register') {
        const text = 'That email is already registered — switch to Sign in.'
        stashAuthFlash({ error: text, email: email.trim() })
        setError(text)
        switchMode('login')
      } else if (/confirm your email/i.test(message)) {
        setNeedsConfirm(true)
        setError(message)
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
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? undefined : mode === 'login' ? 'Sign in' : 'Create account'}
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
                  <p>Sign in to open Jargon in Claude or ChatGPT.</p>
                </>
              ) : mode === 'forgot' ? (
                <>
                  <h2>Forgot password</h2>
                  <p>We will email you a reset link.</p>
                </>
              ) : (
                <>
                  <h2>Create your account</h2>
                  <p>{registerLead}</p>
                </>
              )}
            </div>
          </div>
        ) : null}
        {showTabs && mode !== 'forgot' ? (
          <div className="login-tabs">
            <a
              href="/login"
              className={mode === 'login' ? 'active' : ''}
              aria-current={onAuthRoute && mode === 'login' ? 'page' : undefined}
              onClick={(e) => onAuthTabClick(e, 'login')}
            >
              Sign in
            </a>
            <a
              href="/signup"
              className={mode === 'register' ? 'active' : ''}
              aria-current={onAuthRoute && mode === 'register' ? 'page' : undefined}
              onClick={(e) => onAuthTabClick(e, 'register')}
            >
              Create account
            </a>
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
            <button type="button" className="btn ghost btn-sm login-aux" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          ) : null}
          {mode === 'forgot' ? (
            <button type="button" className="btn ghost btn-sm login-aux" onClick={() => switchMode('login')}>
              Back to sign in
            </button>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          {info ? <p className="section-lede">{info}</p> : null}
          {needsConfirm && mode === 'login' ? (
            <button type="button" className="btn ghost btn-sm" disabled={busy || !email.trim()} onClick={() => void resend()}>
              Resend confirmation email
            </button>
          ) : null}
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
