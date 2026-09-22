import { useEffect, useState } from 'react'
import { api, setStoredToken } from '../api'
import { LogoMark } from './LogoMark'

function parseRecoveryAccessToken(): string | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash) {
    const params = new URLSearchParams(hash)
    const fromHash = params.get('access_token')
    if (fromHash) return fromHash
  }
  const query = new URLSearchParams(window.location.search)
  return query.get('access_token')
}

export function ResetPasswordPanel() {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAccessToken(parseRecoveryAccessToken())
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken) {
      setError('Reset link is missing or expired. Request a new one from Sign in.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.resetPassword(accessToken, password)
      setStoredToken(null)
      setDone(true)
      window.history.replaceState({}, '', '/reset-password')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-overlay" role="dialog" aria-modal aria-label="Reset password">
      <div className="login-panel">
        <div className="login-brand">
          <LogoMark size={28} />
          <div>
            <h2>Reset password</h2>
            <p>Choose a new password for your Jargon account.</p>
          </div>
        </div>
        {done ? (
          <div className="login-form">
            <p>Password updated. You can sign in with the new password.</p>
            <a className="btn primary btn-full" href="/">
              Sign in
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            {!accessToken ? (
              <p className="form-error">
                Open the link from your email to continue, or request a new reset from Sign in.
              </p>
            ) : null}
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button type="submit" className="btn primary btn-full" disabled={busy || !accessToken}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
