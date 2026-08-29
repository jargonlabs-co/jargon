interface TabItem {
  id: string
  label: string
  dirty?: boolean
}

interface Props {
  tabs: TabItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export function ProjectTabs({ tabs, activeId, onSelect, onClose, onNew }: Props) {
  return (
    <div className="project-tabs studio-tabs" role="tablist" aria-label="Open tools">
      <div className="studio-tabs-label" aria-hidden="true">
        Studio
      </div>
      <div className="project-tabs-scroll">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === activeId ? 'project-tab active' : 'project-tab'}
            role="tab"
            aria-selected={tab.id === activeId}
            onClick={() => onSelect(tab.id)}
          >
            <span className="project-tab-label">
              {tab.label}
              {tab.dirty ? <span className="project-tab-dot" aria-label="draft" /> : null}
            </span>
            <button
              type="button"
              className="project-tab-close"
              title="Close tool"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="project-tab-new" onClick={onNew} title="New tool">
        +
      </button>
    </div>
  )
}
