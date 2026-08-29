import { useMemo, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BOARD_PALETTE,
  LIBRARY_GROUPS,
  PALETTE_MIME,
  type PaletteItem
} from '../lib/board'

const DEFAULT_WIDTH = 240
const MIN_WIDTH = 180
const MAX_WIDTH = 360
const COLLAPSE_AT = 72

interface Props {
  onAddToBoard?: (item: PaletteItem) => void
  disabled?: boolean
  width: number
  onWidthChange: (width: number) => void
}

export function LibrarySidebar({
  onAddToBoard,
  disabled = false,
  width,
  onWidthChange
}: Props) {
  const [query, setQuery] = useState('')
  const [resizing, setResizing] = useState(false)
  const collapsed = width === 0

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items = !q
      ? BOARD_PALETTE
      : BOARD_PALETTE.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.detail.toLowerCase().includes(q) ||
            item.group.toLowerCase().includes(q)
        )
    return LIBRARY_GROUPS.map((group) => ({
      group,
      items: items.filter((item) => item.group === group)
    })).filter((section) => section.items.length > 0)
  }, [query])

  function onDragStart(e: DragEvent, item: PaletteItem) {
    if (disabled) {
      e.preventDefault()
      return
    }
    const payload = JSON.stringify({ jargon: 'palette', item })
    e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(item))
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizing(true)

    const startX = e.clientX
    const startWidth = width

    function onMove(ev: globalThis.PointerEvent) {
      const next = startWidth + (ev.clientX - startX)
      if (next < COLLAPSE_AT) {
        onWidthChange(0)
        return
      }
      const capped = Math.min(MAX_WIDTH, next)
      if (startWidth === 0) {
        onWidthChange(Math.max(COLLAPSE_AT + 1, capped))
        return
      }
      onWidthChange(Math.max(MIN_WIDTH, capped))
    }

    function onUp(ev: globalThis.PointerEvent) {
      const next = startWidth + (ev.clientX - startX)
      if (next >= COLLAPSE_AT && next > 0 && next < MIN_WIDTH) {
        onWidthChange(DEFAULT_WIDTH)
      }
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function onResizeDoubleClick() {
    onWidthChange(collapsed ? DEFAULT_WIDTH : 0)
  }

  if (collapsed) {
    return (
      <div className={`palette-rail collapsed${resizing ? ' resizing' : ''}`}>
        <div
          className="palette-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag right to show palette"
          title="Drag to show palette"
          onPointerDown={onResizePointerDown}
          onDoubleClick={onResizeDoubleClick}
        />
      </div>
    )
  }

  return (
    <div className={`palette-rail${resizing ? ' resizing' : ''}`}>
      <aside className="library-sidebar">
        <div className="library-sidebar-header">
          <div className="library-sidebar-kicker">Compose</div>
          <div className="library-sidebar-title">Palette</div>
          <p className="library-sidebar-lede">
            Context → rank → people → rep surfaces → actions
          </p>
          <div className="library-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search blocks"
              aria-label="Search palette"
            />
          </div>
        </div>

        <div className="library-sidebar-body">
          {grouped.length === 0 ? (
            <div className="library-empty">No matching blocks</div>
          ) : (
            grouped.map(({ group, items }) => (
              <section key={group} className="library-group">
                <h3 className="library-group-label">{group}</h3>
                <div className="library-group-items">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={disabled ? -1 : 0}
                      className={`library-item kind-${item.kind} ${disabled ? 'disabled' : ''}`}
                      draggable={!disabled}
                      onDragStart={(e) => onDragStart(e, item)}
                      onClick={() => {
                        if (!disabled) onAddToBoard?.(item)
                      }}
                      onKeyDown={(e) => {
                        if (disabled) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onAddToBoard?.(item)
                        }
                      }}
                      title={item.detail}
                    >
                      <span className="library-item-label">{item.label}</span>
                      <span className="library-item-detail">{item.detail}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>
      <div
        className="palette-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize palette"
        title="Drag left to hide · double-click to collapse"
        onPointerDown={onResizePointerDown}
        onDoubleClick={onResizeDoubleClick}
      />
    </div>
  )
}
