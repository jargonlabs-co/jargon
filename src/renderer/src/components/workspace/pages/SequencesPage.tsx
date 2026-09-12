import { useState } from 'react'
import type { ProjectBundle } from '../../../api/client'
import { ConnectedContextSection } from '../ConnectedContextSection'
import { motionComplete, specOf, channelLabel } from '../../../lib/workspaceSpec'

interface Props {
  bundle: ProjectBundle
  onOpenInbox: () => void
  onStartSequence?: () => void
}

export function SequencesPage({ bundle, onOpenInbox, onStartSequence }: Props) {
  const sequence = bundle.sequences[0]
  const steps = bundle.steps
    .filter((s) => s.sequenceId === sequence?.id)
    .sort((a, b) => a.order - b.order)
  const [selectedStepId, setSelectedStepId] = useState(steps[0]?.id ?? null)
  const selected = steps.find((s) => s.id === selectedStepId) ?? steps[0]
  const spec = specOf(bundle.project)
  const isQueue = spec.primarySurface === 'queue' || spec.kind === 'today' || spec.primarySurface === 'linkedin'
  const remaining = bundle.contacts.filter((c) => !motionComplete(c, spec)).length
  const started = remaining < bundle.contacts.length

  return (
    <div className="page-split">
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">Sequences</div>
            <h2>{sequence?.name ?? 'Sequences'}</h2>
            {isQueue ? (
              <p className="muted" style={{ marginTop: 8, maxWidth: 520 }}>
                {bundle.contacts.length} prospects enrolled. Start the sequence to open today’s{' '}
                {spec.channels.map((ch) => channelLabel(ch).toLowerCase()).join(' and ')} tasks.
              </p>
            ) : null}
          </div>
          <div className="prod-view-actions">
            {onStartSequence ? (
              <button className="prod-btn primary" onClick={onStartSequence}>
                {started ? 'Continue daily tasks' : 'Start sequence'}
              </button>
            ) : (
              <button className="prod-btn primary" onClick={onOpenInbox}>
                Open inbox
              </button>
            )}
          </div>
        </div>

        {isQueue ? <ConnectedContextSection /> : null}

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
            <div className="dash-value">{remaining}</div>
            <div className="dash-label">Left today</div>
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
              {selected.channel === 'call' ? (
                <p className="muted" style={{ marginTop: 12 }}>
                  Complete this step from the Dial console, then set a disposition to advance the
                  prospect.
                </p>
              ) : null}
              {selected.channel === 'linkedin' ? (
                <p className="muted" style={{ marginTop: 12 }}>
                  Send this LinkedIn step from the composer.
                </p>
              ) : null}
              {selected.subject ? (
                <div className="detail-kv">
                  <span>Subject</span>
                  <strong>{selected.subject}</strong>
                </div>
              ) : null}
              {selected.body ? <pre className="email-body">{selected.body}</pre> : null}
              {onStartSequence ? (
                <button className="prod-btn primary" onClick={onStartSequence}>
                  {started ? 'Continue daily tasks' : 'Start sequence'}
                </button>
              ) : selected.channel === 'email' || selected.channel === 'linkedin' ? (
                <button className="prod-btn primary" onClick={onOpenInbox}>
                  Compose from this step
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
