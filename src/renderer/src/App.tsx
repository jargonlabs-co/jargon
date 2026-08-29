import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthPayload, Org, Project, PublicUser } from './api/client'
import { api, setClientAuthToken } from './api/client'
import type { PaletteItem } from './lib/board'
import { promptToBoardPlan } from './lib/promptToBoard'
import { Sidebar } from './components/Sidebar'
import { ToolCanvas } from './components/ToolCanvas'
import { TitleBar } from './components/TitleBar'
import { AuthScreen } from './components/AuthScreen'
import { ProjectTabs } from './components/ProjectTabs'
import { LibrarySidebar } from './components/LibrarySidebar'
import { ChatBar } from './components/ChatBar'
import type { BoardPromptApply } from './components/workspace/BoardCanvas'
import { inferProjectFromPrompt, isProspectQueuePrompt, SUGGESTED_PROMPTS } from './lib/analyzePrompt'
import './styles/app.css'

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

  const [projects, setProjects] = useState<Project[]>([])
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [paletteWidth, setPaletteWidth] = useState(240)
  const [apiReady, setApiReady] = useState(false)
  const [canvasMode, setCanvasMode] = useState<'workspace' | 'connections'>('workspace')
  const [pendingAdd, setPendingAdd] = useState<PaletteItem | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<BoardPromptApply | null>(null)
  const [queuedPrompt, setQueuedPrompt] = useState<Omit<BoardPromptApply, 'token'> | null>(null)
  const [chatStatus, setChatStatus] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)

  const activeProjectId =
    activeTabId && canvasMode === 'workspace' ? activeTabId : null

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        for (let i = 0; i < 20; i++) {
          try {
            await fetch(`${window.jargon?.apiBaseUrl ?? 'http://127.0.0.1:8787'}/health`)
            break
          } catch {
            await new Promise((r) => setTimeout(r, 250))
          }
        }
        const stored = (await window.jargon?.getAuthToken?.()) ?? null
        if (stored) {
          setClientAuthToken(stored)
          const me = await api.me()
          if (cancelled) return
          setUser(me.user)
          setOrg(me.org)
          setAuthed(true)
        }
      } catch {
        setClientAuthToken(null)
        await window.jargon?.setAuthToken?.(null)
      } finally {
        if (!cancelled) setAuthChecking(false)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    let cancelled = false
    async function boot() {
      for (let i = 0; i < 20; i++) {
        try {
          const list = await api.listProjects()
          if (cancelled) return
          setProjects(list)
          setApiReady(true)
          if (list.length > 0) {
            const first = list[0].id
            setOpenTabIds([first])
            setActiveTabId(first)
          }
          return
        } catch {
          await new Promise((r) => setTimeout(r, 250))
        }
      }
      if (!cancelled) setApiReady(true)
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [authed])

  const onAuthed = useCallback((payload: AuthPayload) => {
    setUser(payload.user)
    setOrg(payload.org)
    setAuthed(true)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    setClientAuthToken(null)
    await window.jargon?.setAuthToken?.(null)
    setAuthed(false)
    setUser(null)
    setOrg(null)
    setProjects([])
    setOpenTabIds([])
    setActiveTabId(null)
    setCanvasMode('workspace')
  }, [])

  const refreshProjects = useCallback(async () => {
    const list = await api.listProjects()
    setProjects(list)
    return list
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabIds((prev) => {
        const next = prev.filter((t) => t !== id)
        if (activeTabId === id) {
          setActiveTabId(next[next.length - 1] ?? null)
          setCanvasMode('workspace')
        }
        return next
      })
    },
    [activeTabId]
  )

  const deleteProject = useCallback(
    async (id: string) => {
      await api.deleteProject(id)
      await refreshProjects()
      closeTab(id)
    },
    [refreshProjects, closeTab]
  )

  const selectProject = useCallback(
    (id: string) => {
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setActiveTabId(id)
      setCanvasMode('workspace')
      void refreshProjects()
    },
    [refreshProjects]
  )

  const openConnections = useCallback(() => {
    setCanvasMode('connections')
  }, [])

  const newProject = useCallback(async () => {
    if (creatingProject || !apiReady) return
    setCreatingProject(true)
    setCanvasMode('workspace')
    try {
      const bundle = await api.createProject({
        prompt: 'Blank rep tool',
        kind: 'generic',
        answers: { segment: 'General', team: 'RevOps', goal: 'Compose from palette' }
      })
      await refreshProjects()
      const id = bundle.project.id
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setActiveTabId(id)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create project')
    } finally {
      setCreatingProject(false)
    }
  }, [creatingProject, apiReady, refreshProjects])

  const tabItems = useMemo(() => {
    return openTabIds.map((id) => {
      const project = projects.find((p) => p.id === id)
      return { id, label: project?.name ?? 'Tool' }
    })
  }, [openTabIds, projects])

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const prospectQueueMode = activeProject?.kind === 'today'
  const libraryDisabled = canvasMode !== 'workspace' || !activeProjectId || prospectQueueMode

  const handleChatPrompt = useCallback(
    async (prompt: string) => {
      const prospectQueue = isProspectQueuePrompt(prompt)
      const plan = prospectQueue ? null : promptToBoardPlan(prompt)
      setChatStatus(prospectQueue ? 'Searching Crustdata…' : plan?.summary ?? null)

      const needsNewProject =
        prospectQueue || !activeProjectId || (plan?.replace && (plan?.items.length ?? 0) >= 10)
      let projectId = activeProjectId

      if (needsNewProject) {
        if (creatingProject || !apiReady) return
        setCreatingProject(true)
        setCanvasMode('workspace')
        try {
          const inferred = inferProjectFromPrompt(prompt)
          const bundle = await api.createProject({
            prompt,
            kind: inferred.kind,
            answers: {
              segment: inferred.segment,
              team: inferred.team,
              goal: inferred.goal,
              ...(inferred.channels ? { channels: inferred.channels } : {}),
              ...(inferred.prospect_count ? { prospect_count: inferred.prospect_count } : {})
            }
          })
          await refreshProjects()
          projectId = bundle.project.id
          setOpenTabIds((prev) => (prev.includes(projectId!) ? prev : [...prev, projectId!]))
          setActiveTabId(projectId)
          if (prospectQueue) {
            const n = bundle.contacts.length
            const src = bundle.project.answers.prospect_source ?? 'crustdata'
            setChatStatus(
              n > 0
                ? `Loaded ${n} prospects from ${src === 'crustdata' ? 'Crustdata' : src}`
                : 'No prospects returned — check Crustdata connection'
            )
            return
          }
        } catch (err) {
          setChatStatus(err instanceof Error ? err.message : 'Could not create project')
          return
        } finally {
          setCreatingProject(false)
        }
      }

      if (!plan?.items.length) return

      const apply = { items: plan.items, replace: plan.replace }
      setQueuedPrompt(apply)
    },
    [activeProjectId, creatingProject, apiReady, refreshProjects]
  )

  useEffect(() => {
    if (!activeProjectId || !queuedPrompt || creatingProject) return
    const timer = window.setTimeout(() => {
      setPendingPrompt({
        ...queuedPrompt,
        token: Date.now()
      })
      setQueuedPrompt(null)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [activeProjectId, queuedPrompt, creatingProject])

  useEffect(() => {
    if (!chatStatus) return
    const id = window.setTimeout(() => setChatStatus(null), 5000)
    return () => window.clearTimeout(id)
  }, [chatStatus])

  if (authChecking) {
    return (
      <div className="app">
        <TitleBar />
        <div className="auth-screen">
          <p>Starting Jargon…</p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="app">
        <TitleBar />
        <AuthScreen onAuthed={onAuthed} />
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar
          tools={projects.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            updatedAt: p.updatedAt,
            createdAt: p.createdAt,
            segment: p.segment,
            team: p.team
          }))}
          activeToolId={activeProjectId}
          drafting={creatingProject}
          collapsed={sidebarCollapsed}
          connectionsActive={canvasMode === 'connections'}
          onNewProject={() => void newProject()}
          onSelectTool={selectProject}
          onDeleteTool={(id) => void deleteProject(id)}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          onOpenConnections={openConnections}
          orgLabel={org?.name}
          userLabel={user?.email}
          onSignOut={() => void signOut()}
        />
        <main
          className={`workspace workspace-board studio-workspace ${sidebarCollapsed ? 'workspace-expanded' : ''}`}
        >
          <ProjectTabs
            tabs={tabItems}
            activeId={canvasMode === 'connections' ? null : activeTabId}
            onSelect={(id) => {
              setActiveTabId(id)
              setCanvasMode('workspace')
            }}
            onClose={closeTab}
            onNew={() => void newProject()}
          />
          <div
            className={`workspace-panes ${canvasMode === 'workspace' && !prospectQueueMode ? 'library-board' : 'board-only-pane'}`}
            style={
              canvasMode === 'workspace' && !prospectQueueMode
                ? { gridTemplateColumns: `${paletteWidth === 0 ? 10 : paletteWidth}px minmax(0, 1fr)` }
                : undefined
            }
          >
            {canvasMode === 'workspace' && !prospectQueueMode ? (
              <LibrarySidebar
                width={paletteWidth}
                onWidthChange={setPaletteWidth}
                disabled={libraryDisabled}
                onAddToBoard={(item) => {
                  if (!libraryDisabled) setPendingAdd(item)
                }}
              />
            ) : null}
            <div className="board-column">
              <ToolCanvas
                projectId={activeProjectId}
                phase={creatingProject ? 'building' : activeProjectId ? 'ready' : 'idle'}
                mode={canvasMode}
                pendingAdd={pendingAdd}
                onPendingAddConsumed={() => setPendingAdd(null)}
                pendingPrompt={pendingPrompt}
                onPendingPromptConsumed={() => setPendingPrompt(null)}
                onOpenConnections={openConnections}
              />
              {canvasMode === 'workspace' ? (
                <ChatBar
                  disabled={creatingProject || !apiReady}
                  status={chatStatus}
                  hints={SUGGESTED_PROMPTS.slice(0, 3)}
                  placeholder="Find me 20 VP Sales prospects to contact today…"
                  onSubmit={(prompt) => void handleChatPrompt(prompt)}
                />
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
