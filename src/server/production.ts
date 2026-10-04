import type { ServerConfig } from './config'
import { DEV_ENCRYPTION_KEY } from './crypto'
import { supabaseConfigured } from './providers/supabaseAuth'
import { platformGmailReady } from './providers/gmail'
import { voiceIsLive } from './providers/voice'
import { isProduction } from './env'

export { isProduction }

export interface ProductionCheck {
  errors: string[]
  warnings: string[]
}

export function checkProductionConfig(
  config: ServerConfig,
  env: NodeJS.ProcessEnv = process.env
): ProductionCheck {
  const errors: string[] = []
  const warnings: string[] = []

  const key = env.JARGON_ENCRYPTION_KEY?.trim() ?? ''
  if (!key) errors.push('JARGON_ENCRYPTION_KEY is not set')
  else if (key === DEV_ENCRYPTION_KEY) {
    errors.push(
      'JARGON_ENCRYPTION_KEY is the public dev key. Set a new random key and move the old one to JARGON_ENCRYPTION_KEY_PREVIOUS'
    )
  } else if (key.length < 32) errors.push('JARGON_ENCRYPTION_KEY must be at least 32 characters')

  if (!env.DATABASE_URL?.trim()) errors.push('DATABASE_URL is not set (JSON-file storage is dev only)')
  if (!supabaseConfigured(config)) errors.push('SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not set')
  if (env.JARGON_DEMO_MODE === '1') errors.push('JARGON_DEMO_MODE=1 is not allowed in production')
  if (!/^https:\/\//.test(config.publicUrl)) errors.push('JARGON_PUBLIC_URL must be an https URL')
  if (!/^https:\/\//.test(config.appUrl)) errors.push('JARGON_APP_URL must be an https URL')

  if (!platformGmailReady(config)) warnings.push('Email pool is not configured; email sends will fail')
  if (!voiceIsLive(config)) warnings.push('Plivo is not configured; calls will fail')
  if (!config.heyreach.apiKey || config.heyreach.apiKey === 'demo') {
    warnings.push('HEYREACH_API_KEY is not set; LinkedIn sends will fail')
  }
  if (!config.stripe.webhookSecret) warnings.push('STRIPE_WEBHOOK_SECRET is not set')

  return { errors, warnings }
}

/** Outbound must never be silently faked for real recipients in production. */
export function allowDemoOutbound(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProduction(env)
}
