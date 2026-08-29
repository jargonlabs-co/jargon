import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getStoredToken, setStoredToken, type Org, type PublicUser } from './api'

interface AuthState {
  user: PublicUser | null
  org: Org | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const token = getStoredToken()
    if (!token) {
      setUser(null)
      setOrg(null)
      setLoading(false)
      return
    }
    try {
      const payload = await api.me()
      setUser(payload.user)
      setOrg(payload.org)
    } catch {
      setStoredToken(null)
      setUser(null)
      setOrg(null)
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    setStoredToken(null)
    setUser(null)
    setOrg(null)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <AuthContext.Provider value={{ user, org, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
