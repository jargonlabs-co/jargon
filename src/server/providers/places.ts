import { quietWindowFromPeriods, type HoursPeriod } from '../../shared/play'

const SEARCH = 'https://places.googleapis.com/v1/places:searchText'

export type QuietLookup = {
  label: string
  timezone?: string
  placeId?: string
}

/** Posted hours for a business, from the Places API. */
export async function lookupQuietWindow(apiKey: string, query: string): Promise<QuietLookup | null> {
  const text = query.trim()
  if (!apiKey.trim() || !text) return null
  const res = await fetch(SEARCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.regularOpeningHours,places.timeZone'
    },
    body: JSON.stringify({ textQuery: text })
  })
  if (!res.ok) return null
  const json = (await res.json()) as {
    places?: Array<{
      id?: string
      timeZone?: { id?: string }
      regularOpeningHours?: { periods?: HoursPeriod[] }
    }>
  }
  const place = json.places?.[0]
  const periods = place?.regularOpeningHours?.periods ?? []
  const window = quietWindowFromPeriods(periods, place?.timeZone?.id)
  if (!window) return null
  return { label: window.label, timezone: window.timezone, placeId: place?.id }
}
