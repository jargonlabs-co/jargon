import { NavLink, Outlet } from '../router'
import { useAuth } from '../auth'
import { LogoMark } from '../components/LogoMark'

export function Layout() {
  const { me, signOut } = useAuth()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <LogoMark size={22} />
          <span>Jargon</span>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/">Builds</NavLink>
          <NavLink to="/billing">Billing</NavLink>
          <NavLink to="/api-keys">API keys</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-org">
            <span className="sidebar-org-name">{me?.org.name}</span>
            <span className="sidebar-org-plan">{me?.billing.planName ?? 'Free'}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
