import type { Contact, ContactStatus } from '../../api/client'

export type DialerPhase = 'idle' | 'dialing' | 'ringing' | 'connected' | 'completed'

interface Props {
  open: boolean
  contact: Contact
  phase: DialerPhase
  seconds: number
  modeLabel: string
  readOnly?: boolean
  busy?: boolean
  onClose: () => void
  onStart: () => void
  onDisposition: (status: ContactStatus) => void
}

function formatTime(total: number): string {
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function phaseLabel(phase: DialerPhase): string {
  switch (phase) {
    case 'dialing':
      return 'Dialing…'
    case 'ringing':
      return 'Ringing…'
    case 'connected':
      return 'Live call'
    case 'completed':
      return 'Call ended'
    default:
      return 'Ready to dial'
  }
}

export function RepLiveDialer({
  open,
  contact,
  phase,
  seconds,
  modeLabel,
  readOnly,
  busy,
  onClose,
  onStart,
  onDisposition
}: Props) {
  if (!open) return null

  const live = phase === 'connected'
  const connecting = phase === 'dialing' || phase === 'ringing'
  const idle = phase === 'idle' || phase === 'completed'

  return (
    <div className="rep-dialer-backdrop" onClick={onClose}>
      <div
        className={`rep-dialer ${live ? 'live' : ''} ${connecting ? 'connecting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Live dialer"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rep-dialer-header">
          <div className="rep-dialer-status">
            {live ? <span className="rep-dialer-live-dot" aria-hidden="true" /> : null}
            <span>{phaseLabel(phase)}</span>
          </div>
          <button type="button" className="rep-dialer-close" onClick={onClose} aria-label="Close dialer">
            ✕
          </button>
        </header>

        <div className="rep-dialer-body">
          <div className={`rep-dialer-avatar-wrap ${connecting ? 'pulse-ring' : ''}`}>
            <span className="rep-dialer-avatar">{initials(contact.name)}</span>
          </div>
          <h3>{contact.name}</h3>
          <p className="rep-dialer-role">
            {contact.title || 'Contact'} · {contact.accountName ?? contact.company}
          </p>
          <p className="rep-dialer-number">{contact.phone || 'No number on file'}</p>

          {live ? <div className="rep-dialer-timer">{formatTime(seconds)}</div> : null}
          {connecting ? (
            <p className="rep-dialer-connecting">
              <span className="pulse" /> Connecting via {modeLabel}…
            </p>
          ) : null}

          <div className="rep-dialer-keypad" aria-hidden={!live}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '✱', '0', '#'].map((key) => (
              <button key={key} type="button" className="rep-dialer-key" disabled={!live || readOnly}>
                {key}
              </button>
            ))}
          </div>

          {idle && !readOnly ? (
            <button
              type="button"
              className="rep-dialer-start"
              disabled={busy || !contact.phone}
              onClick={onStart}
            >
              Start call
            </button>
          ) : null}

          {readOnly && idle ? (
            <button type="button" className="rep-dialer-start" onClick={onStart}>
              Simulate live call
            </button>
          ) : null}

          {(live || phase === 'completed') && !readOnly ? (
            <div className="rep-dialer-dispositions">
              <button type="button" className="rep-dialer-disposition primary" disabled={busy} onClick={() => onDisposition('interested')}>
                Interested
              </button>
              <button type="button" className="rep-dialer-disposition" disabled={busy} onClick={() => onDisposition('no_answer')}>
                No answer
              </button>
              <button type="button" className="rep-dialer-disposition" disabled={busy} onClick={() => onDisposition('not_interested')}>
                Not interested
              </button>
              <button type="button" className="rep-dialer-disposition" disabled={busy} onClick={() => onDisposition('completed')}>
                Complete
              </button>
            </div>
          ) : null}

          {live && readOnly ? (
            <footer className="rep-dialer-preview-note">Preview mode — disposition actions disabled</footer>
          ) : null}

          {(live || connecting) && (
            <button
              type="button"
              className="rep-dialer-hangup"
              onClick={onClose}
              aria-label="Hang up"
            >
              End call
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
