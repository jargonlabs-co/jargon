const TOKEN_KEY = 'jargon_portal_token'

export function getApiBase(): string {
  return (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export interface PublicUser {
  id: string
  email: string
  name: string
}

export interface Org {
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}

export interface BillingSnapshot {
  plan: 'free' | 'pro'
  status: string
  planName: string
  priceMonthly: number
  buildCount: number
  buildLimit: number | null
  currentPeriodEnd?: number
  stripeConfigured: boolean
  plans: Array<{
    id: 'free' | 'pro'
    name: string
    priceMonthly: number
    description: string
    buildLimit: number | null
    features: string[]
  }>
}

export interface AuthPayload {
  token: string
  user: PublicUser
  org: Org
}

export interface MeResponse {
  user: PublicUser
  org: Org
  demoMode: boolean
  billing: BillingSnapshot
}

export interface PortalBuild {
  project: {
    id: string
    name: string
    kind: string
    prompt: string
    segment: string
    createdAt: number
    updatedAt: number
  }
  contactCount: number
  shares: Array<{
    id: string
    label: string
    createdAt: number
    expiresAt: number
    revoked: boolean
    commentCount: number
  }>
}

export interface ApiKeyPublic {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt?: number
  revokedAt?: number
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const authToken = token ?? getStoredToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`

  const res = await fetch(`${getApiBase()}${path}`, { ...init, headers })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const json = (await res.json()) as { error?: string }
      if (json.error) message = json.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  login(email: string, password: string) {
    return request<AuthPayload>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
  },
  register(input: { email: string; password: string; name?: string; orgName?: string }) {
    return request<AuthPayload>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },
  logout() {
    return request<void>('/auth/logout', { method: 'POST' })
  },
  me() {
    return request<MeResponse>('/auth/me')
  },
  builds() {
    return request<{ builds: PortalBuild[] }>('/portal/builds')
  },
  createShare(projectId: string, label?: string) {
    return request<{ url: string; label: string; expiresAt: number }>(`/projects/${projectId}/share`, {
      method: 'POST',
      body: JSON.stringify({ label })
    })
  },
  updateOrgName(name: string) {
    return request<{ org: Org }>('/account/org', {
      method: 'PATCH',
      body: JSON.stringify({ name })
    })
  },
  billing() {
    return request<BillingSnapshot>('/billing')
  },
  checkout() {
    return request<{ url: string }>('/billing/checkout', { method: 'POST', body: '{}' })
  },
  billingPortal() {
    return request<{ url: string }>('/billing/portal', { method: 'POST', body: '{}' })
  },
  listApiKeys() {
    return request<ApiKeyPublic[]>('/auth/api-keys')
  },
  createApiKey(name: string) {
    return request<{ id: string; name: string; prefix: string; key: string; createdAt: number }>(
      '/auth/api-keys',
      { method: 'POST', body: JSON.stringify({ name }) }
    )
  },
  revokeApiKey(id: string) {
    return request<void>(`/auth/api-keys/${id}`, { method: 'DELETE' })
  }
}
