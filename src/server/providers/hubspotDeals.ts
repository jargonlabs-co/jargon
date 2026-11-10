import type { ContextProspect } from './prospects'
import { prospectFromHubSpotRow } from './hubspot'
import { objectionFromCall, matchDealStage, type DealStage } from '../../shared/play'

const PIPELINES = 'https://api.hubapi.com/crm/v3/pipelines/deals'
const DEAL_SEARCH = 'https://api.hubapi.com/crm/v3/objects/deals/search'
const CONTACT_BATCH = 'https://api.hubapi.com/crm/v3/objects/contacts/batch/read'
const CALL_BATCH = 'https://api.hubapi.com/crm/v3/objects/calls/batch/read'

const CONTACT_PROPS = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'mobilephone',
  'jobtitle',
  'company',
  'city',
  'hs_linkedinid',
  'hs_linkedin_url',
  'website',
  'associatedcompanyid',
  'hs_timezone',
  'state'
]

export type QuietDealPull = {
  prospects: ContextProspect[]
  stageLabel: string
  warning?: string
}

type DealRow = {
  id: string
  properties?: Record<string, string | null>
}

export async function pullQuietDeals(input: {
  accessToken: string
  stage: string
  inactiveDays?: number
  limit?: number
}): Promise<QuietDealPull> {
  const stages = await listDealStages(input.accessToken)
  const matched = matchDealStage(stages, input.stage)
  if (!matched) {
    return {
      prospects: [],
      stageLabel: input.stage,
      warning: `No HubSpot deal stage matches ${input.stage}.`
    }
  }
  const deals = await searchDeals(input.accessToken, matched.id)
  const cutoff = input.inactiveDays != null ? Date.now() - input.inactiveDays * 86_400_000 : null
  const quiet = cutoff == null ? deals : deals.filter((deal) => isInactive(deal, cutoff))
  const cap = Math.min(Math.max(input.limit ?? 40, 1), 40)
  const contactIds = await associatedIds(
    input.accessToken,
    'deals',
    'contacts',
    quiet.map((deal) => deal.id)
  )
  const ids = [...contactIds.values()].flat().slice(0, cap)
  if (!ids.length) return { prospects: [], stageLabel: matched.label }
  const contacts = await batchRead(input.accessToken, CONTACT_BATCH, ids, CONTACT_PROPS)
  const calls = await lastCallByContact(input.accessToken, ids)
  const dealName = new Map(quiet.map((deal) => [deal.id, (deal.properties?.dealname ?? '').trim()]))
  const contactDeal = new Map<string, string>()
  for (const [dealId, people] of contactIds) {
    for (const personId of people) contactDeal.set(personId, dealId)
  }
  const prospects = contacts.map((row) => {
    const prospect = prospectFromHubSpotRow(row)
    const deal = dealName.get(contactDeal.get(row.id) ?? '') ?? ''
    if (!prospect.company && deal) prospect.company = deal
    const objection = calls.get(row.id) ?? ''
    prospect.attrs = {
      ...(prospect.attrs ?? {}),
      deal_stage: matched.label,
      ...(deal ? { deal_name: deal } : {}),
      ...(objection ? { last_call_objection: objection } : {})
    }
    return prospect
  })
  return { prospects, stageLabel: matched.label }
}

async function listDealStages(accessToken: string): Promise<DealStage[]> {
  const res = await fetch(PIPELINES, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`HubSpot deal pipelines failed (${res.status})`)
  const json = (await res.json()) as {
    results?: Array<{ stages?: Array<{ id?: string; label?: string; displayOrder?: number }> }>
  }
  const stages: DealStage[] = []
  for (const pipeline of json.results ?? []) {
    for (const stage of pipeline.stages ?? []) {
      if (!stage.id || !stage.label) continue
      stages.push({
        id: stage.id,
        label: stage.label,
        displayOrder: stage.displayOrder ?? stages.length
      })
    }
  }
  return stages
}

async function searchDeals(accessToken: string, stageId: string): Promise<DealRow[]> {
  const res = await fetch(DEAL_SEARCH, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: 'dealstage', operator: 'EQ', value: stageId }] }
      ],
      properties: ['dealname', 'dealstage', 'notes_last_contacted', 'hs_last_sales_activity_timestamp', 'createdate'],
      limit: 100
    })
  })
  if (!res.ok) throw new Error(`HubSpot deal search failed (${res.status})`)
  const json = (await res.json()) as { results?: DealRow[] }
  return json.results ?? []
}

function isInactive(deal: DealRow, cutoff: number): boolean {
  const props = deal.properties ?? {}
  const last =
    time(props.notes_last_contacted) ??
    time(props.hs_last_sales_activity_timestamp) ??
    time(props.createdate)
  if (last == null) return true
  return last <= cutoff
}

function time(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 10_000_000_000) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function associatedIds(
  accessToken: string,
  from: string,
  to: string,
  ids: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!ids.length) return map
  const res = await fetch(`https://api.hubapi.com/crm/v4/associations/${from}/${to}/batch/read`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ inputs: ids.slice(0, 100).map((id) => ({ id })) })
  })
  if (!res.ok) throw new Error(`HubSpot ${from} to ${to} associations failed (${res.status})`)
  const json = (await res.json()) as {
    results?: Array<{ from?: { id?: string }; to?: Array<{ toObjectId?: number | string }> }>
  }
  for (const row of json.results ?? []) {
    const fromId = row.from?.id
    if (!fromId) continue
    map.set(
      fromId,
      (row.to ?? []).map((item) => String(item.toObjectId ?? '')).filter(Boolean)
    )
  }
  return map
}

async function batchRead(
  accessToken: string,
  url: string,
  ids: string[],
  properties: string[]
): Promise<Array<{ id: string; properties?: Record<string, string | null> }>> {
  if (!ids.length) return []
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ properties, inputs: ids.map((id) => ({ id })) })
  })
  if (!res.ok) throw new Error(`HubSpot batch read failed (${res.status})`)
  const json = (await res.json()) as {
    results?: Array<{ id: string; properties?: Record<string, string | null> }>
  }
  return json.results ?? []
}

async function lastCallByContact(accessToken: string, contactIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const associations = await associatedIds(accessToken, 'contacts', 'calls', contactIds)
  const callIds = [...new Set([...associations.values()].flat())].slice(0, 100)
  if (!callIds.length) return out
  const calls = await batchRead(accessToken, CALL_BATCH, callIds, ['hs_call_body', 'hs_timestamp'])
  const byId = new Map(calls.map((call) => [call.id, call]))
  for (const [contactId, ids] of associations) {
    const latest = ids
      .map((id) => byId.get(id))
      .filter((call): call is NonNullable<typeof call> => Boolean(call))
      .sort((a, b) => (time(b.properties?.hs_timestamp) ?? 0) - (time(a.properties?.hs_timestamp) ?? 0))[0]
    const body = (latest?.properties?.hs_call_body ?? '').trim()
    const objection = objectionFromCall(body)
    if (objection) out.set(contactId, objection)
  }
  return out
}
