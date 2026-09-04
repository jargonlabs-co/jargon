import type { JargonConfig } from './config.js'

export type DeployResult = {
  projectId: string
  contactCount: number
  dashboardPath?: string
  project?: { name: string; prompt: string }
}

export type ProjectSummary = {
  id: string
  name: string
  kind: string
  updatedAt: number
}

async function request<T>(
  cfg: JargonConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${cfg.apiUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      ...(init.headers as Record<string, string> | undefined)
    }
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) message = json.error
    } catch {
      /* plain text */
    }
    throw new Error(message || `Request failed (${res.status})`)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export async function loginWithPassword(
  apiUrl: string,
  email: string,
  password: string
): Promise<{ token: string; email: string }> {
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) message = json.error
    } catch {
      /* ignore */
    }
    throw new Error(message || `Login failed (${res.status})`)
  }
  const data = JSON.parse(text) as { token: string; user: { email: string } }
  return { token: data.token, email: data.user.email }
}

export async function createApiKey(
  cfg: JargonConfig,
  name: string
): Promise<{ key: string; prefix: string; id: string }> {
  return request(cfg, '/auth/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name })
  })
}

export async function deployTool(
  cfg: JargonConfig,
  input: { prompt: string; label?: string }
): Promise<DeployResult> {
  return request(cfg, '/tools/deploy', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      label: input.label
    })
  })
}

export async function listProjects(cfg: JargonConfig): Promise<ProjectSummary[]> {
  return request(cfg, '/projects')
}

export type ConnectionPublic = {
  id: string
  provider: string
  status: string
  accountLabel?: string
  meta?: Record<string, string>
  lastSyncAt?: number
}

export async function listConnections(cfg: JargonConfig): Promise<ConnectionPublic[]> {
  return request(cfg, '/connections')
}

export async function connectPostgres(
  cfg: JargonConfig,
  input: { databaseUrl: string; table?: string }
): Promise<{ connection: ConnectionPublic; rowCount: number; table: string }> {
  return request(cfg, '/connections/postgres/start', {
    method: 'POST',
    body: JSON.stringify({
      databaseUrl: input.databaseUrl,
      table: input.table ?? 'jargon_prospects'
    })
  })
}

export async function startRailwayOAuth(
  cfg: JargonConfig
): Promise<{ url: string }> {
  return request(cfg, '/connections/railway/start', {
    method: 'POST',
    body: '{}'
  })
}

export async function listRailwayResources(cfg: JargonConfig): Promise<{
  projects: Array<{
    projectId: string
    projectName: string
    environmentId: string
    environmentName: string
    postgresServices: Array<{ serviceId: string; serviceName: string }>
  }>
}> {
  return request(cfg, '/connections/railway/resources')
}

export async function bindRailway(
  cfg: JargonConfig,
  body: {
    projectId: string
    environmentId: string
    serviceId?: string
    table?: string
    projectName?: string
    serviceName?: string
  }
): Promise<{ connection: ConnectionPublic; table: string }> {
  return request(cfg, '/connections/railway/bind', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function syncPostgres(
  cfg: JargonConfig,
  body: { projectId?: string; limit?: number } = {}
): Promise<{ count: number; source: string; table?: string }> {
  return request(cfg, '/connections/postgres/sync', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function syncRailway(
  cfg: JargonConfig,
  body: { projectId?: string; limit?: number } = {}
): Promise<{ count: number; source: string; table?: string }> {
  return request(cfg, '/connections/railway/sync', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function health(apiUrl: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/health`)
  if (!res.ok) throw new Error(`API unreachable (${res.status})`)
  return res.json() as Promise<{ ok: boolean }>
}
