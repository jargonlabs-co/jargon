/**
 * Standalone hosted API entrypoint.
 * Usage: npm run api
 * Bind 0.0.0.0 and set JARGON_PUBLIC_URL for OAuth callbacks.
 * Set DATABASE_URL (Railway Postgres) for app state (orgs, tools, connections) — not passwords.
 * Set SUPABASE_URL + keys for Auth (signup / login).
 */
import { loadConfig } from './config'
import { createHostedStore } from './store'
import { startApiServer } from './index'
import { ensureSupabaseUser, supabaseConfigured } from './providers/supabaseAuth'
import { provisionWorkspace } from './auth'

async function main() {
  const config = loadConfig({
    host: process.env.JARGON_API_HOST ?? '0.0.0.0'
  })
  const { store, backend, label } = await createHostedStore()

  if (!supabaseConfigured(config)) {
    console.warn(
      '[jargon] SUPABASE_* not set — /auth/register and /auth/login will return 503'
    )
  } else {
    try {
      const demo = await ensureSupabaseUser(config, {
        email: 'demo@jargon.app',
        password: 'jargon-demo',
        name: 'Tara'
      })
      provisionWorkspace(store, {
        email: 'demo@jargon.app',
        name: 'Tara',
        orgName: 'Jargon Demo',
        supabaseUserId: demo.id
      })
      console.log('[jargon] Supabase Auth ready (demo@jargon.app)')
    } catch (err) {
      console.warn(
        '[jargon] Could not ensure demo Supabase user:',
        err instanceof Error ? err.message : err
      )
    }
  }

  const { port, config: live } = await startApiServer(store, config.port, {
    host: config.host,
    config
  })
  console.log(`[jargon] Hosted API listening on http://${config.host}:${port}`)
  console.log(`[jargon] Public URL: ${live.publicUrl}`)
  console.log(`[jargon] Demo mode: ${live.demoMode}`)
  console.log(`[jargon] Auth: ${supabaseConfigured(live) ? 'supabase' : 'unconfigured'}`)
  console.log(`[jargon] App state: ${backend} (${label})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
