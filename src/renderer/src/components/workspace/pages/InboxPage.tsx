import { useEffect, useMemo, useState } from 'react'
import type { ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onRefresh: () => Promise<ProjectBundle>
  initialContactId?: string | null
}

export function InboxPage({ bundle, onRefresh, initialContactId }: Props) {
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
  const step =
    rawStep?.channel === 'email'
      ? rawStep
      : steps.find((s, i) => i >= (selected?.stepIndex ?? 0) && s.channel === 'email') ||
        steps.find((s) => s.channel === 'email') ||
        rawStep
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selected) return
    setSubject(
      personalize(
        step?.subject ?? `Quick note for ${selected.company}`,
        selected.name,
        selected.company,
        selected.title
      )
    )
    setBody(
      personalize(
        step?.body ??
          `Hi {{first_name}},\n\nWanted to reach out about ${String(bundle.project.answers.goal ?? 'a quick meeting').toLowerCase()}.\n\nBest,`,
        selected.name,
        selected.company,
        selected.title
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
      setToast('LinkedIn note logged')
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
            <div className="prod-eyebrow">Inbox</div>
            <h2>Composer</h2>
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
                <label className="compose-field">
                  <span>To</span>
                  <input value={selected.email} readOnly />
                </label>
                <label className="compose-field">
                  <span>Subject</span>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </label>
                <label className="compose-field grow">
                  <span>Body</span>
                  <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
                </label>
                <div className="ws-actions">
                  <button className="prod-btn primary" disabled={busy} onClick={() => void send()}>
                    Send email
                  </button>
                  <button className="prod-btn ghost" disabled={busy} onClick={() => void saveDraft()}>
                    Save draft
                  </button>
                  <button className="prod-btn ghost" disabled={busy} onClick={() => void linkedIn()}>
                    Log LinkedIn note
                  </button>
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

function personalize(template: string, name: string, company: string, title: string): string {
  return template
    .replaceAll('{{first_name}}', name.split(' ')[0] ?? name)
    .replaceAll('{{company}}', company)
    .replaceAll('{{persona}}', title)
}
