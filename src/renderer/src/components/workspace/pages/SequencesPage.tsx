import { useState } from 'react'
import type { ProjectBundle } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onOpenInbox: () => void
}

export function SequencesPage({ bundle, onOpenInbox }: Props) {
  const sequence = bundle.sequences[0]
  const steps = bundle.steps
    .filter((s) => s.sequenceId === sequence?.id)
    .sort((a, b) => a.order - b.order)
  const [selectedStepId, setSelectedStepId] = useState(steps[0]?.id ?? null)
  const selected = steps.find((s) => s.id === selectedStepId) ?? steps[0]

  return (
    <div className="page-split">
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">Sequences</div>
            <h2>{sequence?.name ?? 'Sequences'}</h2>
          </div>
          <button className="prod-btn primary" onClick={onOpenInbox}>
            Open inbox
          </button>
        </div>

        <div className="seq-summary">
          <div className="seq-summary-card">
            <div className="dash-value">{steps.length}</div>
            <div className="dash-label">Steps</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{bundle.analytics.enrolled}</div>
            <div className="dash-label">Enrolled</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{bundle.analytics.emailsSent}</div>
            <div className="dash-label">Sent</div>
          </div>
          <div className="seq-summary-card">
            <div className="dash-value">{sequence?.goal ?? '—'}</div>
            <div className="dash-label">Goal</div>
          </div>
        </div>

        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Day</th>
                <th>Channel</th>
                <th>Label</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr
                  key={s.id}
                  className={s.id === selected?.id ? 'selected' : undefined}
                  onClick={() => setSelectedStepId(s.id)}
                >
                  <td className="mono">{s.order + 1}</td>
                  <td className="mono">{s.day}</td>
                  <td>
                    <span className={`channel-badge channel-${s.channel}`}>{s.channel}</span>
                  </td>
                  <td>
                    <strong>{s.label}</strong>
                  </td>
                  <td className="muted">{s.subject ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <aside className="page-detail">
          <div className="detail-header">
            <div className="prod-eyebrow">Step {selected.order + 1}</div>
            <h3>{selected.label}</h3>
          </div>
          <div className="detail-body">
            <div className="detail-block">
              <div className="detail-kv">
                <span>Channel</span>
                <strong>{selected.channel}</strong>
              </div>
              <div className="detail-kv">
                <span>Day</span>
                <strong>{selected.day}</strong>
              </div>
              {selected.subject ? (
                <div className="detail-kv">
                  <span>Subject</span>
                  <strong>{selected.subject}</strong>
                </div>
              ) : null}
              {selected.body ? <pre className="email-body">{selected.body}</pre> : null}
              <button className="prod-btn primary" onClick={onOpenInbox}>
                Compose from this step
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
