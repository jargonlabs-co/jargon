import { useEffect, useMemo, useState } from 'react'
import type { CallSession, Contact, ContactStatus, ProjectBundle, SequenceStep } from '../../../api/client'
import { api } from '../../../api/client'
import { prospectTalkTrack } from '../../../lib/prospectContext'
import { RepLiveDialer, type DialerPhase } from '../RepLiveDialer'

interface Props {
  bundle: ProjectBundle
  onRefresh?: () => Promise<ProjectBundle>
  readOnly?: boolean
}

type WorkMode = 'workspace' | 'call' | 'email'

function channelDone(c: Contact, channel: 'call' | 'email'): boolean {
  return (c.channelsDone ?? []).includes(channel)
}

function personalize(template: string, name: string, company: string, title: string): string {
  const first = name.split(/\s+/)[0] || name
  return template
    .replaceAll('{{first_name}}', first)
    .replaceAll('{{name}}', name)
    .replaceAll('{{company}}', company)
    .replaceAll('{{title}}', title || 'your team')
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function progressLabel(c: Contact): string {
  const call = channelDone(c, 'call')
  const email = channelDone(c, 'email')
  if (call && email) return 'Done'
  if (call) return 'Called'
  if (email) return 'Emailed'
  if (c.status === 'active') return 'Up next'
  return 'Queued'
}

function stepLabel(c: Contact, steps: SequenceStep[]): string {
  if (!steps.length) return '—'
  const idx = Math.min(c.stepIndex ?? 0, steps.length - 1)
  return `Step ${idx + 1}/${steps.length}`
}

function activityEntries(c: Contact, steps: SequenceStep[]): Array<{ when: string; label: string; tone: 'done' | 'pending' | 'next' }> {
  const entries: Array<{ when: string; label: string; tone: 'done' | 'pending' | 'next' }> = [
    { when: 'Today', label: 'Enrolled in outbound sequence', tone: 'done' }
  ]
  if (channelDone(c, 'email')) {
    entries.unshift({ when: 'Today', label: 'Intro email sent', tone: 'done' })
  } else if (steps.some((s) => s.channel === 'email')) {
    entries.unshift({ when: 'Next', label: steps.find((s) => s.channel === 'email')?.label ?? 'Send intro email', tone: 'next' })
  }
  if (channelDone(c, 'call')) {
    entries.unshift({ when: 'Today', label: 'Call logged', tone: 'done' })
  } else if (steps.some((s) => s.channel === 'call')) {
    entries.push({ when: 'Queued', label: steps.find((s) => s.channel === 'call')?.label ?? 'Same-day call', tone: 'pending' })
  }
  if (c.notes?.trim()) {
    entries.unshift({ when: 'Recent', label: c.notes.trim().slice(0, 72), tone: 'done' })
  }
  return entries.slice(0, 5)
}

export function ToolWorkspacePage({ bundle, onRefresh, readOnly = false }: Props) {
  const contacts = useMemo(
    () =>
      [...bundle.contacts].sort((a, b) => {
        const rank = (c: Contact) =>
          c.status === 'active' ? 0 : c.status === 'queued' ? 1 : channelDone(c, 'call') && channelDone(c, 'email') ? 3 : 2
        return rank(a) - rank(b) || a.name.localeCompare(b.name)
      }),
    [bundle.contacts]
  )

  const steps = useMemo(
    () => [...bundle.steps].sort((a, b) => a.order - b.order),
    [bundle.steps]
  )

  const sequenceName = bundle.sequences[0]?.name ?? bundle.project.name

  const [selectedId, setSelectedId] = useState<string | null>(contacts[0]?.id ?? null)
  const [mode, setMode] = useState<WorkMode>('workspace')
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [call, setCall] = useState<CallSession | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [note, setNote] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [dialerOpen, setDialerOpen] = useState(false)
  const [demoPhase, setDemoPhase] = useState<DialerPhase>('idle')
  const [demoSeconds, setDemoSeconds] = useState(0)

  const selected = contacts.find((c) => c.id === selectedId) ?? contacts[0] ?? null

  const emailStep = useMemo(() => steps.find((s) => s.channel === 'email'), [steps])

  const talkTrack = useMemo(
    () => (selected ? prospectTalkTrack(selected) : null),
    [selected]
  )

  const timeline = useMemo(
    () => (selected ? activityEntries(selected, steps) : []),
    [selected, steps]
  )

  useEffect(() => {
    if (!selectedId && contacts[0]) setSelectedId(contacts[0].id)
    if (selectedId && !contacts.some((c) => c.id === selectedId) && contacts[0]) {
      setSelectedId(contacts[0].id)
    }
  }, [contacts, selectedId])

  useEffect(() => {
    if (!selected) return
    setNote('')
    setSubject(
      personalize(
        emailStep?.subject ?? `Quick note for {{company}}`,
        selected.name,
        selected.company,
        selected.title
      )
    )
    setBody(
      personalize(
        emailStep?.body ??
          `Hi {{first_name}},\n\nWanted to reach out about closing out the next steps with {{company}}.\n\nOpen to a short call this week?\n\nBest,`,
        selected.name,
        selected.company,
        selected.title
      )
    )
  }, [selected?.id, emailStep?.subject, emailStep?.body])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (!call || call.phase === 'completed') return
    if (call.phase === 'dialing' || call.phase === 'ringing') {
      const poll = window.setInterval(() => {
        void api.getCall(call.id).then((next) => {
          setCall(next)
          if (next.phase === 'connected') setToast(`Connected with ${selected?.name ?? 'contact'}`)
        })
      }, 400)
      return () => window.clearInterval(poll)
    }
    return
  }, [call?.id, call?.phase, selected?.name])

  useEffect(() => {
    if (call?.phase !== 'connected') return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [call?.phase])

  useEffect(() => {
    if (!readOnly || demoPhase !== 'connected') return
    const id = window.setInterval(() => setDemoSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [readOnly, demoPhase])

  const dialerPhase: DialerPhase =
    readOnly ? demoPhase : call?.phase === 'failed' ? 'idle' : (call?.phase ?? 'idle')

  const dialerSeconds = readOnly ? demoSeconds : seconds
  const dialerModeLabel = call?.mode === 'twilio' ? 'Twilio' : 'Jargon dialer'

  function closeDialer() {
    setDialerOpen(false)
    if (readOnly) {
      setDemoPhase('idle')
      setDemoSeconds(0)
    }
  }

  function openDialer() {
    if (!selected) return
    setDialerOpen(true)
    setMode('call')
    if (readOnly) {
      setDemoPhase('dialing')
      setDemoSeconds(0)
      window.setTimeout(() => {
        setDemoPhase('connected')
      }, 1600)
      return
    }
    if (!call || call.phase === 'completed') {
      void startCall()
    }
  }

  function startDialerCall() {
    if (readOnly) {
      setDemoPhase('dialing')
      setDemoSeconds(0)
      window.setTimeout(() => setDemoPhase('connected'), 1600)
      return
    }
    void startCall()
  }

  async function selectContact(id: string) {
    setSelectedId(id)
    setMode('workspace')
    setCall(null)
    setSeconds(0)
    setDialerOpen(false)
    setDemoPhase('idle')
    setDemoSeconds(0)
    if (readOnly) return
    try {
      await api.patchContact(id, { status: 'active' })
      await onRefresh?.()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not select contact')
    }
  }

  async function seedQueue() {
    if (readOnly || !onRefresh) return
    setSyncing(true)
    try {
      const source = bundle.project.answers.prospect_source ?? ''
      if (source.startsWith('crustdata')) {
        await api.syncCrustdata({
          projectId: bundle.project.id,
          limit: Number(bundle.project.answers.prospect_count ?? 20),
          prompt: bundle.project.prompt
        })
      } else {
        await api.syncApollo({
          projectId: bundle.project.id,
          limit: Number(bundle.project.answers.prospect_count ?? 25)
        })
      }
      const next = await onRefresh?.()
      if (!next) return
      if (next.contacts[0]) setSelectedId(next.contacts[0].id)
      setToast(`Loaded ${next.contacts.length} prospects`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not load prospects')
    } finally {
      setSyncing(false)
    }
  }

  async function startCall() {
    if (readOnly || !selected || busy) return
    setBusy(true)
    setMode('call')
    setDialerOpen(true)
    try {
      setSeconds(0)
      await api.voiceToken().catch(() => undefined)
      const next = await api.startCall(selected.id)
      setCall(next)
      setToast(`Dialing ${selected.name}`)
      await onRefresh?.()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Call failed')
    } finally {
      setBusy(false)
    }
  }

  async function completeCall(disposition: ContactStatus) {
    if (readOnly || !call) return
    setBusy(true)
    try {
      const result = await api.completeCall(call.id, disposition)
      setCall(result.call)
      setToast(`Logged ${disposition.replace('_', ' ')}`)
      await onRefresh?.()
      const nextActive =
        result.bundle.contacts.find((c) => c.status === 'active') ??
        result.bundle.contacts.find((c) => c.status === 'queued')
      if (nextActive) setSelectedId(nextActive.id)
      setCall(null)
      setSeconds(0)
      setMode('workspace')
      closeDialer()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not complete call')
    } finally {
      setBusy(false)
    }
  }

  async function sendEmail() {
    if (readOnly || !selected || busy) return
    setBusy(true)
    try {
      await api.sendMessage(selected.id, { subject, body, status: 'sent', channel: 'email' })
      setToast(`Email sent to ${selected.name}`)
      await onRefresh?.()
      setMode('workspace')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (readOnly || !selected || busy) return
    setBusy(true)
    try {
      await api.sendMessage(selected.id, { subject, body, status: 'draft', channel: 'email' })
      setToast('Draft saved')
      await onRefresh?.()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not save draft')
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (readOnly || !selected || busy) return
    const nextNote = note.trim()
    if (!nextNote) {
      setToast('Add a note before saving')
      return
    }
    setBusy(true)
    try {
      await api.addNote(selected.id, nextNote)
      setToast('Note saved')
      await onRefresh?.()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not save note')
    } finally {
      setBusy(false)
    }
  }

  async function setDisposition(status: ContactStatus) {
    if (readOnly || !selected || busy) return
    setBusy(true)
    try {
      await api.patchContact(selected.id, { status })
      setToast(`Marked ${status.replace('_', ' ')}`)
      const next = await onRefresh?.()
      if (!next) return
      const upcoming =
        next.contacts.find((c) => c.id !== selected.id && (c.status === 'queued' || c.status === 'active')) ??
        next.contacts.find((c) => c.status === 'queued')
      if (upcoming) setSelectedId(upcoming.id)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const called = contacts.filter((c) => channelDone(c, 'call')).length
  const emailed = contacts.filter((c) => channelDone(c, 'email')).length
  const remaining = contacts.filter((c) => !(channelDone(c, 'call') && channelDone(c, 'email'))).length
  const completed = contacts.length - remaining
  const progressPct = contacts.length ? Math.round((completed / contacts.length) * 100) : 0

  if (contacts.length === 0) {
    return (
      <div className="rep-console rep-console-empty">
        {toast ? <div className="share-preview-toast">{toast}</div> : null}
        <div className="rep-console-empty-inner">
          <h3>{readOnly ? 'No sample records in this preview' : 'No records in this tool yet'}</h3>
          <p>
            {readOnly
              ? 'The builder has not loaded prospects into this shared preview yet.'
              : 'Load prospects from connected context so reps can call, email, and disposition from this preview.'}
          </p>
          {!readOnly ? (
            <button type="button" className="rep-btn rep-btn-primary" disabled={syncing} onClick={() => void seedQueue()}>
              {syncing ? 'Loading…' : 'Load prospects'}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={`rep-console ${readOnly ? 'rep-console-preview' : ''}`}>
      {toast ? <div className="share-preview-toast">{toast}</div> : null}

      <header className="rep-console-toolbar">
        <div className="rep-console-toolbar-main">
          <div className="rep-console-toolbar-title">
            <span className="rep-console-toolbar-kicker">{readOnly ? 'Engage' : 'Live queue'}</span>
            <strong>{sequenceName}</strong>
          </div>
          <div className="rep-console-progress-wrap" aria-label={`${progressPct}% complete`}>
            <div className="rep-console-progress-bar">
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <span className="rep-console-progress-label">
              {completed}/{contacts.length} complete
            </span>
          </div>
        </div>
        <div className="rep-console-metrics">
          <div className="rep-console-metric">
            <span className="rep-console-metric-value">{remaining}</span>
            <span className="rep-console-metric-key">Left</span>
          </div>
          <div className="rep-console-metric">
            <span className="rep-console-metric-value">{called}</span>
            <span className="rep-console-metric-key">Called</span>
          </div>
          <div className="rep-console-metric">
            <span className="rep-console-metric-value">{emailed}</span>
            <span className="rep-console-metric-key">Emailed</span>
          </div>
        </div>
        {selected ? (
          <div className="rep-console-toolbar-actions">
            <button type="button" className="rep-btn rep-btn-primary" disabled={busy && !readOnly} onClick={openDialer}>
              Call
            </button>
            {!readOnly ? (
              <button type="button" className="rep-btn" disabled={busy} onClick={() => setMode('email')}>
                Email
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="rep-console-body">
        <aside className="rep-console-queue">
          <div className="rep-console-panel-head">
            <span>Priority queue</span>
            <span className="rep-console-panel-count">{contacts.length}</span>
          </div>
          <div className="rep-console-queue-list">
            {contacts.map((c) => {
              const active = c.id === selected?.id
              const callDone = channelDone(c, 'call')
              const emailDone = channelDone(c, 'email')
              const emailState = emailDone ? 'done' : active ? 'next' : 'pending'
              const callState = callDone ? 'done' : active ? 'next' : 'pending'
              return (
                <div key={c.id} className={`rep-queue-card ${active ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="rep-queue-card-main"
                    onClick={() => void selectContact(c.id)}
                  >
                    <div className="rep-queue-card-top">
                      <span className="rep-queue-avatar">{initials(c.name)}</span>
                      <div className="rep-queue-card-meta">
                        <strong>{c.name}</strong>
                        <span>{c.title || 'Contact'}</span>
                        <span className="rep-queue-company">{c.accountName ?? c.company}</span>
                      </div>
                      <span className={`rep-queue-status status-${c.status}`}>{progressLabel(c)}</span>
                    </div>
                  </button>
                  <div className="rep-queue-card-foot">
                    <span className="rep-queue-step">{stepLabel(c, steps)}</span>
                    <div className="rep-queue-channels" aria-label="Channel actions">
                      <button
                        type="button"
                        className={`rep-channel-btn email ${emailState}`}
                        disabled={readOnly}
                        onClick={() => {
                          void selectContact(c.id)
                          setMode('email')
                        }}
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        className={`rep-channel-btn call ${callState}`}
                        onClick={() => {
                          if (readOnly) {
                            setSelectedId(c.id)
                            setMode('call')
                            openDialer()
                            return
                          }
                          void (async () => {
                            await selectContact(c.id)
                            openDialer()
                          })()
                        }}
                      >
                        Call
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        <main className="rep-console-main">
          {selected ? (
            <>
              <div className="rep-console-contact">
                <div className="rep-console-contact-id">
                  <span className="rep-console-avatar lg">{initials(selected.name)}</span>
                  <div>
                    <h3>{selected.name}</h3>
                    <p>
                      {selected.title || 'Contact'} · {selected.accountName ?? selected.company}
                    </p>
                    <div className="rep-console-contact-chips">
                      {selected.city ? <span>{selected.city}</span> : null}
                      {selected.phone ? <span>{selected.phone}</span> : null}
                      {selected.email ? <span>{selected.email}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="rep-console-contact-actions">
                  <button type="button" className="rep-btn rep-btn-primary" disabled={busy && !readOnly} onClick={openDialer}>
                    Call
                  </button>
                  {!readOnly ? (
                    <>
                      <button type="button" className="rep-btn" disabled={busy} onClick={() => setMode('email')}>
                        Email
                      </button>
                      <button type="button" className="rep-btn rep-btn-ghost" disabled={busy} onClick={() => void setDisposition('interested')}>
                        Interested
                      </button>
                      <button type="button" className="rep-btn rep-btn-ghost" disabled={busy} onClick={() => void setDisposition('no_answer')}>
                        No answer
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="rep-console-tabs" role="tablist" aria-label="Work mode">
                {(
                  [
                    ['workspace', 'Workspace'],
                    ['call', 'Call'],
                    ['email', 'Email']
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={mode === id}
                    className={mode === id ? 'rep-console-tab active' : 'rep-console-tab'}
                    onClick={() => setMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'workspace' ? (
                <div className="rep-console-workspace-grid">
                  <section className="rep-console-card rep-console-talk-card">
                    <header className="rep-console-card-head">
                      <strong>Talk track</strong>
                      <span className="rep-console-card-tag">Live script</span>
                    </header>
                    {talkTrack ? (
                      <div className="rep-console-talk-body">
                        <p className="rep-console-talk-hook">{talkTrack.hook}</p>
                        <blockquote className="rep-console-talk-opener">{talkTrack.opener}</blockquote>
                        <div className="rep-console-talk-sections">
                          {talkTrack.sections.map((section) => (
                            <div
                              key={section.id}
                              className={`rep-console-talk-section ${section.emphasis === 'hot' ? 'hot' : ''}`}
                            >
                              <h4>{section.label}</h4>
                              <ul>
                                {section.items.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <section className="rep-console-card">
                    <header className="rep-console-card-head">
                      <strong>Notes & disposition</strong>
                    </header>
                    {selected.notes ? <pre className="rep-console-note-history">{selected.notes}</pre> : null}
                    {!readOnly ? (
                      <>
                        <textarea
                          className="rep-console-note-input"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={5}
                          placeholder="Log objection, next step, or meeting outcome…"
                        />
                        <footer className="rep-console-card-foot rep-console-card-actions">
                          <button type="button" className="rep-btn rep-btn-ghost" disabled={busy} onClick={() => void saveNote()}>
                            Save note
                          </button>
                          <button type="button" className="rep-btn" disabled={busy} onClick={() => void setDisposition('completed')}>
                            Mark done
                          </button>
                        </footer>
                      </>
                    ) : selected.notes ? null : (
                      <p className="rep-console-muted">No notes on this record.</p>
                    )}
                  </section>

                  {emailStep ? (
                    <section className="rep-console-card rep-console-email-preview">
                      <header className="rep-console-card-head">
                        <strong>Next email</strong>
                        <span className="rep-console-card-tag">{emailStep.label}</span>
                      </header>
                      <div className="rep-console-email-meta">
                        <span>Subject</span>
                        <strong>{subject}</strong>
                      </div>
                      <pre className="rep-console-email-body">{body}</pre>
                      {!readOnly ? (
                        <footer className="rep-console-card-foot rep-console-card-actions">
                          <button type="button" className="rep-btn rep-btn-ghost" disabled={busy} onClick={() => setMode('email')}>
                            Edit
                          </button>
                          <button type="button" className="rep-btn rep-btn-primary" disabled={busy || !selected.email} onClick={() => void sendEmail()}>
                            Send
                          </button>
                        </footer>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {mode === 'call' ? (
                <section className="rep-console-card rep-console-call-panel">
                  <header className="rep-console-card-head">
                    <strong>Call console</strong>
                    {dialerPhase === 'connected' || dialerPhase === 'dialing' || dialerPhase === 'ringing' ? (
                      <span className="rep-dialer-live-pill">
                        <span className="rep-dialer-live-dot" aria-hidden="true" />
                        Live
                      </span>
                    ) : (
                      <button type="button" className="rep-dialer-open-btn" onClick={openDialer}>
                        Open dialer
                      </button>
                    )}
                  </header>
                  <div className="rep-console-call-stage">
                    <div className="rep-console-call-number">{selected.phone || 'No number on file'}</div>
                    <p className="rep-console-muted">
                      {readOnly
                        ? 'Launch the dialer to preview a live call experience.'
                        : 'Open the dialer to connect and log disposition.'}
                    </p>
                    <button
                      type="button"
                      className="rep-btn rep-btn-primary rep-btn-lg"
                      disabled={busy || !selected.phone}
                      onClick={openDialer}
                    >
                      {dialerPhase === 'connected' ? 'Return to call' : 'Open dialer'}
                    </button>
                  </div>
                  <ul className="rep-console-talk compact">
                    {talkTrack?.sections
                      .find((s) => s.id === 'signals')
                      ?.items.slice(0, 3)
                      .map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                  </ul>
                </section>
              ) : null}

              {mode === 'email' ? (
                <section className="rep-console-card rep-console-email-compose">
                  <header className="rep-console-card-head">
                    <strong>Compose email</strong>
                  </header>
                  <label className="rep-console-field">
                    <span>To</span>
                    <input value={selected.email || ''} readOnly />
                  </label>
                  <label className="rep-console-field">
                    <span>Subject</span>
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={readOnly} />
                  </label>
                  <label className="rep-console-field">
                    <span>Body</span>
                    <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} readOnly={readOnly} />
                  </label>
                  {!readOnly ? (
                    <footer className="rep-console-card-foot rep-console-card-actions">
                      <button type="button" className="rep-btn rep-btn-ghost" disabled={busy} onClick={() => void saveDraft()}>
                        Save draft
                      </button>
                      <button type="button" className="rep-btn rep-btn-primary" disabled={busy || !selected.email} onClick={() => void sendEmail()}>
                        Send email
                      </button>
                    </footer>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : (
            <div className="rep-console-empty-inner">Queue cleared.</div>
          )}
        </main>

        <aside className="rep-console-side">
          <section className="rep-console-card">
            <header className="rep-console-card-head">
              <strong>Account</strong>
            </header>
            <dl className="rep-console-facts">
              <div>
                <dt>Company</dt>
                <dd>{selected?.accountName ?? selected?.company ?? '—'}</dd>
              </div>
              <div>
                <dt>Segment</dt>
                <dd>{bundle.project.segment || '—'}</dd>
              </div>
              <div>
                <dt>Team</dt>
                <dd>{bundle.project.team || '—'}</dd>
              </div>
              {selected?.city ? (
                <div>
                  <dt>Location</dt>
                  <dd>{selected.city}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="rep-console-card">
            <header className="rep-console-card-head">
              <strong>Sequence</strong>
            </header>
            <ol className="rep-console-seq-steps">
              {steps.map((step, i) => {
                const done =
                  selected &&
                  ((step.channel === 'call' && channelDone(selected, 'call')) ||
                    (step.channel === 'email' && channelDone(selected, 'email')))
                const current = selected && (selected.stepIndex ?? 0) === i && !done
                return (
                  <li key={step.id} className={done ? 'done' : current ? 'current' : ''}>
                    <span className="rep-console-seq-icon">{step.channel === 'call' ? '☎' : '✉'}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <span>Day {step.day}</span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>

          <section className="rep-console-card">
            <header className="rep-console-card-head">
              <strong>Activity</strong>
            </header>
            <ul className="rep-console-timeline">
              {timeline.map((entry, i) => (
                <li key={`${entry.label}-${i}`} className={entry.tone}>
                  <span className="rep-console-timeline-when">{entry.when}</span>
                  <span className="rep-console-timeline-label">{entry.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {selected ? (
        <RepLiveDialer
          open={dialerOpen}
          contact={selected}
          phase={dialerPhase}
          seconds={dialerSeconds}
          modeLabel={dialerModeLabel}
          readOnly={readOnly}
          busy={busy}
          onClose={closeDialer}
          onStart={startDialerCall}
          onDisposition={(status) => {
            if (readOnly) {
              closeDialer()
              return
            }
            void completeCall(status)
          }}
        />
      ) : null}
    </div>
  )
}
