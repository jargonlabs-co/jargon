/**
 * Standalone hosted API entrypoint.
 * Usage: npm run api
 * Bind 0.0.0.0 and set JARGON_PUBLIC_URL for OAuth callbacks.
 */
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { loadConfig } from './config'
import { hostedDbPath, JsonStore } from './store'
import { startApiServer } from './index'

async function main() {
  const config = loadConfig({
    host: process.env.JARGON_API_HOST ?? '0.0.0.0'
  })
  const dbPath = hostedDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  const store = new JsonStore(dbPath)
  const { port, config: live } = await startApiServer(store, config.port, {
    host: config.host,
    config
  })
  console.log(`[jargon] Hosted API listening on http://${config.host}:${port}`)
  console.log(`[jargon] Public URL: ${live.publicUrl}`)
  console.log(`[jargon] Demo mode: ${live.demoMode}`)
  console.log(`[jargon] DB: ${dbPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
