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

export type PlanId = 'free' | 'team' | 'scale'
export type BillingIntent = 'upgrade' | 'topup' | 'portal'

export interface AccountPlan {
  id: PlanId
  name: string
  creditsIncluded: number
  status: string
}

export interface CreditWallet {
  type: 'recurring' | 'topup'
  credits: number
  nextRefreshAt: string | null
  expiresAt: string | null
}

export interface CreditTopup {
  id: string
  type: 'purchase' | 'granted' | 'auto_topup'
  grantedCredits: number
  remainingCredits: number
  grantedAt: string
  expiresAt: string | null
}

export interface AccountCredits {
  orgId: string
  plan: PlanId
  planName: string
  status: string
  credits: number
  included: number
  periodStart: string | null
  periodEnd: string | null
  billingUrl: string
  payments: { provider: 'stripe' | 'pending'; ready: boolean }
  wallets: CreditWallet[]
  creditTopups: CreditTopup[]
}

export interface UsageTotals {
  credits: number
  emails: number
  calls: number
  linkedin: number
}

export interface AccountUsage {
  periodStart: string | null
  periodEnd: string | null
  totals: UsageTotals
  daily: Array<UsageTotals & { day: string }>
  byProject: Array<UsageTotals & { projectId: string; projectName: string }>
}

export interface ClaudeConnector {
  connected: boolean
  connectedAt: string | null
  mcpUrl: string
  connectorUrl: string
}

export interface AccountSnapshot {
  credits: AccountCredits
  usage: AccountUsage
  catalog: {
    plans: Array<{
      id: PlanId
      name: string
      monthlyCredits: number
      amountCents: number
      description: string
    }>
    packs: Array<{ id: string; credits: number; amountCents: number; label: string }>
    costs: { email: number; call: number; linkedin: number }
  }
  claude?: ClaudeConnector
}

export interface BillingLink {
  url: string
  provider: 'stripe' | 'pending'
  message?: string
}

export interface AccountMe {
  plan: AccountPlan
  credits: {
    remaining: number
    included: number
    periodStart: string | null
    periodEnd: string | null
    billingUrl: string
    wallets?: CreditWallet[]
    creditTopups?: CreditTopup[]
  }
  payments: { provider: 'stripe' | 'pending'; ready: boolean }
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
}

export interface DeployResult {
  projectId: string
  project: { id: string; name: string; kind: string; prompt: string }
  contactCount: number
  dashboardPath?: string
  dashboardUrl?: string
}

export interface ApiKeyPublic {
  id: string
  name: string
  prefix: string
  environment?: 'live' | 'sandbox'
  createdAt: number
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
    return request<{ user: PublicUser; org: Org } & Partial<AccountMe>>('/auth/me')
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
  syncHubSpot() {
    return request<{ count: number; source: string }>('/connections/hubspot/sync', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  connectPostgres(body: { databaseUrl: string; table?: string }) {
    return request<{ connection: ConnectionPublic; rowCount: number; table: string }>(
      '/connections/postgres/start',
      { method: 'POST', body: JSON.stringify(body) }
    )
  },
  syncPostgres() {
    return request<{ count: number; source: string; table?: string }>(
      '/connections/postgres/sync',
      { method: 'POST', body: JSON.stringify({}) }
    )
  },
  listRailwayResources() {
    return request<{
      projects: Array<{
        projectId: string
        projectName: string
        environmentId: string
        environmentName: string
        postgresServices: Array<{ serviceId: string; serviceName: string }>
      }>
    }>('/connections/railway/resources')
  },
  bindRailway(body: {
    projectId: string
    environmentId: string
    serviceId?: string
    table?: string
    projectName?: string
    serviceName?: string
  }) {
    return request<{ connection: ConnectionPublic; table: string }>(
      '/connections/railway/bind',
      { method: 'POST', body: JSON.stringify(body) }
    )
  },
  syncRailway() {
    return request<{ count: number; source: string; table?: string }>(
      '/connections/railway/sync',
      { method: 'POST', body: JSON.stringify({}) }
    )
  },
  deploy(prompt: string) {
    return request<DeployResult>('/tools/deploy', {
      method: 'POST',
      body: JSON.stringify({ prompt })
    })
  },
  builds() {
    return request<{ builds: PortalBuild[] }>('/portal/builds')
  },
  listApiKeys() {
    return request<ApiKeyPublic[]>('/auth/api-keys')
  },
  createApiKey(name: string, environment: 'live' | 'sandbox' = 'live') {
    return request<{
      key: string
      prefix: string
      id: string
      name: string
      environment: 'live' | 'sandbox'
    }>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, environment })
    })
  },
  revokeApiKey(id: string) {
    return request<void>(`/auth/api-keys/${id}`, { method: 'DELETE' })
  },
  account() {
    return request<AccountSnapshot>('/account')
  },
  accountCredits() {
    return request<AccountCredits>('/account/credits')
  },
  accountUsage() {
    return request<AccountUsage>('/account/usage')
  },
  billingLink(body: { intent: BillingIntent; plan?: PlanId; packId?: string }) {
    return request<BillingLink>('/account/billing-link', {
      method: 'POST',
      body: JSON.stringify(body)
    })
  },
  updateOrg(name: string) {
    return request<{ org: Org }>('/account/org', {
      method: 'PATCH',
      body: JSON.stringify({ name })
    })
  },
  consentMcp(input: {
    client_id: string
    redirect_uri: string
    code_challenge: string
    state?: string
  }) {
    return request<{ redirect: string }>('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }
}

/** Public MCP origin Claude should use (logo + OAuth). Do not point this at Railway. */
export const PUBLIC_MCP_URL = 'https://www.jargonlabs.co/mcp'

function isLocalApi(base: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(base)
}

function isRailwayHosted(url: string): boolean {
  return /railway\.app|jargon-api-production/i.test(url)
}

export function getMcpUrl(): string {
  const base = getApiBase()
  if (isLocalApi(base)) return `${base}/mcp`
  return PUBLIC_MCP_URL
}

export function resolveMcpUrl(url?: string | null): string {
  if (!url || isRailwayHosted(url)) return getMcpUrl()
  return url
}

/** Opens Claude’s Add custom connector dialog with Jargon prefilled. */
export function getClaudeConnectorInstallUrl(mcpUrl = getMcpUrl()): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: 'Jargon',
    connectorUrl: resolveMcpUrl(mcpUrl)
  })
  return `https://claude.ai/customize/connectors?${params.toString()}`
}
