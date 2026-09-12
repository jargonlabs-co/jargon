import { useMemo, useState } from 'react'
import type { Channel, Contact, ProjectBundle } from '../../../api/client'
import {
  channelLabel,
  hasChannel,
  motionComplete,
  nextChannel,
  specOf
} from '../../../lib/workspaceSpec'

interface Props {
  bundle: ProjectBundle
  onCall: (contactId: string) => void
  onEmail: (contactId: string) => void
  onLinkedIn?: (contactId: string) => void
  onOpenSequence?: () => void
  onConnectData?: () => void
}

function progressLabel(c: Contact, spec: ReturnType<typeof specOf>): string {
  if (motionComplete(c, spec)) return 'Done'
  const next = nextChannel(c, spec)
  if (c.status === 'active') return next ? `Up next · ${channelLabel(next)}` : 'Up next'
  const done = c.channelsDone ?? []
  if (done.length) return `${done.map(channelLabel).join(', ')} done`
  return 'Queued'
}

export function TodayQueuePage({
  bundle,
  onCall,
  onEmail,
  onLinkedIn,
  onOpenSequence,
  onConnectData
}: Props) {
  const [starting, setStarting] = useState(false)
  const spec = specOf(bundle.project)

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
    () => contacts.filter((c) => !motionComplete(c, spec)),
    [contacts, spec]
  )
  const remaining = remainingContacts.length
  const nextContact = remainingContacts[0] ?? null
  const started = remaining < contacts.length

  function runAction(contactId: string, channel: Channel | null) {
    if (channel === 'call') onCall(contactId)
    else if (channel === 'linkedin' && onLinkedIn) onLinkedIn(contactId)
    else onEmail(contactId)
  }

  async function startTodaysTasks() {
    if (!nextContact || starting) return
    setStarting(true)
    try {
      runAction(nextContact.id, nextChannel(nextContact, spec))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="today-queue">
      <header className="today-hero">
        <div>
          <p className="eyebrow">Daily tasks</p>
          <h2>
            {contacts.length === 0
              ? 'Connect HubSpot to fill this queue'
              : started
                ? 'Continue today’s outreach'
                : 'Start today’s outreach'}
          </h2>
          <p className="lede">
            {contacts.length === 0 ? (
              <>
                This tool doesn’t supply leads. Load contacts from your HubSpot portal, then run{' '}
                {spec.channels.map(channelLabel).join(', ')} through Jargon.
              </>
            ) : (
              <>
                {remaining} of {contacts.length} people left in{' '}
                <strong>{sequence?.name ?? 'your sequence'}</strong>.
              </>
            )}
          </p>
          {contacts.length === 0 && onConnectData ? (
            <div className="today-primary-actions">
              <button type="button" className="prod-btn primary" onClick={onConnectData}>
                Connect HubSpot
              </button>
            </div>
          ) : null}
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
          {hasChannel(spec, 'call') ? (
            <div>
              <strong>{contacts.filter((c) => (c.channelsDone ?? []).includes('call')).length}</strong>
              <span>called</span>
            </div>
          ) : null}
          {hasChannel(spec, 'email') ? (
            <div>
              <strong>{contacts.filter((c) => (c.channelsDone ?? []).includes('email')).length}</strong>
              <span>emailed</span>
            </div>
          ) : null}
          {hasChannel(spec, 'linkedin') ? (
            <div>
              <strong>
                {contacts.filter((c) => (c.channelsDone ?? []).includes('linkedin')).length}
              </strong>
              <span>LinkedIn</span>
            </div>
          ) : null}
        </div>
      </header>

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
                  <span className={`pill status-${c.status}`}>{progressLabel(c, spec)}</span>
                </td>
                <td className="today-actions">
                  {hasChannel(spec, 'email') ? (
                    <button
                      type="button"
                      disabled={(c.channelsDone ?? []).includes('email')}
                      onClick={() => onEmail(c.id)}
                    >
                      {(c.channelsDone ?? []).includes('email') ? 'Emailed' : 'Email'}
                    </button>
                  ) : null}
                  {hasChannel(spec, 'call') ? (
                    <button
                      type="button"
                      disabled={(c.channelsDone ?? []).includes('call')}
                      onClick={() => onCall(c.id)}
                    >
                      {(c.channelsDone ?? []).includes('call') ? 'Called' : 'Call'}
                    </button>
                  ) : null}
                  {hasChannel(spec, 'linkedin') ? (
                    <button
                      type="button"
                      disabled={(c.channelsDone ?? []).includes('linkedin')}
                      onClick={() => (onLinkedIn ? onLinkedIn(c.id) : onEmail(c.id))}
                    >
                      {(c.channelsDone ?? []).includes('linkedin') ? 'Sent LI' : 'LinkedIn'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
