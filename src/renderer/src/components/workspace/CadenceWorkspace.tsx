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
  { id: 'cadences', label: 'Cadences' },
  { id: 'contacts', label: 'People' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings', section: 'system' as const },
  { id: 'help', label: 'Help', section: 'system' as const }
]

export function CadenceWorkspace({
  tool,
  onSelectLead,
  onSendStep,
  onDispose,
  onToggleStep
}: Props) {
  const [nav, setNav] = useState('cadences')
  const active = tool.leads.find((l) => l.id === tool.activeLeadId) ?? tool.leads[0]
  const step = tool.steps[active?.stepIndex ?? 0]
  const productName = useMemo(
    () => `${tool.segment.replace(/\s+/g, '')} Cadence`,
    [tool.segment]
  )

  return (
    <ProductShell
      productName={productName}
      productKind="Multi-channel cadence"
      navItems={NAV}
      activeNav={nav}
      onNavChange={setNav}
      userLabel={tool.team}
      detail={
        nav === 'cadences' && active ? (
          <div className="detail-panel">
            <div className="detail-header">
              <div className="prod-eyebrow">Current touch</div>
              <h3>{active.name}</h3>
              <div className="muted">
                {active.company} · Day {step?.day ?? 0}
              </div>
            </div>
            <div className="detail-actions">
              <button className="prod-btn primary compact" onClick={() => onSendStep(active.id)}>
                Complete touch
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
                <span className={`channel-badge channel-${step?.channel ?? 'email'}`}>
                  {step?.channel}
                </span>
                <h4 style={{ marginTop: 10 }}>{step?.label}</h4>
                {step?.subject ? <div className="touch-subject">{step.subject}</div> : null}
                {step?.body ? <pre className="email-body compact">{step.body}</pre> : null}
                <div className="detail-kv">
                  <span>Goal</span>
                  <strong>{String(tool.config.goal)}</strong>
                </div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Cadence steps</div>
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
                        {s.channel} · {s.label}
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
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">Cadences</div>
            <h2>{tool.name}</h2>
          </div>
          <button className="prod-btn primary">+ Create cadence</button>
        </div>

        <div className="seq-summary">
          <div className="seq-summary-card">
            <div className="dash-value">{tool.steps.length}</div>
            <div className="dash-label">Touches</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{String(tool.answers.duration ?? '21 days')}</div>
            <div className="dash-label">Duration</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{tool.stats.enrolled}</div>
            <div className="dash-label">People</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{tool.stats.booked}</div>
            <div className="dash-label">Booked</div>
          </div>
        </div>

        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Company</th>
                <th>Touch</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tool.leads.map((lead) => {
                const s = tool.steps[lead.stepIndex]
                return (
                  <tr
                    key={lead.id}
                    className={lead.id === active?.id ? 'selected' : undefined}
                    onClick={() => onSelectLead(lead.id)}
                  >
                    <td>
                      <strong>{lead.name}</strong>
                    </td>
                    <td>{lead.company}</td>
                    <td className="mono">
                      {lead.stepIndex + 1}/{tool.steps.length}
                    </td>
                    <td>
                      <span className={`channel-badge channel-${s?.channel ?? 'email'}`}>
                        {s?.channel}
                      </span>
                    </td>
                    <td>
                      <span className={`ws-chip status-${lead.status}`}>
                        {lead.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <button
                        className="prod-btn ghost compact"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSendStep(lead.id)
                        }}
                      >
                        Advance
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </ProductShell>
  )
}
