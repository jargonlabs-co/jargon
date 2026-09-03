import { uid } from '../crypto'
import type { ServerConfig } from '../config'
import { createOAuthState, oauthRedirectUri, type ProviderSecrets } from '../connections'
import type { DataStore } from '../store'
import { prospectsToContacts, type ContextProspect } from './prospects'

const HUBSPOT_TOKEN = 'https://api.hubapi.com/oauth/v1/token'
const HUBSPOT_CONTACTS = 'https://api.hubapi.com/crm/v3/objects/contacts'

export function hubspotAuthUrl(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  userId: string
): string {
  const state = createOAuthState(store, { orgId, userId, provider: 'hubspot' })
  if (!config.hubspot.clientId) {
    return `${config.publicUrl}/oauth/hubspot/callback?code=demo&state=${state.id}`
  }
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
      accountLabel: 'HubSpot (demo portal)'
    }
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.hubspot.clientId,
    client_secret: config.hubspot.clientSecret,
    redirect_uri: oauthRedirectUri(config, 'hubspot'),
    code
  })
  const res = await fetch(HUBSPOT_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`HubSpot token exchange failed: ${await res.text()}`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    tokenType: json.token_type,
    accountLabel: 'HubSpot'
  }
}

export async function fetchHubSpotContacts(
  accessToken: string,
  limit: number,
  demo: boolean
): Promise<ContextProspect[]> {
  const capped = Math.min(Math.max(limit, 1), 100)
  if (demo || accessToken === 'demo-hubspot-token') {
    return demoHubSpotContacts(capped)
  }

  const props = [
    'email',
    'firstname',
    'lastname',
    'phone',
    'jobtitle',
    'company',
    'city',
    'hs_linkedinid',
    'website'
  ].join(',')
  const url = `${HUBSPOT_CONTACTS}?limit=${capped}&properties=${encodeURIComponent(props)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error(`HubSpot contacts failed: ${await res.text()}`)
  const json = (await res.json()) as {
    results?: Array<{ id: string; properties?: Record<string, string | null> }>
  }
  return (json.results ?? []).map((row, i) => contactFromHubSpot(row, i))
}

function contactFromHubSpot(
  row: { id: string; properties?: Record<string, string | null> },
  index: number
): ContextProspect {
  const p = row.properties ?? {}
  const first = (p.firstname ?? '').trim()
  const last = (p.lastname ?? '').trim()
  const name = `${first} ${last}`.trim() || p.email || `HubSpot contact ${index + 1}`
  const company = (p.company ?? '').trim() || 'Unknown company'
  const linkedin =
    p.hs_linkedinid && !p.hs_linkedinid.startsWith('http')
      ? `https://www.linkedin.com/in/${p.hs_linkedinid}`
      : p.hs_linkedinid || undefined
  return {
    externalId: row.id,
    name,
    company,
    title: (p.jobtitle ?? '').trim() || 'Contact',
    email: (p.email ?? '').trim() || `${row.id}@unknown.invalid`,
    phone: (p.phone ?? '').trim() || '',
    city: (p.city ?? '').trim() || '',
    accountName: company,
    linkedinUrl: linkedin,
    companyDomain: (p.website ?? '').replace(/^https?:\/\//, '').split('/')[0] || undefined
  }
}

function demoHubSpotContacts(limit: number): ContextProspect[] {
  const rows = [
    ['Jordan Hale', 'Northwind Logistics', 'VP Sales', 'jordan.hale@northwind.test'],
    ['Priya Shah', 'Prairie Health', 'Head of Growth', 'priya.shah@prairie.test'],
    ['Marcus Lee', 'Lakeside CRM', 'CRO', 'marcus.lee@lakeside.test']
  ]
  return Array.from({ length: limit }, (_, i) => {
    const [name, company, title, email] = rows[i % rows.length]
    return {
      externalId: `hs_demo_${i + 1}`,
      name: i < rows.length ? name : `${name} ${i + 1}`,
      company,
      title,
      email: i < rows.length ? email : `contact${i + 1}@hubspot-demo.test`,
      phone: '+15555550100',
      city: 'Chicago',
      accountName: company
    }
  })
}

export function finishHubSpotOAuthHtml(config: ServerConfig, ok: boolean, message: string): string {
  const next = `${config.appUrl}/`
  return `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h2>${ok ? 'HubSpot connected' : 'HubSpot connection failed'}</h2>
  <p>${message}</p>
  <p>Your tools will load contacts from this portal. Returning to Jargon…</p>
  <script>location.href=${JSON.stringify(next)}</script>
  <p><a href="${next}">Open Jargon</a></p>
  </body></html>`
}

export function writeHubSpotContactsToProjects(
  store: DataStore,
  orgId: string,
  prospects: ContextProspect[],
  projectId?: string
): number {
  let count = 0
  store.update((db) => {
    const projects = db.projects.filter(
      (p) => p.orgId === orgId && (!projectId || p.id === projectId)
    )
    for (const project of projects) {
      const contacts = prospectsToContacts(orgId, project.id, prospects, 'hubspot')
      db.contacts = db.contacts.filter((c) => c.projectId !== project.id)
      db.contacts.push(...contacts)
      project.answers = {
        ...project.answers,
        data_source: 'hubspot',
        prospect_source: 'hubspot',
        prospect_count: String(contacts.length),
        segment: project.answers.segment || 'HubSpot contacts'
      }
      project.updatedAt = Date.now()
      const campaign = db.campaigns.find((x) => x.projectId === project.id && x.state === 'ACTIVE')
      if (campaign) {
        campaign.total = contacts.length
        campaign.updatedAt = Date.now()
      }
      db.activities.unshift({
        id: uid('act'),
        orgId,
        projectId: project.id,
        kind: 'sync',
        summary: `Loaded ${contacts.length} contacts from HubSpot`,
        createdAt: Date.now()
      })
      count = contacts.length
    }
  })
  return count
}
