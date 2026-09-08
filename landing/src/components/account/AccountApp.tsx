import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type AccountSnapshot,
  type ApiKeyPublic,
  type ConnectionPublic,
  type PlanId,
  type PortalBuild
} from '../../api'
import { useAuth } from '../../auth'
import { LogoMark } from '../LogoMark'
import { BillingPage, checkoutToast } from './BillingPage'
import { ClaudePage, KeysPage } from './ClaudeKeysPages'
import { DataPage } from './DataPage'
import { OverviewPage } from './OverviewPage'
import { ToolsPage, SettingsPage } from './ToolsSettingsPages'
import { UsagePage } from './UsagePage'
import { ACCOUNT_NAV, accountPageFromPath, fallbackSnapshot, formatCredits, PREVIEW_BUILDS, previewSnapshot } from './nav'

export function toolPath(projectId: string): string {
  return `/tools/${projectId}`
}

export function AccountApp({
  preview = false,
  path,
  onNavigate,
  onOpenTool
}: {
  preview?: boolean
  path: string
  onNavigate: (next: string) => void
  onOpenTool?: (projectId: string) => void
}) {
  const auth = useAuth()
  const user = preview ? { name: 'Tara', email: 'demo@jargon.app' } : auth.user!
  const org = preview ? { name: 'Jargon Demo', id: 'org_demo', slug: 'demo' } : auth.org!
  const signOut = preview ? () => window.location.assign('/') : auth.signOut
  const page = accountPageFromPath(path)

  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(preview ? previewSnapshot() : null)
  const [connections, setConnections] = useState<ConnectionPublic[]>([])
  const [builds, setBuilds] = useState<PortalBuild[]>(preview ? PREVIEW_BUILDS : [])
  const [apiKeys, setApiKeys] = useState<ApiKeyPublic[]>([])
  const [lastKey, setLastKey] = useState<{ key: string; environment: 'live' | 'sandbox' } | null>(null)
  const [pgTable, setPgTable] = useState('jargon_prospects')
  const [railwayProjects, setRailwayProjects] = useState<
    Array<{
      projectId: string
      projectName: string
      environmentId: string
      environmentName: string
      postgresServices: Array<{ serviceId: string; serviceName: string }>
    }>
  >([])
  const [selectedKey, setSelectedKey] = useState('')
  const [orgName, setOrgName] = useState(org.name)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (preview) {
      setSnapshot(previewSnapshot())
      setConnections([
        { id: '1', provider: 'hubspot', status: 'connected', accountLabel: 'Acme HubSpot' },
        {
          id: '2',
          provider: 'railway',
          status: 'connected',
          accountLabel: 'outbound-ops · Postgres · jargon_prospects',
          meta: { rowCount: '50', table: 'jargon_prospects', projectId: 'demo' }
        }
      ])
      setRailwayProjects([
        {
          projectId: 'demo',
          projectName: 'outbound-ops',
          environmentId: 'env',
          environmentName: 'production',
          postgresServices: [{ serviceId: 'pg', serviceName: 'Postgres' }]
        }
      ])
      setSelectedKey('demo|env|pg')
      setBuilds(PREVIEW_BUILDS)
      setApiKeys([
        {
          id: 'key_live',
          name: 'Claude Code',
          prefix: 'jarg_a1b2c3d4',
          environment: 'live',
          createdAt: Date.now()
        }
      ])
      return
    }
    const [account, conns, buildRes, keys] = await Promise.all([
      api.account().catch(() => null),
      api.connections(),
      api.builds(),
      api.listApiKeys().catch(() => [] as ApiKeyPublic[])
    ])
    setSnapshot(account ?? fallbackSnapshot())
    setApiKeys(keys)
    setConnections(conns)
    setBuilds(buildRes.builds)
    const railway = conns.find((c) => c.provider === 'railway')
    if (railway?.status === 'connected') {
      try {
        const { projects } = await api.listRailwayResources()
        setRailwayProjects(projects)
        if (projects[0]) {
          const svc = projects[0].postgresServices[0]
          setSelectedKey(`${projects[0].projectId}|${projects[0].environmentId}|${svc?.serviceId || ''}`)
        }
      } catch {
        setRailwayProjects([])
      }
    } else {
      setRailwayProjects([])
    }
  }, [preview])

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message))
  }, [refresh])

  useEffect(() => {
    setOrgName(org.name)
  }, [org.name])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('railway') === 'connected') {
      setToast('Railway signed in — choose a Postgres project')
      onNavigate('/data')
      params.delete('railway')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    } else if (params.get('railway') === 'error') {
      setError('Railway connection failed')
      params.delete('railway')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    } else if (params.get('checkout') === 'success') {
      setToast('Payment received — credits will show in a moment')
      params.delete('checkout')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
      void refresh()
    } else if (params.get('checkout') === 'cancel') {
      setToast('Checkout canceled')
      params.delete('checkout')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    }
  }, [onNavigate, refresh])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

  async function connect(provider: string) {
    if (preview) {
      setToast(`${provider} connect opens OAuth in production`)
      return
    }
    setBusy(provider)
    setError(null)
    try {
      const result = await api.startConnection(provider)
      if (result.url) {
        window.location.href = result.url
        return
      }
      setToast(`${provider} connected`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setBusy(null)
    }
  }

  async function syncHubSpot() {
    if (preview) {
      setToast('Would reload HubSpot contacts')
      return
    }
    setBusy('sync')
    setError(null)
    try {
      const result = await api.syncHubSpot()
      setToast(`Loaded ${result.count} contacts into your tools`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function bindRailway() {
    if (preview) {
      setToast('Would bind Railway Postgres')
      return
    }
    const [projectId, environmentId, serviceId] = selectedKey.split('|')
    const project = railwayProjects.find(
      (p) => p.projectId === projectId && p.environmentId === environmentId
    )
    if (!project) {
      setError('Choose a Railway project')
      return
    }
    const service = project.postgresServices.find((s) => s.serviceId === serviceId)
    setBusy('bind-railway')
    setError(null)
    try {
      await api.bindRailway({
        projectId: project.projectId,
        environmentId: project.environmentId,
        serviceId: service?.serviceId,
        projectName: project.projectName,
        serviceName: service?.serviceName,
        table: pgTable.trim() || 'jargon_prospects'
      })
      setToast('Railway Postgres ready')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bind failed')
    } finally {
      setBusy(null)
    }
  }

  async function syncRailway() {
    if (preview) {
      setToast('Would reload Railway prospects')
      return
    }
    setBusy('sync-railway')
    setError(null)
    try {
      const result = await api.syncRailway()
      setToast(`Loaded ${result.count} contacts from Railway`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function mintKey(environment: 'live' | 'sandbox') {
    if (preview) {
      setToast('API keys are created after login')
      return
    }
    setBusy(`apikey-${environment}`)
    setError(null)
    try {
      const created = await api.createApiKey(
        environment === 'sandbox' ? 'Claude sandbox' : 'Claude Code',
        environment
      )
      setLastKey({ key: created.key, environment: created.environment })
      setApiKeys(await api.listApiKeys())
      setToast(
        environment === 'live'
          ? 'Live key created — it can send real email and place real calls'
          : 'Sandbox key created — sends and dials do not reach real people'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create API key')
    } finally {
      setBusy(null)
    }
  }

  async function revokeKey(id: string) {
    if (preview) return
    setBusy(`revoke-${id}`)
    try {
      await api.revokeApiKey(id)
      setApiKeys((keys) => keys.filter((k) => k.id !== id))
      setToast('API key revoked')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke key')
    } finally {
      setBusy(null)
    }
  }

  async function checkout(intent: 'upgrade' | 'topup' | 'portal', plan?: PlanId, packId?: string) {
    const busyKey = intent === 'topup' ? `topup-${packId}` : intent === 'upgrade' ? `upgrade-${plan}` : 'portal'
    if (preview) {
      setToast('Checkout opens Stripe after Atlas is connected')
      return
    }
    setBusy(busyKey)
    setError(null)
    try {
      const link = await api.billingLink({ intent, plan, packId })
      setToast(checkoutToast(link))
      if (link.provider === 'stripe') {
        window.location.assign(link.url)
        return
      }
      onNavigate('/billing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout')
    } finally {
      setBusy(null)
    }
  }

  async function saveOrg() {
    if (preview) {
      setToast('Would rename workspace')
      return
    }
    setBusy('org')
    try {
      await api.updateOrg(orgName.trim())
      await auth.refresh()
      setToast('Workspace updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update workspace')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="account-shell">
      <aside className="account-nav">
        <button type="button" className="account-brand" onClick={() => onNavigate('/')}>
          <LogoMark size={24} />
          <span>Jargon</span>
        </button>
        <nav className="account-nav-links">
          {ACCOUNT_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`account-nav-link ${page === item.id ? 'is-active' : ''}`}
              onClick={() => onNavigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="account-nav-meta">
          <strong>{org.name}</strong>
          <span>{user.email}</span>
          {snapshot ? (
            <button type="button" className="account-credit-chip" onClick={() => onNavigate('/billing')}>
              {formatCredits(snapshot.credits.credits)} cr · {snapshot.credits.planName}
            </button>
          ) : null}
        </div>
      </aside>

      <div className="account-body">
        <header className="account-topbar">
          <div className="webapp-meta">
            <span className="webapp-org">{org.name}</span>
            <span className="webapp-user">{user.email}</span>
          </div>
          <button type="button" className="btn ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </header>
        <main className="account-main">
          {!snapshot && !error ? <p className="section-lede">Loading account…</p> : null}
          {snapshot && page === 'overview' ? (
            <OverviewPage
              snapshot={snapshot}
              connections={connections}
              builds={builds}
              onNavigate={onNavigate}
              onOpenTool={(id) => onOpenTool?.(id)}
            />
          ) : null}
          {snapshot && page === 'usage' ? <UsagePage snapshot={snapshot} /> : null}
          {snapshot && page === 'billing' ? (
            <BillingPage snapshot={snapshot} busy={busy} onCheckout={checkout} />
          ) : null}
          {page === 'data' ? (
            <DataPage
              connections={connections}
              railwayProjects={railwayProjects}
              selectedKey={selectedKey}
              pgTable={pgTable}
              busy={busy}
              onPgTable={setPgTable}
              onSelectedKey={setSelectedKey}
              onConnect={(provider) => void connect(provider)}
              onSyncHubSpot={() => void syncHubSpot()}
              onBindRailway={() => void bindRailway()}
              onSyncRailway={() => void syncRailway()}
            />
          ) : null}
          {page === 'claude' ? <ClaudePage claude={snapshot?.claude} /> : null}
          {page === 'keys' ? (
            <KeysPage
              apiKeys={apiKeys}
              lastKey={lastKey}
              busy={busy}
              onMint={(environment) => void mintKey(environment)}
              onRevoke={(id) => void revokeKey(id)}
            />
          ) : null}
          {page === 'tools' ? (
            <ToolsPage builds={builds} onOpenTool={(id) => onOpenTool?.(id)} />
          ) : null}
          {page === 'settings' ? (
            <SettingsPage
              orgName={orgName}
              email={user.email}
              busy={busy}
              onOrgName={setOrgName}
              onSaveOrg={() => void saveOrg()}
              onSignOut={() => void signOut()}
            />
          ) : null}
          {error ? <p className="form-error webapp-error">{error}</p> : null}
        </main>
      </div>
      {toast ? <div className="webapp-toast">{toast}</div> : null}
    </div>
  )
}

export { AccountApp as WebApp }
