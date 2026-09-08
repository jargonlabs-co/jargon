import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './auth'
import { LoginPanel } from './components/LoginPanel'
import { AccountApp, toolPath } from './components/account/AccountApp'
import { ToolApp } from './components/ToolApp'
import { MarketingPage } from './MarketingPage'
import { ConnectClaude } from './components/ConnectClaude'
import { IconPage } from './components/IconPage'

function toolIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tools\/([^/]+)\/?$/)
  return match?.[1] ?? null
}

function Root() {
  const { user, loading } = useAuth()
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [path, setPath] = useState(() => window.location.pathname)
  const previewApp =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'app'

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function navigate(next: string) {
    window.history.pushState({}, '', next)
    setPath(next)
  }

  function openAuth(mode: 'login' | 'register') {
    setAuthMode(mode)
    setAuthOpen(true)
  }

  if (path === '/icon' || path === '/icon/') {
    return <IconPage />
  }

  if (previewApp) {
    return <AccountApp preview path={path} onNavigate={navigate} />
  }

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  const toolId = toolIdFromPath(path)

  if (path === '/connect/claude' || path.startsWith('/connect/claude/')) {
    return <ConnectClaude />
  }

  if (user && toolId) {
    return <ToolApp projectId={toolId} onBack={() => navigate('/tools')} />
  }

  if (user) {
    return (
      <AccountApp
        path={path}
        onNavigate={navigate}
        onOpenTool={(id) => {
          navigate(toolPath(id))
        }}
      />
    )
  }

  return (
    <>
      <MarketingPage onLogin={() => openAuth('login')} onSignUp={() => openAuth('register')} />
      {authOpen ? (
        <LoginPanel key={authMode} initialMode={authMode} onClose={() => setAuthOpen(false)} />
      ) : null}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
