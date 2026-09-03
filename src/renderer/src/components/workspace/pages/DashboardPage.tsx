import type { ProjectBundle } from '../../../api/client'
import { ConnectedContextSection } from '../ConnectedContextSection'

interface Props {
  bundle: ProjectBundle
  onNavigate: (page: string) => void
}

export function DashboardPage({ bundle, onNavigate }: Props) {
  const { analytics, project, campaigns, activities } = bundle
  const activeCampaigns = campaigns.filter((c) => c.state === 'ACTIVE').length

  return (
    <div className="prod-view">
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Dashboard</div>
          <h2>{project.name}</h2>
        </div>
        <div className="prod-view-actions">
          {project.kind === 'dialer' ? (
            <button className="prod-btn primary" onClick={() => onNavigate('dial')}>
              Open dial console
            </button>
          ) : (
            <button className="prod-btn primary" onClick={() => onNavigate('inbox')}>
              Open inbox
            </button>
          )}
        </div>
      </div>

      {project.kind === 'dialer' || project.kind === 'today' ? (
        <ConnectedContextSection />
      ) : null}

      <div className="dash-grid">
        <DashCard label="Enrolled" value={String(analytics.enrolled)} />
        <DashCard label="Contacted" value={String(analytics.contacted)} />
        <DashCard label="Replied" value={String(analytics.replied)} />
        <DashCard label="Booked" value={String(analytics.booked)} />
        <DashCard label="Calls" value={String(analytics.calls)} />
        <DashCard label="Emails sent" value={String(analytics.emailsSent)} />
        <DashCard label="Active campaigns" value={String(activeCampaigns)} />
        <DashCard label="Answer rate" value={`${analytics.answerRate.toFixed(1)}%`} />
      </div>

      <div className="prod-table-wrap">
        <div className="detail-block-title" style={{ padding: '12px 14px 0' }}>
          Recent activity
        </div>
        <table className="prod-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {activities.slice(0, 8).map((a) => (
              <tr key={a.id}>
                <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
                <td>
                  <span className="type-badge">{a.kind}</span>
                </td>
                <td>{a.summary}</td>
              </tr>
            ))}
            {activities.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No activity yet — start calling or emailing from the console.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DashCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="dash-card">
      <div className="dash-value">{value}</div>
      <div className="dash-label">{label}</div>
    </div>
  )
}
