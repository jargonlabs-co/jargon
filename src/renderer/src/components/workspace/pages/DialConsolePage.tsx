import { useEffect, useMemo, useState } from 'react'
import type { CallSession, ContactStatus, ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onRefresh: () => Promise<ProjectBundle>
  initialContactId?: string | null
}

export function DialConsolePage({ bundle, onRefresh, initialContactId }: Props) {
  const active =
    (initialContactId && bundle.contacts.find((c) => c.id === initialContactId)) ||
    bundle.contacts.find((c) => c.status === 'active') ||
    bundle.contacts.find((c) => c.status === 'queued') ||
    bundle.contacts[0]
  const [selectedId, setSelectedId] = useState(active?.id ?? null)
  const [call, setCall] = useState<CallSession | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (initialContactId) setSelectedId(initialContactId)
  }, [initialContactId])

  const selected = bundle.contacts.find((c) => c.id === selectedId) ?? active
  const queue = useMemo(
    () => bundle.contacts.filter((c) => c.status === 'queued' || c.status === 'active'),
    [bundle.contacts]
  )
  const step = bundle.steps
    .filter((s) => s.channel === 'call' || s.projectId === bundle.project.id)
    .sort((a, b) => a.order - b.order)[selected?.stepIndex ?? 0]

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (!call || call.phase === 'completed') return
    if (call.phase === 'dialing') {
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

  async function selectContact(id: string) {
    setSelectedId(id)
    await api.patchContact(id, { status: 'active' })
    await onRefresh()
  }

  async function startCall() {
    if (!selected || busy) return
    setBusy(true)
    try {
      setSeconds(0)
      await api.voiceToken().catch(() => undefined)
      const next = await api.startCall(selected.id)
      setCall(next)
      setToast(`Dialing ${selected.name}`)
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  async function complete(disposition: ContactStatus) {
    if (!call) return
    setBusy(true)
    try {
      const result = await api.completeCall(call.id, disposition)
      setCall(result.call)
      setToast(`Logged ${disposition.replace('_', ' ')}`)
      await onRefresh()
      const nextActive =
        result.bundle.contacts.find((c) => c.status === 'active') ??
        result.bundle.contacts.find((c) => c.status === 'queued')
      if (nextActive) setSelectedId(nextActive.id)
      setCall(null)
      setSeconds(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="prod-view dial-console">
      {toast ? <div className="action-toast">{toast}</div> : null}
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Dial console</div>
          <h2>Live queue</h2>
        </div>
        <div className="muted">Softphone · Dial console</div>
      </div>

      <div className="dial-layout">
        <section className="ws-panel">
          <div className="ws-panel-title">Next up</div>
          <div className="ws-list">
            {queue.map((c) => (
              <button
                key={c.id}
                className={c.id === selected?.id ? 'ws-row active' : 'ws-row'}
                onClick={() => void selectContact(c.id)}
              >
                <div>
                  <div className="ws-row-title">{c.name}</div>
                  <div className="ws-row-sub">
                    {c.company} · {c.city}
                  </div>
                </div>
                <span className={`ws-chip status-${c.status}`}>{c.status.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ws-panel call-stage">
          <div className="ws-panel-title">Active session</div>
          {selected ? (
            <div className="call-stage-card">
              <div className="call-avatar">{initials(selected.name)}</div>
              <div className="call-name">{selected.name}</div>
              <div className="call-company">
                {selected.title} · {selected.company}
              </div>
              <div className="call-phone">{selected.phone}</div>
              <p className="call-goal">
                Step: {step?.label ?? 'Discovery dial'} · Goal: {bundle.project.answers.goal ?? 'Book a meeting'}
              </p>

              {!call || call.phase === 'completed' ? (
                <button className="prod-btn primary" disabled={busy} onClick={() => void startCall()}>
                  Start call
                </button>
              ) : null}

              {call?.phase === 'dialing' ? (
                <div className="action-dialing">
                  <span className="pulse" /> Dialing…
                </div>
              ) : null}

              {call?.phase === 'connected' ? (
                <>
                  <div className="call-timer">{formatTime(seconds)}</div>
                  <div className="disposition-grid">
                    <button className="prod-btn primary" onClick={() => void complete('interested')}>
                      Interested
                    </button>
                    <button className="prod-btn ghost" onClick={() => void complete('no_answer')}>
                      No answer
                    </button>
                    <button className="prod-btn ghost" onClick={() => void complete('not_interested')}>
                      Not interested
                    </button>
                    <button className="prod-btn ghost" onClick={() => void complete('completed')}>
                      Complete
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="ws-empty">Queue cleared.</div>
          )}
        </section>
      </div>
    </div>
  )
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
