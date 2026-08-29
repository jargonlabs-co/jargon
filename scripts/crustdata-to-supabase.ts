/**
 * Seed Supabase jargon_prospects from Crustdata person search.
 * Usage: npx tsx scripts/crustdata-to-supabase.ts [--limit 25]
 */
import { loadConfig } from '../src/server/config'
import { searchGtmSoftwarePeople } from '../src/server/providers/crustdata'
import { DEFAULT_SUPABASE_TABLE } from '../src/server/providers/supabase'

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limitFlag = process.argv.indexOf('--limit')
  const limit = limitArg
    ? Number(limitArg.split('=')[1])
    : limitFlag >= 0
      ? Number(process.argv[limitFlag + 1])
      : 25

  const config = loadConfig()
  const crustKey = (process.env.CRUSTDATA_API_KEY ?? config.crustdata.apiKey).trim()
  const projectUrl = (process.env.SUPABASE_URL ?? config.supabase.projectUrl).trim()
  const apiKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    config.supabase.apiKey
  ).trim()
  const table = (process.env.SUPABASE_PROSPECTS_TABLE ?? config.supabase.table ?? DEFAULT_SUPABASE_TABLE).trim()

  if (!crustKey) {
    console.error('Set CRUSTDATA_API_KEY in .env')
    process.exit(1)
  }
  if (!projectUrl || !apiKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  console.log(`Fetching ${limit} prospects from Crustdata…`)
  const result = await searchGtmSoftwarePeople(crustKey, limit, crustKey === 'demo')
  if (result.prospects.length === 0) {
    console.error('No prospects returned from Crustdata')
    process.exit(1)
  }

  const rows = result.prospects.map((p) => ({
    id: p.externalId,
    name: p.name,
    title: p.title,
    company: p.company,
    email: p.email,
    phone: p.phone || null,
    city: p.city || null,
    linkedin_url: p.linkedinUrl || null,
    company_domain: p.companyDomain || null,
    company_industry: p.companyIndustry || null,
    company_size: p.companySize || null,
    crustdata_person_id: p.externalId,
    source: 'crustdata',
    updated_at: new Date().toISOString()
  }))

  const base = projectUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Supabase upsert failed (${res.status}):`, text)
    process.exit(1)
  }

  console.log(`Upserted ${rows.length} rows into ${table} (${result.mode})`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
