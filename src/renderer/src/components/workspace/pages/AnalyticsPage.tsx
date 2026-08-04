import type { ProjectBundle } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
}

export function AnalyticsPage({ bundle }: Props) {
  const { analytics, campaigns, activities } = bundle

  return (
    <div className="prod-view">
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Analytics</div>
          <h2>Performance</h2>
        </div>
      </div>

      <div className="donut-row wide">
        <Donut label="Answer rate" value={analytics.answerRate} color="var(--success)" />
        <Donut label="Open rate" value={analytics.openRate} color="var(--star-blue)" />
        <Donut
          label="Booked rate"
          value={analytics.enrolled ? (analytics.booked / analytics.enrolled) * 100 : 0}
          color="var(--accent)"
        />
      </div>

      <div className="dash-grid">
        <div className="dash-card">
          <div className="dash-value">{analytics.calls}</div>
          <div className="dash-label">Calls logged</div>
        </div>
        <div className="dash-card">
          <div className="dash-value">{analytics.emailsSent}</div>
          <div className="dash-label">Emails sent</div>
        </div>
        <div className="dash-card">
          <div className="dash-value">{analytics.contacted}</div>
          <div className="dash-label">Contacted</div>
        </div>
        <div className="dash-card">
          <div className="dash-value">{analytics.booked}</div>
          <div className="dash-label">Meetings booked</div>
        </div>
      </div>

      <div className="prod-table-wrap" style={{ marginBottom: 14 }}>
        <div className="detail-block-title" style={{ padding: '12px 14px 0' }}>
          Campaign health
        </div>
        <table className="prod-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>State</th>
              <th>Progress</th>
              <th>Answer %</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td>
                  <span className={`state-badge state-${c.state.toLowerCase()}`}>{c.state}</span>
                </td>
                <td>
                  {c.done}/{c.total}
                </td>
                <td>{c.answerRatio.toFixed(1)}%</td>
              </tr>
            ))}
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No campaigns in this workspace.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="prod-table-wrap">
        <div className="detail-block-title" style={{ padding: '12px 14px 0' }}>
          Activity feed
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
            {activities.map((a) => (
              <tr key={a.id}>
                <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
                <td>
                  <span className="type-badge">{a.kind}</span>
                </td>
                <td>{a.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Donut({ label, value, color }: { label: string; value: number; color: string }) {
  const deg = Math.max(0, Math.min(100, value)) * 3.6
  return (
    <div className="donut-card">
      <div className="donut" style={{ background: `conic-gradient(${color} ${deg}deg, #e6ddd0 0deg)` }}>
        <div className="donut-hole">
          <strong>{value.toFixed(1)}%</strong>
        </div>
      </div>
      <div className="donut-label">{label}</div>
    </div>
  )
}
