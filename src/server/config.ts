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
  heyreach: {
    apiKey: string
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
  const hasTwilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

  return {
    publicUrl,
    appUrl: (process.env.JARGON_APP_URL ?? 'http://127.0.0.1:5180').replace(/\/$/, ''),
    host: process.env.JARGON_API_HOST ?? '127.0.0.1',
    port,
    deepLinkScheme: process.env.JARGON_DEEP_LINK ?? 'jargon',
    demoMode: process.env.JARGON_DEMO_MODE === '1' || !(hasTwilio && hasGoogle),
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
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      apiKeySid: process.env.TWILIO_API_KEY_SID ?? '',
      apiKeySecret: process.env.TWILIO_API_KEY_SECRET ?? '',
      twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? '',
      fromNumber: process.env.TWILIO_FROM_NUMBER ?? ''
    },
    heyreach: {
      apiKey: (process.env.HEYREACH_API_KEY ?? '').trim()
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
    ...overrides
  }
}
