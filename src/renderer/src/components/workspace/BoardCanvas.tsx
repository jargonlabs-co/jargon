import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { api, type ProjectBundle } from '../../api/client'
import {
  loadBoard,
  PALETTE_MIME,
  saveBoard,
  type BoardNode,
  type LibraryGroup,
  type PaletteItem
} from '../../lib/board'
import {
  appendNodes,
  appendToFlow,
  insertIntoFlow,
  layoutFlowHorizontally
} from '../../lib/promptToBoard'
import { groupNodesByPipeline, nodeStage } from '../../lib/pipelineLayout'
import { SharePreviewDialog } from './SharePreviewDialog'
import { ToolWorkspacePage } from './pages/ToolWorkspacePage'
import { RunsWorkspacePage } from './pages/RunsWorkspacePage'

type BoardView = 'board' | 'tool' | 'runs'

export interface BoardPromptApply {
  items: PaletteItem[]
  replace?: boolean
  token: number
}

interface Props {
  bundle: ProjectBundle
  onBundleChange?: (bundle: ProjectBundle) => void
  onOpenConnections?: () => void
  pendingAdd?: PaletteItem | null
  onPendingAddConsumed?: () => void
  pendingPrompt?: BoardPromptApply | null
  onPendingPromptConsumed?: () => void
  onNodeCountChange?: (count: number) => void
}

export function BoardCanvas({
  bundle,
  onBundleChange,
  onOpenConnections,
  pendingAdd,
  onPendingAddConsumed,
  pendingPrompt,
  onPendingPromptConsumed,
  onNodeCountChange
}: Props) {
  const projectId = bundle.project.id
  const prospectQueueMode = bundle.project.kind === 'today'
  const [nodes, setNodes] = useState<BoardNode[]>(() => {
    const loaded = loadBoard(projectId, bundle.project.kind)
    return layoutFlowHorizontally(loaded)
  })
  const [view, setView] = useState<BoardView>(() => (prospectQueueMode ? 'tool' : 'board'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropStage, setDropStage] = useState<LibraryGroup | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const buildTimers = useRef<number[]>([])
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set())
  const [isBuilding, setIsBuilding] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  function clearBuildTimers() {
    buildTimers.current.forEach((id) => window.clearTimeout(id))
    buildTimers.current = []
  }

  useEffect(() => () => clearBuildTimers(), [])

  useEffect(() => {
    const loaded = loadBoard(projectId, bundle.project.kind)
    clearBuildTimers()
    setIsBuilding(false)
    setAnimatingIds(new Set())
    setNodes(layoutFlowHorizontally(loaded))
    setSelectedId(null)
    setView(prospectQueueMode ? 'tool' : 'board')
  }, [projectId, bundle.project.kind, prospectQueueMode])

  useEffect(() => {
    saveBoard(projectId, nodes)
    onNodeCountChange?.(nodes.length)
  }, [projectId, nodes, onNodeCountChange])

  useEffect(() => {
    if (!pendingAdd) return
    const item = pendingAdd
    setNodes((prev) => {
      const next = appendToFlow(prev, [item], 480, false)
      const last = next[next.length - 1]
      if (last) {
        setSelectedId(last.id)
        setAnimatingIds(new Set([last.id]))
        const t = window.setTimeout(() => setAnimatingIds(new Set()), 320)
        buildTimers.current.push(t)
      }
      return next
    })
    setView('board')
    onPendingAddConsumed?.()
  }, [pendingAdd, onPendingAddConsumed])

  useEffect(() => {
    if (!pendingPrompt) return
    const { items, replace } = pendingPrompt
    if (!items.length) {
      onPendingPromptConsumed?.()
      return
    }

    clearBuildTimers()
    setView('board')
    setIsBuilding(true)
    onPendingPromptConsumed?.()

    if (replace) {
      setNodes([])
      setSelectedId(null)
      setAnimatingIds(new Set())
    }

    const STEP_MS = 180
    const startDelay = replace ? 80 : 0

    items.forEach((item, index) => {
      const timer = window.setTimeout(() => {
        setNodes((prev) => {
          const next = appendNodes(prev, [item])
          const added = next.find((n) => !prev.some((p) => p.id === n.id))
          if (added) {
            setSelectedId(added.id)
            setAnimatingIds(new Set([added.id]))
            const fade = window.setTimeout(() => setAnimatingIds(new Set()), 320)
            buildTimers.current.push(fade)
          }
          return layoutFlowHorizontally(next)
        })
        if (index === items.length - 1) {
          const done = window.setTimeout(() => {
            setIsBuilding(false)
            setAnimatingIds(new Set())
          }, 240)
          buildTimers.current.push(done)
        }
      }, startDelay + index * STEP_MS)
      buildTimers.current.push(timer)
    })
  }, [pendingPrompt, onPendingPromptConsumed])

  const selected = nodes.find((n) => n.id === selectedId) ?? null
  const sections = useMemo(() => groupNodesByPipeline(nodes), [nodes])
  const surfaceCount = nodes.filter((n) => nodeStage(n) === 'Rep surfaces').length
  const hasTool = nodes.length > 0

  async function refreshBundle(): Promise<ProjectBundle> {
    const next = await api.getProject(projectId)
    onBundleChange?.(next)
    return next
  }

  function parsePalettePayload(raw: string): PaletteItem | null {
    try {
      const parsed = JSON.parse(raw) as PaletteItem | { jargon: string; item: PaletteItem }
      if (parsed && typeof parsed === 'object' && 'jargon' in parsed && parsed.jargon === 'palette') {
        return parsed.item
      }
      if (parsed && typeof parsed === 'object' && 'id' in parsed && 'kind' in parsed) {
        return parsed as PaletteItem
      }
    } catch {
      /* ignore */
    }
    return null
  }

  function onStageDragOver(e: DragEvent, stage: LibraryGroup) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropStage(stage)
  }

  function onStageDrop(e: DragEvent, stage: LibraryGroup) {
    e.preventDefault()
    e.stopPropagation()
    setDropStage(null)

    const fromCustom = e.dataTransfer.getData(PALETTE_MIME)
    const fromText = e.dataTransfer.getData('text/plain')
    const item = parsePalettePayload(fromCustom || fromText)
    if (!item) return

    setNodes((prev) => {
      const next = insertIntoFlow(prev, item, undefined, 480, stage)
      const added = next.find((n) => !prev.some((p) => p.id === n.id))
      if (added) setSelectedId(added.id)
      return next
    })
    setView('board')
  }

  function onBoardDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onBoardDrop(e: DragEvent) {
    e.preventDefault()
    setDropStage(null)

    const fromCustom = e.dataTransfer.getData(PALETTE_MIME)
    const fromText = e.dataTransfer.getData('text/plain')
    const item = parsePalettePayload(fromCustom || fromText)
    if (!item) return

    setNodes((prev) => {
      const next = insertIntoFlow(prev, item)
      const added = next.find((n) => !prev.some((p) => p.id === n.id))
      if (added) setSelectedId(added.id)
      return next
    })
    setView('board')
  }

  function removeSelected() {
    if (!selectedId) return
    setNodes((prev) => layoutFlowHorizontally(prev.filter((n) => n.id !== selectedId)))
    setSelectedId(null)
  }

  function clearBoard() {
    setNodes([])
    setSelectedId(null)
  }

  function moveStep(id: string, direction: -1 | 1) {
    setNodes((prev) => {
      const idx = prev.findIndex((n) => n.id === id)
      if (idx < 0) return prev
      const dest = idx + direction
      if (dest < 0 || dest >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(dest, 0, item)
      return layoutFlowHorizontally(next)
    })
  }

  return (
    <div className="board-shell studio-board">
      <header className="board-toolbar">
        <div className="board-toolbar-meta">
          <div className="board-toolbar-kicker">
            {prospectQueueMode ? (
              <>
                <span className="studio-pill">Crustdata</span>
                <span>Prospect queue</span>
              </>
            ) : (
              <>
                <span className="studio-pill">Draft</span>
                <span>Building for reps</span>
              </>
            )}
          </div>
          <div className="board-title">{bundle.project.name}</div>
          <div className="board-sub">
            {prospectQueueMode
              ? (bundle.project.answers.crustdata_query as string | undefined) ||
                bundle.project.prompt
              : isBuilding
                ? 'Scaffolding tool from chat…'
                : 'Pipeline · context flows down into rep preview'}
            {!prospectQueueMode && !isBuilding && bundle.project.segment
              ? ` · ${bundle.project.segment}`
              : ''}
          </div>
        </div>
        <div className="board-toolbar-actions">
          {!prospectQueueMode ? (
            <div className="board-view-tabs" role="tablist" aria-label="Studio views">
              {(
                [
                  ['board', 'Compose'],
                  ['tool', 'Rep preview'],
                  ['runs', 'Activity']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={view === id ? 'board-view-tab active' : 'board-view-tab'}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {view === 'tool' ? (
            <button type="button" className="ghost-btn" onClick={() => setShareOpen(true)}>
              Share preview
            </button>
          ) : null}
          {view === 'board' && nodes.length > 0 ? (
            <button type="button" className="ghost-btn" onClick={clearBoard}>
              Clear canvas
            </button>
          ) : null}
          {onOpenConnections ? (
            <button type="button" className="ghost-btn" onClick={onOpenConnections}>
              Context
            </button>
          ) : null}
        </div>
      </header>

      {view === 'tool' ? (
        <div className="board-alt-view">
          {!prospectQueueMode ? (
            <div className="rep-preview-banner" role="status">
              <strong>Rep preview · live</strong>
              <span>Call, email, and disposition run against your project data</span>
            </div>
          ) : null}
          <ToolWorkspacePage bundle={bundle} onRefresh={refreshBundle} />
        </div>
      ) : null}
      {view === 'runs' ? (
        <div className="board-alt-view">
          <RunsWorkspacePage bundle={bundle} />
        </div>
      ) : null}

      {view === 'board' ? (
        <div className="board-layout board-layout-wide">
          <div className="board-main">
            <div
              ref={boardRef}
              className="board-surface board-paper"
              onDragOver={onBoardDragOver}
              onDragLeave={() => setDropStage(null)}
              onDrop={onBoardDrop}
              onClick={() => setSelectedId(null)}
            >
              <div className="board-dots" aria-hidden="true" />

              {!hasTool ? (
                <div className="board-empty">
                  <p className="board-empty-kicker">Compose</p>
                  <h3>Design a rep-facing tool</h3>
                  <p>
                    Try “Build an outbound tool for reps for the accounts most likely to close in
                    the next 90 days” — or drag blocks from the Palette into each pipeline stage.
                  </p>
                </div>
              ) : (
                <div className={`pipeline-canvas ${isBuilding ? 'building' : ''}`}>
                  {sections.map((section) => (
                    <section
                      key={section.stage}
                      className={`pipeline-stage ${dropStage === section.stage ? 'drop-target' : ''} ${section.nodes.length ? 'has-blocks' : ''}`}
                      onDragOver={(e) => onStageDragOver(e, section.stage)}
                      onDragLeave={() => setDropStage(null)}
                      onDrop={(e) => onStageDrop(e, section.stage)}
                    >
                      <header className="pipeline-stage-header">
                        <span className="pipeline-stage-label">{section.meta.title}</span>
                        <p className="pipeline-stage-lede">{section.meta.lede}</p>
                      </header>

                      <div className="pipeline-stage-blocks">
                        {section.nodes.length === 0 ? (
                          <div className="pipeline-stage-empty">Drop blocks here</div>
                        ) : (
                          section.nodes.map((node) => {
                            const globalIndex = nodes.findIndex((n) => n.id === node.id)
                            return (
                              <div
                                key={node.id}
                                role="button"
                                tabIndex={0}
                                className={`pipeline-block kind-${node.kind} ${selectedId === node.id ? 'selected' : ''} ${animatingIds.has(node.id) ? 'entering' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedId(node.id)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setSelectedId(node.id)
                                  }
                                }}
                              >
                                <span className="pipeline-block-kind">{node.kind}</span>
                                <strong>{node.label}</strong>
                                <span className="pipeline-block-actions">
                                  <button
                                    type="button"
                                    aria-label="Move up"
                                    disabled={globalIndex === 0}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      moveStep(node.id, -1)
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Move down"
                                    disabled={globalIndex === nodes.length - 1}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      moveStep(node.id, 1)
                                    }}
                                  >
                                    ↓
                                  </button>
                                </span>
                              </div>
                            )
                          })
                        )}
                      </div>

                      <div className="pipeline-connector" aria-hidden="true">
                        <span className="pipeline-connector-line" />
                        <span className="pipeline-connector-arrow">↓</span>
                      </div>
                    </section>
                  ))}

                  <div
                    className={`pipeline-destination ${surfaceCount > 0 ? 'ready' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setView('tool')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setView('tool')
                      }
                    }}
                  >
                    <div className="pipeline-destination-icon" aria-hidden="true">
                      ◎
                    </div>
                    <div className="pipeline-destination-copy">
                      <strong>Rep preview</strong>
                      <span>
                        {surfaceCount > 0
                          ? `${surfaceCount} surface${surfaceCount === 1 ? '' : 's'} flow here — click to preview`
                          : 'Add rep surfaces above to define what reps open'}
                      </span>
                    </div>
                    {surfaceCount > 0 ? (
                      <span className="pipeline-destination-cta">Open preview →</span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <aside className="board-inspector">
              <div className="board-inspector-title">Inspector</div>
              {selected ? (
                <>
                  <label className="board-field">
                    <span>Label</span>
                    <input
                      value={selected.label}
                      onChange={(e) => {
                        const value = e.target.value
                        setNodes((prev) =>
                          prev.map((n) => (n.id === selected.id ? { ...n, label: value } : n))
                        )
                      }}
                    />
                  </label>
                  <div className="board-field">
                    <span>Stage</span>
                    <div className="ide-pill">{nodeStage(selected)}</div>
                  </div>
                  <div className="board-field">
                    <span>Block type</span>
                    <div className="ide-pill">{selected.kind}</div>
                  </div>
                  <p className="muted board-inspector-hint">
                    Blocks in <strong>{nodeStage(selected)}</strong> feed the stages below. Rep
                    surfaces become what reps open in preview.
                  </p>
                  <button type="button" className="ghost-btn danger" onClick={removeSelected}>
                    Remove block
                  </button>
                </>
              ) : (
                <p className="muted board-inspector-empty">
                  Select a block to inspect. Context and enrichment flow down into rep surfaces and
                  preview.
                </p>
              )}
              <div className="board-inspector-stats">
                <div>
                  <span>Blocks</span>
                  <strong>{nodes.length}</strong>
                </div>
                <div>
                  <span>Records</span>
                  <strong>{bundle.contacts.length}</strong>
                </div>
              </div>
            </aside>
          </div>
        </div>
      ) : null}

      <SharePreviewDialog
        projectId={projectId}
        projectName={bundle.project.name}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  )
}
