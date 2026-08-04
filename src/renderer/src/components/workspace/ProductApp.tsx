import { useEffect, useMemo, useState } from 'react'
import type { ProjectBundle } from '../../api/client'
import { api } from '../../api/client'
import { ProductShell, type NavItem } from './ProductShell'
import { DashboardPage } from './pages/DashboardPage'
import { CampaignsPage } from './pages/CampaignsPage'
import { SequencesPage } from './pages/SequencesPage'
import { ContactsPage } from './pages/ContactsPage'
import { DialConsolePage } from './pages/DialConsolePage'
import { InboxPage } from './pages/InboxPage'
import { AnalyticsPage } from './pages/AnalyticsPage'

interface Props {
  projectId: string
  onBundleChange?: (bundle: ProjectBundle) => void
}

export function ProductApp({ projectId, onBundleChange }: Props) {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('dashboard')

  async function refresh() {
    const next = await api.getProject(projectId)
    setBundle(next)
    onBundleChange?.(next)
    return next
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getProject(projectId)
      .then((next) => {
        if (cancelled) return
        setBundle(next)
        onBundleChange?.(next)
        setPage(defaultPage(next.project.kind))
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

  const navItems = useMemo(() => navForKind(bundle?.project.kind ?? 'generic'), [bundle?.project.kind])

  if (loading) {
    return (
      <div className="product-loading">
        <div className="build-progress">
          <div className="build-bar" />
        </div>
        <p>Loading project…</p>
      </div>
    )
  }

  if (error || !bundle) {
    return (
      <div className="product-loading">
        <h3>Couldn’t load project</h3>
        <p>{error ?? 'Unknown error'}</p>
      </div>
    )
  }

  return (
    <ProductShell
      productName={bundle.project.name}
      productKind={kindLabel(bundle.project.kind)}
      navItems={navItems}
      activeNav={page}
      onNavChange={setPage}
      userLabel={bundle.project.team}
    >
      {page === 'dashboard' ? <DashboardPage bundle={bundle} onNavigate={setPage} /> : null}
      {page === 'campaigns' ? (
        <CampaignsPage bundle={bundle} onRefresh={refresh} onOpenDial={() => setPage('dial')} />
      ) : null}
      {page === 'sequences' ? (
        <SequencesPage bundle={bundle} onOpenInbox={() => setPage('inbox')} />
      ) : null}
      {page === 'contacts' ? (
        <ContactsPage
          bundle={bundle}
          onRefresh={refresh}
          onCall={async (id) => {
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('dial')
          }}
          onEmail={async () => {
            setPage('inbox')
          }}
        />
      ) : null}
      {page === 'dial' ? <DialConsolePage bundle={bundle} onRefresh={refresh} /> : null}
      {page === 'inbox' ? <InboxPage bundle={bundle} onRefresh={refresh} /> : null}
      {page === 'analytics' ? <AnalyticsPage bundle={bundle} /> : null}
      {page === 'settings' || page === 'help' ? (
        <div className="prod-view placeholder-view">
          <div className="prod-eyebrow">{page}</div>
          <h2>{page === 'settings' ? 'Settings' : 'Help'}</h2>
          <p>Local simulated workspace for {bundle.project.segment}.</p>
        </div>
      ) : null}
    </ProductShell>
  )
}

function defaultPage(kind: ProjectBundle['project']['kind']): string {
  if (kind === 'dialer') return 'campaigns'
  if (kind === 'sequencer') return 'sequences'
  return 'dashboard'
}

function kindLabel(kind: ProjectBundle['project']['kind']): string {
  switch (kind) {
    case 'dialer':
      return 'Outbound dialer'
    case 'sequencer':
      return 'Email sequencer'
    case 'cadence':
      return 'Multi-channel cadence'
    case 'list':
      return 'Lead list builder'
    default:
      return 'Sales workspace'
  }
}

function navForKind(kind: ProjectBundle['project']['kind']): NavItem[] {
  const sharedTail = [
    { id: 'settings', label: 'Settings', section: 'system' as const },
    { id: 'help', label: 'Help', section: 'system' as const }
  ]
  if (kind === 'dialer') {
    return [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'campaigns', label: 'Campaigns' },
      { id: 'dial', label: 'Dial console' },
      { id: 'contacts', label: 'Contacts' },
      { id: 'inbox', label: 'Inbox' },
      { id: 'analytics', label: 'Analytics' },
      ...sharedTail
    ]
  }
  if (kind === 'sequencer') {
    return [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'sequences', label: 'Sequences' },
      { id: 'inbox', label: 'Inbox' },
      { id: 'contacts', label: 'Contacts' },
      { id: 'analytics', label: 'Analytics' },
      ...sharedTail
    ]
  }
  return [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'sequences', label: 'Sequences' },
    { id: 'dial', label: 'Dial console' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'analytics', label: 'Analytics' },
    ...sharedTail
  ]
}
