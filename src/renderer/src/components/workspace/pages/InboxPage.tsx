import { useEffect, useMemo, useState } from 'react'
import type { Channel, ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'
import { hasChannel, interpolateTemplate, specOf } from '../../../lib/workspaceSpec'

interface Props {
  bundle: ProjectBundle
  onRefresh: () => Promise<ProjectBundle>
  initialContactId?: string | null
  initialChannel?: Channel | null
}

export function InboxPage({ bundle, onRefresh, initialContactId, initialChannel }: Props) {
  const spec = specOf(bundle.project)
  const showEmail = hasChannel(spec, 'email')
  const showLinkedIn = hasChannel(spec, 'linkedin')
  const active =
    (initialContactId && bundle.contacts.find((c) => c.id === initialContactId)) ||
    bundle.contacts.find((c) => c.status === 'active') ||
    bundle.contacts[0]
  const [selectedId, setSelectedId] = useState(active?.id ?? null)

  useEffect(() => {
    if (initialContactId) setSelectedId(initialContactId)
  }, [initialContactId])
  const selected = bundle.contacts.find((c) => c.id === selectedId) ?? active
  const steps = useMemo(
    () =>
      bundle.steps
        .filter((s) => s.projectId === bundle.project.id)
        .sort((a, b) => a.order - b.order),
    [bundle.steps, bundle.project.id]
  )
  const rawStep = steps[selected?.stepIndex ?? 0]
  const preferredChannel: Channel =
    initialChannel === 'linkedin' || initialChannel === 'email'
      ? initialChannel
      : rawStep?.channel === 'linkedin' || rawStep?.channel === 'email'
        ? rawStep.channel
        : showLinkedIn && !showEmail
          ? 'linkedin'
          : 'email'
  const step =
    rawStep?.channel === preferredChannel
      ? rawStep
      : steps.find((s, i) => i >= (selected?.stepIndex ?? 0) && s.channel === preferredChannel) ||
        steps.find((s) => s.channel === preferredChannel) ||
        rawStep
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selected) return
    setSubject(
      interpolateTemplate(step?.subject ?? `Quick note for ${selected.company}`, selected)
    )
    setBody(
      interpolateTemplate(
        step?.body ??
          `Hi {{first_name}},\n\nWanted to reach out about ${String(bundle.project.answers.goal ?? 'a quick meeting').toLowerCase()}.\n\nBest,`,
        selected
      )
    )
  }, [selected?.id, step?.id, bundle.project.answers.goal])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(id)
  }, [toast])

  const messages = bundle.messages
    .filter((m) => (selected ? m.contactId === selected.id : true))
    .sort((a, b) => b.createdAt - a.createdAt)

  async function chooseContact(id: string) {
    setSelectedId(id)
    await api.patchContact(id, { status: 'active' })
    await onRefresh()
  }

  async function saveDraft() {
    if (!selected) return
    setBusy(true)
    try {
      await api.sendMessage(selected.id, { subject, body, status: 'draft', channel: 'email' })
      setToast('Draft saved')
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (!selected) return
    setBusy(true)
    try {
      await api.sendMessage(selected.id, { subject, body, status: 'sent', channel: 'email' })
      setToast(`Email sent to ${selected.name}`)
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  async function linkedIn() {
    if (!selected) return
    setBusy(true)
    try {
      await api.sendMessage(selected.id, {
        subject: 'LinkedIn note',
        body,
        status: 'sent',
        channel: 'linkedin'
      })
      setToast(`LinkedIn message sent to ${selected.name}`)
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-split inbox-page">
      {toast ? <div className="action-toast">{toast}</div> : null}
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">{showLinkedIn && !showEmail ? 'LinkedIn' : 'Inbox'}</div>
            <h2>{showLinkedIn && !showEmail ? 'LinkedIn composer' : 'Composer'}</h2>
          </div>
        </div>

        <div className="inbox-layout">
          <section className="ws-panel">
            <div className="ws-panel-title">People</div>
            <div className="ws-list">
              {bundle.contacts.map((c) => (
                <button
                  key={c.id}
                  className={c.id === selected?.id ? 'ws-row active' : 'ws-row'}
                  onClick={() => void chooseContact(c.id)}
                >
                  <div>
                    <div className="ws-row-title">{c.name}</div>
                    <div className="ws-row-sub">{c.company}</div>
                  </div>
                  <span className="muted mono">#{c.stepIndex + 1}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="ws-panel compose-panel">
            <div className="ws-panel-title">
              {selected ? `Message ${selected.name}` : 'Select a contact'}
            </div>
            {selected ? (
              <div className="action-compose" style={{ padding: 14 }}>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Step {selected.stepIndex + 1}: {step?.label ?? 'Outreach'}
                </div>
                {showEmail ? (
                  <label className="compose-field">
                    <span>To</span>
                    <input value={selected.email} readOnly />
                  </label>
                ) : selected.linkedinUrl ? (
                  <label className="compose-field">
                    <span>LinkedIn</span>
                    <input value={selected.linkedinUrl} readOnly />
                  </label>
                ) : null}
                {showEmail ? (
                  <label className="compose-field">
                    <span>Subject</span>
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </label>
                ) : null}
                <label className="compose-field grow">
                  <span>Body</span>
                  <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
                </label>
                <div className="ws-actions">
                  {showEmail ? (
                    <button className="prod-btn primary" disabled={busy} onClick={() => void send()}>
                      Send email
                    </button>
                  ) : null}
                  {showEmail ? (
                    <button className="prod-btn ghost" disabled={busy} onClick={() => void saveDraft()}>
                      Save draft
                    </button>
                  ) : null}
                  {showLinkedIn ? (
                    <button
                      className={showEmail ? 'prod-btn ghost' : 'prod-btn primary'}
                      disabled={busy}
                      onClick={() => void linkedIn()}
                    >
                      Send LinkedIn via HeyReach
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="ws-empty">Pick someone to message.</div>
            )}
          </section>
        </div>
      </div>

      <aside className="page-detail">
        <div className="detail-header">
          <div className="prod-eyebrow">Message history</div>
          <h3>{selected?.name ?? 'Inbox'}</h3>
        </div>
        <div className="detail-body">
          <div className="detail-step-list">
            {messages.length === 0 ? (
              <div className="muted">No messages yet.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="detail-step">
                  <span className="type-badge">{m.status}</span>
                  <div>
                    <strong>{m.subject}</strong>
                    <div className="muted">
                      {m.channel} · {new Date(m.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
