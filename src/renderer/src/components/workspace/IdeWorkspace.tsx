import { useEffect, useState } from 'react'
import type { ProjectBundle } from '../../api/client'
import { api } from '../../api/client'
import { SourcesWorkspacePage } from './pages/SourcesWorkspacePage'
import { WorkflowWorkspacePage } from './pages/WorkflowWorkspacePage'
import { ToolWorkspacePage } from './pages/ToolWorkspacePage'
import { RunsWorkspacePage } from './pages/RunsWorkspacePage'

export type IdeTab = 'sources' | 'workflow' | 'tool' | 'runs'

const TABS: Array<{ id: IdeTab; label: string }> = [
  { id: 'sources', label: 'Sources' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'tool', label: 'Tool' },
  { id: 'runs', label: 'Runs' }
]

interface Props {
  projectId: string
  onOpenConnections?: () => void
}

export function IdeWorkspace({ projectId, onOpenConnections }: Props) {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<IdeTab>('workflow')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setTab('workflow')
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
  }, [projectId])

  if (loading) {
    return (
      <div className="ide-workspace ide-loading">
        <div className="build-progress">
          <div className="build-bar" />
        </div>
        <p>Loading workspace…</p>
      </div>
    )
  }

  if (error || !bundle) {
    return (
      <div className="ide-workspace ide-loading">
        <h3>Couldn’t load project</h3>
        <p>{error ?? 'Unknown error'}</p>
      </div>
    )
  }

  return (
    <div className="ide-workspace">
      <header className="ide-workspace-header">
        <div className="ide-workspace-meta">
          <div className="ide-workspace-name">{bundle.project.name}</div>
          <div className="ide-workspace-sub">
            {bundle.project.segment || 'GTM workspace'}
            {bundle.project.team ? ` · ${bundle.project.team}` : ''}
          </div>
        </div>
        <nav className="ide-tabs" aria-label="Workspace views">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'ide-tab active' : 'ide-tab'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="ide-workspace-body">
        {tab === 'sources' ? (
          <SourcesWorkspacePage bundle={bundle} onOpenConnections={onOpenConnections} />
        ) : null}
        {tab === 'workflow' ? <WorkflowWorkspacePage bundle={bundle} /> : null}
        {tab === 'tool' ? <ToolWorkspacePage bundle={bundle} /> : null}
        {tab === 'runs' ? <RunsWorkspacePage bundle={bundle} /> : null}
      </div>
    </div>
  )
}
