const DEFAULT_API = 'http://127.0.0.1:8787'
const DEFAULT_PREVIEW = 'http://127.0.0.1:5173'

/** API base the studio is connected to (Electron or dev server). */
export function getStudioApiBase(): string {
  return (window.jargon?.apiBaseUrl ?? DEFAULT_API).replace(/\/$/, '')
}

/** API base for a browser share preview tab (?api= wins). */
export function getSharePreviewApiBase(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('api')
  if (fromQuery) return fromQuery.replace(/\/$/, '')
  return getStudioApiBase()
}

/** Ensure preview links always target preview.html with the studio API in ?api=. */
export function normalizeSharePreviewUrl(rawUrl: string, apiBase = getStudioApiBase()): string {
  const api = apiBase.replace(/\/$/, '')
  const tokenMatch = rawUrl.match(/#\/([^?#]+)/)
  const token = tokenMatch?.[1]

  try {
    const url = new URL(rawUrl, window.location.origin)
    if (!url.pathname.endsWith('preview.html')) {
      url.pathname = url.pathname.replace(/\/?$/, '/preview.html')
    }
    url.searchParams.set('api', api)
    if (token) url.hash = `/${token}`
    return url.toString()
  } catch {
    if (!token) return rawUrl
    return `${DEFAULT_PREVIEW}/preview.html?api=${encodeURIComponent(api)}#/${token}`
  }
}

/** Wire ?api= into window.jargon when opening preview.html in a normal browser tab. */
export function bootstrapSharePreviewApi(): void {
  const api = new URLSearchParams(window.location.search).get('api')?.replace(/\/$/, '')
  if (!api) return
  window.jargon = {
    platform: 'web',
    ...window.jargon,
    apiBaseUrl: api
  }
}
