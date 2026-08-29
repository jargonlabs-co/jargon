import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'

export type RoutePath = '/' | '/billing' | '/api-keys' | '/account'

const routes: Record<RoutePath, () => Promise<{ default: () => ReactNode }>> = {
  '/': () => import('./pages/DashboardPage'),
  '/billing': () => import('./pages/BillingPage'),
  '/api-keys': () => import('./pages/ApiKeysPage'),
  '/account': () => import('./pages/AccountPage')
}

function normalizePath(path: string): RoutePath {
  if (path === '/billing') return '/billing'
  if (path === '/api-keys') return '/api-keys'
  if (path === '/account') return '/account'
  return '/'
}

interface RouterState {
  path: RoutePath
  navigate: (path: RoutePath) => void
}

const RouterContext = createContext<RouterState | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<RoutePath>(() => normalizePath(window.location.pathname))

  useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function navigate(next: RoutePath) {
    if (next === path) return
    window.history.pushState({}, '', next)
    setPath(next)
  }

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>
}

export function useRouter() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within RouterProvider')
  return ctx
}

export function NavLink({ to, children }: { to: RoutePath; children: ReactNode }) {
  const { path, navigate } = useRouter()
  return (
    <button
      type="button"
      className={path === to ? 'nav-link active' : 'nav-link'}
      onClick={() => navigate(to)}
    >
      {children}
    </button>
  )
}

export function Outlet() {
  const { path } = useRouter()
  const [Page, setPage] = useState<(() => ReactNode) | null>(null)

  useEffect(() => {
    let cancelled = false
    setPage(null)
    void routes[path]().then((mod) => {
      if (!cancelled) setPage(() => mod.default)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!Page) return <div className="page-loading">Loading…</div>
  return <Page />
}
