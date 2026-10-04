/**
 * Standalone hosted API entrypoint.
 * Usage: npm run api
 * Bind 0.0.0.0 and set JARGON_PUBLIC_URL for OAuth callbacks.
 * Set DATABASE_URL (Railway Postgres) for app state (orgs, tools, connections) — not passwords.
 * Set SUPABASE_URL + keys for Auth (signup / login).
 */
import { loadConfig } from './config'
import { createHostedStore } from './store'
import { PgStore } from './pgStore'
import { startApiServer } from './index'
import { supabaseConfigured } from './providers/supabaseAuth'
import { syncVoiceProvider } from './providers/voice'
import { checkProductionConfig, isProduction } from './production'
import { reencryptConnectionSecrets } from './connections'
import { flushErrorReporting, initErrorReporting, reportError } from './observability'

async function main() {
  initErrorReporting()
  process.on('unhandledRejection', (reason) => reportError(reason, { source: 'unhandledRejection' }))
  const config = loadConfig({
    host: process.env.JARGON_API_HOST ?? '0.0.0.0'
  })
  const production = isProduction()

  if (production) {
    const { errors, warnings } = checkProductionConfig(config)
    for (const w of warnings) console.warn(`[jargon] ${w}`)
    if (errors.length) {
      for (const e of errors) console.error(`[jargon] ${e}`)
      throw new Error('Refusing to start: production config is incomplete')
    }
  }

  const { store, backend, label } = await createHostedStore({
    // Exit 0 so Railway's ON_FAILURE policy doesn't restart us and steal the row back.
    onFenced: () => setTimeout(() => process.exit(0), 1000)
  })

  if (store instanceof PgStore) {
    const daily = async () => {
      try {
        const id = await store.snapshot('daily', { minAgeMs: 23 * 60 * 60 * 1000 })
        if (id) console.log(`[jargon] Daily state snapshot ${id}`)
      } catch (err) {
        console.warn('[jargon] Daily snapshot failed:', err instanceof Error ? err.message : err)
      }
    }
    setInterval(() => void daily(), 60 * 60 * 1000).unref()
    void daily()
  }

  if (process.env.JARGON_ENCRYPTION_KEY_PREVIOUS?.trim()) {
    const { rotated, failed } = reencryptConnectionSecrets(store)
    await store.flush?.()
    console.log(`[jargon] Re-encrypted ${rotated} connection secrets (${failed} unreadable)`)
  }

  if (!supabaseConfigured(config)) {
    console.warn(
      '[jargon] SUPABASE_* not set — /auth/register and /auth/login will return 503'
    )
  }

  const { port, config: live } = await startApiServer(store, config.port, {
    host: config.host,
    config
  })
  console.log(`[jargon] Hosted API listening on http://${config.host}:${port}`)
  console.log(`[jargon] Environment: ${production ? 'production' : 'development'}`)
  console.log(`[jargon] Public URL: ${live.publicUrl}`)
  console.log(`[jargon] Demo mode: ${live.demoMode}`)
  console.log(`[jargon] Auth: ${supabaseConfigured(live) ? 'supabase' : 'unconfigured'}`)
  console.log(`[jargon] App state: ${backend} (${label})`)
  try {
    await syncVoiceProvider(live)
  } catch (err) {
    console.warn(
      '[jargon] Could not sync voice provider URLs:',
      err instanceof Error ? err.message : err
    )
  }
}

main().catch(async (err) => {
  reportError(err, { source: 'boot' })
  await flushErrorReporting()
  process.exit(1)
})
