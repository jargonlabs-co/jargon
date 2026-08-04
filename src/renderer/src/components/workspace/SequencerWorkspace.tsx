import { useMemo, useState } from 'react'
import type { Lead, SalesTool } from '../../types'
import { ProductShell } from './ProductShell'

interface Props {
  tool: SalesTool
  onSelectLead: (leadId: string) => void
  onSendStep: (leadId: string) => void
  onDispose: (leadId: string, status: Lead['status']) => void
  onToggleStep: (stepId: string) => void
}

const NAV = [
  { id: 'sequences', label: 'Sequences' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'lists', label: 'Lead Lists' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings', section: 'system' as const },
  { id: 'help', label: 'Help', section: 'system' as const }
]

export function SequencerWorkspace({
  tool,
  onSelectLead,
  onSendStep,
  onDispose,
  onToggleStep
}: Props) {
  const [nav, setNav] = useState('sequences')
  const [query, setQuery] = useState('')
  const active = tool.leads.find((l) => l.id === tool.activeLeadId) ?? tool.leads[0]
  const step = tool.steps[active?.stepIndex ?? 0]
  const productName = useMemo(
    () => `${tool.segment.replace(/\s+/g, '')} Engage`,
    [tool.segment]
  )

  const filtered = tool.leads.filter(
    (l) =>
      l.name.toLowerCase().includes(query.toLowerCase()) ||
      l.company.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <ProductShell
      productName={productName}
      productKind="Email sequencer"
      navItems={NAV}
      activeNav={nav}
      onNavChange={setNav}
      userLabel={tool.team}
      detail={
        nav === 'sequences' && active ? (
          <div className="detail-panel">
            <div className="detail-header">
              <div className="prod-eyebrow">Active lead</div>
              <h3>{active.name}</h3>
              <div className="muted">
                {active.title} · {active.company}
              </div>
            </div>
            <div className="detail-actions">
              <button className="prod-btn primary compact" onClick={() => onSendStep(active.id)}>
                Send & advance
              </button>
              <button className="prod-btn ghost compact" onClick={() => onDispose(active.id, 'replied')}>
                Mark replied
              </button>
              <button
                className="prod-btn ghost compact"
                onClick={() => onDispose(active.id, 'interested')}
              >
                Booked
              </button>
            </div>
            <div className="detail-body">
              <div className="detail-block">
                <div className="detail-block-title">
                  Step { (active.stepIndex ?? 0) + 1 } · {step?.label}
                </div>
                <div className="detail-kv">
                  <span>To</span>
                  <strong>{active.email}</strong>
                </div>
                <div className="detail-kv">
                  <span>Subject</span>
                  <strong>{personalize(step?.subject ?? '', active)}</strong>
                </div>
                <pre className="email-body">{personalize(step?.body ?? '', active)}</pre>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Sequence timeline</div>
                <div className="detail-step-list">
                  {tool.steps.map((s, i) => (
                    <button
                      key={s.id}
                      className={
                        i === active.stepIndex
                          ? 'detail-step active'
                          : s.completed
                            ? 'detail-step done'
                            : 'detail-step'
                      }
                      onClick={() => onToggleStep(s.id)}
                    >
                      <span className="mono">D{s.day}</span>
                      <span>
                        {s.label}
                        {s.subject ? ` · ${s.subject}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {nav === 'sequences' ? (
        <div className="prod-view">
          <div className="prod-view-header">
            <div>
              <div className="prod-eyebrow">Sequences</div>
              <h2>{tool.name}</h2>
            </div>
            <div className="prod-view-actions">
              <button className="prod-btn primary">+ New sequence</button>
              <div className="prod-search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search leads"
                />
                <span>⌕</span>
              </div>
            </div>
          </div>

          <div className="seq-summary">
            <SummaryCard label="Enrolled" value={tool.stats.enrolled} />
            <SummaryCard label="Contacted" value={tool.stats.contacted} />
            <SummaryCard label="Replied" value={tool.stats.replied} />
            <SummaryCard label="Booked" value={tool.stats.booked} />
            <SummaryCard label="Steps" value={tool.steps.length} />
            <SummaryCard label="Tone" value={String(tool.answers.tone ?? 'Direct').split(' ')[0]} />
          </div>

          <div className="prod-table-wrap">
            <div className="prod-table-meta">
              <span>
                Showing {filtered.length} leads in sequence
              </span>
              <span>{String(tool.config.goal)}</span>
            </div>
            <table className="prod-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Company</th>
                  <th>Step</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => {
                  const s = tool.steps[lead.stepIndex]
                  return (
                    <tr
                      key={lead.id}
                      className={lead.id === active?.id ? 'selected' : undefined}
                      onClick={() => onSelectLead(lead.id)}
                    >
                      <td>
                        <strong>{lead.name}</strong>
                        <div className="muted">{lead.email}</div>
                      </td>
                      <td>{lead.company}</td>
                      <td className="mono">
                        {lead.stepIndex + 1}/{tool.steps.length}
                      </td>
                      <td>
                        <span className="type-badge">{s?.channel ?? 'email'}</span>
                      </td>
                      <td>
                        <span className={`ws-chip status-${lead.status}`}>
                          {lead.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td>{s?.label ?? 'Done'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : nav === 'analytics' ? (
        <div className="prod-view">
          <div className="prod-view-header">
            <div>
              <div className="prod-eyebrow">Analytics</div>
              <h2>Sequence performance</h2>
            </div>
          </div>
          <div className="donut-row wide">
            <Donut
              label="Open rate"
              value={62.4}
              color="var(--star-blue)"
            />
            <Donut label="Reply rate" value={tool.stats.enrolled ? (tool.stats.replied / tool.stats.enrolled) * 100 : 8.2} color="var(--success)" />
            <Donut label="Booked rate" value={tool.stats.enrolled ? (tool.stats.booked / tool.stats.enrolled) * 100 : 3.1} color="var(--accent)" />
          </div>
        </div>
      ) : (
        <div className="prod-view placeholder-view">
          <div className="prod-eyebrow">{nav}</div>
          <h2>{NAV.find((n) => n.id === nav)?.label}</h2>
          <p>
            Part of your custom sequencer for <strong>{tool.segment}</strong>.
          </p>
        </div>
      )}
    </ProductShell>
  )
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="seq-summary-card">
      <div className="dash-value">{value}</div>
      <div className="dash-label">{label}</div>
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

function personalize(template: string, lead: Lead): string {
  return template
    .replaceAll('{{first_name}}', lead.name.split(' ')[0] ?? lead.name)
    .replaceAll('{{company}}', lead.company)
    .replaceAll('{{persona}}', lead.title)
    .replaceAll('{{similar_company}}', 'Northstar Ops')
}
