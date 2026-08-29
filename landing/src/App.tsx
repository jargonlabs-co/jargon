import { useState } from 'react'
import { AuthProvider, useAuth } from './auth'
import { LoginPanel } from './components/LoginPanel'
import { WebApp } from './components/WebApp'
import { MarketingPage } from './MarketingPage'

function Root() {
  const { user, loading } = useAuth()
  const [loginOpen, setLoginOpen] = useState(false)
  const previewApp =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'app'

  if (previewApp) {
    return <WebApp preview />
  }

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  if (user) {
    return <WebApp />
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
