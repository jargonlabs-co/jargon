/**
 * Read-only smoke test for the HeyReach integration.
 *
 *   HEYREACH_API_KEY=... npx tsx scripts/heyreach-check.ts [linkedin-profile-url]
 *
 * Validates the key, lists sendable LinkedIn accounts, and — when a profile URL
 * is passed — reports whether Jargon would reply in an existing conversation or
 * fall back to campaign enrollment. Sends nothing.
 */
import {
  findHeyReachConversation,
  isHeyReachConnection,
  listHeyReachAccounts,
  listHeyReachCampaigns,
  validateHeyReachKey
} from '../src/server/providers/heyreach'

async function main(): Promise<void> {
  const apiKey = (process.env.HEYREACH_API_KEY ?? '').trim()
  if (!apiKey) {
    console.error('Set HEYREACH_API_KEY first.')
    process.exit(1)
  }

  const valid = await validateHeyReachKey(apiKey)
  if (!valid.ok) {
    console.error(`key: ${valid.error}`)
    process.exit(1)
  }
  console.log(`key: ok — ${valid.label}`)

  const accounts = await listHeyReachAccounts(apiKey)
  if (!accounts.length) {
    console.error('accounts: none connected in HeyReach — LinkedIn sends will fail')
    process.exit(1)
  }
  for (const account of accounts) {
    console.log(`account: ${account.id} ${account.name}${account.active ? '' : ' (inactive)'}`)
  }

  const sender = accounts.find((a) => a.active) ?? accounts[0]
  const override = (process.env.HEYREACH_CAMPAIGN_ID ?? '').trim()
  const campaigns = await listHeyReachCampaigns(apiKey, sender.id)
  for (const campaign of campaigns) {
    console.log(`campaign: ${campaign.id} ${campaign.name} (${campaign.status})`)
  }
  const campaignId = override || (campaigns[0] ? String(campaigns[0].id) : '')
  if (!campaignId) {
    console.log(`campaign: none running for ${sender.name} — cold leads will be rejected`)
  } else {
    console.log(`campaign: using ${campaignId}${override ? ' (HEYREACH_CAMPAIGN_ID)' : ' (auto)'}`)
  }

  const linkedinUrl = process.argv[2]
  if (!linkedinUrl) return

  const conversationId = await findHeyReachConversation({
    apiKey,
    accountId: sender.id,
    linkedinUrl
  })
  if (conversationId) {
    console.log(`lead: existing conversation ${conversationId} — would send a direct message`)
    return
  }
  const connected = await isHeyReachConnection({ apiKey, accountId: sender.id, linkedinUrl })
  console.log(
    `lead: no conversation (connection: ${connected ?? 'unknown'}) — would ${
      campaignId ? `enroll in campaign ${campaignId}` : 'fail without HEYREACH_CAMPAIGN_ID'
    }`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
