const TOKEN_KEY = 'jargon_web_token'

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
}

export interface AuthPayload {
  token: string
  user: PublicUser
  org: Org
}

export interface ConnectionPublic {
  id: string
  provider: string
  status: string
  accountLabel?: string
  meta?: Record<string, string>
}

export interface PortalBuild {
  project: {
    id: string
    name: string
    kind: string
    prompt: string
    updatedAt: number
  }
  contactCount: number
  shares: Array<{ id: string; label: string; expiresAt: number; revoked: boolean }>
}

export interface DeployResult {
  projectId: string
  project: { id: string; name: string; kind: string; prompt: string }
  contactCount: number
  shareUrl?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  if (token) headers.Authorization = `Bearer ${token}`

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
    return request<{ user: PublicUser; org: Org }>('/auth/me')
  },
  connections() {
    return request<ConnectionPublic[]>('/connections')
  },
  startConnection(provider: string, body?: Record<string, string>) {
    return request<{ url?: string; connection?: ConnectionPublic }>(
      `/connections/${provider}/start`,
      { method: 'POST', body: JSON.stringify(body ?? {}) }
    )
  },
  deploy(prompt: string) {
    return request<DeployResult>('/tools/deploy', {
      method: 'POST',
      body: JSON.stringify({ prompt, share: true })
    })
  },
  builds() {
    return request<{ builds: PortalBuild[] }>('/portal/builds')
  },
  createShare(projectId: string, label?: string) {
    return request<{ url: string }>(`/projects/${projectId}/share`, {
      method: 'POST',
      body: JSON.stringify({ label })
    })
  }
}
