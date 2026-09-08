import type { PortalBuild } from '../../api'

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
        <h1>Tools</h1>
        <p className="section-lede">
          Workspaces deployed from Claude or <code>jargon deploy</code>. Open a tool to run the queue.
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

export function SettingsPage({
  orgName,
  email,
  busy,
  onSaveOrg,
  onOrgName,
  onSignOut
}: {
  orgName: string
  email: string
  busy: string | null
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
      <div style={{ marginTop: 40 }}>
        <button type="button" className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </section>
  )
}
