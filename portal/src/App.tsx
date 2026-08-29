import { AuthProvider, useAuth } from './auth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { RouterProvider } from './router'

function AppRoutes() {
  const { me, loading } = useAuth()
  if (loading) return <div className="page-loading">Loading…</div>
  if (!me) return <LoginPage />
  return (
    <RouterProvider>
      <Layout />
    </RouterProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
