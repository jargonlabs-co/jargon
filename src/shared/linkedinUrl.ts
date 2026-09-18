/**
 * Normalize LinkedIn profile URLs from CRM/export formats into a stable https URL.
 * Accepts vanity slugs, scheme-less hosts, and Salesforce/Sales Nav member IDs (ACo…).
 */
export function normalizeLinkedInUrl(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  let s = String(raw).trim()
  if (!s) return undefined

  const md = s.match(/\]\(([^)\s]+)\)/)
  if (md?.[1]) s = md[1].trim()
  s = s.replace(/^<|>$/g, '').trim()
  if (!s) return undefined

  // Bare member URN / vanity slug
  if (/^ACo[\w-]+$/i.test(s) || (/^[\w.-]+$/.test(s) && !/\./.test(s))) {
    return `https://www.linkedin.com/in/${s}`
  }

  // Path-only
  if (s.startsWith('/in/') || s.startsWith('/sales/')) {
    s = `https://www.linkedin.com${s}`
  }

  // Scheme-less linkedin.com/…
  if (/^(www\.)?linkedin\.com\//i.test(s)) {
    s = `https://${s.replace(/^www\./i, 'www.')}`
  }

  if (!/^https?:\/\//i.test(s)) {
    // e.g. "in/jane-doe" or leftover host-less junk
    if (/^in\/[\w.%+-]+/i.test(s)) {
      s = `https://www.linkedin.com/${s.replace(/^\//, '')}`
    } else {
      return undefined
    }
  }

  try {
    const u = new URL(s)
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return undefined

    const inMatch = u.pathname.match(/\/in\/([^/?#]+)/i)
    if (inMatch?.[1]) {
      const id = decodeURIComponent(inMatch[1]).replace(/\/+$/, '')
      if (!id) return undefined
      return `https://www.linkedin.com/in/${id}`
    }

    const salesMatch = u.pathname.match(/\/sales\/lead\/([^/,?#]+)/i)
    if (salesMatch?.[1]) {
      const id = decodeURIComponent(salesMatch[1]).replace(/\/+$/, '')
      if (!id) return undefined
      return `https://www.linkedin.com/sales/lead/${id}`
    }

    return undefined
  } catch {
    return undefined
  }
}
