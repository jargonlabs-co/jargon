import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_CONTEXT,
  DEFAULT_GUARDRAILS,
  PENDING_SEQUENCES,
  RECOMMENDATIONS,
  TOP_SEQUENCES,
  repsFor,
  type AdminWindow,
  type ContextField,
  type Guardrails,
  type Recommendation,
  type RepMetrics
} from './adminMock'

type AdminTab = 'team' | 'insights' | 'guardrails' | 'context'
type Decision = 'accepted' | 'rejected'
type RepSort = 'meetings' | 'emails' | 'calls' | 'replyRate' | 'connectRate'

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'team', label: 'Team' },
  { id: 'insights', label: 'Insights' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'context', label: 'Org context' }
]

const WINDOWS: Array<{ id: AdminWindow; label: string }> = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' }
]

const num = (n: number) => new Intl.NumberFormat('en-US').format(n)
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const ratio = (a: number, b: number) => (b ? a / b : 0)

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('team')
  const [guardrails, setGuardrails] = useState<Guardrails>(DEFAULT_GUARDRAILS)
  const [context, setContext] = useState<ContextField[]>(DEFAULT_CONTEXT)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const pendingCount = RECOMMENDATIONS.filter((r) => !decisions[r.id]).length

  function applyEffect(rec: Recommendation, direction: 'apply' | 'revert') {
    const effect = rec.effect
    if (!effect) return
    if (effect.kind === 'guardrail') {
      setGuardrails((g) => {
        const next = { ...g }
        if (effect.patch.callStart) {
          next.callStart = direction === 'apply' ? effect.patch.callStart : DEFAULT_GUARDRAILS.callStart
        }
        if (effect.patch.blockedPhrases) {
          const phrases = effect.patch.blockedPhrases
          next.blockedPhrases =
            direction === 'apply'
              ? [...new Set([...g.blockedPhrases, ...phrases])]
              : g.blockedPhrases.filter((p) => !phrases.includes(p))
        }
        return next
      })
    } else {
      setContext((fields) =>
        fields.map((f) => {
          if (f.id !== effect.field) return f
          const value =
            direction === 'apply'
              ? `${f.value.trimEnd()}\n${effect.append}`
              : f.value.replace(`\n${effect.append}`, '')
          return { ...f, value }
        })
      )
    }
  }

  function decide(rec: Recommendation, decision: Decision) {
    setDecisions((d) => ({ ...d, [rec.id]: decision }))
    if (decision === 'accepted') {
      applyEffect(rec, 'apply')
      setToast(
        rec.effect?.kind === 'guardrail'
          ? 'Accepted and applied to Guardrails'
          : rec.effect?.kind === 'context'
            ? 'Accepted and added to Org context'
            : 'Accepted and assigned to the sequence owner'
      )
    } else {
      setToast('Recommendation dismissed')
    }
  }

  function undo(rec: Recommendation) {
    if (decisions[rec.id] === 'accepted') applyEffect(rec, 'revert')
    setDecisions((d) => {
      const next = { ...d }
      delete next[rec.id]
      return next
    })
  }

  return (
    <section className="webapp-section admin-page">
      <div className="section-heading">
        <p className="eyebrow">
          Admin <span className="admin-sample-pill">Sample data</span>
        </p>
        <h1>Team overview</h1>
        <p className="section-lede">
          See how every rep and sequence is performing, act on recommendations, and set the rules every rep’s
          sequences follow.
        </p>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`admin-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'insights' && pendingCount > 0 ? <span className="admin-tab-count">{pendingCount}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'team' ? <TeamSection /> : null}
      {tab === 'insights' ? <InsightsSection decisions={decisions} onDecide={decide} onUndo={undo} /> : null}
      {tab === 'guardrails' ? (
        <GuardrailsSection guardrails={guardrails} onChange={setGuardrails} onToast={setToast} />
      ) : null}
      {tab === 'context' ? <ContextSection fields={context} onChange={setContext} onToast={setToast} /> : null}

      {toast ? <div className="webapp-toast">{toast}</div> : null}
    </section>
  )
}

function TeamSection() {
  const [window, setWindow] = useState<AdminWindow>('30d')
  const [sort, setSort] = useState<RepSort>('meetings')
  const reps = useMemo(() => repsFor(window), [window])

  const totals = reps.reduce(
    (acc, r) => ({
      emails: acc.emails + r.emails,
      calls: acc.calls + r.calls,
      connects: acc.connects + r.connects,
      replies: acc.replies + r.replies,
      meetings: acc.meetings + r.meetings
    }),
    { emails: 0, calls: 0, connects: 0, replies: 0, meetings: 0 }
  )

  const sortValue = (r: RepMetrics): number => {
    if (sort === 'replyRate') return ratio(r.replies, r.emails)
    if (sort === 'connectRate') return ratio(r.connects, r.calls)
    return r[sort]
  }
  const sorted = [...reps].sort((a, b) => sortValue(b) - sortValue(a))
  const maxMeetings = Math.max(...reps.map((r) => r.meetings))

  const header = (id: RepSort, label: string) => (
    <th scope="col" className="is-num">
      <button
        type="button"
        className={`admin-sort${sort === id ? ' is-active' : ''}`}
        onClick={() => setSort(id)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort === id ? ' ↓' : ''}
      </button>
    </th>
  )

  return (
    <div className="admin-panel">
      <div className="usage-window" role="group" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`btn btn-sm ${window === w.id ? 'primary' : 'ghost'}`}
            aria-pressed={window === w.id}
            onClick={() => setWindow(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="account-stat-grid admin-stat-grid">
        <Stat label="Emails sent" value={num(totals.emails)} />
        <Stat label="Calls placed" value={num(totals.calls)} />
        <Stat label="Meetings booked" value={num(totals.meetings)} />
        <Stat label="Reply rate" value={pct(ratio(totals.replies, totals.emails))} />
        <Stat label="Connect rate" value={pct(ratio(totals.connects, totals.calls))} />
      </div>

      <div className="section-heading admin-subhead">
        <h2>By rep</h2>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Rep</th>
              {header('emails', 'Emails')}
              {header('calls', 'Calls')}
              {header('connectRate', 'Connect')}
              {header('replyRate', 'Reply')}
              {header('meetings', 'Meetings')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((rep) => (
              <tr key={rep.id}>
                <td>
                  <strong>{rep.name}</strong>
                  <span className="admin-muted">{rep.title}</span>
                </td>
                <td className="is-num">{num(rep.emails)}</td>
                <td className="is-num">{num(rep.calls)}</td>
                <td className="is-num">{pct(ratio(rep.connects, rep.calls))}</td>
                <td className="is-num">{pct(ratio(rep.replies, rep.emails))}</td>
                <td className="is-num">
                  <div className="admin-meetings">
                    <span className="admin-bar" aria-hidden="true">
                      <span style={{ width: `${(rep.meetings / maxMeetings) * 100}%` }} />
                    </span>
                    <strong>{rep.meetings}</strong>
                    <span className={`admin-trend ${rep.trend >= 0 ? 'is-up' : 'is-down'}`}>
                      {rep.trend >= 0 ? '▲' : '▼'} {Math.abs(Math.round(rep.trend * 100))}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-heading admin-subhead">
        <h2>Highest-converting sequences</h2>
        <p className="section-lede">Ranked by meetings booked per contact enrolled.</p>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Sequence</th>
              <th scope="col" className="is-num">Enrolled</th>
              <th scope="col" className="is-num">Reply</th>
              <th scope="col" className="is-num">Meeting rate</th>
              <th scope="col" className="is-num">Meetings</th>
            </tr>
          </thead>
          <tbody>
            {[...TOP_SEQUENCES]
              .sort((a, b) => b.meetingRate - a.meetingRate)
              .map((seq, i) => (
                <tr key={seq.id}>
                  <td className="admin-rank">{i + 1}</td>
                  <td>
                    <strong>{seq.name}</strong>
                    <span className="admin-muted">
                      {seq.owner} · {seq.steps} steps · {seq.channels.join(', ')}
                    </span>
                  </td>
                  <td className="is-num">{num(seq.enrolled)}</td>
                  <td className="is-num">{pct(seq.replyRate)}</td>
                  <td className="is-num">
                    <strong>{pct(seq.meetingRate)}</strong>
                  </td>
                  <td className="is-num">{seq.meetings}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="account-stat">
      <p className="account-stat-label">{label}</p>
      <p className="account-stat-value">{value}</p>
    </article>
  )
}

function InsightsSection({
  decisions,
  onDecide,
  onUndo
}: {
  decisions: Record<string, Decision>
  onDecide: (rec: Recommendation, decision: Decision) => void
  onUndo: (rec: Recommendation) => void
}) {
  const [filter, setFilter] = useState<'pending' | Decision>('pending')
  const counts = {
    pending: RECOMMENDATIONS.filter((r) => !decisions[r.id]).length,
    accepted: RECOMMENDATIONS.filter((r) => decisions[r.id] === 'accepted').length,
    rejected: RECOMMENDATIONS.filter((r) => decisions[r.id] === 'rejected').length
  }
  const visible = RECOMMENDATIONS.filter((r) => (decisions[r.id] ?? 'pending') === filter)

  return (
    <div className="admin-panel">
      <p className="section-lede">
        Jargon reviews your team’s activity and outcomes and suggests changes. Accepting a guardrail or context
        recommendation applies it right away.
      </p>
      <div className="usage-window" role="group" aria-label="Filter recommendations">
        {(['pending', 'accepted', 'rejected'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${filter === f ? 'primary' : 'ghost'}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'pending' ? 'To review' : f === 'accepted' ? 'Accepted' : 'Rejected'} ({counts[f]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="section-lede admin-empty">
          {filter === 'pending' ? 'You’re all caught up.' : `Nothing ${filter} yet.`}
        </p>
      ) : (
        <div className="admin-recs">
          {visible.map((rec) => (
            <article key={rec.id} className="admin-rec">
              <div className="admin-rec-top">
                <span className={`admin-pill is-${rec.category.split(' ')[0].toLowerCase()}`}>{rec.category}</span>
                <span className="admin-rec-impact">{rec.impact}</span>
              </div>
              <h3>{rec.title}</h3>
              <p>{rec.evidence}</p>
              <div className="admin-rec-actions">
                {decisions[rec.id] ? (
                  <>
                    <span className="admin-muted">
                      {decisions[rec.id] === 'accepted' ? 'Accepted' : 'Rejected'}
                      {decisions[rec.id] === 'accepted' && rec.effect
                        ? ` · applied to ${rec.effect.kind === 'guardrail' ? 'Guardrails' : 'Org context'}`
                        : ''}
                    </span>
                    <button type="button" className="btn ghost btn-sm" onClick={() => onUndo(rec)}>
                      Undo
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn primary btn-sm" onClick={() => onDecide(rec, 'accepted')}>
                      Accept
                    </button>
                    <button type="button" className="btn ghost btn-sm" onClick={() => onDecide(rec, 'rejected')}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function GuardrailsSection({
  guardrails,
  onChange,
  onToast
}: {
  guardrails: Guardrails
  onChange: (g: Guardrails) => void
  onToast: (msg: string) => void
}) {
  const [saved, setSaved] = useState(guardrails)
  const [phrase, setPhrase] = useState('')
  const [pending, setPending] = useState(PENDING_SEQUENCES)
  const dirty = JSON.stringify(saved) !== JSON.stringify(guardrails)
  const set = <K extends keyof Guardrails>(key: K, value: Guardrails[K]) => onChange({ ...guardrails, [key]: value })

  function addPhrase() {
    const value = phrase.trim().toLowerCase()
    if (!value || guardrails.blockedPhrases.includes(value)) return
    set('blockedPhrases', [...guardrails.blockedPhrases, value])
    setPhrase('')
  }

  function review(id: string, approved: boolean) {
    const seq = pending.find((p) => p.id === id)
    setPending((list) => list.filter((p) => p.id !== id))
    if (seq) onToast(approved ? `Approved “${seq.name}”` : `Sent “${seq.name}” back to ${seq.rep.split(' ')[0]}`)
  }

  return (
    <div className="admin-panel">
      <p className="section-lede">
        These rules apply to every sequence a rep builds or launches, including ones drafted in Claude or ChatGPT.
        Admin-built sequences are exempt.
      </p>

      <div className="admin-card">
        <div className="admin-rule">
          <div>
            <strong>Require admin approval</strong>
            <p>New rep sequences wait for an admin before contacting anyone.</p>
          </div>
          <Toggle checked={guardrails.requireApproval} onChange={(v) => set('requireApproval', v)} label="Require approval" />
        </div>

        <div className="admin-rule">
          <div>
            <strong>Daily limits per rep</strong>
            <p>Sends pause for the day once a rep hits the cap.</p>
          </div>
          <div className="admin-inline-fields">
            <label className="context-field">
              Emails / day
              <input
                type="number"
                min={0}
                value={guardrails.dailyEmailCap}
                onChange={(e) => set('dailyEmailCap', Number(e.target.value))}
              />
            </label>
            <label className="context-field">
              Calls / day
              <input
                type="number"
                min={0}
                value={guardrails.dailyCallCap}
                onChange={(e) => set('dailyCallCap', Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="admin-rule">
          <div>
            <strong>Calling hours</strong>
            <p>In the recipient’s local time.</p>
          </div>
          <div className="admin-inline-fields">
            <label className="context-field">
              From
              <input type="time" value={guardrails.callStart} onChange={(e) => set('callStart', e.target.value)} />
            </label>
            <label className="context-field">
              To
              <input type="time" value={guardrails.callEnd} onChange={(e) => set('callEnd', e.target.value)} />
            </label>
          </div>
        </div>

        <div className="admin-rule">
          <div>
            <strong>Sequence length</strong>
            <p>Maximum steps a rep can add to one sequence.</p>
          </div>
          <div className="admin-inline-fields">
            <label className="context-field">
              Max steps
              <input
                type="number"
                min={1}
                max={20}
                value={guardrails.maxSteps}
                onChange={(e) => set('maxSteps', Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="admin-rule">
          <div>
            <strong>Allowed channels</strong>
            <p>Channels reps can use in their sequences.</p>
          </div>
          <div className="admin-checks">
            {(['Email', 'Calls', 'LinkedIn'] as const).map((ch) => (
              <label key={ch} className="admin-check">
                <input
                  type="checkbox"
                  checked={guardrails.channels[ch]}
                  onChange={(e) => set('channels', { ...guardrails.channels, [ch]: e.target.checked })}
                />
                {ch}
              </label>
            ))}
          </div>
        </div>

        <div className="admin-rule is-stacked">
          <div>
            <strong>Blocked phrases</strong>
            <p>Sequences containing these can’t launch until they’re removed.</p>
          </div>
          <div className="admin-chips">
            {guardrails.blockedPhrases.map((p) => (
              <span key={p} className="admin-chip">
                {p}
                <button
                  type="button"
                  aria-label={`Remove ${p}`}
                  onClick={() => set('blockedPhrases', guardrails.blockedPhrases.filter((x) => x !== p))}
                >
                  ×
                </button>
              </span>
            ))}
            <form
              className="admin-chip-add"
              onSubmit={(e) => {
                e.preventDefault()
                addPhrase()
              }}
            >
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Add a phrase" />
              <button type="submit" className="btn ghost btn-sm" disabled={!phrase.trim()}>
                Add
              </button>
            </form>
          </div>
        </div>

        <div className="admin-rule">
          <div>
            <strong>Unsubscribe link and suppression list</strong>
            <p>Always on for every email. Required for compliance.</p>
          </div>
          <span className="admin-locked">Always on</span>
        </div>

        <div className="admin-save">
          <span className="admin-muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button type="button" className="btn ghost btn-sm" disabled={!dirty} onClick={() => onChange(saved)}>
            Discard
          </button>
          <button
            type="button"
            className="btn primary btn-sm"
            disabled={!dirty}
            onClick={() => {
              setSaved(guardrails)
              onToast('Guardrails saved')
            }}
          >
            Save guardrails
          </button>
        </div>
      </div>

      <div className="section-heading admin-subhead">
        <h2>Waiting for approval</h2>
        <p className="section-lede">Rep sequences held by the approval guardrail.</p>
      </div>
      {pending.length === 0 ? (
        <p className="section-lede admin-empty">No sequences waiting.</p>
      ) : (
        <ul className="build-list">
          {pending.map((seq) => (
            <li key={seq.id} className="build-row admin-approval">
              <div>
                <strong>{seq.name}</strong>
                <p>
                  {seq.rep} · {seq.steps} steps · {seq.channels} · {seq.submitted}
                </p>
                {seq.flags.length ? (
                  <ul className="admin-flags">
                    {seq.flags.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-ok">Passes all guardrails</p>
                )}
              </div>
              <div className="admin-rec-actions">
                <button type="button" className="btn primary btn-sm" onClick={() => review(seq.id, true)}>
                  Approve
                </button>
                <button type="button" className="btn ghost btn-sm" onClick={() => review(seq.id, false)}>
                  Send back
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ContextSection({
  fields,
  onChange,
  onToast
}: {
  fields: ContextField[]
  onChange: (fields: ContextField[]) => void
  onToast: (msg: string) => void
}) {
  const [saved, setSaved] = useState(fields)
  const dirty = JSON.stringify(saved) !== JSON.stringify(fields)
  const update = (id: string, patch: Partial<ContextField>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  return (
    <div className="admin-panel">
      <p className="section-lede">
        Shared context Jargon uses when drafting any sequence in your workspace. Locked fields can’t be overridden by
        reps in their own sequences.
      </p>
      <div className="admin-context">
        {fields.map((field) => (
          <div key={field.id} className="admin-card admin-context-field">
            <div className="admin-context-head">
              <div>
                <strong>{field.label}</strong>
                <p>{field.hint}</p>
              </div>
              <span className="admin-lock">
                <Toggle
                  checked={field.locked}
                  onChange={(locked) => update(field.id, { locked })}
                  label={`Lock ${field.label}`}
                />
                {field.locked ? 'Locked for reps' : 'Reps can edit'}
              </span>
            </div>
            <textarea
              value={field.value}
              rows={Math.max(3, field.value.split('\n').length + 1)}
              onChange={(e) => update(field.id, { value: e.target.value })}
            />
            <span className="admin-muted">
              Updated by {field.updatedBy} · {field.updatedAt}
            </span>
          </div>
        ))}
      </div>
      <div className="admin-save is-sticky">
        <span className="admin-muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button type="button" className="btn ghost btn-sm" disabled={!dirty} onClick={() => onChange(saved)}>
          Discard
        </button>
        <button
          type="button"
          className="btn primary btn-sm"
          disabled={!dirty}
          onClick={() => {
            const stamped = fields.map((f, i) =>
              JSON.stringify(f) === JSON.stringify(saved[i]) ? f : { ...f, updatedBy: 'You', updatedAt: 'Just now' }
            )
            onChange(stamped)
            setSaved(stamped)
            onToast('Org context saved')
          }}
        >
          Save context
        </button>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`admin-toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}
