import { useEffect, useMemo, useState } from 'react'
import type { Lead, SalesTool } from '../../types'

export type ActionKind = 'call' | 'email' | 'draft' | 'linkedin' | 'note'

export interface ActionEvent {
  id: string
  kind: ActionKind
  leadId: string
  leadName: string
  summary: string
  at: number
}

interface Props {
  tool: SalesTool
  lead: Lead | null
  onSelectLead: (leadId: string) => void
  onCallComplete: (leadId: string, status: Lead['status']) => void
  onEmailSent: (leadId: string) => void
  onLogged: (leadId: string, note: string) => void
}

export function ActionWorkbench({
  tool,
  lead,
  onSelectLead,
  onCallComplete,
  onEmailSent,
  onLogged
}: Props) {
  const [mode, setMode] = useState<ActionKind | null>(null)
  const [draftSubject, setDraftSubject] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [note, setNote] = useState('')
  const [callPhase, setCallPhase] = useState<'idle' | 'dialing' | 'connected'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [feed, setFeed] = useState<ActionEvent[]>([])

  const step = tool.steps[lead?.stepIndex ?? 0]

  useEffect(() => {
    if (!lead) return
    setDraftSubject(personalize(step?.subject ?? `Quick note for ${lead.company}`, lead))
    setDraftBody(
      personalize(
        step?.body ??
          `Hi ${lead.name.split(' ')[0]},\n\nWanted to reach out about ${String(tool.config.goal).toLowerCase()}.\n\nBest,`,
        lead
      )
    )
    setNote('')
    setMode(null)
    setCallPhase('idle')
    setSeconds(0)
  }, [lead?.id, step?.id, tool.config.goal])

  useEffect(() => {
    if (callPhase !== 'connected') return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [callPhase])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  const queue = useMemo(
    () => tool.leads.filter((l) => l.status === 'queued' || l.status === 'active'),
    [tool.leads]
  )

  function pushFeed(kind: ActionKind, summary: string) {
    if (!lead) return
    setFeed((prev) => [
      {
        id: `evt_${Date.now()}`,
        kind,
        leadId: lead.id,
        leadName: lead.name,
        summary,
        at: Date.now()
      },
      ...prev
    ].slice(0, 8))
  }

  function flash(message: string) {
    setToast(message)
  }

  function startCall() {
    if (!lead) return
    setMode('call')
    setCallPhase('dialing')
    setSeconds(0)
    pushFeed('call', `Dialing ${lead.phone}`)
    window.setTimeout(() => {
      setCallPhase('connected')
      flash(`Connected with ${lead.name}`)
    }, 1200)
  }

  function openEmail() {
    if (!lead) return
    setMode('email')
    pushFeed('email', `Opened email to ${lead.email}`)
  }

  function openDraft() {
    if (!lead) return
    setMode('draft')
    pushFeed('draft', `Drafting message for ${lead.name}`)
  }

  function openLinkedIn() {
    if (!lead) return
    setMode('linkedin')
    setDraftBody(
      `Hi ${lead.name.split(' ')[0]} — saw your work at ${lead.company} and thought this might be relevant for ${String(tool.config.goal).toLowerCase()}. Open to a quick chat?`
    )
    pushFeed('linkedin', `Drafting LinkedIn note for ${lead.name}`)
  }

  function openNote() {
    setMode('note')
  }

  function sendEmail() {
    if (!lead) return
    onEmailSent(lead.id)
    pushFeed('email', `Sent: ${draftSubject}`)
    flash(`Email sent to ${lead.name}`)
    setMode(null)
  }

  function sendDraft() {
    if (!lead) return
    onEmailSent(lead.id)
    pushFeed('draft', 'Draft saved & queued to send')
    flash('Draft queued')
    setMode(null)
  }

  function sendLinkedIn() {
    if (!lead) return
    onLogged(lead.id, draftBody)
    pushFeed('linkedin', 'LinkedIn note logged')
    flash('LinkedIn note logged (local)')
    setMode(null)
  }

  function saveNote() {
    if (!lead || !note.trim()) return
    onLogged(lead.id, note.trim())
    pushFeed('note', note.trim())
    flash('Note saved')
    setMode(null)
    setNote('')
  }

  function endCall(status: Lead['status']) {
    if (!lead) return
    onCallComplete(lead.id, status)
    pushFeed('call', `Call ended · ${status.replace('_', ' ')}`)
    flash(`Call logged: ${status.replace('_', ' ')}`)
    setMode(null)
    setCallPhase('idle')
    setSeconds(0)
  }

  if (!lead) {
    return (
      <div className="action-workbench empty">
        <div>
          <strong>No active contact</strong>
          <p>Select a contact to call, email, or draft a message.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="action-workbench">
      {toast ? <div className="action-toast">{toast}</div> : null}

      <div className="action-top">
        <div className="action-contact">
          <div className="action-avatar">{initials(lead.name)}</div>
          <div className="action-contact-copy">
            <div className="action-contact-name">{lead.name}</div>
            <div className="action-contact-meta">
              {lead.title} · {lead.company}
            </div>
            <div className="action-contact-meta mono">
              {lead.phone} · {lead.email}
            </div>
          </div>
          <span className={`ws-chip status-${lead.status}`}>{lead.status.replace('_', ' ')}</span>
        </div>

        <div className="action-buttons">
          <button className="action-btn call" onClick={startCall}>
            <span>☎</span> Call
          </button>
          <button className="action-btn email" onClick={openEmail}>
            <span>✉</span> Email
          </button>
          <button className="action-btn draft" onClick={openDraft}>
            <span>✎</span> Draft
          </button>
          <button className="action-btn linkedin" onClick={openLinkedIn}>
            <span>in</span> LinkedIn
          </button>
          <button className="action-btn note" onClick={openNote}>
            <span>✓</span> Log note
          </button>
        </div>
      </div>

      <div className="action-body">
        <div className="action-queue">
          <div className="action-section-title">Next up</div>
          <div className="action-queue-list">
            {queue.map((item) => (
              <button
                key={item.id}
                className={item.id === lead.id ? 'action-queue-row active' : 'action-queue-row'}
                onClick={() => onSelectLead(item.id)}
              >
                <div>
                  <strong>{item.name}</strong>
                  <div className="muted">{item.company}</div>
                </div>
                <span className="muted mono">#{item.stepIndex + 1}</span>
              </button>
            ))}
          </div>
          <div className="action-section-title" style={{ marginTop: 12 }}>
            Activity
          </div>
          <div className="action-feed">
            {feed.length === 0 ? (
              <div className="muted">Actions you take will show up here.</div>
            ) : (
              feed.map((evt) => (
                <div key={evt.id} className="action-feed-row">
                  <span className={`action-kind kind-${evt.kind}`}>{evt.kind}</span>
                  <div>
                    <strong>{evt.leadName}</strong>
                    <div className="muted">{evt.summary}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="action-stage">
          {!mode ? (
            <div className="action-idle">
              <div className="action-section-title">Suggested next action</div>
              <h3>
                {step?.channel === 'call'
                  ? `Call ${lead.name}`
                  : step?.channel === 'linkedin'
                    ? `Message ${lead.name} on LinkedIn`
                    : `Email ${lead.name}`}
              </h3>
              <p>
                Step {lead.stepIndex + 1}: <strong>{step?.label ?? 'Outreach'}</strong> · Goal:{' '}
                {String(tool.config.goal)}
              </p>
              <div className="action-buttons">
                {step?.channel === 'call' ? (
                  <button className="action-btn call" onClick={startCall}>
                    Start call
                  </button>
                ) : step?.channel === 'linkedin' ? (
                  <button className="action-btn linkedin" onClick={openLinkedIn}>
                    Draft LinkedIn note
                  </button>
                ) : (
                  <button className="action-btn email" onClick={openEmail}>
                    Draft & send email
                  </button>
                )}
                <button className="action-btn draft" onClick={openDraft}>
                  Open composer
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'call' ? (
            <div className="action-call-panel">
              <div className="action-section-title">
                {callPhase === 'dialing' ? 'Dialing…' : 'Live call'}
              </div>
              <div className="call-timer">{formatTime(seconds)}</div>
              <div className="action-contact-name">{lead.name}</div>
              <div className="muted">{lead.phone}</div>
              {callPhase === 'dialing' ? (
                <div className="action-dialing">
                  <span className="pulse" /> Connecting…
                </div>
              ) : (
                <div className="disposition-grid">
                  <button className="prod-btn primary" onClick={() => endCall('interested')}>
                    Interested
                  </button>
                  <button className="prod-btn ghost" onClick={() => endCall('no_answer')}>
                    No answer
                  </button>
                  <button className="prod-btn ghost" onClick={() => endCall('not_interested')}>
                    Not interested
                  </button>
                  <button className="prod-btn ghost" onClick={() => endCall('completed')}>
                    Complete
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {mode === 'email' || mode === 'draft' ? (
            <div className="action-compose">
              <div className="action-section-title">
                {mode === 'email' ? 'Send email' : 'Draft message'}
              </div>
              <label className="compose-field">
                <span>To</span>
                <input value={lead.email} readOnly />
              </label>
              <label className="compose-field">
                <span>Subject</span>
                <input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} />
              </label>
              <label className="compose-field grow">
                <span>Message</span>
                <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={8} />
              </label>
              <div className="ws-actions">
                <button className="prod-btn primary" onClick={mode === 'email' ? sendEmail : sendDraft}>
                  {mode === 'email' ? 'Send email' : 'Save draft'}
                </button>
                <button className="prod-btn ghost" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'linkedin' ? (
            <div className="action-compose">
              <div className="action-section-title">LinkedIn note</div>
              <label className="compose-field grow">
                <span>Note</span>
                <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={6} />
              </label>
              <div className="ws-actions">
                <button className="prod-btn primary" onClick={sendLinkedIn}>
                  Log note
                </button>
                <button className="prod-btn ghost" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'note' ? (
            <div className="action-compose">
              <div className="action-section-title">Log note</div>
              <label className="compose-field grow">
                <span>Note</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={5}
                  placeholder="What happened on this touch?"
                />
              </label>
              <div className="ws-actions">
                <button className="prod-btn primary" onClick={saveNote}>
                  Save note
                </button>
                <button className="prod-btn ghost" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
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

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatTime(total: number): string {
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}
