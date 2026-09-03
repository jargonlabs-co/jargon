import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './auth'
import { LoginPanel } from './components/LoginPanel'
import { WebApp, toolPath } from './components/WebApp'
import { ToolApp } from './components/ToolApp'
import { MarketingPage } from './MarketingPage'

function toolIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tools\/([^/]+)\/?$/)
  return match?.[1] ?? null
}

function Root() {
  const { user, loading } = useAuth()
  const [loginOpen, setLoginOpen] = useState(false)
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

  if (previewApp) {
    return <WebApp preview />
  }

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  const toolId = toolIdFromPath(path)

  if (user && toolId) {
    return <ToolApp projectId={toolId} onBack={() => navigate('/')} />
  }

  if (user) {
    return (
      <WebApp
        onOpenTool={(id) => {
          navigate(toolPath(id))
        }}
      />
    )
  }

  return (
    <>
      <MarketingPage onLogin={() => setLoginOpen(true)} />
      {loginOpen ? <LoginPanel onClose={() => setLoginOpen(false)} /> : null}
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
