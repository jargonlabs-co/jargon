import type { ProjectBundle } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
}

export function RunsWorkspacePage({ bundle }: Props) {
  const activities = [...bundle.activities].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
  const enriched = bundle.contacts.filter((c) => c.enrichedAt).length

  return (
    <div className="ide-page">
      <div className="ide-page-header">
        <div>
          <p className="ide-eyebrow">Studio</p>
          <h2>Activity</h2>
          <p className="ide-lede">
            Runs, approvals, and failures for this tool — inspectable history while you iterate
            before publishing to reps.
          </p>
        </div>
      </div>

      <div className="ide-stat-row">
        <div className="ide-stat">
          <span className="ide-stat-label">Contacts</span>
          <strong>{bundle.contacts.length}</strong>
        </div>
        <div className="ide-stat">
          <span className="ide-stat-label">Enriched</span>
          <strong>{enriched}</strong>
        </div>
        <div className="ide-stat">
          <span className="ide-stat-label">Messages</span>
          <strong>{bundle.messages.length}</strong>
        </div>
        <div className="ide-stat">
          <span className="ide-stat-label">Calls</span>
          <strong>{bundle.calls.length}</strong>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="ide-empty">
          <h3>No activity yet</h3>
          <p>When enrichment, writeback, or rep actions run through this tool, logs land here.</p>
        </div>
      ) : (
        <ul className="ide-run-list">
          {activities.map((a) => (
            <li key={a.id} className="ide-run-row">
              <span className="ide-pill">{a.kind}</span>
              <span className="ide-run-summary">{a.summary}</span>
              <time dateTime={new Date(a.createdAt).toISOString()}>
                {new Date(a.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
