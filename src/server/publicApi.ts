import type { DataStore } from './store'
import type {
  CallSession,
  Contact,
  ContactStatus,
  Message,
  MessageStatus,
  Project,
  SequenceStep
} from './types'
import type { ServerConfig } from './config'
import { uid } from './crypto'
import { sendPlatformGmail } from './providers/gmail'
import { sendHeyReachLinkedInMessage } from './providers/heyreach'
import { inferDeployParams } from './deploy'
import { createProjectRecord } from './projectCreate'
import {
  extractContactsFromPrompt,
  MAX_CONTACTS,
  PROMPT_CONTACTS_HINT,
  promptNeedsExplicitContacts,
  toManualContacts,
  type DeployContactInput
} from './deployContacts'
import {
  isContactStatus,
  listContacts,
  nextQueueContact,
  shouldAdvanceStep
} from './queries'

export type PublicProject = {
  id: string
  name: string
  kind: Project['kind']
  prompt: string
  segment: string
  description: string
  contactCount: number
  dashboardPath: string
  createdAt: number
  updatedAt: number
}

export type PublicContact = {
  id: string
  projectId: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  status: ContactStatus
  stepIndex: number
  notes: string
  linkedinUrl?: string
  accountName?: string
  context?: string[]
  createdAt: number
  updatedAt: number
}

export type PublicStep = {
  id: string
  day: number
  channel: SequenceStep['channel']
  label: string
  subject?: string
  body?: string
  order: number
}

export type PublicCall = {
  id: string
  contactId: string
  projectId: string
  phase: CallSession['phase']
  disposition?: ContactStatus
  mode: CallSession['mode']
  startedAt: number
  connectedAt?: number
  endedAt?: number
}

export type PublicMessage = {
  id: string
  contactId: string
  projectId: string
  channel: Message['channel']
  status: MessageStatus
  subject: string
  body: string
  mode: Message['mode']
  createdAt: number
  sentAt?: number
}

export type QueueNextPublic = {
  contact: PublicContact | null
  step: PublicStep | null
  remaining: number
}

export function toPublicProject(dbContacts: Contact[], project: Project): PublicProject {
  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    prompt: project.prompt,
    segment: project.segment,
    description: project.description,
    contactCount: dbContacts.filter((c) => c.projectId === project.id).length,
    dashboardPath: `/tools/${project.id}`,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  }
}

export function toPublicContact(contact: Contact): PublicContact {
  return {
    id: contact.id,
    projectId: contact.projectId,
    name: contact.name,
    company: contact.company,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    city: contact.city,
    status: contact.status,
    stepIndex: contact.stepIndex,
    notes: contact.notes,
    linkedinUrl: contact.linkedinUrl,
    accountName: contact.accountName,
    context: contact.context,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt
  }
}

export function toPublicStep(step: SequenceStep | null): PublicStep | null {
  if (!step) return null
  return {
    id: step.id,
    day: step.day,
    channel: step.channel,
    label: step.label,
    subject: step.subject,
    body: step.body,
    order: step.order
  }
}

export function toPublicCall(call: CallSession): PublicCall {
  return {
    id: call.id,
    contactId: call.contactId,
    projectId: call.projectId,
    phase: call.phase,
    disposition: call.disposition,
    mode: call.mode,
    startedAt: call.startedAt,
    connectedAt: call.connectedAt,
    endedAt: call.endedAt
  }
}

export function toPublicMessage(message: Message): PublicMessage {
  return {
    id: message.id,
    contactId: message.contactId,
    projectId: message.projectId,
    channel: message.channel,
    status: message.status,
    subject: message.subject,
    body: message.body,
    mode: message.mode,
    createdAt: message.createdAt,
    sentAt: message.sentAt
  }
}

export function emptyQueue(): QueueNextPublic {
  return { contact: null, step: null, remaining: 0 }
}

export function toPublicQueueNext(
  next: ReturnType<typeof nextQueueContact>
): QueueNextPublic {
  if (!next) return emptyQueue()
  return {
    contact: toPublicContact(next.contact),
    step: toPublicStep(next.step),
    remaining: next.remaining
  }
}

export function findOrgProject(store: DataStore, orgId: string, projectId: string) {
  return store.db.projects.find((p) => p.id === projectId && p.orgId === orgId) ?? null
}

export function findOrgContact(store: DataStore, orgId: string, contactId: string) {
  return store.db.contacts.find((c) => c.id === contactId && c.orgId === orgId) ?? null
}

export function findOrgCall(store: DataStore, orgId: string, callId: string) {
  return store.db.calls.find((c) => c.id === callId && c.orgId === orgId) ?? null
}

export function listPublicProjects(store: DataStore, orgId: string): PublicProject[] {
  return store.db.projects
    .filter((p) => p.orgId === orgId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => toPublicProject(store.db.contacts, p))
}

export function listPublicContacts(
  store: DataStore,
  projectId: string,
  opts: { status?: ContactStatus; q?: string; limit?: number; offset?: number }
) {
  return listPublicProspects(store, { ...opts, projectId })
}

export function listPublicProspects(
  store: DataStore,
  opts: {
    orgId?: string
    projectId?: string
    status?: ContactStatus
    q?: string
    limit?: number
    offset?: number
  }
) {
  const result = listContacts(store.db, opts)
  return {
    contacts: result.contacts.map(toPublicContact),
    total: result.total,
    limit: result.limit,
    offset: result.offset
  }
}

export async function deployPublicTool(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  prompt: string,
  contacts?: DeployContactInput[]
): Promise<
  | { ok: true; status: 201; body: { projectId: string; contactCount: number; dashboardPath: string; project: PublicProject } }
  | { ok: false; status: 400; body: { error: string } }
  | { ok: false; status: 502; body: { error: string } }
> {
  const resolved =
    contacts?.length ? contacts : extractContactsFromPrompt(prompt)
  if (!resolved?.length && promptNeedsExplicitContacts(prompt)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `This prompt names a specific list. ${PROMPT_CONTACTS_HINT}`
      }
    }
  }
  const inferred = inferDeployParams(prompt)
  try {
    const projectId = await createProjectRecord(store, config, {
      orgId,
      prompt,
      kind: inferred.kind,
      answers: inferred.answers,
      contacts: resolved
    })
    const project = store.db.projects.find((p) => p.id === projectId)
    if (!project) {
      return { ok: false, status: 502, body: { error: 'Project created but could not be loaded' } }
    }
    const publicProject = toPublicProject(store.db.contacts, project)
    return {
      ok: true,
      status: 201,
      body: {
        projectId,
        contactCount: publicProject.contactCount,
        dashboardPath: publicProject.dashboardPath,
        project: publicProject
      }
    }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { error: err instanceof Error ? err.message : 'Deploy failed' }
    }
  }
}

export function addPublicContacts(
  store: DataStore,
  orgId: string,
  projectId: string,
  inputs: DeployContactInput[]
):
  | { ok: true; added: number; contactCount: number; contacts: PublicContact[] }
  | { ok: false; error: string } {
  const project = findOrgProject(store, orgId, projectId)
  if (!project) return { ok: false, error: 'Project not found' }
  const existing = store.db.contacts.filter((c) => c.projectId === projectId)
  if (existing.length + inputs.length > MAX_CONTACTS) {
    return { ok: false, error: `workspace can hold ${MAX_CONTACTS} contacts` }
  }
  const created = toManualContacts(orgId, projectId, inputs)
  if (existing.some((c) => c.status === 'active')) {
    for (const contact of created) contact.status = 'queued'
  }
  const now = Date.now()
  store.update((db) => {
    db.contacts.push(...created)
    const total = db.contacts.filter((c) => c.projectId === projectId).length
    const campaign = db.campaigns.find((x) => x.projectId === projectId && x.state === 'ACTIVE')
    if (campaign) {
      campaign.total = total
      campaign.updatedAt = now
    }
    const nextProject = db.projects.find((x) => x.id === projectId)
    if (nextProject) nextProject.updatedAt = now
    db.activities.unshift({
      id: uid('act'),
      orgId,
      projectId,
      kind: 'sync',
      summary: `Added ${created.length} contacts`,
      createdAt: now
    })
  })
  return {
    ok: true,
    added: created.length,
    contactCount: existing.length + created.length,
    contacts: created.map(toPublicContact)
  }
}

export function applyDisposition(
  store: DataStore,
  contactId: string,
  input: { status: ContactStatus; note?: string; advanceStep?: boolean }
): { contact: PublicContact; next: QueueNextPublic } {
  const now = Date.now()
  const doAdvance = shouldAdvanceStep(input.status, input.advanceStep)
  store.update((db) => {
    const c = db.contacts.find((x) => x.id === contactId)
    if (!c) return
    c.status = input.status
    c.updatedAt = now
    if (doAdvance) {
      c.stepIndex = Math.min(c.stepIndex + 1, 99)
    }
    if (input.note?.trim()) {
      const stamped = `${new Date(now).toLocaleString()}: ${input.note.trim()}`
      c.notes = c.notes ? `${c.notes}\n${stamped}` : stamped
    }
    db.activities.unshift({
      id: uid('act'),
      orgId: c.orgId,
      projectId: c.projectId,
      contactId: c.id,
      kind: 'system',
      summary: input.note?.trim()
        ? `Disposition ${input.status.replace('_', ' ')} · ${input.note.trim()}`
        : `Disposition ${input.status.replace('_', ' ')}`,
      createdAt: now
    })
    if (input.status !== 'active' && input.status !== 'queued') {
      const next = db.contacts.find(
        (x) => x.projectId === c.projectId && x.status === 'queued' && x.id !== c.id
      )
      if (next) {
        next.status = 'active'
        next.updatedAt = now
      }
    }
    const project = db.projects.find((p) => p.id === c.projectId)
    if (project) project.updatedAt = now
  })
  const updated = store.db.contacts.find((c) => c.id === contactId)!
  return {
    contact: toPublicContact(updated),
    next: toPublicQueueNext(nextQueueContact(store.db, updated.projectId))
  }
}

export function startPublicCall(
  store: DataStore,
  config: ServerConfig,
  contact: Contact,
  sandbox = false
): PublicCall {
  const now = Date.now()
  const callId = uid('call')
  const twilioReady = Boolean(config.twilio.accountSid && config.twilio.apiKeySid)
  const mode = sandbox || !twilioReady ? 'demo' : 'twilio'
  store.update((db) => {
    db.contacts.forEach((c) => {
      if (c.projectId !== contact.projectId) return
      if (c.id === contact.id) {
        c.status = 'active'
        c.updatedAt = now
      } else if (c.status === 'active') {
        c.status = 'queued'
        c.updatedAt = now
      }
    })
    db.calls.unshift({
      id: callId,
      orgId: contact.orgId,
      projectId: contact.projectId,
      contactId: contact.id,
      phase: 'dialing',
      mode,
      startedAt: now
    })
    db.activities.unshift({
      id: uid('act'),
      orgId: contact.orgId,
      projectId: contact.projectId,
      contactId: contact.id,
      kind: 'call',
      summary: `Dialing ${contact.name}`,
      createdAt: now
    })
    const project = db.projects.find((p) => p.id === contact.projectId)
    if (project) project.updatedAt = now
  })

  if (mode === 'demo') {
    setTimeout(() => {
      store.update((db) => {
        const call = db.calls.find((c) => c.id === callId)
        if (!call || call.phase !== 'dialing') return
        call.phase = 'connected'
        call.connectedAt = Date.now()
        db.activities.unshift({
          id: uid('act'),
          orgId: call.orgId,
          projectId: call.projectId,
          contactId: call.contactId,
          kind: 'call',
          summary: `Connected with ${contact.name}`,
          createdAt: Date.now()
        })
      })
    }, 1100)
  }

  return toPublicCall(store.db.calls.find((c) => c.id === callId)!)
}

export function completePublicCall(
  store: DataStore,
  callId: string,
  disposition: ContactStatus
): { call: PublicCall; next: QueueNextPublic } {
  const now = Date.now()
  store.update((db) => {
    const c = db.calls.find((x) => x.id === callId)
    if (!c) return
    c.phase = 'completed'
    c.disposition = disposition
    c.endedAt = now
    const contact = db.contacts.find((x) => x.id === c.contactId)
    if (contact) {
      contact.status = disposition
      contact.updatedAt = now
      const done = new Set(contact.channelsDone ?? [])
      done.add('call')
      contact.channelsDone = [...done]
      if (disposition === 'interested' || disposition === 'completed' || disposition === 'replied') {
        contact.stepIndex = Math.min(contact.stepIndex + 1, 99)
      }
    }
    const campaign = db.campaigns.find(
      (camp) => camp.projectId === c.projectId && camp.state === 'ACTIVE'
    )
    if (campaign) {
      campaign.done = Math.min(campaign.total, campaign.done + 1)
      campaign.updatedAt = now
      const completed = db.calls.filter((x) => x.projectId === c.projectId && x.phase === 'completed')
      const answered = completed.filter((x) => x.disposition && x.disposition !== 'no_answer').length
      campaign.answerRatio = completed.length ? (answered / completed.length) * 100 : 0
    }
    const next = db.contacts.find(
      (x) => x.projectId === c.projectId && x.status === 'queued' && x.id !== c.contactId
    )
    if (next) {
      next.status = 'active'
      next.updatedAt = now
    }
    db.activities.unshift({
      id: uid('act'),
      orgId: c.orgId,
      projectId: c.projectId,
      contactId: c.contactId,
      kind: 'call',
      summary: `Call completed · ${disposition.replace('_', ' ')}`,
      createdAt: now
    })
    const project = db.projects.find((p) => p.id === c.projectId)
    if (project) project.updatedAt = now
  })
  const call = store.db.calls.find((c) => c.id === callId)!
  return {
    call: toPublicCall(call),
    next: toPublicQueueNext(nextQueueContact(store.db, call.projectId))
  }
}

export async function sendPublicMessage(
  store: DataStore,
  config: ServerConfig,
  contact: Contact,
  input: {
    subject?: string
    body?: string
    status?: 'draft' | 'queued' | 'sent'
    channel?: 'email' | 'linkedin'
    sandbox?: boolean
  }
): Promise<
  | { ok: true; status: 201; body: { message: PublicMessage } }
  | { ok: false; status: 502; body: { error: string; message: PublicMessage } }
> {
  const messageChannel = input.channel ?? 'email'
  const now = Date.now()
  const messageId = uid('msg')
  let finalStatus: MessageStatus = input.status ?? 'sent'
  let mode: Message['mode'] = 'demo'
  let providerMessageId: string | undefined
  let error: string | undefined

  if (finalStatus === 'sent' && messageChannel === 'email') {
    if (input.sandbox) {
      mode = 'demo'
      providerMessageId = `sandbox_mail_${now}`
    } else {
      try {
        const result = await sendPlatformGmail(config, {
          to: contact.email,
          subject: input.subject ?? '(no subject)',
          body: input.body ?? ''
        })
        mode = result.mode
        providerMessageId = result.id
      } catch (err) {
        finalStatus = 'failed'
        error = err instanceof Error ? err.message : 'Send failed'
      }
    }
  }

  if (finalStatus === 'sent' && messageChannel === 'linkedin') {
    if (input.sandbox) {
      mode = 'demo'
      providerMessageId = `sandbox_li_${now}`
    } else {
      const apiKey = config.heyreach.apiKey.trim() || 'demo'
      const demo = !config.heyreach.apiKey.trim() || apiKey === 'demo'
      try {
        const result = await sendHeyReachLinkedInMessage({
          apiKey,
          linkedinUrl: contact.linkedinUrl ?? '',
          message: input.body ?? '',
          demo
        })
        mode = result.mode
        providerMessageId = result.id
      } catch (err) {
        finalStatus = 'failed'
        error = err instanceof Error ? err.message : 'LinkedIn send failed'
      }
    }
  }

  store.update((db) => {
    db.messages.unshift({
      id: messageId,
      orgId: contact.orgId,
      projectId: contact.projectId,
      contactId: contact.id,
      subject: input.subject ?? (messageChannel === 'linkedin' ? 'LinkedIn message' : '(no subject)'),
      body: input.body ?? '',
      status: finalStatus,
      channel: messageChannel,
      mode,
      providerMessageId,
      error,
      createdAt: now,
      updatedAt: now,
      sentAt: finalStatus === 'sent' ? now : undefined
    })
    const c = db.contacts.find((x) => x.id === contact.id)
    if (c && finalStatus === 'sent') {
      c.status = c.status === 'queued' ? 'active' : c.status
      c.stepIndex = c.stepIndex + 1
      c.updatedAt = now
      const done = new Set(c.channelsDone ?? [])
      done.add(messageChannel === 'linkedin' ? 'linkedin' : 'email')
      c.channelsDone = [...done]
    }
    db.activities.unshift({
      id: uid('act'),
      orgId: contact.orgId,
      projectId: contact.projectId,
      contactId: contact.id,
      kind:
        finalStatus === 'sent'
          ? messageChannel === 'linkedin'
            ? 'linkedin'
            : 'email'
          : messageChannel === 'linkedin'
            ? 'linkedin'
            : finalStatus === 'failed'
              ? 'email'
              : 'draft',
      summary:
        finalStatus === 'sent'
          ? messageChannel === 'linkedin'
            ? `Sent LinkedIn message to ${contact.name}`
            : `Sent email to ${contact.name}`
          : finalStatus === 'failed'
            ? `Failed to ${messageChannel === 'linkedin' ? 'message' : 'email'} ${contact.name}: ${error}`
            : `Saved ${messageChannel} draft for ${contact.name}`,
      createdAt: now
    })
    const project = db.projects.find((p) => p.id === contact.projectId)
    if (project) project.updatedAt = now
  })

  const message = toPublicMessage(store.db.messages.find((m) => m.id === messageId)!)
  if (finalStatus === 'failed') {
    return { ok: false, status: 502, body: { error: error ?? 'Send failed', message } }
  }
  return { ok: true, status: 201, body: { message } }
}

export function addPublicNote(store: DataStore, contactId: string, note: string): PublicContact {
  const now = Date.now()
  store.update((db) => {
    const c = db.contacts.find((x) => x.id === contactId)
    if (!c) return
    const stamped = `${new Date(now).toLocaleString()}: ${note.trim()}`
    c.notes = c.notes ? `${c.notes}\n${stamped}` : stamped
    c.updatedAt = now
    db.activities.unshift({
      id: uid('act'),
      orgId: c.orgId,
      projectId: c.projectId,
      contactId: c.id,
      kind: 'note',
      summary: note.trim(),
      createdAt: now
    })
  })
  return toPublicContact(store.db.contacts.find((c) => c.id === contactId)!)
}

export { isContactStatus, nextQueueContact }
