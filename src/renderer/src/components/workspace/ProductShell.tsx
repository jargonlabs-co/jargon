import type { ReactNode } from 'react'

export interface NavItem {
  id: string
  label: string
  section?: 'main' | 'system'
}

interface Props {
  productName: string
  productKind: string
  navItems: NavItem[]
  activeNav: string
  onNavChange: (id: string) => void
  userLabel?: string
  children: ReactNode
  detail?: ReactNode
}

export function ProductShell({
  productName,
  productKind,
  navItems,
  activeNav,
  onNavChange,
  userLabel = 'Sales Ops',
  children,
  detail
}: Props) {
  const main = navItems.filter((n) => n.section !== 'system')
  const system = navItems.filter((n) => n.section === 'system')

  return (
    <div className="product-app">
      <aside className="product-nav">
        <div className="product-brand">
          <div className="product-brand-mark" aria-hidden="true">
            <span className="product-dot orange" />
            <span className="product-dot navy" />
            <span className="product-dot blue" />
          </div>
          <div>
            <div className="product-brand-name">{productName}</div>
            <div className="product-brand-kind">{productKind}</div>
          </div>
        </div>

        <nav className="product-nav-list">
          {main.map((item) => (
            <button
              key={item.id}
              className={item.id === activeNav ? 'product-nav-item active' : 'product-nav-item'}
              onClick={() => onNavChange(item.id)}
            >
              <span className="product-nav-icon">{iconFor(item.id)}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="product-nav-spacer" />

        <nav className="product-nav-list">
          {system.map((item) => (
            <button
              key={item.id}
              className={item.id === activeNav ? 'product-nav-item active' : 'product-nav-item'}
              onClick={() => onNavChange(item.id)}
            >
              <span className="product-nav-icon">{iconFor(item.id)}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="product-user">
          <div className="product-user-avatar">{userLabel.slice(0, 1)}</div>
          <div>
            <div className="product-user-label">Signed in as</div>
            <div className="product-user-name">{userLabel}</div>
          </div>
        </div>
      </aside>

      <div className={`product-main ${detail ? 'with-detail' : ''}`}>
        <div className="product-stage">{children}</div>
        {detail ? <aside className="product-detail">{detail}</aside> : null}
      </div>
    </div>
  )
}

function iconFor(id: string): string {
  const map: Record<string, string> = {
    dashboard: '▦',
    context: '◈',
    campaigns: '⚑',
    sequences: '☰',
    today: '☀',
    cadences: '↻',
    lists: '▤',
    contacts: '☺',
    scripts: '✎',
    analytics: '◔',
    settings: '⚙',
    help: '?',
    inbox: '✉',
    dial: '☎',
    connections: '⬡',
    agents: '⌁'
  }
  return map[id] ?? '•'
}
