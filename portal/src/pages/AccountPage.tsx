import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'

export default function AccountPage() {
  const { me, refresh } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (me) setOrgName(me.org.name)
  }, [me])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.updateOrgName(orgName.trim())
      await refresh()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (!me) return null

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Account</h1>
          <p className="page-subtitle">Your profile and organization.</p>
        </div>
      </header>

      <div className="account-grid">
        <section className="panel">
          <h2>Profile</h2>
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{me.user.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{me.user.email}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Organization</h2>
          <form onSubmit={save} className="stack-form">
            <label>
              Workspace name
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </label>
            <p className="muted">
              Slug: <code>{me.org.slug}</code>
            </p>
            {error ? <p className="form-error">{error}</p> : null}
            {saved ? <p className="form-success">Saved.</p> : null}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save changes
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
