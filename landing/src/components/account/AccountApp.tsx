import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type AccountSnapshot,
  type PlanId,
  type PortalBuild
} from '../../api'
import { useAuth } from '../../auth'
import { LogoMark } from '../LogoMark'
import { BillingPage, checkoutToast } from './BillingPage'
import { OverviewPage } from './OverviewPage'
import { ToolsPage, SettingsPage } from './ToolsSettingsPages'
import { UsagePage } from './UsagePage'
import { AdminPage } from './AdminPage'
import { ACCOUNT_NAV, accountPageFromPath, formatCredits, PREVIEW_BUILDS, previewSnapshot } from './nav'

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
  const [builds, setBuilds] = useState<PortalBuild[]>(preview ? PREVIEW_BUILDS : [])
  const [orgName, setOrgName] = useState(org.name)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (preview) {
      setSnapshot(previewSnapshot())
      setBuilds(PREVIEW_BUILDS)
      return
    }
    const [account, buildRes] = await Promise.all([api.account(), api.builds()])
    setSnapshot(account)
    setBuilds(buildRes.builds)
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
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

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
        <main className={`account-main${page === 'overview' ? ' is-home' : ''}${page === 'admin' ? ' is-wide' : ''}`}>
          {!snapshot && !error ? <p className="section-lede">Loading account…</p> : null}
          {snapshot && page === 'overview' ? (
            <OverviewPage
              snapshot={snapshot}
              builds={builds}
              userName={user.name}
              userEmail={user.email}
              onNavigate={onNavigate}
              onOpenTool={(id) => onOpenTool?.(id)}
            />
          ) : null}
          {snapshot && page === 'usage' ? <UsagePage snapshot={snapshot} preview={preview} /> : null}
          {snapshot && page === 'billing' ? (
            <BillingPage snapshot={snapshot} busy={busy} onCheckout={checkout} />
          ) : null}
          {page === 'tools' ? (
            <ToolsPage builds={builds} onOpenTool={(id) => onOpenTool?.(id)} />
          ) : null}
          {page === 'admin' ? <AdminPage /> : null}
          {page === 'settings' ? (
            <SettingsPage
              orgName={orgName}
              workspaceName={org.name}
              email={user.email}
              busy={busy}
              preview={preview}
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
