/** Parse the hash Supabase appends after a confirm or recovery redirect. */

export const EMAIL_CONFIRMED_NOTICE = 'Email confirmed. Sign in to finish setting up.'

function hashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(raw)
}

export function authRedirectError(hash: string): string | null {
  if (!hash || hash === '#') return null
  const params = hashParams(hash)
  if (!params.has('error') && !params.has('error_code') && !params.has('error_description')) return null
  const description = params.get('error_description')?.trim()
  if (description) return description
  return 'This link is invalid or has expired. Request a new one.'
}

export function recoveryAccessToken(hash: string, search = ''): string | null {
  const fromHash = hashParams(hash).get('access_token')
  if (fromHash) return fromHash
  return new URLSearchParams(search).get('access_token')
}

/**
 * Supabase falls back to the site root when the redirect is not allowlisted.
 * Move recovery and signup redirects onto the page that can finish them.
 * Returns a replacement URL (path, query, hash) or null when the current URL is already right.
 */
export function normalizeAuthRedirect(pathname: string, hash: string): string | null {
  const params = hashParams(hash)
  const fragment = !hash || hash === '#' ? '' : hash.startsWith('#') ? hash : `#${hash}`
  const type = params.get('type')
  const onReset = pathname === '/reset-password' || pathname.startsWith('/reset-password/')
  const onLogin = pathname === '/login' || pathname.startsWith('/login/')

  if (type === 'recovery' && !onReset) return `/reset-password${fragment}`
  if (type === 'signup' && !onLogin) return `/login?verified=1${fragment}`

  const onHome = pathname === '/' || pathname === ''
  if (onHome && params.has('error') && (params.has('sb') || type === 'recovery')) {
    return `/reset-password${fragment}`
  }
  return null
}

export function loginNotice(input: {
  search: string
  hash: string
  flashedInfo?: string | null
  flashedError?: string | null
  flashedConfirm?: boolean
}): { info: string | null; error: string | null; needsConfirm: boolean } {
  const linkError = authRedirectError(input.hash)
  if (linkError) return { info: null, error: linkError, needsConfirm: true }
  const verified = new URLSearchParams(input.search).get('verified') === '1'
  return {
    info: input.flashedInfo || (verified ? EMAIL_CONFIRMED_NOTICE : null),
    error: input.flashedError ?? null,
    needsConfirm: Boolean(input.flashedConfirm)
  }
}
