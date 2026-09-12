import { uid } from './crypto'
import type { Contact } from './types'
import { extraAttrs } from '../shared/fieldCatalog'

export type DeployContactInput = {
  name: string
  company?: string
  title?: string
  email?: string
  phone?: string
  city?: string
  linkedinUrl?: string
  accountName?: string
  notes?: string
  context?: string[]
  companyDomain?: string
  attrs?: Record<string, unknown>
}

export const MAX_CONTACTS = 100

function asTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
  return items.length ? items : undefined
}

function pick(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asTrimmed(record[key])
    if (value) return value
  }
  return undefined
}

function normalizeContactRow(
  record: Record<string, unknown>
): DeployContactInput | { error: string } {
  const name = pick(record, ['name', 'fullName', 'full_name'])
  if (!name) return { error: 'name is required' }
  return {
    name,
    company: pick(record, ['company', 'account', 'accountName', 'account_name', 'organization']),
    title: pick(record, ['title', 'jobTitle', 'job_title', 'role']),
    email: pick(record, ['email', 'emailAddress', 'email_address', 'workEmail']),
    phone: pick(record, ['phone', 'phoneNumber', 'phone_number', 'mobile', 'directDial']),
    city: pick(record, ['city', 'location']),
    linkedinUrl: pick(record, ['linkedinUrl', 'linkedin_url', 'linkedin', 'profileUrl', 'profile_url']),
    accountName: pick(record, ['accountName', 'account_name', 'company']),
    notes: pick(record, ['notes', 'note', 'reason', 'signal']),
    context: asStringList(record.context),
    companyDomain: pick(record, ['companyDomain', 'company_domain', 'domain']),
    attrs: extraAttrs(record)
  }
}

export function parseDeployContacts(
  raw: unknown
): { ok: true; contacts?: DeployContactInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (!Array.isArray(raw)) return { ok: false, error: 'contacts must be an array' }
  if (raw.length === 0) {
    return { ok: false, error: 'contacts must include at least one person' }
  }
  if (raw.length > MAX_CONTACTS) {
    return { ok: false, error: `contacts is limited to ${MAX_CONTACTS} people` }
  }

  const contacts: DeployContactInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `contacts[${i}] must be an object` }
    }
    const parsed = normalizeContactRow(row as Record<string, unknown>)
    if ('error' in parsed) return { ok: false, error: `contacts[${i}].${parsed.error}` }
    contacts.push(parsed)
  }
  return { ok: true, contacts }
}

export function parseRequiredContacts(
  raw: unknown
): { ok: true; contacts: DeployContactInput[] } | { ok: false; error: string } {
  const parsed = parseDeployContacts(raw)
  if (!parsed.ok) return parsed
  if (!parsed.contacts?.length) {
    return { ok: false, error: 'contacts is required — pass the people to put in the queue' }
  }
  return { ok: true, contacts: parsed.contacts }
}

/** Prompt describes a researched/named list; do not silently hydrate CRM. */
export function promptNeedsExplicitContacts(prompt: string): boolean {
  return /crustdata|these \d+|this list|the following|ranked (companies|list)|linkedin\.com\/in|@[\w.-]+\.[a-z]{2,}/i.test(
    prompt
  )
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function jsonArraysIn(text: string): unknown[] {
  const found: unknown[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[') continue
    let depth = 0
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) {
          const value = parseJsonValue(text.slice(i, j + 1))
          if (Array.isArray(value)) found.push(value)
          i = j
          break
        }
      }
    }
  }
  return found
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}/.test(line)
}

function headerField(cell: string): string | null {
  const t = cell.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/^(contact|name|person|full name)$/.test(t)) return 'name'
  if (/company|account/.test(t)) return 'company'
  if (/title|role|job/.test(t)) return 'title'
  if (/email/.test(t)) return 'email'
  if (/phone|mobile|dial/.test(t)) return 'phone'
  if (/linkedin|profile/.test(t)) return 'linkedinUrl'
  if (/notes|signal/.test(t)) return 'notes'
  if (/city|location/.test(t)) return 'city'
  return t.replace(/\s+/g, '_')
}

function cellUrl(cell: string): string | undefined {
  const md = cell.match(/\]\((https?:\/\/[^)\s]+)\)/)
  if (md?.[1]) return md[1]
  const raw = cell.match(/https?:\/\/[^\s)|]+/)
  return raw?.[0]
}

function cellEmail(cell: string): string | undefined {
  return cell.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
}

function extractMarkdownTableContacts(prompt: string): DeployContactInput[] | undefined {
  const lines = prompt.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('|')) continue
    const headers = splitTableRow(lines[i]).map(headerField)
    if (!headers.includes('name')) continue
    let rowIndex = i + 1
    if (rowIndex < lines.length && isTableDivider(lines[rowIndex])) rowIndex++
    const rows: DeployContactInput[] = []
    for (; rowIndex < lines.length; rowIndex++) {
      const line = lines[rowIndex]
      if (!line.includes('|') || isTableDivider(line)) break
      const cells = splitTableRow(line)
      const record: Record<string, unknown> = {}
      headers.forEach((field, idx) => {
        if (!field) return
        const raw = cells[idx] ?? ''
        if (field === 'linkedinUrl') record.linkedinUrl = cellUrl(raw)
        else if (field === 'email') record.email = cellEmail(raw)
        else record[field] = asTrimmed(raw)
      })
      const parsed = normalizeContactRow(record)
      if (!('error' in parsed)) rows.push(parsed)
    }
    if (rows.length) return rows.slice(0, MAX_CONTACTS)
  }
  return undefined
}

/** Claude connectors often cache tool schemas — only `prompt` is sendable. Pull people out of that text. */
export function extractContactsFromPrompt(prompt: string): DeployContactInput[] | undefined {
  for (const value of jsonArraysIn(prompt)) {
    const parsed = parseDeployContacts(value)
    if (parsed.ok && parsed.contacts?.length) return parsed.contacts
  }
  return extractMarkdownTableContacts(prompt)
}

export const PROMPT_CONTACTS_HINT =
  'Include the people in prompt as JSON, e.g. [{"name":"Ada Lopez","company":"Acme","title":"VP RevOps","email":"ada@acme.com","phone":"+1…","linkedinUrl":"https://linkedin.com/in/…"}]. That list becomes the queue — HubSpot/Railway are not used.'

export function providedSegment(contacts: DeployContactInput[]): string {
  const companies = [
    ...new Set(contacts.map((c) => c.company).filter((c): c is string => Boolean(c)))
  ]
  if (!companies.length) return 'Provided list'
  if (companies.length <= 4) return companies.join(', ')
  return `${companies.slice(0, 3).join(', ')} +${companies.length - 3}`
}

export function toManualContacts(
  orgId: string,
  projectId: string,
  inputs: DeployContactInput[]
): Contact[] {
  const now = Date.now()
  return inputs.map((p, i) => {
    const company = p.company ?? ''
    return {
      id: uid('ct'),
      orgId,
      projectId,
      name: p.name,
      company,
      title: p.title ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      city: p.city ?? '',
      status: i === 0 ? ('active' as const) : ('queued' as const),
      stepIndex: 0,
      notes: p.notes ?? '',
      source: 'manual' as const,
      accountName: p.accountName ?? company,
      linkedinUrl: p.linkedinUrl,
      companyDomain: p.companyDomain,
      context: p.context,
      attrs: p.attrs && Object.keys(p.attrs).length ? p.attrs : {},
      channelsDone: [],
      createdAt: now,
      updatedAt: now
    }
  })
}
