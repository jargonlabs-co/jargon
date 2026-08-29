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
import { TodayQueuePage } from './pages/TodayQueuePage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { ContextPage } from './pages/ContextPage'

interface Props {
  projectId: string
  onBundleChange?: (bundle: ProjectBundle) => void
}

export function ProductApp({ projectId, onBundleChange }: Props) {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [focusContactId, setFocusContactId] = useState<string | null>(null)

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
      {page === 'context' ? (
        <ContextPage
          bundle={bundle}
          onContinue={() =>
            setPage(bundle.project.kind === 'today' ? 'sequences' : bundle.project.kind === 'dialer' ? 'dial' : 'dashboard')
          }
        />
      ) : null}
      {page === 'today' ? (
        <TodayQueuePage
          bundle={bundle}
          onRefresh={refresh}
          onCall={async (id) => {
            setFocusContactId(id)
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('dial')
          }}
          onEmail={async (id) => {
            setFocusContactId(id)
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('inbox')
          }}
          onOpenSequence={() => setPage('sequences')}
        />
      ) : null}
      {page === 'dashboard' ? <DashboardPage bundle={bundle} onNavigate={setPage} /> : null}
      {page === 'campaigns' ? (
        <CampaignsPage bundle={bundle} onRefresh={refresh} onOpenDial={() => setPage('dial')} />
      ) : null}
      {page === 'sequences' ? (
        <SequencesPage
          bundle={bundle}
          onOpenInbox={() => setPage('inbox')}
          onStartSequence={() => setPage('today')}
        />
      ) : null}
      {page === 'contacts' ? (
        <ContactsPage
          bundle={bundle}
          onRefresh={refresh}
          onCall={async (id) => {
            setFocusContactId(id)
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('dial')
          }}
          onEmail={async (id) => {
            setFocusContactId(id)
            setPage('inbox')
          }}
        />
      ) : null}
      {page === 'dial' ? (
        <DialConsolePage
          bundle={bundle}
          onRefresh={refresh}
          initialContactId={focusContactId}
        />
      ) : null}
      {page === 'inbox' ? (
        <InboxPage bundle={bundle} onRefresh={refresh} initialContactId={focusContactId} />
      ) : null}
      {page === 'analytics' ? <AnalyticsPage bundle={bundle} /> : null}
      {page === 'connections' ? <ConnectionsPage /> : null}
      {page === 'settings' || page === 'help' ? (
        <div className="prod-view placeholder-view">
          <div className="prod-eyebrow">{page}</div>
          <h2>{page === 'settings' ? 'Settings' : 'Help'}</h2>
          <p>
            Multi-tenant workspace for {bundle.project.segment}. Connect HubSpot, Gmail, and Twilio
            under Connections.
          </p>
          <button type="button" className="ghost-btn" onClick={() => setPage('connections')}>
            Open Connections
          </button>
        </div>
      ) : null}
    </ProductShell>
  )
}

function defaultPage(kind: ProjectBundle['project']['kind']): string {
  if (kind === 'today' || kind === 'dialer') return 'context'
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
    case 'today':
      return 'Outbound sequencer'
    default:
      return 'Sales workspace'
  }
}

function navForKind(kind: ProjectBundle['project']['kind']): NavItem[] {
  const sharedTail = [
    { id: 'connections', label: 'Connections', section: 'system' as const },
    { id: 'settings', label: 'Settings', section: 'system' as const },
    { id: 'help', label: 'Help', section: 'system' as const }
  ]
  if (kind === 'today') {
    return [
      { id: 'context', label: 'Context' },
      { id: 'sequences', label: 'Sequence' },
      { id: 'today', label: 'Daily tasks' },
      { id: 'inbox', label: 'Inbox' },
      { id: 'dial', label: 'Dial console' },
      { id: 'contacts', label: 'Contacts' },
      { id: 'analytics', label: 'Analytics' },
      ...sharedTail
    ]
  }
  if (kind === 'dialer') {
    return [
      { id: 'context', label: 'Context' },
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
