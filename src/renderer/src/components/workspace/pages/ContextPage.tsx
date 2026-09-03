import { ConnectedContextSection } from '../ConnectedContextSection'
import type { ProjectBundle } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onContinue: () => void
}

export function ContextPage({ bundle, onContinue }: Props) {
  const isDialer = bundle.project.kind === 'dialer'
  const isToday = bundle.project.kind === 'today'

  return (
    <div className="prod-view">
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Context</div>
          <h2>Connected to this {isDialer ? 'dialer' : 'workspace'}</h2>
          <p className="muted" style={{ marginTop: 8, maxWidth: 560 }}>
            {bundle.project.name} reads people from HubSpot. Email, calls, and LinkedIn go out
            through Jargon.
          </p>
        </div>
        <div className="prod-view-actions">
          <button className="prod-btn primary" onClick={onContinue}>
            {isToday ? 'Start sequence' : isDialer ? 'Open dial console' : 'Continue'}
          </button>
        </div>
      </div>

      <ConnectedContextSection />
    </div>
  )
}
