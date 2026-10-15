import type { DataStore } from './store'
import type { Activity, CallSession, Contact, Message, Project, SequenceStep } from './types'

export type AdminRange = '7d' | '30d' | '90d' | 'quarter' | 'custom'
export type AdminFocus = 'reps' | 'sequences' | 'meetings' | 'territories'

export type AdminMetrics = {
  emails: number
  calls: number
  connects: number
  replies: number
  meetings: number
  linkedin: number
}

export type AdminSequenceRow = AdminMetrics & {
  id: string
  name: string
}

export type AdminRepRow = AdminMetrics & {
  id: string
  name: string
  attributed: boolean
  sequences: AdminSequenceRow[]
}

export type AdminMeetingRow = {
  id: string
  contactName: string
  company: string
  sequence: string
  start: string
  title: string
}

export type AdminMessagePick = {
  subject: string
  preview: string
  sent: number
  replies: number
  meetings: number
  /** Meetings divided by sends when this copy booked any, otherwise replies divided by sends. */
  rate: number
  basis: 'meetings' | 'replies'
}

export type AdminTerritoryRow = AdminMetrics & {
  id: string
  name: string
  message: AdminMessagePick | null
}

export type AdminReport = {
  view: 'admin'
  orgName: string
  range: AdminRange
  rangeLabel: string
  start: string
  end: string
  focus: AdminFocus
  totals: AdminMetrics
  reps: AdminRepRow[]
  sequences: AdminSequenceRow[]
  meetings: AdminMeetingRow[]
  territories: AdminTerritoryRow[]
  /** True when some activity in the window has no member. */
  unattributed: boolean
  summary: string
  nextAction: string
}

const DAY = 86_400_000
const UNASSIGNED = 'unassigned'

/** A performance question, not a request to build a cadence. */
export function isAdminReportAsk(prompt: string): boolean {
  const text = prompt.toLowerCase()
  if (/\b(cadence|sequenc|dialer|enroll|campaign)\b/.test(text)) return false
  if (/\b(drill-?downs?|productivity|performance report|rep report)\b/.test(text)) return true
  if (/\bhow (did|has) the (team|org|reps?)\b/.test(text)) return true
  return (
    /\b(last quarter|this quarter|q[1-4])\b/.test(text) &&
    /\b(reps?|drill|report|performance|admin|productivity)\b/.test(text)
  )
}

export function adminWindow(
  input: { range?: AdminRange; start?: string; end?: string },
  now = Date.now()
): { ok: true; range: AdminRange; start: number; end: number; label: string } | { ok: false; error: string } {
  if (input.start || input.end) {
    if (!input.start || !input.end) return { ok: false, error: 'Pass both start and end' }
    const start = parseBound(input.start, 'start')
    const end = parseBound(input.end, 'end')
    if (start == null || end == null) return { ok: false, error: 'start and end must be dates' }
    if (start >= end) return { ok: false, error: 'start must be before end' }
    const endDay = end - 1
    return {
      ok: true,
      range: 'custom',
      start,
      end,
      label: formatSpan(start, endDay)
    }
  }
  const range = input.range ?? '30d'
  if (range === 'quarter') {
    const quarter = previousQuarter(now)
    return { ok: true, range, start: quarter.start, end: quarter.end, label: quarter.label }
  }
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  const start = now - days * DAY
  return {
    ok: true,
    range: range === '7d' || range === '90d' ? range : '30d',
    start,
    end: now + 1,
    label: range === '7d' ? 'Last 7 days' : range === '90d' ? 'Last 90 days' : 'Last 30 days'
  }
}

export function buildAdminReport(
  store: DataStore,
  orgId: string,
  input: { range?: AdminRange; start?: string; end?: string; focus?: AdminFocus },
  now = Date.now()
): { ok: true; report: AdminReport } | { ok: false; error: string } {
  const org = store.db.orgs.find((row) => row.id === orgId)
  if (!org) return { ok: false, error: 'Account not found' }
  const window = adminWindow(input, now)
  if (!window.ok) return window
  const focus = input.focus ?? 'reps'
  const projects = new Map(
    store.db.projects.filter((project) => project.orgId === orgId).map((project) => [project.id, project])
  )
  const users = new Map(store.db.users.map((user) => [user.id, user.name || user.email]))
  const contacts = store.db.contacts.filter((contact) => contact.orgId === orgId)
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))

  const totals = emptyMetrics()
  const sequenceBuckets = new Map<string, MetricsBucket>()
  const repBuckets = new Map<string, RepBucket>()
  const territoryBuckets = new Map<string, MetricsBucket>()

  const touch = (userId: string | undefined, projectId: string, key: keyof AdminMetrics, contactId?: string) => {
    const project = projects.get(projectId)
    const sequence = bucketFor(sequenceBuckets, projectId, project?.name || 'Sequence')
    add(totals, key)
    add(sequence, key)
    const repId = userId && users.has(userId) ? userId : UNASSIGNED
    const repName = repId === UNASSIGNED ? 'Unassigned' : users.get(repId) || 'Rep'
    const rep = repBucketFor(repBuckets, repId, repName, repId !== UNASSIGNED)
    add(rep, key)
    const repSequence = bucketFor(rep.sequenceMap, projectId, project?.name || 'Sequence')
    add(repSequence, key)
    const place = territoryOf(contactId ? contactById.get(contactId) : undefined)
    add(bucketFor(territoryBuckets, place.id, place.name), key)
  }

  for (const message of store.db.messages) {
    if (message.orgId !== orgId || message.status !== 'sent') continue
    const at = message.sentAt ?? message.createdAt
    if (!inRange(at, window.start, window.end)) continue
    if (message.channel === 'linkedin') touch(message.userId, message.projectId, 'linkedin', message.contactId)
    else touch(message.userId, message.projectId, 'emails', message.contactId)
  }

  for (const call of store.db.calls) {
    if (call.orgId !== orgId || !inRange(call.startedAt, window.start, window.end)) continue
    touch(call.userId, call.projectId, 'calls', call.contactId)
    if (callConnected(call)) touch(call.userId, call.projectId, 'connects', call.contactId)
  }

  for (const activity of store.db.activities) {
    if (activity.orgId !== orgId || !inRange(activity.createdAt, window.start, window.end)) continue
    if (!isReply(activity)) continue
    const sender = replyOwner(store.db.messages, activity)
    touch(sender, activity.projectId, 'replies', activity.contactId)
  }

  const countedMeetings = new Set<string>()
  const meetingRows: AdminMeetingRow[] = []
  for (const contact of contacts) {
    const at = meetingBookedAt(contact)
    if (at == null || !inRange(at, window.start, window.end) || !contact.meeting) continue
    countedMeetings.add(contact.id)
    touch(contact.meeting.userId, contact.projectId, 'meetings', contact.id)
    meetingRows.push(meetingRow(contact, projects))
  }
  for (const activity of store.db.activities) {
    if (activity.orgId !== orgId || !activity.contactId || countedMeetings.has(activity.contactId)) continue
    if (!inRange(activity.createdAt, window.start, window.end) || !isMeetingDisposition(activity)) continue
    const contact = contactById.get(activity.contactId)
    countedMeetings.add(activity.contactId)
    touch(activity.userId, activity.projectId, 'meetings', activity.contactId)
    meetingRows.push({
      id: activity.id,
      contactName: contact?.name || 'Contact',
      company: contact?.company || '',
      sequence: projects.get(activity.projectId)?.name || 'Sequence',
      start: new Date(activity.createdAt).toISOString(),
      title: 'Meeting booked'
    })
  }

  const sequences = [...sequenceBuckets.values()]
    .map(toSequenceRow)
    .sort(byMeetings)
  const reps = [...repBuckets.values()].map(toRepRow).sort(sortReps)
  const onlyTeam = reps.length === 1 && reps[0]?.id === UNASSIGNED
  if (onlyTeam && reps[0]) reps[0].name = 'Team'
  const unattributed = reps.some((rep) => !rep.attributed)
  meetingRows.sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
  const territories = territoryRows(
    territoryBuckets,
    store.db.messages.filter((message) => message.orgId === orgId),
    store.db.activities.filter((activity) => activity.orgId === orgId),
    store.db.steps.filter((step) => step.orgId === orgId),
    contactById,
    countedMeetings,
    window.start,
    window.end
  )

  const report: AdminReport = {
    view: 'admin',
    orgName: org.name,
    range: window.range,
    rangeLabel: window.label,
    start: new Date(window.start).toISOString(),
    end: new Date(window.end).toISOString(),
    focus,
    totals,
    reps,
    sequences,
    meetings: meetingRows.slice(0, 50),
    territories,
    unattributed,
    summary:
      focus === 'territories'
        ? territorySummary(org.name, window.label, window.range, territories)
        : summaryLine(org.name, window.label, totals, window.range),
    nextAction:
      'The admin view is open. Say the summary in one sentence. Do not paste the table. Do not call show_tasks.'
  }
  return { ok: true, report }
}

function emptyMetrics(): AdminMetrics {
  return { emails: 0, calls: 0, connects: 0, replies: 0, meetings: 0, linkedin: 0 }
}

type MetricsBucket = AdminMetrics & { id: string; name: string }
type RepBucket = MetricsBucket & { attributed: boolean; sequenceMap: Map<string, MetricsBucket> }

function bucketFor(map: Map<string, MetricsBucket>, id: string, name: string): MetricsBucket {
  let row = map.get(id)
  if (!row) {
    row = { id, name, ...emptyMetrics() }
    map.set(id, row)
  }
  return row
}

function repBucketFor(map: Map<string, RepBucket>, id: string, name: string, attributed: boolean): RepBucket {
  let row = map.get(id)
  if (!row) {
    row = { id, name, attributed, sequenceMap: new Map(), ...emptyMetrics() }
    map.set(id, row)
  }
  return row
}

function add(metrics: AdminMetrics, key: keyof AdminMetrics) {
  metrics[key] += 1
}

function toSequenceRow(row: MetricsBucket): AdminSequenceRow {
  return {
    id: row.id,
    name: row.name,
    emails: row.emails,
    calls: row.calls,
    connects: row.connects,
    replies: row.replies,
    meetings: row.meetings,
    linkedin: row.linkedin
  }
}

function toRepRow(row: RepBucket): AdminRepRow {
  return {
    ...toSequenceRow(row),
    attributed: row.attributed,
    sequences: [...row.sequenceMap.values()].map(toSequenceRow).sort(byMeetings)
  }
}

function byMeetings(a: AdminMetrics, b: AdminMetrics) {
  return b.meetings - a.meetings || b.calls - a.calls || b.emails - a.emails
}

function sortReps(a: AdminRepRow, b: AdminRepRow) {
  if (a.attributed !== b.attributed) return a.attributed ? -1 : 1
  return byMeetings(a, b)
}

function inRange(at: number | undefined, start: number, end: number) {
  return typeof at === 'number' && at >= start && at < end
}

function callConnected(call: CallSession) {
  if (call.connectedAt) return true
  if (call.phase !== 'completed' || !call.disposition) return false
  return call.disposition !== 'no_answer' && call.disposition !== 'queued'
}

function isReply(activity: Activity) {
  if (activity.kind !== 'email') return false
  if (activity.summary.startsWith('Auto-reply')) return false
  return activity.summary.includes(' replied')
}

function isMeetingDisposition(activity: Activity) {
  return activity.summary.startsWith('Disposition meeting booked')
}

function replyOwner(messages: Message[], activity: Activity): string | undefined {
  let best: Message | undefined
  for (const message of messages) {
    if (message.contactId !== activity.contactId || message.channel !== 'email' || message.status !== 'sent') continue
    const at = message.sentAt ?? message.createdAt
    if (at > activity.createdAt) continue
    if (!best || at > (best.sentAt ?? best.createdAt)) best = message
  }
  return best?.userId
}

function meetingBookedAt(contact: Contact): number | null {
  if (!contact.meeting) return null
  if (contact.meeting.bookedAt) return contact.meeting.bookedAt
  const start = Date.parse(contact.meeting.start)
  return Number.isFinite(start) ? start : null
}

function meetingRow(contact: Contact, projects: Map<string, Project>): AdminMeetingRow {
  const meeting = contact.meeting!
  return {
    id: contact.id,
    contactName: contact.name,
    company: contact.company,
    sequence: projects.get(contact.projectId)?.name || 'Sequence',
    start: meeting.start,
    title: meeting.title
  }
}

function summaryLine(orgName: string, label: string, totals: AdminMetrics, range: AdminRange) {
  const window = range === 'quarter' ? 'Last quarter' : label
  const quiet = totals.emails + totals.calls + totals.meetings + totals.replies + totals.linkedin === 0
  if (quiet) return `${window}, ${orgName} had no outbound activity.`
  const meetings = `${totals.meetings} ${totals.meetings === 1 ? 'meeting' : 'meetings'}`
  const calls = `${totals.calls} ${totals.calls === 1 ? 'call' : 'calls'}`
  const emails = `${totals.emails} ${totals.emails === 1 ? 'email' : 'emails'}`
  const replies = totals.replies
    ? `, with ${totals.replies} ${totals.replies === 1 ? 'reply' : 'replies'}`
    : ''
  return `${window}, ${orgName} booked ${meetings} from ${calls} and ${emails}${replies}.`
}

function previousQuarter(now: number) {
  const date = new Date(now)
  const month = date.getUTCMonth()
  const year = date.getUTCFullYear()
  const current = Math.floor(month / 3)
  const quarter = current === 0 ? 3 : current - 1
  const quarterYear = current === 0 ? year - 1 : year
  const startMonth = quarter * 3
  const start = Date.UTC(quarterYear, startMonth, 1)
  const end = Date.UTC(quarterYear, startMonth + 3, 1)
  return {
    start,
    end,
    label: formatSpan(start, end - DAY)
  }
}

function parseBound(raw: string, edge: 'start' | 'end'): number | null {
  const trimmed = raw.trim()
  const ms = Date.parse(trimmed)
  if (!Number.isFinite(ms)) return null
  if (edge === 'end' && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return ms + DAY
  return ms
}

function formatDay(ms: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(ms)
}

function formatSpan(start: number, endInclusive: number) {
  const sameYear = new Date(start).getUTCFullYear() === new Date(endInclusive).getUTCFullYear()
  const startLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' as const })
  }).format(start)
  return `${startLabel} – ${formatDay(endInclusive)}`
}

const NO_TERRITORY = { id: 'none', name: 'No territory' }
const TERRITORY_KEYS = [
  'territory',
  'sales_territory',
  'salesterritory',
  'hs_territory',
  'territory_name',
  'region',
  'sales_region',
  'state',
  'hs_state',
  'company_state',
  'company_territory'
]

function territoryOf(contact: Contact | undefined): { id: string; name: string } {
  if (!contact?.attrs) return NO_TERRITORY
  const entries = Object.entries(contact.attrs)
  for (const wanted of TERRITORY_KEYS) {
    const found = entries.find(([key]) => key.toLowerCase() === wanted)
    const text = found ? attrText(found[1]) : ''
    if (!text) continue
    const name = text.replace(/\s+/g, ' ')
    return { id: name.toLowerCase(), name }
  }
  return NO_TERRITORY
}

function attrText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

type CopyBucket = {
  key: string
  subject: string
  preview: string
  sent: number
  replies: Set<string>
  meetings: Set<string>
}

function territoryRows(
  buckets: Map<string, MetricsBucket>,
  messages: Message[],
  activities: Activity[],
  steps: SequenceStep[],
  contacts: Map<string, Contact>,
  meetingContacts: Set<string>,
  start: number,
  end: number
): AdminTerritoryRow[] {
  const stepById = new Map(steps.map((step) => [step.id, step]))
  const copies = new Map<string, Map<string, CopyBucket>>()
  const copyFor = (contact: Contact, message: Message) => {
    const place = territoryOf(contact)
    let group = copies.get(place.id)
    if (!group) {
      group = new Map()
      copies.set(place.id, group)
    }
    const identity = messageIdentity(message, contact, stepById)
    let row = group.get(identity.key)
    if (!row) {
      row = { key: identity.key, subject: identity.subject, preview: identity.preview, sent: 0, replies: new Set(), meetings: new Set() }
      group.set(identity.key, row)
    }
    return row
  }

  for (const message of messages) {
    if (message.status !== 'sent' || message.channel === 'linkedin') continue
    const at = message.sentAt ?? message.createdAt
    if (!inRange(at, start, end)) continue
    const contact = contacts.get(message.contactId)
    if (!contact) continue
    const row = copyFor(contact, message)
    row.sent += 1
    if (!row.preview) row.preview = firstLine(message.body)
  }

  for (const activity of activities) {
    if (!activity.contactId || !inRange(activity.createdAt, start, end) || !isReply(activity)) continue
    const contact = contacts.get(activity.contactId)
    const message = lastTouchEmail(messages, activity.contactId, activity.createdAt, start, end)
    if (!contact || !message) continue
    const row = copyFor(contact, message)
    row.replies.add(contact.id)
    if (message.body.trim()) row.preview = firstLine(message.body)
  }

  for (const contactId of meetingContacts) {
    const contact = contacts.get(contactId)
    if (!contact) continue
    const at = meetingBookedAt(contact) ?? 0
    const message = lastTouchEmail(messages, contactId, at, start, end)
    if (!message) continue
    const row = copyFor(contact, message)
    row.meetings.add(contact.id)
    if (message.body.trim()) row.preview = firstLine(message.body)
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...toSequenceRow(bucket),
      message: bestCopy([...(copies.get(bucket.id)?.values() ?? [])])
    }))
    .sort(sortTerritories)
}

function sortTerritories(a: AdminTerritoryRow, b: AdminTerritoryRow) {
  if ((a.id === 'none') !== (b.id === 'none')) return a.id === 'none' ? 1 : -1
  return byMeetings(a, b)
}

function bestCopy(rows: CopyBucket[]): AdminMessagePick | null {
  const sent = rows.filter((row) => row.sent > 0)
  if (!sent.length) return null
  const volume = sent.some((row) => row.sent >= 3)
    ? sent.filter((row) => row.sent >= 3)
    : sent.some((row) => row.sent >= 2)
      ? sent.filter((row) => row.sent >= 2)
      : sent
  volume.sort((a, b) => {
    const meetings = b.meetings.size / b.sent - a.meetings.size / a.sent
    if (meetings) return meetings
    const replies = b.replies.size / b.sent - a.replies.size / a.sent
    if (replies) return replies
    return b.sent - a.sent
  })
  const best = volume[0]
  if (!best) return null
  const meetings = best.meetings.size
  const replies = best.replies.size
  const basis = meetings > 0 ? 'meetings' : 'replies'
  return {
    subject: best.subject,
    preview: best.preview,
    sent: best.sent,
    replies,
    meetings,
    rate: best.sent ? (basis === 'meetings' ? meetings : replies) / best.sent : 0,
    basis
  }
}

function messageIdentity(
  message: Message,
  contact: Contact,
  steps: Map<string, SequenceStep>
): { key: string; subject: string; preview: string } {
  const step = message.stepId ? steps.get(message.stepId) : undefined
  if (step) {
    return {
      key: `step:${step.id}`,
      subject: step.subject?.trim() || step.label || message.subject.trim() || '(no subject)',
      preview: firstLine(message.body)
    }
  }
  const subject = message.subject.trim() || '(no subject)'
  return { key: `subj:${normalizeSubject(subject, contact)}`, subject, preview: firstLine(message.body) }
}

function normalizeSubject(subject: string, contact: Contact): string {
  const first = (contact.name.split(/\s+/)[0] || '').toLowerCase()
  let text = subject.toLowerCase().replace(/\s+/g, ' ')
  if (first) text = text.replaceAll(first, '{{first_name}}')
  if (contact.company.trim()) text = text.replaceAll(contact.company.trim().toLowerCase(), '{{company}}')
  return text
}

function firstLine(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim()
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

function lastTouchEmail(
  messages: Message[],
  contactId: string,
  at: number,
  start: number,
  end: number
): Message | undefined {
  let best: Message | undefined
  for (const message of messages) {
    if (message.contactId !== contactId || message.channel === 'linkedin' || message.status !== 'sent') continue
    const sentAt = message.sentAt ?? message.createdAt
    if (!inRange(sentAt, start, end) || sentAt > at) continue
    if (!best || sentAt > (best.sentAt ?? best.createdAt)) best = message
  }
  return best
}

function territorySummary(orgName: string, label: string, range: AdminRange, rows: AdminTerritoryRow[]) {
  const window = range === 'quarter' ? 'Last quarter' : label
  const ranked = rows.filter((row) => row.id !== 'none')
  if (!ranked.length) {
    return `${window}, ${orgName} has no territory on its contacts. Territory is read from the CRM field territory, region, or state.`
  }
  const top = ranked[0]
  if (!top?.message) return `${window}, ${top?.name ?? 'The top territory'} led ${orgName} with ${top?.meetings ?? 0} meetings.`
  const pct = Math.round(top.message.rate * 1000) / 10
  const outcome = top.message.basis === 'meetings' ? 'booked a meeting' : 'got a reply'
  return `${window}, ${top.name} converted best on “${top.message.subject}” (${pct}% of ${top.message.sent} emails ${outcome}).`
}

export const SAMPLE_ADMIN_REPORT: AdminReport = {
  view: 'admin',
  orgName: 'Northwind',
  range: 'quarter',
  rangeLabel: 'Jul 1 – Sep 30, 2026',
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-10-01T00:00:00.000Z',
  focus: 'reps',
  totals: { emails: 91, calls: 69, connects: 26, replies: 16, meetings: 11, linkedin: 8 },
  unattributed: false,
  summary: 'Last quarter, Northwind booked 11 meetings from 69 calls and 91 emails, with 16 replies.',
  nextAction: 'The admin view is open. Say the summary in one sentence. Do not paste the table. Do not call show_tasks.',
  reps: [
    {
      id: 'user_maya',
      name: 'Maya Chen',
      attributed: true,
      emails: 42,
      calls: 28,
      connects: 11,
      replies: 9,
      meetings: 6,
      linkedin: 4,
      sequences: [
        { id: 'proj_gtm', name: 'GTM Engineers · US', emails: 24, calls: 16, connects: 7, replies: 6, meetings: 4, linkedin: 2 },
        { id: 'proj_revops', name: 'Series B RevOps', emails: 18, calls: 12, connects: 4, replies: 3, meetings: 2, linkedin: 2 }
      ]
    },
    {
      id: 'user_jordan',
      name: 'Jordan Hale',
      attributed: true,
      emails: 31,
      calls: 19,
      connects: 6,
      replies: 4,
      meetings: 3,
      linkedin: 3,
      sequences: [
        { id: 'proj_revops', name: 'Series B RevOps', emails: 15, calls: 10, connects: 4, replies: 2, meetings: 2, linkedin: 1 },
        { id: 'proj_dq', name: 'Disqualified re-engage', emails: 16, calls: 9, connects: 2, replies: 2, meetings: 1, linkedin: 2 }
      ]
    },
    {
      id: 'user_sam',
      name: 'Sam Ortiz',
      attributed: true,
      emails: 18,
      calls: 22,
      connects: 9,
      replies: 3,
      meetings: 2,
      linkedin: 1,
      sequences: [
        { id: 'proj_gtm', name: 'GTM Engineers · US', emails: 16, calls: 14, connects: 5, replies: 2, meetings: 1, linkedin: 1 },
        { id: 'proj_dq', name: 'Disqualified re-engage', emails: 2, calls: 8, connects: 4, replies: 1, meetings: 1, linkedin: 0 }
      ]
    }
  ],
  sequences: [
    { id: 'proj_gtm', name: 'GTM Engineers · US', emails: 40, calls: 30, connects: 12, replies: 8, meetings: 5, linkedin: 3 },
    { id: 'proj_revops', name: 'Series B RevOps', emails: 33, calls: 22, connects: 8, replies: 5, meetings: 4, linkedin: 3 },
    { id: 'proj_dq', name: 'Disqualified re-engage', emails: 18, calls: 17, connects: 6, replies: 3, meetings: 2, linkedin: 2 }
  ],
  territories: [
    {
      id: 'west',
      name: 'West',
      emails: 40,
      calls: 30,
      connects: 12,
      replies: 8,
      meetings: 5,
      linkedin: 3,
      message: {
        subject: '{{first_name}} — GTM hiring at {{company}}',
        preview: 'Saw Northwind is hiring GTM engineers. Worth a 20-minute intro?',
        sent: 24,
        replies: 6,
        meetings: 4,
        rate: 4 / 24,
        basis: 'meetings'
      }
    },
    {
      id: 'east',
      name: 'East',
      emails: 33,
      calls: 22,
      connects: 8,
      replies: 5,
      meetings: 4,
      linkedin: 3,
      message: {
        subject: 'RevOps seat at {{company}}',
        preview: 'Noticed Harbor is opening a RevOps seat this quarter. Open to a short intro?',
        sent: 20,
        replies: 4,
        meetings: 3,
        rate: 3 / 20,
        basis: 'meetings'
      }
    },
    {
      id: 'central',
      name: 'Central',
      emails: 18,
      calls: 17,
      connects: 6,
      replies: 3,
      meetings: 2,
      linkedin: 2,
      message: {
        subject: 'Worth another look, {{first_name}}',
        preview: 'Circling back in case the earlier note landed at the wrong time.',
        sent: 12,
        replies: 2,
        meetings: 2,
        rate: 2 / 12,
        basis: 'meetings'
      }
    }
  ],
  meetings: [
    {
      id: 'mt_1',
      contactName: 'Alex Chen',
      company: 'Northwind',
      sequence: 'GTM Engineers · US',
      start: '2026-09-18T17:00:00.000Z',
      title: 'Intro with Alex Chen'
    },
    {
      id: 'mt_2',
      contactName: 'Priya Shah',
      company: 'Harbor',
      sequence: 'Series B RevOps',
      start: '2026-09-09T15:30:00.000Z',
      title: 'Intro with Priya Shah'
    },
    {
      id: 'mt_3',
      contactName: 'Luis Ortega',
      company: 'Fieldwork',
      sequence: 'GTM Engineers · US',
      start: '2026-08-21T18:00:00.000Z',
      title: 'Intro with Luis Ortega'
    },
    {
      id: 'mt_4',
      contactName: 'Nina Park',
      company: 'Lumen',
      sequence: 'Disqualified re-engage',
      start: '2026-07-29T16:00:00.000Z',
      title: 'Intro with Nina Park'
    }
  ]
}
