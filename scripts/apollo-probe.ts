import { loadConfig } from '../src/server/config'
import { searchGtmSoftwareProspects } from '../src/server/providers/apollo'

async function main() {
  const config = loadConfig()
  const key = config.apollo.apiKey
  console.log('key_present', Boolean(key))
  const limit = Number(process.argv[2] ?? 3)
  const result = await searchGtmSoftwareProspects(key, limit, false)
  console.log('mode', result.mode)
  console.log('total_entries', result.total)
  console.log('returned_count', result.prospects.length)
  console.log('all_have_email', result.prospects.every((p) => Boolean(p.email)))
  console.log('distinct_companies', new Set(result.prospects.map((p) => p.company)).size)
  console.log('distinct_names', new Set(result.prospects.map((p) => p.name)).size)
}

main().catch((e) => {
  console.error('ERR', e instanceof Error ? e.message : e)
  process.exit(1)
})
