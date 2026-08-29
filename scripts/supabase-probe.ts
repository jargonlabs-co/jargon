/**
 * Smoke-test Supabase prospects table read.
 * Usage: npx tsx scripts/supabase-probe.ts [--limit 5]
 */
import { loadConfig } from '../src/server/config'
import { fetchSupabaseProspects } from '../src/server/providers/supabase'

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limitFlag = process.argv.indexOf('--limit')
  const limit = limitArg
    ? Number(limitArg.split('=')[1])
    : limitFlag >= 0
      ? Number(process.argv[limitFlag + 1])
      : 5

  const config = loadConfig()
  const projectUrl = (process.env.SUPABASE_URL ?? config.supabase.projectUrl).trim()
  const apiKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    config.supabase.apiKey
  ).trim()
  const table = (process.env.SUPABASE_PROSPECTS_TABLE ?? config.supabase.table).trim()

  if (!projectUrl || !apiKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  console.log(`Reading up to ${limit} rows from ${table}…`)
  const result = await fetchSupabaseProspects({ projectUrl, apiKey, table, limit })
  console.log(`Mode: ${result.mode} · Found: ${result.prospects.length}`)
  for (const p of result.prospects.slice(0, 5)) {
    console.log(`- ${p.name} · ${p.title} @ ${p.company}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
