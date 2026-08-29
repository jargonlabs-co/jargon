import { useEffect, useMemo, useState } from 'react'
import type { Contact, ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onRefresh: () => Promise<ProjectBundle>
  onCall: (contactId: string) => void
  onEmail: (contactId: string) => void
  onOpenSequence?: () => void
}

function channelDone(c: Contact, channel: 'call' | 'email'): boolean {
  return (c.channelsDone ?? []).includes(channel)
}

function progressLabel(c: Contact): string {
  const call = channelDone(c, 'call')
  const email = channelDone(c, 'email')
  if (call && email) return 'Done'
  if (call) return 'Called · email left'
  if (email) return 'Emailed · call left'
  if (c.status === 'active') return 'Up next'
  return 'Queued'
}

function nextAction(c: Contact, steps: ProjectBundle['steps']): 'email' | 'call' {
  const step = steps[c.stepIndex ?? 0]
  if (step?.channel === 'call' && !channelDone(c, 'call')) return 'call'
  if (step?.channel === 'email' && !channelDone(c, 'email')) return 'email'
  if (!channelDone(c, 'email')) return 'email'
  return 'call'
}

export function TodayQueuePage({ bundle, onRefresh, onCall, onEmail, onOpenSequence }: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [starting, setStarting] = useState(false)

  const sequence = bundle.sequences[0]
  const steps = useMemo(
    () =>
      bundle.steps
        .filter((s) => s.sequenceId === sequence?.id)
        .sort((a, b) => a.order - b.order),
    [bundle.steps, sequence?.id]
  )

  const contacts = useMemo(
    () =>
      [...bundle.contacts].sort((a, b) => {
        const rank = (c: Contact) =>
          c.status === 'active' ? 0 : c.status === 'queued' ? 1 : 2
        return rank(a) - rank(b) || a.name.localeCompare(b.name)
      }),
    [bundle.contacts]
  )

  const remainingContacts = useMemo(
    () => contacts.filter((c) => !(channelDone(c, 'call') && channelDone(c, 'email'))),
    [contacts]
  )
  const remaining = remainingContacts.length
  const called = contacts.filter((c) => channelDone(c, 'call')).length
  const emailed = contacts.filter((c) => channelDone(c, 'email')).length
  const nextContact = remainingContacts[0] ?? null
  const started = remaining < contacts.length

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(id)
  }, [toast])

  async function resync() {
    setSyncing(true)
    try {
      await api.syncApollo({
        projectId: bundle.project.id,
        limit: Number(bundle.project.answers.prospect_count ?? 100)
      })
      await onRefresh()
      setToast('Prospect list refreshed')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function startTodaysTasks() {
    if (!nextContact || starting) return
    setStarting(true)
    try {
      const action = nextAction(nextContact, steps)
      if (action === 'email') onEmail(nextContact.id)
      else onCall(nextContact.id)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="today-queue">
      <header className="today-hero">
        <div>
          <p className="eyebrow">Daily tasks</p>
          <h2>{started ? 'Continue today’s outreach' : 'Start today’s outreach'}</h2>
          <p className="lede">
            {remaining} of {contacts.length} prospects left in{' '}
            <strong>{sequence?.name ?? 'your sequence'}</strong>. Work email and phone for each
            contact before you close the day.
          </p>
          {steps.length > 0 ? (
            <ol className="today-seq-steps">
              {steps.map((s) => (
                <li key={s.id}>
                  <span className={`channel-badge channel-${s.channel}`}>{s.channel}</span>
                  <span>
                    Day {s.day}: {s.label}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="today-primary-actions">
            <button
              type="button"
              className="prod-btn primary"
              disabled={!nextContact || starting}
              onClick={() => void startTodaysTasks()}
            >
              {starting
                ? 'Opening…'
                : !nextContact
                  ? 'All tasks done'
                  : started
                    ? `Continue with ${nextContact.name}`
                    : `Start with ${nextContact.name}`}
            </button>
            {onOpenSequence ? (
              <button type="button" className="ghost-btn" onClick={onOpenSequence}>
                View sequence
              </button>
            ) : null}
          </div>
        </div>
        <div className="today-stats">
          <div>
            <strong>{remaining}</strong>
            <span>remaining</span>
          </div>
          <div>
            <strong>{called}</strong>
            <span>called</span>
          </div>
          <div>
            <strong>{emailed}</strong>
            <span>emailed</span>
          </div>
          <div className="today-stat-actions">
            <button type="button" className="ghost-btn" onClick={() => void resync()} disabled={syncing}>
              {syncing ? 'Refreshing…' : 'Refresh prospects'}
            </button>
          </div>
        </div>
      </header>

      {toast ? <div className="toast">{toast}</div> : null}

      <div className="today-table-wrap">
        <table className="today-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Prospect</th>
              <th>Account</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={c.id} className={c.status === 'active' ? 'is-active' : undefined}>
                <td>{i + 1}</td>
                <td>
                  <div className="today-person">
                    <strong>{c.name}</strong>
                    <span>
                      {c.title}
                      {c.city ? ` · ${c.city}` : ''}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="today-person">
                    <strong>{c.accountName ?? c.company}</strong>
                    <span>{c.companyIndustry ?? 'computer software'}</span>
                  </div>
                </td>
                <td>
                  <span className={`pill status-${c.status}`}>{progressLabel(c)}</span>
                </td>
                <td className="today-actions">
                  <button
                    type="button"
                    disabled={channelDone(c, 'email')}
                    onClick={() => onEmail(c.id)}
                  >
                    {channelDone(c, 'email') ? 'Emailed' : 'Email'}
                  </button>
                  <button
                    type="button"
                    disabled={channelDone(c, 'call')}
                    onClick={() => onCall(c.id)}
                  >
                    {channelDone(c, 'call') ? 'Called' : 'Call'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
