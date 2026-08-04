import { useEffect, useMemo, useState } from 'react'
import type { ProjectKind } from '../api/types'
import { relativeTime } from '../lib/persistence'

export interface SidebarProject {
  id: string
  name: string
  kind: ProjectKind
  updatedAt: number
  createdAt: number
  segment: string
  team: string
}

interface Props {
  tools: SidebarProject[]
  activeToolId: string | null
  drafting: boolean
  collapsed?: boolean
  workspaceName?: string
  onNewProject: () => void
  onSelectTool: (id: string) => void
  onDeleteTool: (id: string) => void
  onToggleCollapse: () => void
}

export function Sidebar({
  tools,
  activeToolId,
  drafting,
  collapsed = false,
  workspaceName = 'jargon',
  onNewProject,
  onSelectTool,
  onDeleteTool,
  onToggleCollapse
}: Props) {
  const [query, setQuery] = useState('')
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = !q
      ? tools
      : tools.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.segment.toLowerCase().includes(q) ||
            t.kind.toLowerCase().includes(q)
        )
    return [...list].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
  }, [tools, query])

  if (collapsed) {
    return (
      <button
        className="sidebar-expand-fab"
        onClick={onToggleCollapse}
        title="Show projects"
        aria-label="Expand sidebar"
      >
        »»
      </button>
    )
  }

  return (
    <aside className="sidebar project-sidebar">
      <div className="sidebar-actions">
        <div className="sidebar-actions-row">
          <button className="sidebar-action primary" onClick={onNewProject}>
            <span className="sidebar-action-icon">+</span>
            New project
          </button>
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            ««
          </button>
        </div>
        <div className="sidebar-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search projects"
          />
        </div>
      </div>

      <div className="sidebar-section-block">
        <button className="sidebar-section-toggle" onClick={() => setProjectsOpen((v) => !v)}>
          <span className={`chev ${projectsOpen ? 'open' : ''}`}>▾</span>
          Projects
          <span className="sidebar-section-count">{tools.length}</span>
        </button>

        {projectsOpen ? (
          <div className="project-tree">
            <button className="workspace-folder" onClick={() => setWorkspaceOpen((v) => !v)}>
              <span className={`chev small ${workspaceOpen ? 'open' : ''}`}>▾</span>
              <span className="folder-icon">📁</span>
              <span className="folder-name">{workspaceName}</span>
            </button>

            {workspaceOpen ? (
              <div className="project-children">
                {drafting ? (
                  <div className="project-row drafting">
                    <span className="project-row-icon">✦</span>
                    <span className="project-row-name">New outbound tool…</span>
                    <span className="project-row-time">now</span>
                  </div>
                ) : null}

                {filtered.length === 0 && !drafting ? (
                  <div className="sidebar-empty nested">
                    No projects yet — describe one in chat to save it here.
                  </div>
                ) : (
                  filtered.map((tool) => (
                    <div
                      key={tool.id}
                      className={tool.id === activeToolId ? 'project-row active' : 'project-row'}
                      onClick={() => onSelectTool(tool.id)}
                      title={tool.name}
                    >
                      <span className="project-row-icon">{kindGlyph(tool.kind)}</span>
                      <span className="project-row-name">{tool.name}</span>
                      <span className="project-row-time">
                        {relativeTime(tool.updatedAt ?? tool.createdAt, now)}
                      </span>
                      <button
                        className="project-row-delete"
                        title="Remove project"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteTool(tool.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="sidebar-section-block">
        <div className="sidebar-section-toggle static">
          <span className="chev open">▾</span>
          Home
        </div>
        <div className="project-children home">
          <div className="project-row muted-row">
            <span className="project-row-icon">⌂</span>
            <span className="project-row-name">Jargon workspace</span>
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-user">
          <div className="sidebar-footer-avatar">J</div>
          <div>
            <div className="sidebar-footer-name">Jargon</div>
            <div className="sidebar-footer-plan">Local simulated API</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function kindGlyph(kind: ProjectKind): string {
  switch (kind) {
    case 'dialer':
      return '☎'
    case 'sequencer':
      return '✉'
    case 'cadence':
      return '↻'
    case 'list':
      return '▤'
    default:
      return '◆'
  }
}
