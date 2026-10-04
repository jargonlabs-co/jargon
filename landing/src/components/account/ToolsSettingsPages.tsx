import { useState } from 'react'
import { api, type PortalBuild } from '../../api'

export function ToolsPage({
  builds,
  onOpenTool
}: {
  builds: PortalBuild[]
  onOpenTool: (id: string) => void
}) {
  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Sequences</h1>
        <p className="section-lede">
          Workspaces deployed from Claude or <code>jargon deploy</code>. Open a sequence to run the queue.
        </p>
      </div>
      {builds.length === 0 ? (
        <p className="section-lede">Nothing deployed yet.</p>
      ) : (
        <ul className="build-list">
          {builds.map((build) => (
            <li key={build.project.id} className="build-row">
              <div>
                <strong>{build.project.name}</strong>
                <p>
                  {build.contactCount} contacts · {build.project.prompt}
                </p>
              </div>
              <button type="button" className="btn primary btn-sm" onClick={() => onOpenTool(build.project.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function YourDataSection({
  workspaceName,
  preview,
  onDeleted
}: {
  workspaceName: string
  preview?: boolean
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function exportData() {
    if (preview) return
    setBusy('export')
    setError(null)
    try {
      const data = await api.exportAccount()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `jargon-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  async function deleteWorkspace() {
    if (preview) return
    setBusy('delete')
    setError(null)
    try {
      await api.deleteAccount(confirm)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workspace')
      setBusy(null)
    }
  }

  return (
    <div style={{ marginTop: 40 }}>
      <h2>Your data</h2>
      <p className="section-lede">
        Download everything Jargon stores for this workspace: contacts, sequences, messages, calls, and activity.
      </p>
      <button type="button" className="btn ghost btn-sm" disabled={busy !== null} onClick={() => void exportData()}>
        {busy === 'export' ? 'Preparing…' : 'Export data'}
      </button>
      <div style={{ marginTop: 24 }}>
        {confirming ? (
          <>
            <p className="section-lede">
              This permanently deletes the workspace, its contacts and history, your connections, and your login. Type{' '}
              <strong>{workspaceName}</strong> to confirm.
            </p>
            <label className="context-field">
              Workspace name
              <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn primary btn-sm"
              disabled={busy !== null || confirm.trim() !== workspaceName.trim()}
              onClick={() => void deleteWorkspace()}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete workspace'}
            </button>{' '}
            <button type="button" className="btn ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost btn-sm" onClick={() => setConfirming(true)}>
            Delete workspace…
          </button>
        )}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}

export function SettingsPage({
  orgName,
  workspaceName,
  email,
  busy,
  preview,
  onSaveOrg,
  onOrgName,
  onSignOut
}: {
  orgName: string
  workspaceName: string
  email: string
  busy: string | null
  preview?: boolean
  onOrgName: (value: string) => void
  onSaveOrg: () => void
  onSignOut: () => void
}) {
  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Settings</h1>
        <p className="section-lede">Workspace name and sign-out. Signed in as {email}.</p>
      </div>
      <label className="context-field">
        Workspace name
        <input type="text" value={orgName} onChange={(e) => onOrgName(e.target.value)} />
      </label>
      <button type="button" className="btn primary btn-sm" disabled={busy === 'org' || !orgName.trim()} onClick={onSaveOrg}>
        {busy === 'org' ? 'Saving…' : 'Save'}
      </button>
      <YourDataSection workspaceName={workspaceName} preview={preview} onDeleted={onSignOut} />
      <div style={{ marginTop: 40 }}>
        <button type="button" className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </section>
  )
}
