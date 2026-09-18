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

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  loadEnvFiles()
  const port = Number(process.env.PORT ?? process.env.JARGON_API_PORT ?? 8787)
  const publicUrl = process.env.JARGON_PUBLIC_URL ?? `http://127.0.0.1:${port}`
  const hasPlivo = Boolean(process.env.PLIVO_AUTH_ID && process.env.PLIVO_AUTH_TOKEN)
  const hasVoice = hasPlivo
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

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
      refreshToken: (process.env.GMAIL_REFRESH_TOKEN ?? process.env.GOOGLE_REFRESH_TOKEN ?? '').trim()
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
      fromNumber: (process.env.PLIVO_FROM_NUMBER ?? '').trim(),
      appId: (process.env.PLIVO_APP_ID ?? '').trim(),
      endpointUsername: (process.env.PLIVO_ENDPOINT_USERNAME ?? '').trim(),
      endpointPassword: (process.env.PLIVO_ENDPOINT_PASSWORD ?? '').trim()
    },
    heyreach: {
      apiKey: (process.env.HEYREACH_API_KEY ?? '').trim(),
      senderAccountId: (process.env.HEYREACH_SENDER_ACCOUNT_ID ?? '').trim(),
      campaignId: (process.env.HEYREACH_CAMPAIGN_ID ?? '').trim()
    },
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
