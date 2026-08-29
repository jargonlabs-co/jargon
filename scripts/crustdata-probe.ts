/**
 * Smoke-test Crustdata person search.
 * Usage: npx tsx scripts/crustdata-probe.ts [--limit 5]
 */
import { loadConfig } from '../src/server/config'
import { searchGtmSoftwarePeople } from '../src/server/providers/crustdata'

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limitFlag = process.argv.indexOf('--limit')
  const limit = limitArg
    ? Number(limitArg.split('=')[1])
    : limitFlag >= 0
      ? Number(process.argv[limitFlag + 1])
      : 5

  const config = loadConfig()
  const apiKey = (process.env.CRUSTDATA_API_KEY ?? config.crustdata.apiKey).trim()
  if (!apiKey) {
    console.error('Set CRUSTDATA_API_KEY in .env')
    process.exit(1)
  }

  console.log(`Searching Crustdata for up to ${limit} GTM prospects…`)
  const result = await searchGtmSoftwarePeople(apiKey, limit, apiKey === 'demo')
  console.log(`Mode: ${result.mode} · Found: ${result.prospects.length}`)
  for (const p of result.prospects.slice(0, 5)) {
    console.log(`- ${p.name} · ${p.title} @ ${p.company}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
