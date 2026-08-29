import { useEffect, useState } from 'react'
import type { ProjectBundle } from '../api/client'
import { api } from '../api/client'
import type { PaletteItem } from '../lib/board'
import { BoardCanvas, type BoardPromptApply } from './workspace/BoardCanvas'
import { ConnectionsPage } from './workspace/pages/ConnectionsPage'

interface Props {
  projectId: string | null
  phase: 'idle' | 'clarifying' | 'building' | 'ready'
  mode?: 'workspace' | 'connections'
  pendingAdd?: PaletteItem | null
  onPendingAddConsumed?: () => void
  pendingPrompt?: BoardPromptApply | null
  onPendingPromptConsumed?: () => void
  onOpenConnections?: () => void
}

export function ToolCanvas({
  projectId,
  phase,
  mode = 'workspace',
  pendingAdd,
  onPendingAddConsumed,
  pendingPrompt,
  onPendingPromptConsumed,
  onOpenConnections
}: Props) {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mode !== 'workspace' || !projectId) {
      setBundle(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getProject(projectId)
      .then((next) => {
        if (!cancelled) setBundle(next)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, mode])

  if (mode === 'connections') {
    return (
      <section className="tool-canvas tool-canvas-filled ide-canvas board-canvas-host">
        <div className="canvas-body workspace-host filled">
          <div className="ide-connections-host">
            <ConnectionsPage />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      className={`tool-canvas ide-canvas board-canvas-host ${projectId || phase === 'building' ? 'tool-canvas-filled' : ''}`}
    >
      {phase === 'building' && !projectId ? (
        <div className="canvas-empty">
          <div className="build-progress">
            <div className="build-bar" />
          </div>
          <h2>Scaffolding tool…</h2>
          <p>Opening a blank canvas you can compose from the Palette or chat.</p>
        </div>
      ) : loading ? (
        <div className="canvas-empty">
          <div className="build-progress">
            <div className="build-bar" />
          </div>
          <p>Loading tool…</p>
        </div>
      ) : error ? (
        <div className="canvas-empty">
          <h2>Couldn’t load tool</h2>
          <p>{error}</p>
        </div>
      ) : bundle && projectId ? (
        <div className="canvas-body workspace-host filled">
          <BoardCanvas
            bundle={bundle}
            onBundleChange={setBundle}
            onOpenConnections={onOpenConnections}
            pendingAdd={pendingAdd}
            onPendingAddConsumed={onPendingAddConsumed}
            pendingPrompt={pendingPrompt}
            onPendingPromptConsumed={onPendingPromptConsumed}
          />
        </div>
      ) : (
        <div className="canvas-empty board-home-empty studio-home-empty">
          <div className="canvas-empty-mark">J</div>
          <p className="studio-home-kicker">RevOps studio</p>
          <h2>Build tools for your reps</h2>
          <p>
            Open or create a tool, connect context, then compose with the Palette — or describe the
            surface in chat and refine it here.
          </p>
        </div>
      )}
    </section>
  )
}
