import { useEffect, useState } from 'react'
import { api, type AccountSnapshot, type AccountUsage, type UsageRange } from '../../api'
import { formatCredits, formatWhen } from './nav'

type WindowId = 'period' | '7d' | '30d' | '90d' | 'month' | 'custom'

const WINDOWS: Array<{ id: WindowId; label: string }> = [
  { id: 'period', label: 'Billing period' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' }
]

const MAX_RANGE_DAYS = 366
const DAY_MS = 86_400_000

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

function lastDays(n: number): UsageRange {
  const now = Date.now()
  return { from: utcDay(now - (n - 1) * DAY_MS), to: utcDay(now) }
}

function presetRange(id: WindowId): UsageRange | null {
  if (id === '7d') return lastDays(7)
  if (id === '30d') return lastDays(30)
  if (id === '90d') return lastDays(90)
  if (id === 'month') {
    const today = utcDay(Date.now())
    return { from: `${today.slice(0, 8)}01`, to: today }
  }
  return null
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function customRangeError(range: UsageRange): string | null {
  if (!range.from || !range.to) return 'Pick a start and end date.'
  if (range.from > range.to) return 'Start date must be on or before the end date.'
  if (daysBetween(range.from, range.to) > MAX_RANGE_DAYS) return `Windows are limited to ${MAX_RANGE_DAYS} days.`
  return null
}

/** Preview mode has no API; slice the sample snapshot locally. */
function previewUsage(base: AccountUsage, range: UsageRange): AccountUsage {
  const daily = base.daily.filter((row) => row.day >= range.from && row.day <= range.to)
  const totals = daily.reduce(
    (acc, row) => ({
      credits: acc.credits + row.credits,
      emails: acc.emails + row.emails,
      calls: acc.calls + row.calls,
      linkedin: acc.linkedin + row.linkedin
    }),
    { credits: 0, emails: 0, calls: 0, linkedin: 0 }
  )
  return { ...base, range, daily, totals, byProject: daily.length ? base.byProject : [] }
}

export function UsagePage({ snapshot, preview = false }: { snapshot: AccountSnapshot; preview?: boolean }) {
  const { catalog } = snapshot
  const [windowId, setWindowId] = useState<WindowId>('period')
  const [range, setRange] = useState<UsageRange | null>(null)
  const [draft, setDraft] = useState<UsageRange>(() => lastDays(30))
  const [draftError, setDraftError] = useState<string | null>(null)
  const [fetched, setFetched] = useState<AccountUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!range) {
      setFetched(null)
      setError(null)
      return
    }
    if (preview) {
      setFetched(previewUsage(snapshot.usage, range))
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .accountUsage(range)
      .then((result) => {
        if (!cancelled) setFetched(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load usage')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, preview, snapshot.usage])

  function selectWindow(id: WindowId) {
    setWindowId(id)
    setDraftError(null)
    if (id === 'custom') {
      if (!customRangeError(draft)) setRange({ ...draft })
      return
    }
    setRange(presetRange(id))
  }

  function applyCustom() {
    const problem = customRangeError(draft)
    setDraftError(problem)
    if (!problem) setRange({ ...draft })
  }

  const usage = range ? fetched : snapshot.usage
  const today = utcDay(Date.now())
  const windowLabel = range
    ? `${formatDay(range.from)} – ${formatDay(range.to)}`
    : `${formatWhen(snapshot.usage.periodStart)} – ${formatWhen(snapshot.usage.periodEnd)}`

  return (
    <section className="webapp-section">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Usage</h1>
        <p className="section-lede">
          Live email is {catalog.costs.email} credit, a call is {catalog.costs.call}, LinkedIn is{' '}
          {catalog.costs.linkedin}. Reads, deploys, and sandbox keys are free.
        </p>
      </div>

      <div className="usage-window" role="group" aria-label="Usage window">
        {WINDOWS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`btn btn-sm ${windowId === option.id ? 'primary' : 'ghost'}`}
            aria-pressed={windowId === option.id}
            onClick={() => selectWindow(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {windowId === 'custom' ? (
        <div className="usage-window-custom">
          <label className="context-field">
            From
            <input
              type="date"
              value={draft.from}
              max={draft.to || today}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className="context-field">
            To
            <input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              max={today}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
          <button type="button" className="btn primary btn-sm" onClick={applyCustom}>
            Apply
          </button>
        </div>
      ) : null}
      {draftError ? <p className="usage-window-error">{draftError}</p> : null}

      <p className="usage-window-label">
        Showing {windowLabel}
        {range ? ' (UTC days)' : ''}
        {loading ? ' · Loading…' : ''}
      </p>

      {error ? <p className="usage-window-error">{error}</p> : null}

      {usage ? (
        <>
          <div className="account-stat-grid">
            <article className="account-stat">
              <p className="account-stat-label">Credits spent</p>
              <p className="account-stat-value">{formatCredits(usage.totals.credits)}</p>
            </article>
            <article className="account-stat">
              <p className="account-stat-label">Emails</p>
              <p className="account-stat-value">{usage.totals.emails}</p>
            </article>
            <article className="account-stat">
              <p className="account-stat-label">Calls</p>
              <p className="account-stat-value">{usage.totals.calls}</p>
            </article>
            <article className="account-stat">
              <p className="account-stat-label">LinkedIn</p>
              <p className="account-stat-value">{usage.totals.linkedin}</p>
            </article>
          </div>

          <div className="section-heading" style={{ marginTop: 36 }}>
            <h2>By sequence</h2>
          </div>
          {usage.byProject.length === 0 ? (
            <p className="section-lede">No live usage in this window.</p>
          ) : (
            <ul className="build-list">
              {usage.byProject.map((row) => (
                <li key={row.projectId} className="build-row">
                  <div>
                    <strong>{row.projectName}</strong>
                    <p>
                      {row.emails} email · {row.calls} calls · {row.linkedin} LinkedIn
                    </p>
                  </div>
                  <span className="account-inline-metric">{formatCredits(row.credits)} cr</span>
                </li>
              ))}
            </ul>
          )}

          <div className="section-heading" style={{ marginTop: 36 }}>
            <h2>Daily</h2>
          </div>
          {usage.daily.length === 0 ? (
            <p className="section-lede">No daily totals in this window.</p>
          ) : (
            <ul className="build-list">
              {usage.daily.map((row) => (
                <li key={row.day} className="build-row">
                  <div>
                    <strong>{formatDay(row.day)}</strong>
                    <p>
                      {row.emails} email · {row.calls} calls · {row.linkedin} LinkedIn
                    </p>
                  </div>
                  <span className="account-inline-metric">{formatCredits(row.credits)} cr</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  )
}
