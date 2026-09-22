import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface ServerConfig {
  /** Public URL of this API (used in OAuth redirects) */
  publicUrl: string
  /** Logged-in website (dashboard + tool UIs) */
  appUrl: string
  /** Bind host — 0.0.0.0 for hosted */
  host: string
  port: number
  /** Deep link scheme for desktop OAuth return */
  deepLinkScheme: string
  demoMode: boolean
  google: {
    clientId: string
    clientSecret: string
    scopes: string
    /** Platform mailbox refresh token — outbound is Jargon-owned, not the customer */
    refreshToken: string
  }
  hubspot: {
    clientId: string
    clientSecret: string
    scopes: string
  }
  twilio: {
    accountSid: string
    authToken: string
    apiKeySid: string
    apiKeySecret: string
    twimlAppSid: string
    fromNumber: string
  }
  plivo: {
    authId: string
    authToken: string
    fromNumber: string
    appId: string
    endpointUsername: string
    endpointPassword: string
  }
  heyreach: {
    apiKey: string
    /** LinkedIn account to send from; defaults to the first active HeyReach account */
    senderAccountId: string
    /** Campaign used for cold outreach when no conversation exists yet */
    campaignId: string
  }
  /** Managed outbound capacity — customers never bring send credentials. */
  outboundPools: {
    emailMailboxes: Array<{ id: string; refreshToken: string; label: string }>
    /** Plivo-rented DIDs + SIP endpoint usernames (returned username with suffix). No passwords — JWT mint. */
    voiceEndpoints: Array<{
      id: string
      fromNumber: string
      endpointUsername: string
    }>
    linkedinSeats: Array<{ id: string; accountId: string }>
    emailDailyPerOrg: number
    linkedinDailyPerOrg: number
    voiceDailyPerOrg: number
    concurrentCallsPerOrg: number
  }
  supabase: {
    url: string
    anonKey: string
    serviceRoleKey: string
  }
  railway: {
    clientId: string
    clientSecret: string
    scopes: string
  }
  stripe: {
    secretKey: string
    webhookSecret: string
    publishableKey: string
  }
  /** Prompt → DeploySpec compile (OpenAI and/or Anthropic). */
  llm: {
    compileEnabled: boolean
    openaiApiKey: string
    openaiBaseUrl: string
    openaiModel: string
    anthropicApiKey: string
    anthropicModel: string
  }
}

let envFilesLoaded = false

/** Load .env / .env.local into process.env when keys are unset. */
function loadEnvFiles(): void {
  if (envFilesLoaded) return
  envFilesLoaded = true
  for (const name of ['.env', '.env.local']) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#') || !line.includes('=')) continue
        const eq = line.indexOf('=')
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (key && process.env[key] === undefined) process.env[key] = value
      }
    } catch {
      /* ignore unreadable env files */
    }
  }
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  const text = (raw ?? '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function loadOutboundPools(env: NodeJS.ProcessEnv, base: {
  gmailRefresh: string
  plivoFrom: string
  plivoUser: string
  heyreachSender: string
}): ServerConfig['outboundPools'] {
  const emailFromJson = parseJsonArray<{
    id?: string
    refreshToken?: string
    label?: string
  }>(env.GMAIL_POOL_JSON)
  const emailMailboxes =
    emailFromJson
      .filter((m) => m.refreshToken?.trim())
      .map((m, i) => ({
        id: (m.id ?? `mailbox_${i + 1}`).trim(),
        refreshToken: m.refreshToken!.trim(),
        label: (m.label ?? m.id ?? `mailbox_${i + 1}`).trim()
      }))
  if (!emailMailboxes.length && base.gmailRefresh) {
    emailMailboxes.push({
      id: 'default',
      refreshToken: base.gmailRefresh,
      label: 'platform'
    })
  }

  const voiceFromJson = parseJsonArray<{
    id?: string
    fromNumber?: string
    endpointUsername?: string
  }>(env.PLIVO_POOL_JSON)
  const voiceEndpoints =
    voiceFromJson
      .filter((v) => v.fromNumber?.trim() && v.endpointUsername?.trim())
      .map((v, i) => ({
        id: (v.id ?? `voice_${i + 1}`).trim(),
        fromNumber: v.fromNumber!.trim(),
        // Must be the username Plivo returns after create (appends 12-digit suffix).
        endpointUsername: v.endpointUsername!.trim()
      }))
  if (!voiceEndpoints.length && base.plivoFrom && base.plivoUser) {
    voiceEndpoints.push({
      id: 'default',
      fromNumber: base.plivoFrom,
      endpointUsername: base.plivoUser
    })
  }

  const seatIds = (env.HEYREACH_SENDER_ACCOUNT_IDS ?? base.heyreachSender)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const linkedinSeats = seatIds.map((accountId, i) => ({
    id: `li_${accountId || i + 1}`,
    accountId
  }))

  return {
    emailMailboxes,
    voiceEndpoints,
    linkedinSeats,
    emailDailyPerOrg: Math.max(0, Number(env.JARGON_EMAIL_DAILY_PER_ORG ?? 50) || 50),
    linkedinDailyPerOrg: Math.max(0, Number(env.JARGON_LINKEDIN_DAILY_PER_ORG ?? 20) || 20),
    voiceDailyPerOrg: Math.max(0, Number(env.JARGON_VOICE_DAILY_PER_ORG ?? 100) || 100),
    concurrentCallsPerOrg: Math.max(1, Number(env.JARGON_CONCURRENT_CALLS_PER_ORG ?? 1) || 1)
  }
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  loadEnvFiles()
  const port = Number(process.env.PORT ?? process.env.JARGON_API_PORT ?? 8787)
  const publicUrl = process.env.JARGON_PUBLIC_URL ?? `http://127.0.0.1:${port}`
  const hasPlivo = Boolean(process.env.PLIVO_AUTH_ID && process.env.PLIVO_AUTH_TOKEN)
  const hasVoice = hasPlivo
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  const gmailRefresh = (process.env.GMAIL_REFRESH_TOKEN ?? process.env.GOOGLE_REFRESH_TOKEN ?? '').trim()
  const plivoFrom = (process.env.PLIVO_FROM_NUMBER ?? '').trim()
  const plivoUser = (process.env.PLIVO_ENDPOINT_USERNAME ?? '').trim()
  const heyreachSender = (process.env.HEYREACH_SENDER_ACCOUNT_ID ?? '').trim()

  return {
    publicUrl,
    appUrl: (process.env.JARGON_APP_URL ?? 'http://127.0.0.1:5180').replace(/\/$/, ''),
    host: process.env.JARGON_API_HOST ?? '127.0.0.1',
    port,
    deepLinkScheme: process.env.JARGON_DEEP_LINK ?? 'jargon',
    demoMode: process.env.JARGON_DEMO_MODE === '1' || !(hasVoice && hasGoogle),
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      scopes:
        process.env.GOOGLE_SCOPES ??
        'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
      refreshToken: gmailRefresh
    },
    hubspot: {
      clientId: process.env.HUBSPOT_CLIENT_ID ?? '',
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? '',
      scopes:
        process.env.HUBSPOT_SCOPES ??
        'crm.objects.contacts.read crm.objects.companies.read oauth'
    },
    twilio: {
      accountSid: (process.env.TWILIO_ACCOUNT_SID ?? '').trim(),
      authToken: (process.env.TWILIO_AUTH_TOKEN ?? '').trim(),
      apiKeySid: (process.env.TWILIO_API_KEY_SID ?? '').trim(),
      apiKeySecret: (process.env.TWILIO_API_KEY_SECRET ?? '').trim(),
      twimlAppSid: (process.env.TWILIO_TWIML_APP_SID ?? '').trim(),
      fromNumber: (process.env.TWILIO_FROM_NUMBER ?? '').trim()
    },
    plivo: {
      authId: (process.env.PLIVO_AUTH_ID ?? '').trim(),
      authToken: (process.env.PLIVO_AUTH_TOKEN ?? '').trim(),
      fromNumber: plivoFrom,
      appId: (process.env.PLIVO_APP_ID ?? '').trim(),
      endpointUsername: plivoUser,
      endpointPassword: (process.env.PLIVO_ENDPOINT_PASSWORD ?? '').trim()
    },
    heyreach: {
      apiKey: (process.env.HEYREACH_API_KEY ?? '').trim(),
      senderAccountId: heyreachSender,
      campaignId: (process.env.HEYREACH_CAMPAIGN_ID ?? '').trim()
    },
    outboundPools: loadOutboundPools(process.env, {
      gmailRefresh,
      plivoFrom,
      plivoUser,
      heyreachSender
    }),
    supabase: {
      url: (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, ''),
      anonKey: (process.env.SUPABASE_ANON_KEY ?? '').trim(),
      serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
    },
    railway: {
      clientId: (process.env.RAILWAY_CLIENT_ID ?? '').trim(),
      clientSecret: (process.env.RAILWAY_CLIENT_SECRET ?? '').trim(),
      scopes:
        (process.env.RAILWAY_OAUTH_SCOPES ?? '').trim() ||
        'openid email profile offline_access project:member'
    },
    stripe: {
      secretKey: (process.env.STRIPE_SECRET_KEY ?? '').trim(),
      webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim(),
      publishableKey: (process.env.STRIPE_PUBLISHABLE_KEY ?? '').trim()
    },
    llm: {
      // Opt-in only — rule catalog compiles by default (no token cost).
      compileEnabled: process.env.JARGON_LLM_COMPILE === '1',
      openaiApiKey: (process.env.OPENAI_API_KEY ?? '').trim(),
      openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').trim(),
      openaiModel: (process.env.JARGON_COMPILE_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim(),
      anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
      anthropicModel: (
        process.env.JARGON_COMPILE_ANTHROPIC_MODEL ??
        process.env.ANTHROPIC_MODEL ??
        'claude-haiku-4-5-20251001'
      ).trim()
    },
    ...overrides
  }
}

