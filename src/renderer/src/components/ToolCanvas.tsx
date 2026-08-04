import { ProductApp } from './workspace/ProductApp'

interface Props {
  projectId: string | null
  phase: 'idle' | 'clarifying' | 'building' | 'ready'
  fullscreen?: boolean
}

export function ToolCanvas({ projectId, phase, fullscreen = false }: Props) {
  const showChrome = !projectId && !fullscreen

  return (
    <section
      className={`tool-canvas ${projectId || fullscreen ? 'tool-canvas-filled' : ''} ${fullscreen ? 'tool-canvas-fullscreen' : ''}`}
    >
      {showChrome ? (
        <div className="panel-header">
          <span className="panel-title">Canvas</span>
          {phase === 'clarifying' ? (
            <span className="status-pill status-draft">clarifying</span>
          ) : null}
          {phase === 'building' ? (
            <span className="status-pill status-running">building</span>
          ) : null}
        </div>
      ) : null}

      {phase === 'building' && !projectId ? (
        <div className="canvas-empty">
          <div className="build-progress">
            <div className="build-bar" />
          </div>
          <h2>Building your outbound tool…</h2>
          <p>Provisioning campaigns, contacts, and simulated dial/email engines.</p>
        </div>
      ) : !projectId ? (
        <div className="canvas-empty">
          <div className="canvas-empty-mark">J</div>
          <h2>Your tools appear here</h2>
          <p>
            {phase === 'clarifying'
              ? 'Answer the follow-ups in chat — then Jargon will assemble a full outbound product.'
              : 'Describe an outbound tool in the composer. Jargon will clarify, then build.'}
          </p>
        </div>
      ) : (
        <div className="canvas-body workspace-host filled">
          <ProductApp projectId={projectId} />
        </div>
      )}
    </section>
  )
}
