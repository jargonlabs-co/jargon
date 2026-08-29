import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getStoredToken, setStoredToken, type MeResponse } from './api'

interface AuthState {
  me: MeResponse | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const token = getStoredToken()
    if (!token) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      const payload = await api.me()
      setMe(payload)
    } catch {
      setStoredToken(null)
      setMe(null)
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
    setMe(null)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <AuthContext.Provider value={{ me, loading, refresh, signOut }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
