import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface ServerConfig {
  /** Public URL of this API (used in OAuth redirects) */
  publicUrl: string
  /** Browser URL for shared rep preview pages */
  previewUrl: string
  /** Bind host — 127.0.0.1 for Electron-embedded, 0.0.0.0 for hosted */
  host: string
  port: number
  /** Deep link scheme for desktop OAuth return */
  deepLinkScheme: string
  demoMode: boolean
  hubspot: {
    clientId: string
    clientSecret: string
    scopes: string
  }
  google: {
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
  apollo: {
    apiKey: string
  }
  crustdata: {
    apiKey: string
  }
  supabase: {
    projectUrl: string
    apiKey: string
    table: string
  }
  stripe: {
    secretKey: string
    webhookSecret: string
    pricePro: string
  }
  portalUrl: string
}

let envFilesLoaded = false

/** Load .env / .env.apollo into process.env when keys are unset (Electron + `npm run api`). */
function loadEnvFiles(): void {
  if (envFilesLoaded) return
  envFilesLoaded = true
  for (const name of ['.env', '.env.apollo', '.env.local']) {
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
  const previewUrl = process.env.JARGON_PREVIEW_URL ?? 'http://127.0.0.1:5173'
  const hasTwilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  const hasHubspot = Boolean(process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET)
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  const apolloKey = (process.env.APOLLO_API_KEY ?? '').trim()
  const crustdataKey = (process.env.CRUSTDATA_API_KEY ?? '').trim()
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim()
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim()

  return {
    publicUrl,
    previewUrl,
    host: process.env.JARGON_API_HOST ?? '127.0.0.1',
    port,
    deepLinkScheme: process.env.JARGON_DEEP_LINK ?? 'jargon',
    demoMode: process.env.JARGON_DEMO_MODE === '1' || !(hasTwilio && hasHubspot && hasGoogle),
    hubspot: {
      clientId: process.env.HUBSPOT_CLIENT_ID ?? '',
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? '',
      scopes: process.env.HUBSPOT_SCOPES ?? 'crm.objects.contacts.read crm.objects.companies.read oauth'
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      scopes:
        process.env.GOOGLE_SCOPES ??
        'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email'
    },
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      apiKeySid: process.env.TWILIO_API_KEY_SID ?? '',
      apiKeySecret: process.env.TWILIO_API_KEY_SECRET ?? '',
      twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? '',
      fromNumber: process.env.TWILIO_FROM_NUMBER ?? ''
    },
    apollo: {
      apiKey: apolloKey
    },
    crustdata: {
      apiKey: crustdataKey
    },
    supabase: {
      projectUrl: supabaseUrl,
      apiKey: supabaseKey,
      table: (process.env.SUPABASE_PROSPECTS_TABLE ?? 'jargon_prospects').trim()
    },
    stripe: {
      secretKey: (process.env.STRIPE_SECRET_KEY ?? '').trim(),
      webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim(),
      pricePro: (process.env.STRIPE_PRICE_PRO ?? '').trim()
    },
    portalUrl: (process.env.JARGON_PORTAL_URL ?? 'http://127.0.0.1:5181').replace(/\/$/, ''),
    ...overrides
  }
}
