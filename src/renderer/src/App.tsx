import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ClarifySession, SessionPhase } from './types'
import type { Project } from './api/client'
import { api } from './api/client'
import {
  analysisIntro,
  startClarifySession,
  SUGGESTED_PROMPTS
} from './lib/analyzePrompt'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { ToolCanvas } from './components/ToolCanvas'
import { Composer } from './components/Composer'
import { TitleBar } from './components/TitleBar'
import './styles/app.css'

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Describe the outbound tool you want.\n\nI’ll ask a few clarifying questions, then build a ready-to-use workspace — dialer, sequencer, cadence, or list.\n\nTry:\n• “Create an outbound dialer for the Midwest segment”\n• “Create an email sequencing tool for the SMB team”',
  createdAt: Date.now()
}

function msgId(suffix: string): string {
  return `msg_${Date.now()}_${suffix}_${Math.random().toString(36).slice(2, 5)}`
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [session, setSession] = useState<ClarifySession | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const timers = useRef<number[]>([])

  const drafting = phase === 'clarifying' || phase === 'building'
  const showProjectWindow = phase === 'ready' && !!activeProjectId

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      for (let i = 0; i < 20; i++) {
        try {
          const list = await api.listProjects()
          if (cancelled) return
          setProjects(list)
          setApiReady(true)
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
  }, [])

  const refreshProjects = useCallback(async () => {
    const list = await api.listProjects()
    setProjects(list)
    return list
  }, [])

  const askCurrentQuestion = useCallback((next: ClarifySession) => {
    const question = next.questions[next.currentIndex]
    if (!question) return
    setMessages((prev) => [
      ...prev,
      {
        id: msgId('q'),
        role: 'assistant',
        content: question.prompt,
        questionId: question.id,
        options: question.options,
        createdAt: Date.now()
      }
    ])
  }, [])

  const finishAndBuild = useCallback(
    (finalSession: ClarifySession) => {
      setPhase('building')
      setIsWorking(true)
      setSession(null)
      setMessages((prev) => [
        ...prev,
        {
          id: msgId('build'),
          role: 'assistant',
          content: 'Great — I have what I need. Building your outbound tool now…',
          createdAt: Date.now()
        }
      ])

      const timer = window.setTimeout(() => {
        void (async () => {
          try {
            const bundle = await api.createProject({
              prompt: finalSession.originalPrompt,
              kind: finalSession.kind,
              answers: finalSession.answers
            })
            await refreshProjects()
            setActiveProjectId(bundle.project.id)
            setPhase('ready')
            setMessages((prev) => [
              ...prev,
              {
                id: msgId('ready'),
                role: 'assistant',
                content: `Built **${bundle.project.name}** — saved to Projects and opened full-screen.\n\nUse the app nav for Campaigns, Dial console, Sequences, Inbox, and Analytics. Actions persist through the local simulated backend.`,
                toolId: bundle.project.id,
                createdAt: Date.now()
              }
            ])
          } catch (err) {
            setPhase('idle')
            setMessages((prev) => [
              ...prev,
              {
                id: msgId('err'),
                role: 'assistant',
                content: `Couldn’t create the project: ${err instanceof Error ? err.message : 'Unknown error'}`,
                createdAt: Date.now()
              }
            ])
          } finally {
            setIsWorking(false)
          }
        })()
      }, 900)

      timers.current.push(timer)
    },
    [refreshProjects]
  )

  const answerQuestion = useCallback(
    (questionId: string, answer: string) => {
      if (!session || isWorking) return
      const current = session.questions[session.currentIndex]
      if (!current || current.id !== questionId) return
      const trimmed = answer.trim()
      if (!trimmed) return

      setMessages((prev) => [
        ...prev,
        { id: msgId('a'), role: 'user', content: trimmed, createdAt: Date.now() }
      ])

      const next: ClarifySession = {
        ...session,
        answers: { ...session.answers, [questionId]: trimmed },
        currentIndex: session.currentIndex + 1
      }

      if (next.currentIndex >= next.questions.length) {
        setSession(next)
        finishAndBuild(next)
        return
      }

      setSession(next)
      setIsWorking(true)
      const timer = window.setTimeout(() => {
        setIsWorking(false)
        askCurrentQuestion(next)
      }, 350)
      timers.current.push(timer)
    },
    [session, isWorking, askCurrentQuestion, finishAndBuild]
  )

  const startFromPrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim()
      if (!trimmed || isWorking || phase === 'clarifying' || phase === 'building') return

      setMessages((prev) => [
        ...prev,
        { id: msgId('u'), role: 'user', content: trimmed, createdAt: Date.now() }
      ])
      setIsWorking(true)
      setActiveProjectId(null)

      const timer = window.setTimeout(() => {
        const next = startClarifySession(trimmed)
        setSession(next)
        setPhase('clarifying')
        setIsWorking(false)
        setMessages((prev) => [
          ...prev,
          {
            id: msgId('intro'),
            role: 'assistant',
            content: analysisIntro(next),
            createdAt: Date.now()
          }
        ])
        const qTimer = window.setTimeout(() => askCurrentQuestion(next), 280)
        timers.current.push(qTimer)
      }, 500)

      timers.current.push(timer)
    },
    [isWorking, phase, askCurrentQuestion]
  )

  const submitComposer = useCallback(
    (value: string) => {
      if (phase === 'clarifying' && session) {
        const current = session.questions[session.currentIndex]
        if (current) {
          answerQuestion(current.id, value)
          return
        }
      }
      startFromPrompt(value)
    },
    [phase, session, answerQuestion, startFromPrompt]
  )

  const deleteProject = useCallback(
    async (id: string) => {
      await api.deleteProject(id)
      await refreshProjects()
      if (activeProjectId === id) {
        setActiveProjectId(null)
        setPhase('idle')
      }
    },
    [activeProjectId, refreshProjects]
  )

  const selectProject = useCallback(
    (id: string) => {
      if (drafting) return
      setActiveProjectId(id)
      setPhase('ready')
      void refreshProjects()
      const name = projects.find((p) => p.id === id)?.name ?? 'project'
      setMessages([
        {
          id: msgId('reopen'),
          role: 'assistant',
          content: `Opened **${name}** from your saved projects.`,
          toolId: id,
          createdAt: Date.now()
        }
      ])
    },
    [drafting, projects, refreshProjects]
  )

  const newProject = useCallback(() => {
    if (drafting && !window.confirm('Leave the current draft and start a new project?')) return
    clearTimers()
    setSession(null)
    setIsWorking(false)
    setActiveProjectId(null)
    setPhase('idle')
    setMessages([{ ...WELCOME, id: msgId('welcome'), createdAt: Date.now() }])
  }, [drafting, clearTimers])

  const composerPlaceholder =
    phase === 'clarifying'
      ? 'Type an answer, or click an option above…'
      : 'Describe an outbound tool… e.g. create a dialer for Midwest enterprise'

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
          drafting={drafting}
          collapsed={sidebarCollapsed}
          onNewProject={newProject}
          onSelectTool={selectProject}
          onDeleteTool={(id) => void deleteProject(id)}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        <main
          className={`workspace ${showProjectWindow ? 'workspace-project' : 'workspace-chat'} ${sidebarCollapsed ? 'workspace-expanded' : ''}`}
        >
          {showProjectWindow ? (
            <ToolCanvas projectId={activeProjectId} phase={phase} fullscreen />
          ) : (
            <>
              <div className="workspace-panes chat-only">
                <ChatPanel
                  messages={messages}
                  isGenerating={isWorking || !apiReady}
                  generatingLabel={
                    !apiReady
                      ? 'Starting local API…'
                      : phase === 'building'
                        ? 'Building tool…'
                        : 'Analyzing…'
                  }
                  suggestions={phase === 'idle' && !activeProjectId ? SUGGESTED_PROMPTS : []}
                  showActionHints={phase !== 'idle'}
                  onSuggest={startFromPrompt}
                  onOpenTool={selectProject}
                  onSelectOption={phase === 'clarifying' ? answerQuestion : undefined}
                />
              </div>
              <Composer
                disabled={isWorking || phase === 'building' || !apiReady}
                placeholder={composerPlaceholder}
                onSubmit={submitComposer}
              />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
