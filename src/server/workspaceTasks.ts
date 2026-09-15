import type { Channel, ContactStatus, MessageStatus } from './types'
import type { PublicCall, PublicContact, PublicMessage, PublicStep } from './publicApi'

const DAY_MS = 86_400_000

const STOP_STATUSES: ContactStatus[] = ['replied', 'interested', 'not_interested']

/** due: act now · scheduled: waiting on its send day · blocked: missing an address or number */
export type TaskState = 'due' | 'scheduled' | 'done' | 'skipped' | 'blocked'

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'done' | 'skipped'

/** One step of the sequence for one enrolled contact. */
export type WorkspaceTask = {
  id: string
  contactId: string
  contactName: string
  contactMeta: string
  stepId: string
  stepLabel: string
  stepOrder: number
  day: number
  channel: Channel
  dueAt: number
  state: TaskState
  bucket: TaskBucket
  messageId?: string
  messageStatus?: MessageStatus
  subject?: string
  body?: string
  /** Email address, phone, or LinkedIn URL this task acts on. */
  target?: string
  /** Why a task is blocked or skipped. */
  reason?: string
}

export type TaskStats = {
  overdue: number
  today: number
  upcoming: number
  done: number
  skipped: number
  blocked: number
  /** overdue + today, i.e. what the rep should work right now. */
  open: number
  enrolled: number
}

export function buildWorkspaceTasks(input: {
  contacts: PublicContact[]
  steps: PublicStep[]
  messages: PublicMessage[]
  calls: PublicCall[]
  now?: number
}): WorkspaceTask[] {
  const now = input.now ?? Date.now()
  const steps = [...input.steps].sort((a, b) => a.day - b.day || a.order - b.order)
  if (!steps.length) return []

  const byContact = new Map<string, PublicMessage[]>()
  for (const message of input.messages) {
    const list = byContact.get(message.contactId)
    if (list) list.push(message)
    else byContact.set(message.contactId, [message])
  }
  const stepDays = new Map(steps.map((step) => [step.id, Math.max(0, step.day)]))
  // Contacts whose every step was skipped at enrollment still get tasks, anchored to the workspace.
  const workspaceAnchor = enrollmentAnchor(input.messages, stepDays)

  const tasks: WorkspaceTask[] = []
  for (const contact of input.contacts) {
    const messages = byContact.get(contact.id) ?? []
    const anchor =
      enrollmentAnchor(messages, stepDays) ?? (contact.status === 'queued' ? null : workspaceAnchor)
    if (anchor == null) continue

    const stopped = STOP_STATUSES.includes(contact.status)
    const completedCalls = input.calls
      .filter((call) => call.contactId === contact.id && call.phase === 'completed')
      .sort((a, b) => a.startedAt - b.startedAt)
    const claimed = new Set<string>()
    const seenChannels = new Set<Channel>()
    let callIndex = 0

    for (const step of steps) {
      const firstOfChannel = !seenChannels.has(step.channel)
      seenChannels.add(step.channel)
      const dueAt = anchor + Math.max(0, step.day) * DAY_MS
      const base = {
        id: `${contact.id}:${step.id}`,
        contactId: contact.id,
        contactName: contact.name,
        contactMeta: [contact.title, contact.company].filter(Boolean).join(' · '),
        stepId: step.id,
        stepLabel: step.label || channelName(step.channel),
        stepOrder: step.order,
        day: Math.max(0, step.day),
        channel: step.channel
      }

      if (step.channel === 'call') {
        const call = completedCalls[callIndex]
        if (call) {
          callIndex += 1
          tasks.push({
            ...base,
            dueAt: call.startedAt,
            state: 'done',
            bucket: 'done',
            target: contact.phone || undefined,
            reason: call.disposition ? call.disposition.replace('_', ' ') : undefined
          })
          continue
        }
        const state: TaskState = stopped
          ? 'skipped'
          : !contact.phone?.trim()
            ? 'blocked'
            : dueAt > now
              ? 'scheduled'
              : 'due'
        tasks.push({
          ...base,
          dueAt,
          state,
          bucket: bucketFor(state, dueAt, now),
          target: contact.phone || undefined,
          reason: reasonFor(state, stopped, contact.status, 'No phone number')
        })
        continue
      }

      const message =
        pick(messages, (m) => m.stepId === step.id && !claimed.has(m.id)) ??
        (firstOfChannel
          ? pick(messages, (m) => !m.stepId && m.channel === step.channel && !claimed.has(m.id))
          : undefined)
      if (message) claimed.add(message.id)
      const target = step.channel === 'linkedin' ? contact.linkedinUrl : contact.email
      const copy = {
        subject: message?.subject || step.subject,
        body: message?.body || step.body,
        target: target || undefined
      }

      if (message?.status === 'sent') {
        tasks.push({
          ...base,
          ...copy,
          dueAt: message.sentAt ?? dueAt,
          state: 'done',
          bucket: 'done',
          messageId: message.id,
          messageStatus: message.status
        })
        continue
      }
      if (message?.status === 'cancelled') {
        tasks.push({
          ...base,
          ...copy,
          dueAt: message.sendAt ?? dueAt,
          state: 'skipped',
          bucket: 'skipped',
          messageId: message.id,
          messageStatus: message.status,
          reason: `Cancelled — ${contact.status.replace('_', ' ')}`
        })
        continue
      }

      const sendAt = message?.sendAt ?? dueAt
      // An ad-hoc draft is actionable the moment it exists; anything with a send
      // day — including a cadence drafted at enrollment — waits for that day.
      const actionable = (message?.status === 'draft' && message.sendAt == null) || sendAt <= now
      const state: TaskState = stopped
        ? 'skipped'
        : !target?.trim()
          ? 'blocked'
          : actionable
            ? 'due'
            : 'scheduled'
      tasks.push({
        ...base,
        ...copy,
        dueAt: sendAt,
        state,
        bucket: bucketFor(state, sendAt, now),
        messageId: message?.id,
        messageStatus: message?.status,
        reason:
          message?.status === 'failed'
            ? 'Last send failed'
            : reasonFor(state, stopped, contact.status, step.channel === 'linkedin' ? 'No LinkedIn URL' : 'No email address')
      })
    }
  }

  return tasks.sort((a, b) => a.dueAt - b.dueAt || a.contactName.localeCompare(b.contactName))
}

export function summarizeTasks(tasks: WorkspaceTask[]): TaskStats {
  const count = (fn: (task: WorkspaceTask) => boolean) => tasks.filter(fn).length
  const overdue = count((t) => t.bucket === 'overdue')
  const today = count((t) => t.bucket === 'today')
  return {
    overdue,
    today,
    upcoming: count((t) => t.bucket === 'upcoming'),
    done: count((t) => t.bucket === 'done'),
    skipped: count((t) => t.bucket === 'skipped'),
    blocked: count((t) => t.state === 'blocked'),
    open: overdue + today,
    enrolled: new Set(tasks.map((t) => t.contactId)).size
  }
}

function pick(messages: PublicMessage[], match: (m: PublicMessage) => boolean): PublicMessage | undefined {
  const hits = messages.filter(match)
  if (!hits.length) return undefined
  return hits.find((m) => m.status !== 'cancelled' && m.status !== 'failed') ?? hits[0]
}

/** Enrollment time implied by a scheduled message: its send day minus the step's wait days. */
function enrollmentAnchor(messages: PublicMessage[], stepDays: Map<string, number>): number | null {
  let anchor: number | null = null
  for (const message of messages) {
    if (!message.stepId) continue
    const day = stepDays.get(message.stepId)
    if (day == null) continue
    const at = (message.sendAt ?? message.sentAt ?? message.createdAt) - day * DAY_MS
    if (anchor == null || at < anchor) anchor = at
  }
  return anchor
}

function bucketFor(state: TaskState, dueAt: number, now: number): TaskBucket {
  if (state === 'done') return 'done'
  if (state === 'skipped') return 'skipped'
  const start = new Date(now).setHours(0, 0, 0, 0)
  const end = new Date(now).setHours(23, 59, 59, 999)
  if (dueAt < start) return 'overdue'
  if (dueAt <= end) return 'today'
  return 'upcoming'
}

function reasonFor(
  state: TaskState,
  stopped: boolean,
  status: ContactStatus,
  blockedReason: string
): string | undefined {
  if (state === 'blocked') return blockedReason
  if (stopped) return `Contact is ${status.replace('_', ' ')}`
  return undefined
}

function channelName(channel: Channel): string {
  if (channel === 'call') return 'Call'
  if (channel === 'linkedin') return 'LinkedIn'
  return 'Email'
}
