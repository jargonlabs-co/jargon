import { useEffect, useMemo, useState } from 'react'
import type { Channel, ProjectBundle } from '../../api/client'
import { api } from '../../api/client'
import type { DialerVoice } from '../../lib/dialerVoice'
import { ProductShell } from './ProductShell'
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
import {
  continuePage,
  defaultPage,
  navForSpec,
  specOf,
  workspaceKindLabel
} from '../../lib/workspaceSpec'

interface Props {
  projectId: string
  onBundleChange?: (bundle: ProjectBundle) => void
  voice?: DialerVoice
}

export function ProductApp({ projectId, onBundleChange, voice }: Props) {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [focusContactId, setFocusContactId] = useState<string | null>(null)
  const [focusChannel, setFocusChannel] = useState<Channel | null>(null)

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
        setPage(defaultPage(specOf(next.project)))
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

  const spec = useMemo(() => (bundle ? specOf(bundle.project) : null), [bundle])
  const navItems = useMemo(() => (spec ? navForSpec(spec) : []), [spec])

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
      productKind={spec ? workspaceKindLabel(spec) : 'Outbound workspace'}
      navItems={navItems}
      activeNav={page}
      onNavChange={setPage}
      userLabel={bundle.project.team}
    >
      {page === 'context' ? (
        <ContextPage
          bundle={bundle}
          onContinue={() => setPage(spec ? continuePage(spec) : 'dashboard')}
        />
      ) : null}
      {page === 'today' ? (
        <TodayQueuePage
          bundle={bundle}
          onConnectData={() => setPage('connections')}
          onCall={async (id) => {
            setFocusContactId(id)
            setFocusChannel('call')
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('dial')
          }}
          onEmail={async (id) => {
            setFocusContactId(id)
            setFocusChannel('email')
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('inbox')
          }}
          onLinkedIn={async (id) => {
            setFocusContactId(id)
            setFocusChannel('linkedin')
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
          onStartSequence={() => setPage(spec ? continuePage(spec) : 'today')}
        />
      ) : null}
      {page === 'contacts' ? (
        <ContactsPage
          bundle={bundle}
          onRefresh={refresh}
          onConnectData={() => setPage('connections')}
          onCall={async (id) => {
            setFocusContactId(id)
            setFocusChannel('call')
            await api.patchContact(id, { status: 'active' })
            await refresh()
            setPage('dial')
          }}
          onEmail={async (id) => {
            setFocusContactId(id)
            setFocusChannel('email')
            setPage('inbox')
          }}
          onLinkedIn={async (id) => {
            setFocusContactId(id)
            setFocusChannel('linkedin')
            setPage('inbox')
          }}
        />
      ) : null}
      {page === 'dial' ? (
        <DialConsolePage
          bundle={bundle}
          onRefresh={refresh}
          initialContactId={focusContactId}
          voice={voice}
        />
      ) : null}
      {page === 'inbox' ? (
        <InboxPage
          bundle={bundle}
          onRefresh={refresh}
          initialContactId={focusContactId}
          initialChannel={focusChannel}
        />
      ) : null}
      {page === 'analytics' ? <AnalyticsPage bundle={bundle} /> : null}
      {page === 'connections' ? <ConnectionsPage /> : null}
      {page === 'settings' || page === 'help' ? (
        <div className="prod-view placeholder-view">
          <div className="prod-eyebrow">{page}</div>
          <h2>{page === 'settings' ? 'Settings' : 'Help'}</h2>
          <p>
            Workspace for {bundle.project.segment}. Connect HubSpot under Connections. Email, calling,
            and LinkedIn are sent by Jargon.
          </p>
          <button type="button" className="ghost-btn" onClick={() => setPage('connections')}>
            Open Connections
          </button>
        </div>
      ) : null}
    </ProductShell>
  )
}
