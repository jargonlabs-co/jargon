import { randomUUID } from 'node:crypto'

export function apiBase(): string {
  const raw = (process.env.JARGON_API_URL ?? 'https://www.jargonlabs.co').replace(
    /\/$/,
    ''
  )
  return raw.endsWith('/v1') ? raw : `${raw}/v1`
}

export function apiKey(): string {
  const key = (process.env.JARGON_API_KEY ?? process.env.JARGON_TEST_KEY ?? '').trim()
  if (!key) {
    throw new Error(
      'Set JARGON_API_KEY (or JARGON_TEST_KEY). Create one at jargonlabs.co or: jargon api-keys create --sandbox'
    )
  }
  return key
}

type CallOpts = {
  query?: Record<string, string | number | undefined>
  body?: unknown
  idempotency?: boolean
}

export async function jargonFetch(method: string, path: string, opts: CallOpts = {}): Promise<unknown> {
  const url = new URL(`${apiBase()}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === '') continue
    url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    Accept: 'application/json'
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.idempotency) headers['Idempotency-Key'] = randomUUID()

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  })
  const text = await res.text()
  let json: unknown = text
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const err =
      typeof json === 'object' && json && 'error' in json
        ? String((json as { error: string }).error)
        : text || `HTTP ${res.status}`
    const extra =
      typeof json === 'object' && json && 'code' in json
        ? ` (${String((json as { code: string }).code)})`
        : ''
    throw new Error(`${res.status} ${err}${extra}`)
  }
  return json
}

export function toolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
  }
}

export function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}
