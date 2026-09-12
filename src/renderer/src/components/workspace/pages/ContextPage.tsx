import { ConnectedContextSection } from '../ConnectedContextSection'
import type { ProjectBundle } from '../../../api/client'
import { formatChannels, specOf, workspaceKindLabel } from '../../../lib/workspaceSpec'

interface Props {
  bundle: ProjectBundle
  onContinue: () => void
}

export function ContextPage({ bundle, onContinue }: Props) {
  const spec = specOf(bundle.project)
  const kind = workspaceKindLabel(spec)
  const continueLabel =
    spec.primarySurface === 'dial'
      ? 'Open dial console'
      : spec.primarySurface === 'linkedin'
        ? 'Open LinkedIn queue'
        : spec.primarySurface === 'inbox'
          ? 'Open inbox'
          : 'Start sequence'

  return (
    <div className="prod-view">
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Context</div>
          <h2>Connected to this {kind.toLowerCase()}</h2>
          <p className="muted" style={{ marginTop: 8, maxWidth: 560 }}>
            {bundle.project.name} reads people from your connected list. {formatChannels(spec.channels)}{' '}
            run through Jargon.
          </p>
        </div>
        <div className="prod-view-actions">
          <button className="prod-btn primary" onClick={onContinue}>
            {continueLabel}
          </button>
        </div>
      </div>

      <ConnectedContextSection />
    </div>
  )
}
