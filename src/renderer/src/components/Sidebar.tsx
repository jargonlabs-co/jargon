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
  orgLabel?: string
  userLabel?: string
  connectionsActive?: boolean
  onNewProject: () => void
  onSelectTool: (id: string) => void
  onDeleteTool: (id: string) => void
  onToggleCollapse: () => void
  onOpenConnections?: () => void
  onSignOut?: () => void
}

export function Sidebar({
  tools,
  activeToolId,
  drafting,
  collapsed = false,
  workspaceName = 'jargon',
  orgLabel,
  userLabel,
  connectionsActive = false,
  onNewProject,
  onSelectTool,
  onDeleteTool,
  onToggleCollapse,
  onOpenConnections,
  onSignOut
}: Props) {
  const [query, setQuery] = useState('')
  const [toolsOpen, setToolsOpen] = useState(true)
  const [folderOpen, setFolderOpen] = useState(true)
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
        title="Show studio"
        aria-label="Expand sidebar"
      >
        »»
      </button>
    )
  }

  return (
    <aside className="sidebar project-sidebar studio-sidebar">
      <div className="studio-brand">
        <div className="studio-brand-mark">J</div>
        <div>
          <div className="studio-brand-name">Jargon</div>
          <div className="studio-brand-role">RevOps studio</div>
        </div>
      </div>

      <div className="sidebar-actions">
        <div className="sidebar-actions-row">
          <button className="sidebar-action primary" onClick={onNewProject}>
            <span className="sidebar-action-icon">+</span>
            New tool
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
            placeholder="Search tools"
            aria-label="Search tools"
          />
        </div>
      </div>

      <div className="sidebar-section-block">
        <button className="sidebar-section-toggle" onClick={() => setToolsOpen((v) => !v)}>
          <span className={`chev ${toolsOpen ? 'open' : ''}`}>▾</span>
          Tools
          <span className="sidebar-section-count">{tools.length}</span>
        </button>

        {toolsOpen ? (
          <div className="project-tree">
            <button className="workspace-folder" onClick={() => setFolderOpen((v) => !v)}>
              <span className={`chev small ${folderOpen ? 'open' : ''}`}>▾</span>
              <span className="folder-icon">◇</span>
              <span className="folder-name">{workspaceName}</span>
            </button>

            {folderOpen ? (
              <div className="project-children">
                {drafting ? (
                  <div className="project-row drafting">
                    <span className="project-row-icon">✦</span>
                    <span className="project-row-name">Scaffolding tool…</span>
                    <span className="project-row-time">now</span>
                  </div>
                ) : null}

                {filtered.length === 0 && !drafting ? (
                  <div className="sidebar-empty nested">
                    No tools yet — describe a rep-facing surface in chat, or start blank.
                  </div>
                ) : (
                  filtered.map((tool) => (
                    <div
                      key={tool.id}
                      className={
                        tool.id === activeToolId && !connectionsActive
                          ? 'project-row active'
                          : 'project-row'
                      }
                      onClick={() => onSelectTool(tool.id)}
                      title={tool.name}
                    >
                      <span className="project-row-icon">◆</span>
                      <span className="project-row-name">{tool.name}</span>
                      <span className="project-row-time">
                        {relativeTime(tool.updatedAt ?? tool.createdAt, now)}
                      </span>
                      <button
                        className="project-row-delete"
                        title="Remove tool"
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
          Studio
        </div>
        <div className="project-children home">
          {onOpenConnections ? (
            <button
              type="button"
              className={connectionsActive ? 'project-row active' : 'project-row'}
              onClick={onOpenConnections}
            >
              <span className="project-row-icon">⬡</span>
              <span className="project-row-name">Context</span>
              <span className="project-row-meta">Sources</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-user">
          <div className="sidebar-footer-avatar">
            {(userLabel ?? orgLabel ?? 'J').charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="sidebar-footer-name">{orgLabel ?? 'Jargon'}</div>
            <div className="sidebar-footer-plan">{userLabel ?? 'RevOps'}</div>
          </div>
        </div>
        {onSignOut ? (
          <button type="button" className="sidebar-signout" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
    </aside>
  )
}
