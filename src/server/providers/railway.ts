import type { ServerConfig } from '../config'
import {
  createOAuthState,
  getConnection,
  oauthRedirectUri,
  readSecrets,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import type { DataStore } from '../store'
import {
  DEFAULT_PROSPECTS_TABLE,
  fetchPostgresProspects,
  writePostgresContactsToProjects
} from './postgresProspects'

const RAILWAY_AUTH = 'https://backboard.railway.com/oauth/auth'
const RAILWAY_TOKEN = 'https://backboard.railway.com/oauth/token'
const RAILWAY_ME = 'https://backboard.railway.com/oauth/me'
const RAILWAY_GQL = 'https://backboard.railway.com/graphql/v2'

export type RailwayProjectOption = {
  projectId: string
  projectName: string
  environmentId: string
  environmentName: string
  postgresServices: Array<{ serviceId: string; serviceName: string }>
}

function railwayConfigured(config: ServerConfig): boolean {
  return Boolean(config.railway.clientId && config.railway.clientSecret)
}

export function railwayAuthUrl(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  userId: string
): string {
  const state = createOAuthState(store, { orgId, userId, provider: 'railway' })
  if (!railwayConfigured(config)) {
    return `${config.publicUrl}/oauth/railway/callback?code=demo&state=${state.id}`
  }
  const url = new URL(RAILWAY_AUTH)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.railway.clientId)
  url.searchParams.set('redirect_uri', oauthRedirectUri(config, 'railway'))
  url.searchParams.set('scope', config.railway.scopes)
  url.searchParams.set('state', state.id)
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export async function exchangeRailwayCode(
  config: ServerConfig,
  code: string
): Promise<ProviderSecrets & { accountLabel: string }> {
  if (code === 'demo' || !railwayConfigured(config)) {
    return {
      accessToken: 'demo-railway-token',
      refreshToken: 'demo-railway-refresh',
      expiresAt: Date.now() + 3600_000,
      accountLabel: 'Railway (demo)'
    }
  }

  const basic = Buffer.from(
    `${config.railway.clientId}:${config.railway.clientSecret}`
  ).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthRedirectUri(config, 'railway')
  })
  const res = await fetch(RAILWAY_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!res.ok) throw new Error(`Railway token exchange failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }

  let accountLabel = 'Railway'
  try {
    const meRes = await fetch(RAILWAY_ME, {
      headers: { Authorization: `Bearer ${json.access_token}` }
    })
    if (meRes.ok) {
      const me = (await meRes.json()) as { email?: string; name?: string }
      accountLabel = me.email || me.name || accountLabel
    }
  } catch {
    /* ignore profile fetch errors */
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    tokenType: json.token_type,
    accountLabel
  }
}

async function refreshRailwayToken(
  config: ServerConfig,
  refreshToken: string
): Promise<ProviderSecrets> {
  if (refreshToken === 'demo-railway-refresh' || !railwayConfigured(config)) {
    return {
      accessToken: 'demo-railway-token',
      refreshToken: 'demo-railway-refresh',
      expiresAt: Date.now() + 3600_000
    }
  }
  const basic = Buffer.from(
    `${config.railway.clientId}:${config.railway.clientSecret}`
  ).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  const res = await fetch(RAILWAY_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!res.ok) throw new Error(`Railway token refresh failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    tokenType: json.token_type
  }
}

export async function resolveRailwayAccessToken(
  store: DataStore,
  config: ServerConfig,
  orgId: string
): Promise<{ accessToken: string; demo: boolean } | null> {
  const conn = getConnection(store, orgId, 'railway')
  if (!conn || conn.status !== 'connected') return null
  const secrets = readSecrets(conn)
  const demo = secrets.accessToken === 'demo-railway-token'
  if (
    !demo &&
    secrets.refreshToken &&
    secrets.expiresAt &&
    secrets.expiresAt < Date.now() + 60_000
  ) {
    const refreshed = await refreshRailwayToken(config, secrets.refreshToken)
    upsertConnection(store, {
      orgId,
      provider: 'railway',
      status: 'connected',
      accountLabel: conn.accountLabel,
      secrets: { ...secrets, ...refreshed },
      meta: conn.meta
    })
    return { accessToken: refreshed.accessToken, demo: false }
  }
  return { accessToken: secrets.accessToken, demo }
}

async function railwayGraphql<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(RAILWAY_GQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.[0]?.message || `Railway GraphQL failed (${res.status})`)
  }
  if (!json.data) throw new Error('Railway GraphQL returned no data')
  return json.data
}

export async function listRailwayPostgresTargets(
  accessToken: string,
  demo = false
): Promise<RailwayProjectOption[]> {
  if (demo || accessToken === 'demo-railway-token') {
    return [
      {
        projectId: 'demo-project',
        projectName: 'outbound-ops (demo)',
        environmentId: 'demo-env',
        environmentName: 'production',
        postgresServices: [{ serviceId: 'demo-pg', serviceName: 'Postgres' }]
      }
    ]
  }

  // OAuth tokens expose authorized projects via externalWorkspaces (not top-level projects)
  const granted = await railwayGraphql<{
    externalWorkspaces?: Array<{
      id: string
      name: string
      projects?: Array<{ id: string; name: string }>
    }>
  }>(
    accessToken,
    `query {
      externalWorkspaces {
        id
        name
        projects { id name }
      }
    }`
  )

  const projectRefs = (granted.externalWorkspaces ?? []).flatMap((ws) =>
    (ws.projects ?? []).map((p) => ({ id: p.id, name: p.name }))
  )

  const out: RailwayProjectOption[] = []
  for (const ref of projectRefs) {
    const data = await railwayGraphql<{
      project?: {
        id: string
        name: string
        services?: { edges?: Array<{ node?: { id: string; name: string } }> }
        environments?: { edges?: Array<{ node?: { id: string; name: string } }> }
      }
    }>(
      accessToken,
      `query($id: String!) {
        project(id: $id) {
          id
          name
          services { edges { node { id name } } }
          environments { edges { node { id name } } }
        }
      }`,
      { id: ref.id }
    )
    const project = data.project
    if (!project?.id) continue
    const environments = project.environments?.edges ?? []
    const env =
      environments.find((e) => /prod/i.test(e.node?.name || ''))?.node ||
      environments[0]?.node
    if (!env?.id) continue
    const allServices = (project.services?.edges ?? [])
      .map((s) => s.node)
      .filter((s): s is { id: string; name: string } => Boolean(s?.id && s.name))
    let postgresServices = allServices
      .filter((s) => /postgres|postgresql|pg\b/i.test(s.name))
      .map((s) => ({ serviceId: s.id, serviceName: s.name }))
    if (postgresServices.length === 0) {
      postgresServices = allServices.map((s) => ({
        serviceId: s.id,
        serviceName: s.name
      }))
    }
    out.push({
      projectId: project.id,
      projectName: project.name || ref.name,
      environmentId: env.id,
      environmentName: env.name,
      postgresServices
    })
  }
  return out
}

export async function fetchRailwayDatabaseUrl(input: {
  accessToken: string
  projectId: string
  environmentId: string
  serviceId?: string
  demo?: boolean
}): Promise<string> {
  if (input.demo || input.accessToken === 'demo-railway-token') {
    return 'postgresql://demo:demo@127.0.0.1:5432/railway'
  }

  const data = await railwayGraphql<{
    variables?: Record<string, string>
  }>(
    input.accessToken,
    `query($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    {
      projectId: input.projectId,
      environmentId: input.environmentId,
      serviceId: input.serviceId || null
    }
  )

  const vars = data.variables || {}
  const url =
    vars.DATABASE_PUBLIC_URL ||
    vars.DATABASE_URL ||
    vars.POSTGRES_URL ||
    vars.POSTGRES_PRISMA_URL
  if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      'No DATABASE_URL found on that Railway service. Pick the Postgres service (or one with a public DATABASE_URL).'
    )
  }
  // Prefer public proxy URL when both exist — product API cannot reach *.railway.internal
  if (vars.DATABASE_PUBLIC_URL && /^postgres(ql)?:\/\//i.test(vars.DATABASE_PUBLIC_URL)) {
    return vars.DATABASE_PUBLIC_URL
  }
  if (url.includes('railway.internal')) {
    throw new Error(
      'DATABASE_URL is private (railway.internal). Enable a TCP proxy on Postgres or set DATABASE_PUBLIC_URL.'
    )
  }
  return url
}

export function finishRailwayOAuthHtml(
  config: ServerConfig,
  ok: boolean,
  message: string
): string {
  const next = `${config.appUrl}/app?railway=${ok ? 'connected' : 'error'}`
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? 'Railway connected' : 'Railway connection failed'}</h2>
  <p>${message}</p>
  <p>Next: choose which Postgres project holds your prospects table.</p>
  <script>location.href=${JSON.stringify(next)}</script>
  <p><a href="${next}">Open Jargon</a></p>
  </body></html>`
}

export async function syncRailwayProspects(input: {
  store: DataStore
  config: ServerConfig
  orgId: string
  projectId?: string
  limit?: number
}): Promise<{ count: number; table: string; source: 'railway' }> {
  const conn = getConnection(input.store, input.orgId, 'railway')
  if (!conn || conn.status !== 'connected') {
    throw new Error('Railway not connected')
  }
  const meta = conn.meta || {}
  const railwayProjectId = meta.projectId
  const environmentId = meta.environmentId
  const serviceId = meta.serviceId
  const table = (meta.table || DEFAULT_PROSPECTS_TABLE).replace(/[^a-zA-Z0-9_]/g, '')
  if (!railwayProjectId || !environmentId) {
    throw new Error('Select a Railway project and Postgres service first')
  }

  const resolved = await resolveRailwayAccessToken(input.store, input.config, input.orgId)
  if (!resolved) throw new Error('Railway not connected')

  const databaseUrl = await fetchRailwayDatabaseUrl({
    accessToken: resolved.accessToken,
    projectId: railwayProjectId,
    environmentId,
    serviceId: serviceId || undefined,
    demo: resolved.demo
  })

  if (resolved.demo) {
    // Demo cannot reach a real DB — keep queue empty-safe by throwing clear error
    throw new Error(
      'Railway OAuth is in demo mode (set RAILWAY_CLIENT_ID / RAILWAY_CLIENT_SECRET).'
    )
  }

  const prospects = await fetchPostgresProspects({
    databaseUrl,
    table,
    limit: input.limit ?? 100
  })
  const count = writePostgresContactsToProjects(
    input.store,
    input.orgId,
    prospects,
    input.projectId,
    { table }
  )
  // Tag source as railway in answers
  input.store.update((db) => {
    const targets = db.projects.filter(
      (p) => p.orgId === input.orgId && (!input.projectId || p.id === input.projectId)
    )
    for (const p of targets) {
      p.answers = {
        ...p.answers,
        data_source: 'railway',
        prospect_source: 'railway',
        prospect_table: table
      }
      p.updatedAt = Date.now()
    }
    const c = db.connections.find((x) => x.id === conn.id)
    if (c) {
      c.lastSyncAt = Date.now()
      c.updatedAt = Date.now()
      c.meta = { ...c.meta, rowCount: String(prospects.length), table }
    }
  })
  return { count, table, source: 'railway' }
}
