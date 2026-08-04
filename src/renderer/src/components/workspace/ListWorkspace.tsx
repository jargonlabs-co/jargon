import { useMemo, useState } from 'react'
import type { SalesTool } from '../../types'
import { ProductShell } from './ProductShell'

interface Props {
  tool: SalesTool
  onToggleStep: (stepId: string) => void
}

const NAV = [
  { id: 'lists', label: 'Lists' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'exports', label: 'Exports' },
  { id: 'settings', label: 'Settings', section: 'system' as const },
  { id: 'help', label: 'Help', section: 'system' as const }
]

export function ListWorkspace({ tool, onToggleStep }: Props) {
  const [nav, setNav] = useState('lists')
  const [selectedId, setSelectedId] = useState(tool.leads[0]?.id ?? null)
  const selected = tool.leads.find((l) => l.id === selectedId) ?? tool.leads[0]
  const productName = useMemo(
    () => `${tool.segment.replace(/\s+/g, '')} Lists`,
    [tool.segment]
  )

  return (
    <ProductShell
      productName={productName}
      productKind="Lead list builder"
      navItems={NAV}
      activeNav={nav}
      onNavChange={setNav}
      userLabel={tool.team}
      detail={
        selected ? (
          <div className="detail-panel">
            <div className="detail-header">
              <div className="prod-eyebrow">Account</div>
              <h3>{selected.company}</h3>
              <div className="muted">{selected.name} · {selected.title}</div>
            </div>
            <div className="detail-actions">
              <button className="prod-btn primary compact">Add to sequence</button>
              <button className="prod-btn ghost compact">Enrich</button>
              <button className="prod-btn ghost compact">Export</button>
            </div>
            <div className="detail-body">
              <div className="detail-block">
                <div className="detail-block-title">Firmographics</div>
                <div className="detail-kv">
                  <span>Segment</span>
                  <strong>{tool.segment}</strong>
                </div>
                <div className="detail-kv">
                  <span>ICP</span>
                  <strong>{String(tool.answers.icp ?? 'Custom')}</strong>
                </div>
                <div className="detail-kv">
                  <span>Size</span>
                  <strong>{String(tool.answers.size ?? '51–200')}</strong>
                </div>
                <div className="detail-kv">
                  <span>City</span>
                  <strong>{selected.city}</strong>
                </div>
                <div className="detail-kv">
                  <span>Email</span>
                  <strong>{selected.email}</strong>
                </div>
                <div className="detail-kv">
                  <span>Phone</span>
                  <strong>{selected.phone}</strong>
                </div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Build pipeline</div>
                <div className="detail-step-list">
                  {tool.steps.map((s) => (
                    <button
                      key={s.id}
                      className={s.completed ? 'detail-step done' : 'detail-step'}
                      onClick={() => onToggleStep(s.id)}
                    >
                      <span>{s.completed ? '✓' : '○'}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null
      }
    >
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">Lists</div>
            <h2>{tool.name}</h2>
          </div>
          <div className="prod-view-actions">
            <button className="prod-btn primary">+ New list</button>
            <button className="prod-btn ghost">Import CSV</button>
          </div>
        </div>

        <div className="seq-summary">
          <div className="seq-summary-card">
            <div className="dash-value">{tool.leads.length}</div>
            <div className="dash-label">Accounts</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{String(tool.answers.enrichment ?? 'Full').split(' ')[0]}</div>
            <div className="dash-label">Enrichment</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{tool.steps.filter((s) => s.completed).length}/{tool.steps.length}</div>
            <div className="dash-label">Pipeline</div>
          </div>
        </div>

        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Title</th>
                <th>City</th>
                <th>Fit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tool.leads.map((lead, i) => (
                <tr
                  key={lead.id}
                  className={lead.id === selected?.id ? 'selected' : undefined}
                  onClick={() => setSelectedId(lead.id)}
                >
                  <td>
                    <strong>{lead.company}</strong>
                  </td>
                  <td>{lead.name}</td>
                  <td>{lead.title}</td>
                  <td>{lead.city}</td>
                  <td>
                    <span className="fit-score">{94 - i * 3}</span>
                  </td>
                  <td>
                    <span className={`ws-chip status-${lead.status}`}>
                      {lead.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ProductShell>
  )
}
