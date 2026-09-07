import type {
  AnalyticsSummary,
  Contact,
  ContactStatus,
  Database,
  SequenceStep
} from './types'

/** Statuses that still belong in the outbound queue. */
export const QUEUE_STATUSES: ContactStatus[] = ['queued', 'active', 'no_answer']

const TERMINAL_FOR_STEP: ContactStatus[] = ['interested', 'completed', 'replied']

export function analyticsFor(db: Database, projectId: string): AnalyticsSummary {
  const contacts = db.contacts.filter((c) => c.projectId === projectId)
  const calls = db.calls.filter((c) => c.projectId === projectId)
  const messages = db.messages.filter((m) => m.projectId === projectId)
  const enrolled = contacts.length
  const contacted = contacts.filter((c) => c.status !== 'queued').length
  const replied = contacts.filter((c) => c.status === 'replied' || c.status === 'interested').length
  const booked = contacts.filter((c) => c.status === 'interested').length
  const emailsSent = messages.filter((m) => m.status === 'sent').length
  const completedCalls = calls.filter((c) => c.phase === 'completed')
  const answered = completedCalls.filter(
    (c) => c.disposition && !['no_answer', 'queued'].includes(c.disposition)
  ).length

  return {
    enrolled,
    contacted,
    replied,
    booked,
    calls: completedCalls.length,
    emailsSent,
    openRate: emailsSent ? Math.min(95, 48 + emailsSent * 3) : 0,
    answerRate: completedCalls.length ? (answered / completedCalls.length) * 100 : 0
  }
}

export function bundleProject(db: Database, projectId: string) {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return null
  return {
    project,
    campaigns: db.campaigns.filter((c) => c.projectId === projectId),
    sequences: db.sequences.filter((s) => s.projectId === projectId),
    steps: db.steps.filter((s) => s.projectId === projectId),
    contacts: db.contacts.filter((c) => c.projectId === projectId),
    calls: db.calls.filter((c) => c.projectId === projectId),
    messages: db.messages.filter((m) => m.projectId === projectId),
    activities: db.activities
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50),
    analytics: analyticsFor(db, projectId)
  }
}

export function stepsForProject(db: Database, projectId: string): SequenceStep[] {
  return db.steps
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.order - b.order || a.day - b.day)
}

export function currentStepForContact(
  db: Database,
  contact: Contact
): SequenceStep | null {
  const steps = stepsForProject(db, contact.projectId)
  if (!steps.length) return null
  const idx = Math.min(Math.max(contact.stepIndex, 0), steps.length - 1)
  return steps[idx] ?? null
}

function contactMatchesQuery(contact: Contact, q: string): boolean {
  const hay = [contact.name, contact.company, contact.title, contact.email, contact.city]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

export function listProjectContacts(
  db: Database,
  projectId: string,
  opts: {
    status?: ContactStatus
    q?: string
    limit?: number
    offset?: number
  } = {}
): { contacts: Contact[]; total: number; limit: number; offset: number } {
  return listContacts(db, { ...opts, projectId })
}

export function listContacts(
  db: Database,
  opts: {
    orgId?: string
    projectId?: string
    status?: ContactStatus
    q?: string
    limit?: number
    offset?: number
  } = {}
): { contacts: Contact[]; total: number; limit: number; offset: number } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const q = opts.q?.trim().toLowerCase()

  let contacts = db.contacts.filter((c) => {
    if (opts.orgId && c.orgId !== opts.orgId) return false
    if (opts.projectId && c.projectId !== opts.projectId) return false
    return true
  })
  if (opts.status) {
    contacts = contacts.filter((c) => c.status === opts.status)
  }
  if (q) {
    contacts = contacts.filter((c) => contactMatchesQuery(c, q))
  }
  contacts = [...contacts].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1
    if (b.status === 'active' && a.status !== 'active') return 1
    return a.stepIndex - b.stepIndex || a.updatedAt - b.updatedAt
  })

  const total = contacts.length
  return {
    contacts: contacts.slice(offset, offset + limit),
    total,
    limit,
    offset
  }
}

/**
 * Next contact to work: prefer current `active`, else earliest queueable by step/updated.
 */
export function nextQueueContact(
  db: Database,
  projectId: string
): { contact: Contact; step: SequenceStep | null; remaining: number } | null {
  const queueable = db.contacts.filter(
    (c) => c.projectId === projectId && QUEUE_STATUSES.includes(c.status)
  )
  if (!queueable.length) return null

  const active = queueable.find((c) => c.status === 'active')
  const sorted = [...queueable].sort(
    (a, b) => a.stepIndex - b.stepIndex || a.updatedAt - b.updatedAt
  )
  const contact = active ?? sorted[0]
  if (!contact) return null

  return {
    contact,
    step: currentStepForContact(db, contact),
    remaining: queueable.length
  }
}

export function isContactStatus(value: unknown): value is ContactStatus {
  return (
    typeof value === 'string' &&
    [
      'queued',
      'active',
      'completed',
      'replied',
      'no_answer',
      'interested',
      'not_interested'
    ].includes(value)
  )
}

export function shouldAdvanceStep(
  status: ContactStatus,
  advanceStep?: boolean
): boolean {
  if (advanceStep === true) return true
  if (advanceStep === false) return false
  return TERMINAL_FOR_STEP.includes(status)
}
