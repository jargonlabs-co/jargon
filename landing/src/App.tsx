import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './auth'
import { LoginPanel } from './components/LoginPanel'
import { AccountApp, toolPath } from './components/account/AccountApp'
import { ToolApp } from './components/ToolApp'
import { MarketingPage } from './MarketingPage'
import { ChangelogPage } from './components/ChangelogPage'
import { ConnectClaude } from './components/ConnectClaude'
import { IconPage } from './components/IconPage'
import { ResetPasswordPanel } from './components/ResetPasswordPanel'
import { SignupPage } from './components/SignupPage'

function toolIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tools\/([^/]+)\/?$/)
  return match?.[1] ?? null
}

function Root() {
  const { user, loading } = useAuth()
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
    setPath(window.location.pathname)
  }

  if (path === '/icon' || path === '/icon/') {
    return <IconPage />
  }

  if (path === '/reset-password' || path.startsWith('/reset-password')) {
    return <ResetPasswordPanel />
  }

  if (previewApp) {
    return <AccountApp preview path={path} onNavigate={navigate} />
  }

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  const toolId = toolIdFromPath(path)

  if (
    path === '/connect/claude' ||
    path.startsWith('/connect/claude/') ||
    (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'consent')
  ) {
    return <ConnectClaude />
  }

  if (path === '/changelog' || path === '/changelog/') {
    return <ChangelogPage signedIn={Boolean(user)} onOpenApp={() => navigate('/')} />
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

  if (path === '/signup' || path === '/signup/') {
    return <SignupPage onSignIn={() => navigate('/login')} />
  }

  if (path === '/login' || path === '/login/') {
    return (
      <LoginPanel
        key="login"
        initialMode="login"
        onModeChange={(mode) => {
          if (mode === 'register') navigate('/signup')
        }}
        onClose={() => navigate('/')}
      />
    )
  }

  if (toolId) {
    return (
      <LoginPanel
        key="tool-login"
        initialMode="login"
        onClose={() => navigate('/')}
      />
    )
  }

  return <MarketingPage />
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
