import { useState } from 'react'
import type { Campaign, ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onRefresh: () => Promise<ProjectBundle>
  onOpenDial: () => void
}

export function CampaignsPage({ bundle, onRefresh, onOpenDial }: Props) {
  const [selectedId, setSelectedId] = useState(bundle.campaigns[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const selected = bundle.campaigns.find((c) => c.id === selectedId) ?? bundle.campaigns[0]
  const filtered = bundle.campaigns.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  )

  async function toggle(campaign: Campaign) {
    if (campaign.state === 'ACTIVE') await api.pauseCampaign(campaign.id)
    else await api.runCampaign(campaign.id)
    await onRefresh()
  }

  return (
    <div className="page-split">
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">Campaigns</div>
            <h2>Campaigns</h2>
          </div>
          <div className="prod-view-actions">
            <button className="prod-btn primary" onClick={onOpenDial}>
              Open dial console
            </button>
            <div className="prod-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search campaigns"
              />
              <span>⌕</span>
            </div>
          </div>
        </div>

        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Type</th>
                <th>Progress</th>
                <th>Modified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={c.id === selected?.id ? 'selected' : undefined}
                  onClick={() => setSelectedId(c.id)}
                >
                  <td>
                    <strong>{c.name}</strong>
                    <div className="mini-progress" style={{ marginTop: 6 }}>
                      <div
                        className="mini-progress-bar"
                        style={{ width: `${(c.done / Math.max(c.total, 1)) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td>
                    <span className={`state-badge state-${c.state.toLowerCase()}`}>{c.state}</span>
                  </td>
                  <td>
                    <span className="type-badge">{c.type}</span>
                  </td>
                  <td className="mono">
                    {c.done}/{c.total}
                  </td>
                  <td className="muted">{new Date(c.updatedAt).toLocaleString()}</td>
                  <td>
                    <button
                      className="prod-btn ghost compact"
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggle(c)
                      }}
                    >
                      {c.state === 'ACTIVE' ? 'Pause' : 'Run'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <aside className="page-detail">
          <div className="detail-header">
            <div className="prod-eyebrow">Campaign detail</div>
            <h3>{selected.name}</h3>
          </div>
          <div className="detail-body">
            <div className="detail-actions">
              <button className="prod-btn primary compact" onClick={() => void toggle(selected)}>
                {selected.state === 'ACTIVE' ? 'Pause' : 'Run'}
              </button>
              <button className="prod-btn ghost compact" onClick={onOpenDial}>
                Dial queue
              </button>
            </div>
            <div className="detail-block">
              <div className="detail-kv">
                <span>State</span>
                <span className={`state-badge state-${selected.state.toLowerCase()}`}>
                  {selected.state}
                </span>
              </div>
              <div className="detail-kv">
                <span>Type</span>
                <span className="type-badge">{selected.type}</span>
              </div>
              <div className="detail-kv">
                <span>Progress</span>
                <strong>
                  {selected.done} / {selected.total} (
                  {((selected.done / Math.max(selected.total, 1)) * 100).toFixed(1)}%)
                </strong>
              </div>
              <div className="mini-progress large">
                <div
                  className="mini-progress-bar"
                  style={{ width: `${(selected.done / Math.max(selected.total, 1)) * 100}%` }}
                />
              </div>
              <div className="detail-kv">
                <span>Ring ratio</span>
                <strong>{selected.ringRatio.toFixed(1)}%</strong>
              </div>
              <div className="detail-kv">
                <span>Answer ratio</span>
                <strong>{selected.answerRatio.toFixed(1)}%</strong>
              </div>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
