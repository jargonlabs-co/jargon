import type { Contact, FieldDef, FieldType } from '../server/types'

export type Attrs = Record<string, unknown>

const IDENTITY_KEYS = new Set([
  'name',
  'fullName',
  'full_name',
  'firstName',
  'first_name',
  'firstname',
  'lastName',
  'last_name',
  'lastname',
  'company',
  'account',
  'accountName',
  'account_name',
  'organization',
  'company_name',
  'employer',
  'title',
  'jobTitle',
  'job_title',
  'jobtitle',
  'role',
  'current_title',
  'email',
  'emailAddress',
  'email_address',
  'workEmail',
  'work_email',
  'business_email',
  'phone',
  'phoneNumber',
  'phone_number',
  'mobile',
  'directDial',
  'city',
  'location',
  'city_state',
  'linkedinUrl',
  'linkedin_url',
  'linkedin',
  'profileUrl',
  'profile_url',
  'linkedin_profile_url',
  'hs_linkedinid',
  'notes',
  'note',
  'reason',
  'signal',
  'context',
  'companyDomain',
  'company_domain',
  'domain',
  'website',
  'attrs',
  'id',
  'externalId',
  'external_id',
  'crustdata_person_id',
  'projectId',
  'orgId',
  'status',
  'stepIndex',
  'source'
])

const MAX_ATTR_KEYS = 40
const MAX_ATTR_CHARS = 500

export function sanitizeFieldKey(raw: string): string | null {
  const key = raw.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  if (!key || key.length > 64) return null
  if (/^[0-9]/.test(key)) return `f_${key}`
  return key
}

export function fieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase())
}

function fieldTypeOf(value: unknown): FieldType {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  return 'string'
}

export function coerceAttrValue(value: unknown): unknown {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, MAX_ATTR_CHARS) : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string' && item.trim()) return item.trim()
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>
          const title = rec.title ?? rec.name ?? rec.snippet ?? rec.value
          return typeof title === 'string' ? title.trim() : ''
        }
        if (typeof item === 'number' && Number.isFinite(item)) return String(item)
        return ''
      })
      .filter(Boolean)
      .slice(0, 12)
    return parts.length ? parts : undefined
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).slice(0, MAX_ATTR_CHARS)
    } catch {
      return undefined
    }
  }
  return undefined
}

export function extraAttrs(
  record: Record<string, unknown>,
  extraSkip: Iterable<string> = []
): Attrs {
  const skip = new Set([...IDENTITY_KEYS, ...extraSkip])
  const attrs: Attrs = {}
  if (record.attrs && typeof record.attrs === 'object' && !Array.isArray(record.attrs)) {
    Object.assign(attrs, extraAttrs(record.attrs as Record<string, unknown>, skip))
  }
  for (const [rawKey, raw] of Object.entries(record)) {
    if (rawKey === 'attrs' || skip.has(rawKey)) continue
    const key = sanitizeFieldKey(rawKey)
    if (!key || skip.has(key) || key in attrs) continue
    const value = coerceAttrValue(raw)
    if (value === undefined) continue
    attrs[key] = value
    if (Object.keys(attrs).length >= MAX_ATTR_KEYS) break
  }
  return attrs
}

export function attrString(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' · ')
  return String(value)
}

export function interpolationVars(contact: {
  name: string
  company?: string
  title?: string
  email?: string
  phone?: string
  city?: string
  linkedinUrl?: string
  accountName?: string
  notes?: string
  companyDomain?: string
  companyIndustry?: string
  companySize?: string
  companyRevenue?: string
  attrs?: Attrs
  context?: string[]
}): Record<string, string> {
  const first = (contact.name.split(/\s+/)[0] || contact.name).trim()
  const last = contact.name.split(/\s+/).slice(1).join(' ')
  const vars: Record<string, string> = {
    name: contact.name,
    first_name: first,
    last_name: last,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    title: contact.title ?? '',
    persona: contact.title ?? '',
    company: contact.company ?? '',
    city: contact.city ?? '',
    linkedinUrl: contact.linkedinUrl ?? '',
    accountName: contact.accountName ?? contact.company ?? '',
    notes: contact.notes ?? '',
    companyDomain: contact.companyDomain ?? '',
    companyIndustry: contact.companyIndustry ?? '',
    companySize: contact.companySize ?? '',
    companyRevenue: contact.companyRevenue ?? '',
    context: (contact.context ?? []).join(' · ')
  }
  for (const [key, value] of Object.entries(contact.attrs ?? {})) {
    const text = attrString(value)
    if (!text) continue
    vars[key] = text
    vars[`attrs.${key}`] = text
  }
  return vars
}

export function interpolateTemplate(template: string, contact: Parameters<typeof interpolationVars>[0]): string {
  if (!template) return template
  const vars = interpolationVars(contact)
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, raw: string) => {
    const key = raw.trim()
    return vars[key] ?? vars[key.replace(/^attrs\./, '')] ?? ''
  })
}

export function catalogFromContacts(
  contacts: Array<{
    name?: string
    email?: string
    phone?: string
    title?: string
    company?: string
    city?: string
    linkedinUrl?: string
    companyDomain?: string
    companyIndustry?: string
    companySize?: string
    attrs?: Attrs
  }>
): FieldDef[] {
  const seen = new Map<string, FieldDef>()
  const identity: FieldDef[] = [
    { key: 'name', label: 'Name', type: 'string', origin: 'identity' },
    { key: 'first_name', label: 'First name', type: 'string', origin: 'identity' },
    { key: 'email', label: 'Email', type: 'string', origin: 'identity' },
    { key: 'title', label: 'Title', type: 'string', origin: 'identity' },
    { key: 'company', label: 'Company', type: 'string', origin: 'identity' },
    { key: 'phone', label: 'Phone', type: 'string', origin: 'identity' },
    { key: 'city', label: 'City', type: 'string', origin: 'identity' },
    { key: 'linkedinUrl', label: 'LinkedIn URL', type: 'string', origin: 'identity' }
  ]
  for (const field of identity) seen.set(field.key, field)

  for (const contact of contacts) {
    if (contact.companyIndustry && !seen.has('companyIndustry')) {
      seen.set('companyIndustry', {
        key: 'companyIndustry',
        label: 'Industry',
        type: 'string',
        origin: 'identity'
      })
    }
    if (contact.companySize && !seen.has('companySize')) {
      seen.set('companySize', {
        key: 'companySize',
        label: 'Company size',
        type: 'string',
        origin: 'identity'
      })
    }
    for (const [key, value] of Object.entries(contact.attrs ?? {})) {
      if (seen.has(key)) continue
      seen.set(key, {
        key,
        label: fieldLabel(key),
        type: fieldTypeOf(value),
        origin: 'attrs'
      })
    }
  }
  return [...seen.values()]
}

export function contactForCatalog(contact: Contact): Parameters<typeof catalogFromContacts>[0][number] {
  return contact
}
