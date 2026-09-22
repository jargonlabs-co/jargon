import type { ServerConfig } from '../config'
import {
  getConnection,
  readSecrets,
  setConnectionMeta,
  upsertConnection,
  type ProviderSecrets
} from '../connections'
import type { DataStore } from '../store'
import { normalizeLinkedInUrl } from '../../shared/linkedinUrl'
import { allocateLinkedInSeat } from '../outboundPools'

const HEYREACH_BASE = 'https://api.heyreach.io/api/public'
const REQUEST_TIMEOUT_MS = 20_000

export class HeyReachError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'HeyReachError'
    this.status = status
  }
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-API-KEY': apiKey
  }
}

async function heyreachRequest<T>(
  apiKey: string,
  init: { path: string; method?: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  const method = init.method ?? 'POST'
  let res: Response
  try {
    res = await fetch(`${HEYREACH_BASE}${init.path}`, {
      method,
      headers: headers(apiKey),
      body: method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable'
    throw new HeyReachError(`HeyReach ${reason} (${method} ${init.path})`)
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).trim()
    if (res.status === 401 || res.status === 403) {
      throw new HeyReachError('HeyReach rejected the API key', res.status)
    }
    if (res.status === 429) {
      throw new HeyReachError('HeyReach rate limit reached (300 req/min)', res.status)
    }
    throw new HeyReachError(text || `HeyReach ${init.path} failed (${res.status})`, res.status)
  }

  const text = await res.text().catch(() => '')
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}

/** HeyReach paginates list endpoints as POST { offset, limit } -> { totalCount, items }. */
type Paged<T> = { totalCount?: number; items?: T[] }

/**
 * Ensure the platform HeyReach key is attached as an org connection (managed outbound).
 * Customers never bring their own HeyReach API key.
 */
export function ensureHeyReachConnection(
  store: DataStore,
  orgId: string,
  serverConfig: ServerConfig
) {
  const apiKey = serverConfig.heyreach.apiKey.trim()
  if (!apiKey) return getConnection(store, orgId, 'heyreach')

  const existing = getConnection(store, orgId, 'heyreach')
  if (existing?.status === 'connected') {
    try {
      const secrets = readSecrets(existing)
      if (secrets.accessToken === apiKey) return existing
    } catch {
      /* re-upsert below */
    }
  }

  return upsertConnection(store, {
    orgId,
    provider: 'heyreach',
    status: 'connected',
    accountLabel: apiKey === 'demo' ? 'HeyReach (demo)' : 'HeyReach',
    secrets: { accessToken: apiKey } satisfies ProviderSecrets,
    meta: { mode: apiKey === 'demo' ? 'demo' : 'live', source: 'env' }
  })
}

/** Resolve the managed HeyReach API key (platform only). */
export function resolveHeyReachApiKey(
  store: DataStore,
  orgId: string,
  serverConfig: ServerConfig
): { apiKey: string; demo: boolean } | null {
  ensureHeyReachConnection(store, orgId, serverConfig)
  const conn = getConnection(store, orgId, 'heyreach')
  if (conn?.status === 'connected') {
    try {
      const secrets = readSecrets(conn)
      const apiKey = secrets.accessToken?.trim()
      if (apiKey) {
        return { apiKey, demo: apiKey === 'demo' || conn.meta?.mode === 'demo' }
      }
    } catch {
      /* fall through */
    }
  }
  if (serverConfig.heyreach.apiKey.trim()) {
    const apiKey = serverConfig.heyreach.apiKey.trim()
    return { apiKey, demo: apiKey === 'demo' }
  }
  return null
}

export async function validateHeyReachKey(
  apiKey: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const key = apiKey.trim()
  if (!key) return { ok: false, error: 'API key required' }
  if (key === 'demo') return { ok: true, label: 'HeyReach (demo)' }

  try {
    await heyreachRequest(key, { path: '/auth/CheckApiKey', method: 'GET' })
  } catch (err) {
    if (err instanceof HeyReachError && err.status != null) {
      return { ok: false, error: err.message }
    }
    // Network failure should not block deploy / connect in constrained environments.
    return { ok: true, label: 'HeyReach (unverified)' }
  }

  const accounts = await listHeyReachAccounts(key).catch(() => [])
  const active = accounts.filter((a) => a.active !== false)
  if (accounts.length && !active.length) {
    return { ok: false, error: 'HeyReach has no active LinkedIn accounts to send from' }
  }
  return {
    ok: true,
    label: active[0]?.name ? `HeyReach (${active[0].name})` : 'HeyReach'
  }
}

export type HeyReachAccount = {
  id: number
  name: string
  active?: boolean
}

export async function listHeyReachAccounts(apiKey: string): Promise<HeyReachAccount[]> {
  const res = await heyreachRequest<Paged<Record<string, unknown>>>(apiKey, {
    path: '/li_account/GetAll',
    body: { offset: 0, limit: 100 }
  })
  return (res.items ?? [])
    .map((raw): HeyReachAccount | null => {
      const id = Number(raw.id)
      if (!Number.isFinite(id)) return null
      const first = typeof raw.firstName === 'string' ? raw.firstName : ''
      const last = typeof raw.lastName === 'string' ? raw.lastName : ''
      const email = typeof raw.emailAddress === 'string' ? raw.emailAddress : ''
      const name = [first, last].filter(Boolean).join(' ').trim() || email || `Account ${id}`
      return {
        id,
        name,
        active: raw.isActive !== false
      }
    })
    .filter((a): a is HeyReachAccount => a != null)
}

/**
 * The LinkedIn account HeyReach sends from. Explicit config wins, otherwise the
 * first active account is picked and cached on the connection so repeat sends
 * keep the same sender identity.
 */
export async function resolveHeyReachSenderAccount(input: {
  store: DataStore
  orgId: string
  config: ServerConfig
  apiKey: string
}): Promise<HeyReachAccount> {
  const seat = allocateLinkedInSeat(input.store, input.config, input.orgId)
  if (seat) {
    const id = Number(seat.accountId)
    if (Number.isFinite(id) && id > 0) {
      setConnectionMeta(input.store, input.orgId, 'heyreach', {
        senderAccountId: String(id),
        senderAccountName: `Seat ${seat.id}`,
        poolMemberId: seat.id
      })
      return { id, name: `Seat ${seat.id}` }
    }
  }

  const configured = Number(input.config.heyreach.senderAccountId)
  if (Number.isFinite(configured) && configured > 0) {
    return { id: configured, name: `Account ${configured}` }
  }

  const conn = getConnection(input.store, input.orgId, 'heyreach')
  const cached = Number(conn?.meta?.senderAccountId)
  if (Number.isFinite(cached) && cached > 0) {
    return { id: cached, name: conn?.meta?.senderAccountName || `Account ${cached}` }
  }

  const accounts = await listHeyReachAccounts(input.apiKey)
  const account = accounts.find((a) => a.active !== false) ?? accounts[0]
  if (!account) {
    throw new HeyReachError(
      'No LinkedIn account is connected in HeyReach. Add one in HeyReach, then retry.'
    )
  }
  setConnectionMeta(input.store, input.orgId, 'heyreach', {
    senderAccountId: String(account.id),
    senderAccountName: account.name
  })
  return account
}

export type HeyReachCampaign = {
  id: number
  name: string
  status: string
}

/** Campaigns that can accept new leads, newest-usable first. */
export async function listHeyReachCampaigns(
  apiKey: string,
  accountId?: number
): Promise<HeyReachCampaign[]> {
  const res = await heyreachRequest<Paged<Record<string, unknown>>>(apiKey, {
    path: '/campaign/GetAll',
    body: {
      offset: 0,
      limit: 100,
      statuses: ['IN_PROGRESS', 'PAUSED'],
      ...(accountId ? { accountIds: [accountId] } : {})
    }
  })
  const campaigns = (res.items ?? [])
    .map((raw): HeyReachCampaign | null => {
      const id = Number(raw.id)
      if (!Number.isFinite(id)) return null
      return {
        id,
        name: typeof raw.name === 'string' ? raw.name : `Campaign ${id}`,
        status: typeof raw.status === 'string' ? raw.status : ''
      }
    })
    .filter((c): c is HeyReachCampaign => c != null)
  // A running campaign starts sending immediately; a paused one needs resuming.
  return campaigns.sort((a, b) => Number(b.status === 'IN_PROGRESS') - Number(a.status === 'IN_PROGRESS'))
}

/**
 * The campaign cold leads get enrolled into. Explicit config wins, otherwise the
 * first campaign this sender already runs is picked and cached, so setting
 * HEYREACH_API_KEY alone is enough to send.
 */
export async function resolveHeyReachCampaignId(input: {
  store: DataStore
  orgId: string
  config: ServerConfig
  apiKey: string
  accountId: number
}): Promise<number | null> {
  const configured = Number(input.config.heyreach.campaignId)
  if (Number.isFinite(configured) && configured > 0) return configured

  const conn = getConnection(input.store, input.orgId, 'heyreach')
  const cached = Number(conn?.meta?.campaignId)
  if (Number.isFinite(cached) && cached > 0) return cached

  const campaign = (await listHeyReachCampaigns(input.apiKey, input.accountId))[0]
  if (!campaign) return null
  setConnectionMeta(input.store, input.orgId, 'heyreach', {
    campaignId: String(campaign.id),
    campaignName: campaign.name
  })
  return campaign.id
}

/**
 * HeyReach can only send into an existing chat, so a direct message requires
 * finding the conversation for this lead first.
 */
export async function findHeyReachConversation(input: {
  apiKey: string
  accountId: number
  linkedinUrl: string
}): Promise<string | null> {
  const res = await heyreachRequest<Paged<Record<string, unknown>>>(input.apiKey, {
    path: '/inbox/GetConversationsV2',
    body: {
      offset: 0,
      limit: 10,
      filters: {
        linkedInAccountIds: [input.accountId],
        leadProfileUrl: input.linkedinUrl
      }
    }
  })
  for (const item of res.items ?? []) {
    const id = item.id ?? item.conversationId
    if (typeof id === 'string' && id.trim()) return id
    if (typeof id === 'number') return String(id)
  }
  return null
}

export async function isHeyReachConnection(input: {
  apiKey: string
  accountId: number
  linkedinUrl: string
}): Promise<boolean | null> {
  try {
    const res = await heyreachRequest<Record<string, unknown>>(input.apiKey, {
      path: '/MyNetwork/IsConnection',
      body: { senderAccountId: input.accountId, leadProfileUrl: input.linkedinUrl }
    })
    const value = res.isConnection ?? res.result ?? res.value
    return typeof value === 'boolean' ? value : null
  } catch {
    return null
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * Cold outreach path: HeyReach has no "DM a stranger" endpoint, so the lead is
 * enrolled into a campaign whose sequence sends the connection request + message.
 */
export async function addHeyReachCampaignLead(input: {
  apiKey: string
  campaignId: number
  accountId: number
  linkedinUrl: string
  contact: { name?: string; company?: string; title?: string; email?: string }
  message: string
}): Promise<void> {
  const { firstName, lastName } = splitName(input.contact.name ?? '')
  const res = await heyreachRequest<Record<string, unknown>>(input.apiKey, {
    path: '/campaign/AddLeadsToCampaignV2',
    body: {
      campaignId: input.campaignId,
      resumePausedCampaign: true,
      accountLeadPairs: [
        {
          linkedInAccountId: input.accountId,
          lead: {
            firstName,
            lastName,
            profileUrl: input.linkedinUrl,
            companyName: input.contact.company || undefined,
            position: input.contact.title || undefined,
            emailAddress: input.contact.email || undefined,
            customUserFields: [{ name: 'message', value: input.message }]
          }
        }
      ]
    }
  })
  const failed = Number(res.failedCount ?? res.totalFailed ?? 0)
  const added = Number(res.addedCount ?? res.totalAdded ?? res.successCount ?? 0)
  if (failed > 0 && added === 0) {
    throw new HeyReachError(
      `HeyReach rejected the lead for campaign ${input.campaignId} (already enrolled or excluded)`
    )
  }
}

export type LinkedInSendResult = {
  id: string
  mode: 'demo' | 'heyreach'
  /** 'message' = direct reply in an existing chat, 'campaign' = enrolled for outreach. */
  delivery: 'demo' | 'message' | 'campaign'
  conversationId?: string
  accountId?: number
}

export async function sendHeyReachLinkedInMessage(input: {
  store: DataStore
  config: ServerConfig
  orgId: string
  linkedinUrl: string
  message: string
  subject?: string
  contact?: { name?: string; company?: string; title?: string; email?: string }
  sandbox?: boolean
}): Promise<LinkedInSendResult> {
  if (input.sandbox) {
    return { id: `sandbox_li_${Date.now()}`, mode: 'demo', delivery: 'demo' }
  }

  const resolved = resolveHeyReachApiKey(input.store, input.orgId, input.config)
  if (!resolved || resolved.demo) {
    return { id: `demo_li_${Date.now()}`, mode: 'demo', delivery: 'demo' }
  }

  const linkedinUrl = normalizeLinkedInUrl(input.linkedinUrl)?.trim() ?? ''
  if (!linkedinUrl) {
    throw new HeyReachError('LinkedIn profile URL required to send via HeyReach')
  }
  const message = input.message.trim()
  if (!message) {
    throw new HeyReachError('Message body required to send via HeyReach')
  }

  const { apiKey } = resolved
  const account = await resolveHeyReachSenderAccount({
    store: input.store,
    orgId: input.orgId,
    config: input.config,
    apiKey
  })

  const conversationId = await findHeyReachConversation({
    apiKey,
    accountId: account.id,
    linkedinUrl
  })

  if (conversationId) {
    const res = await heyreachRequest<Record<string, unknown>>(apiKey, {
      path: '/inbox/SendMessage',
      body: {
        conversationId,
        linkedInAccountId: account.id,
        message,
        subject: input.subject ?? ''
      }
    })
    const id = res.id ?? res.messageId
    return {
      id: typeof id === 'string' || typeof id === 'number' ? String(id) : `heyreach_${Date.now()}`,
      mode: 'heyreach',
      delivery: 'message',
      conversationId,
      accountId: account.id
    }
  }

  const campaignId = await resolveHeyReachCampaignId({
    store: input.store,
    orgId: input.orgId,
    config: input.config,
    apiKey,
    accountId: account.id
  })
  if (campaignId == null) {
    const connected = await isHeyReachConnection({ apiKey, accountId: account.id, linkedinUrl })
    throw new HeyReachError(
      connected === false
        ? `No LinkedIn conversation with ${account.name} and this lead is not a connection. Start a HeyReach campaign so Jargon can send a connection request first.`
        : 'No LinkedIn conversation with this lead yet, and no running HeyReach campaign to enroll them in. Start one in HeyReach, or set HEYREACH_CAMPAIGN_ID.'
    )
  }

  await addHeyReachCampaignLead({
    apiKey,
    campaignId,
    accountId: account.id,
    linkedinUrl,
    contact: input.contact ?? {},
    message
  })
  return {
    id: `heyreach_campaign_${campaignId}_${Date.now()}`,
    mode: 'heyreach',
    delivery: 'campaign',
    accountId: account.id
  }
}
