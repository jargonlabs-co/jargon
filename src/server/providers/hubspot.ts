import type { ServerConfig } from '../config'
import {
  createOAuthState,
  desktopDeepLink,
  oauthRedirectUri,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import type { JsonStore } from '../store'
import { uid } from '../crypto'
import type { Contact } from '../types'

export interface HubSpotProspect {
  externalId: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  accountName: string
}

export function hubspotAuthUrl(
  store: JsonStore,
  config: ServerConfig,
  orgId: string,
  userId: string
): string {
  if (!config.hubspot.clientId) {
    // Demo connect path — bounce through our callback immediately
    const state = createOAuthState(store, { orgId, userId, provider: 'hubspot' })
    return `${config.publicUrl}/oauth/hubspot/callback?code=demo&state=${state.id}`
  }
  const state = createOAuthState(store, { orgId, userId, provider: 'hubspot' })
  const url = new URL('https://app.hubspot.com/oauth/authorize')
  url.searchParams.set('client_id', config.hubspot.clientId)
  url.searchParams.set('redirect_uri', oauthRedirectUri(config, 'hubspot'))
  url.searchParams.set('scope', config.hubspot.scopes)
  url.searchParams.set('state', state.id)
  return url.toString()
}

export async function exchangeHubSpotCode(
  config: ServerConfig,
  code: string
): Promise<ProviderSecrets & { accountLabel: string }> {
  if (code === 'demo' || !config.hubspot.clientId) {
    return {
      accessToken: 'demo-hubspot-token',
      accountLabel: 'HubSpot'
    }
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.hubspot.clientId,
    client_secret: config.hubspot.clientSecret,
    redirect_uri: oauthRedirectUri(config, 'hubspot'),
    code
  })
  const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`HubSpot token exchange failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    accountLabel: 'HubSpot'
  }
}

export async function fetchHubSpotProspects(
  accessToken: string,
  limit: number,
  demo: boolean
): Promise<HubSpotProspect[]> {
  if (demo || accessToken === 'demo-hubspot-token') {
    return buildDemoProspects(limit)
  }

  const url = new URL('https://api.hubapi.com/crm/v3/objects/contacts')
  url.searchParams.set('limit', String(Math.min(100, limit)))
  url.searchParams.set(
    'properties',
    'firstname,lastname,email,phone,jobtitle,city,company,associatedcompanyid'
  )
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error(`HubSpot contacts failed: ${await res.text()}`)
  const json = (await res.json()) as {
    results: Array<{
      id: string
      properties: Record<string, string | null>
    }>
  }

  return json.results.slice(0, limit).map((row) => {
    const p = row.properties
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Unknown'
    return {
      externalId: row.id,
      name,
      company: p.company ?? 'Target Account',
      title: p.jobtitle ?? 'Prospect',
      email: p.email ?? `${row.id}@example.com`,
      phone: p.phone ?? '',
      city: p.city ?? '',
      accountName: p.company ?? 'Target Account'
    }
  })
}

export function buildDemoProspects(limit: number): HubSpotProspect[] {
  const first = [
    'Ava', 'Marcus', 'Sofia', 'Jonah', 'Priya', 'Elena', 'Chris', 'Noah', 'Maya', 'Leo',
    'Iris', 'Owen', 'Nina', 'Kai', 'Ruth', 'Sam', 'Tess', 'Victor', 'Willa', 'Zane'
  ]
  const last = [
    'Chen', 'Lee', 'Grant', 'Price', 'Shah', 'Brooks', 'Nguyen', 'Patel', 'Kim', 'Ross'
  ]
  const companies = [
    'Northwind Logistics', 'Prairie Health', 'Lakeside CRM', 'Midwest Forge', 'Ledgerly',
    'Paynest', 'Vaultline', 'Clearstack', 'OrbitOps', 'Harbor AI', 'Summit Grid', 'Copperline'
  ]
  const titles = ['VP Sales', 'Head of Growth', 'SDR Manager', 'CRO', 'RevOps Lead', 'Founder', 'CEO']
  const cities = ['Chicago', 'Minneapolis', 'Detroit', 'Indy', 'Milwaukee', 'Columbus', 'Austin', 'Denver']

  const out: HubSpotProspect[] = []
  for (let i = 0; i < limit; i++) {
    const f = first[i % first.length]
    const l = last[i % last.length]
    const company = companies[i % companies.length]
    out.push({
      externalId: `hs_demo_${i + 1}`,
      name: `${f} ${l}`,
      company,
      title: titles[i % titles.length],
      email: `${f.toLowerCase()}.${l.toLowerCase()}${i}@${company.replace(/\s+/g, '').toLowerCase()}.com`,
      phone: `+1-555-${String(1000 + i).slice(-4)}`,
      city: cities[i % cities.length],
      accountName: company
    })
  }
  return out
}

export function prospectsToContacts(
  orgId: string,
  projectId: string,
  prospects: HubSpotProspect[]
): Contact[] {
  const now = Date.now()
  return prospects.map((p, i) => ({
    id: uid('ct'),
    orgId,
    projectId,
    name: p.name,
    company: p.company,
    title: p.title,
    email: p.email,
    phone: p.phone,
    city: p.city,
    status: i === 0 ? 'active' : 'queued',
    stepIndex: 0,
    notes: '',
    externalId: p.externalId,
    source: 'hubspot' as const,
    accountName: p.accountName,
    channelsDone: [],
    createdAt: now,
    updatedAt: now
  }))
}

export function finishHubSpotOAuthHtml(config: ServerConfig, ok: boolean, message: string): string {
  const deep = desktopDeepLink(config, 'oauth', {
    provider: 'hubspot',
    status: ok ? 'ok' : 'error',
    message
  })
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? 'HubSpot connected' : 'HubSpot connection failed'}</h2>
  <p>${message}</p>
  <p>Returning to Jargon…</p>
  <script>location.href=${JSON.stringify(deep)}</script>
  <p><a href="${deep}">Open Jargon</a></p>
  </body></html>`
}

export { upsertConnection }
