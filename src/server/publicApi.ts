import type { DataStore } from './store'
import type {
  CallPhase,
  CallSession,
  Channel,
  Contact,
  ContactStatus,
  Database,
  FieldDef,
  Message,
  MessageStatus,
  Project,
  SequenceStep,
  WorkspaceSpec
} from './types'
import type { ServerConfig } from './config'
import { uid } from './crypto'
import { sendPlatformGmail } from './providers/gmail'
import { sendHeyReachLinkedInMessage } from './providers/heyreach'
import { hangupLiveCall, inspectLiveVoice } from './providers/voice'
import { inferDeployParams } from './deploy'
import { createProjectRecord } from './projectCreate'
import { formatChannels, parseDeploySpec, shouldAutoStartSequence } from '../shared/workspaceSpec'
import { catalogFromContacts, interpolateTemplate } from '../shared/fieldCatalog'
import { setProjectCatalog } from './fieldCatalogSync'
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
import {
  ATTR_ENROLLED_AT,
  ATTR_TALK_TRACK,
  ATTR_TALK_TRACKS,
  enrolledAtOf
} from './workspaceTasks'

export type PublicProject = {
  id: string
  name: string
  kind: Project['kind']
  prompt: string
  segment: string
  description: string
  contactCount: number
  dashboardPath: string
  dashboardUrl: string
  spec?: WorkspaceSpec
  fieldCatalog?: FieldDef[]
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
  attrs?: Record<string, unknown>
  channelsDone?: Contact['channelsDone']
  enrichedAt?: number
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
  sendAt?: number
  stepId?: string
}

export type QueueNextPublic = {
  contact: PublicContact | null
  step: PublicStep | null
  preview?: { subject?: string; body?: string } | null
  fieldCatalog?: FieldDef[]
  remaining: number
}

export function dashboardFor(projectId: string, appUrl: string): { dashboardPath: string; dashboardUrl: string } {
  const dashboardPath = `/tools/${projectId}`
  return {
    dashboardPath,
    dashboardUrl: `${appUrl.replace(/\/$/, '')}${dashboardPath}`
  }
}

export function toPublicProject(dbContacts: Contact[], project: Project, appUrl: string): PublicProject {
  const { dashboardPath, dashboardUrl } = dashboardFor(project.id, appUrl)
  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    prompt: project.prompt,
    segment: project.segment,
    description: project.description,
    contactCount: dbContacts.filter((c) => c.projectId === project.id).length,
    dashboardPath,
    dashboardUrl,
    spec: project.spec,
    fieldCatalog: project.fieldCatalog?.length
      ? project.fieldCatalog
      : catalogFromContacts(dbContacts.filter((c) => c.projectId === project.id)),
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
    attrs: contact.attrs && Object.keys(contact.attrs).length ? contact.attrs : undefined,
    channelsDone: contact.channelsDone?.length ? contact.channelsDone : undefined,
    enrichedAt: contact.enrichedAt,
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
    sentAt: message.sentAt,
    sendAt: message.sendAt,
    stepId: message.stepId
  }
}

export function emptyQueue(): QueueNextPublic {
  return { contact: null, step: null, preview: null, remaining: 0 }
}

export function toPublicQueueNext(
  next: ReturnType<typeof nextQueueContact>,
  catalog?: FieldDef[]
): QueueNextPublic {
  if (!next) return emptyQueue()
  const contact = toPublicContact(next.contact)
  const step = toPublicStep(next.step)
  return {
    contact,
    step,
    preview: step
      ? {
          subject: step.subject ? interpolateTemplate(step.subject, next.contact) : undefined,
          body: step.body ? interpolateTemplate(step.body, next.contact) : undefined
        }
      : null,
    fieldCatalog: catalog,
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

export function listPublicProjects(store: DataStore, orgId: string, appUrl: string): PublicProject[] {
  return store.db.projects
    .filter((p) => p.orgId === orgId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => toPublicProject(store.db.contacts, p, appUrl))
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
  contacts?: DeployContactInput[],
  specOverride?: unknown,
  opts?: { enroll?: boolean }
): Promise<
  | {
      ok: true
      status: 201
      body: {
        projectId: string
        contactCount: number
        dashboardPath: string
        dashboardUrl: string
        project: PublicProject
        researchPending?: boolean
        nextAction?: string
        steps?: Array<{ id: string; day: number; channel: string; label: string }>
        people?: Array<{
          id: string
          name: string
          company?: string
          title?: string
          email?: string
          linkedinUrl?: string
        }>
      }
    }
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
  const parsedSpec = parseDeploySpec(specOverride)
  if (!parsedSpec.ok) {
    return { ok: false, status: 400, body: { error: parsedSpec.error } }
  }
  const inferred = inferDeployParams(prompt, parsedSpec.spec)
  try {
    const projectId = await createProjectRecord(store, config, {
      orgId,
      prompt,
      kind: inferred.kind,
      answers: inferred.answers,
      spec: inferred.spec,
      contacts: resolved
    })
    const project = store.db.projects.find((p) => p.id === projectId)
    if (!project) {
      return { ok: false, status: 502, body: { error: 'Project created but could not be loaded' } }
    }
    const shouldEnroll =
      opts?.enroll !== false &&
      shouldAutoStartSequence({
        prompt,
        primarySurface: project.spec?.primarySurface,
        channels: project.spec?.channels,
        steps: project.spec?.steps
      })
    if (shouldEnroll) {
      await enrollPublicSequence(store, config, orgId, projectId)
    }
    const publicProject = toPublicProject(store.db.contacts, project, config.appUrl)
    const body: {
      projectId: string
      contactCount: number
      dashboardPath: string
      dashboardUrl: string
      project: PublicProject
      researchPending?: boolean
      nextAction?: string
      steps?: Array<{ id: string; day: number; channel: string; label: string }>
      people?: Array<{
        id: string
        name: string
        company?: string
        title?: string
        email?: string
        linkedinUrl?: string
      }>
    } = {
      projectId,
      contactCount: publicProject.contactCount,
      dashboardPath: publicProject.dashboardPath,
      dashboardUrl: publicProject.dashboardUrl,
      project: publicProject
    }
    if (opts?.enroll === false && publicProject.contactCount > 0) {
      const sequence = getPublicSequence(store, orgId, projectId)
      const listed = listPublicContacts(store, projectId, { limit: 50, offset: 0 })
      const willEnrollLater = shouldAutoStartSequence({
        prompt,
        primarySurface: project.spec?.primarySurface,
        channels: project.spec?.channels,
        steps: project.spec?.steps
      })
      body.researchPending = true
      body.steps = (sequence?.steps ?? [])
        .filter((step): step is PublicStep => Boolean(step))
        .map((step) => ({
          id: step.id,
          day: step.day,
          channel: step.channel,
          label: step.label || step.channel
        }))
      body.people = listed.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company || undefined,
        title: c.title || undefined,
        email: c.email || undefined,
        linkedinUrl: c.linkedinUrl || undefined
      }))
      body.nextAction = willEnrollLater
        ? `Research each of the ${listed.total} contacts and their companies now. Then call save_research for project ${projectId} with personalized talk tracks (channel: call), email copy, and LinkedIn notes for every sequence step (pass stepId). Do not paste the JSON into chat — save_research enrolls everyone and opens Tasks. Do not leave {{first_name}} placeholders as the send copy.`
        : `Research each contact and save_research personalized email copy for project ${projectId}. Do not start a sequence.`
    }
    return {
      ok: true,
      status: 201,
      body
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
    setProjectCatalog(db, projectId)
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

export const SEQUENCE_STOP_STATUSES: ContactStatus[] = [
  'replied',
  'not_interested',
  'completed',
  'interested'
]

const DAY_MS = 86_400_000

export function isSequenceStopStatus(status: ContactStatus): boolean {
  return SEQUENCE_STOP_STATUSES.includes(status)
}

function cancelQueuedFollowups(db: Database, contactId: string, now: number, reason: string): number {
  let n = 0
  for (const message of db.messages) {
    if (message.contactId !== contactId) continue
    if (message.status !== 'queued' && message.status !== 'draft') continue
    if (!message.stepId) continue
    message.status = 'cancelled'
    message.error = reason
    message.updatedAt = now
    n += 1
  }
  return n
}

export function unenrollPublicContact(
  store: DataStore,
  orgId: string,
  contactId: string
): { ok: true; contact: PublicContact; cancelled: number } | { ok: false; error: string } {
  const contact = findOrgContact(store, orgId, contactId)
  if (!contact) return { ok: false, error: 'Contact not found' }
  let cancelled = 0
  store.update((db) => {
    const now = Date.now()
    cancelled = cancelQueuedFollowups(db, contactId, now, 'Unenrolled')
    const row = db.contacts.find((c) => c.id === contactId)
    if (!row) return
    const hasSent = db.messages.some((m) => m.contactId === contactId && m.status === 'sent')
    const wasEnrolled = enrolledAtOf(row) != null || row.status === 'active'
    if (row.attrs && ATTR_ENROLLED_AT in row.attrs) {
      const { [ATTR_ENROLLED_AT]: _dropped, ...rest } = row.attrs
      row.attrs = rest
    }
    if (!hasSent && wasEnrolled) {
      row.status = 'queued'
      row.updatedAt = now
    } else {
      row.updatedAt = now
    }
    db.activities.unshift({
      id: uid('act'),
      orgId,
      projectId: row.projectId,
      contactId,
      kind: 'campaign',
      summary: `Unenrolled ${row.name} from the sequence`,
      createdAt: now
    })
  })
  return { ok: true, contact: toPublicContact(store.db.contacts.find((c) => c.id === contactId)!), cancelled }
}

export function skipPublicTask(
  store: DataStore,
  orgId: string,
  contactId: string,
  stepId: string
): { ok: true; contactId: string; stepId: string } | { ok: false; error: string } {
  const contact = findOrgContact(store, orgId, contactId)
  if (!contact) return { ok: false, error: 'Contact not found' }
  store.update((db) => {
    const now = Date.now()
    const message = db.messages.find(
      (m) =>
        m.contactId === contactId &&
        m.stepId === stepId &&
        m.status !== 'sent' &&
        m.status !== 'cancelled'
    )
    if (message) {
      message.status = 'cancelled'
      message.error = 'Skipped'
      message.updatedAt = now
    }
    const row = db.contacts.find((c) => c.id === contactId)
    if (!row) return
    const skipped = Array.isArray(row.attrs?._skippedSteps)
      ? [...(row.attrs._skippedSteps as unknown[])]
      : []
    if (!skipped.includes(stepId)) skipped.push(stepId)
    row.attrs = { ...(row.attrs ?? {}), _skippedSteps: skipped }
    row.updatedAt = now
  })
  return { ok: true, contactId, stepId }
}

export function applyDisposition(
  store: DataStore,
  contactId: string,
  input: { status: ContactStatus; note?: string; advanceStep?: boolean; channel?: Channel }
): { contact: PublicContact; next: QueueNextPublic } {
  const now = Date.now()
  const doAdvance = shouldAdvanceStep(input.status, input.advanceStep)
  store.update((db) => {
    const c = db.contacts.find((x) => x.id === contactId)
    if (!c) return
    c.status = input.status
    c.updatedAt = now
    if (input.channel) {
      const done = new Set(c.channelsDone ?? [])
      done.add(input.channel)
      c.channelsDone = [...done]
    }
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
    if (isSequenceStopStatus(input.status)) {
      cancelQueuedFollowups(db, c.id, now, `Stopped: ${input.status.replace('_', ' ')}`)
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
  const live = inspectLiveVoice(config)
  const mode = sandbox || !live.ok ? 'demo' : live.provider
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

export function reportPublicCallProgress(
  store: DataStore,
  orgId: string,
  callId: string,
  phase: Extract<CallPhase, 'ringing' | 'connected' | 'failed'>
): PublicCall | null {
  const existing = store.db.calls.find((c) => c.id === callId && c.orgId === orgId)
  if (!existing) return null
  const now = Date.now()
  store.update((db) => {
    const call = db.calls.find((c) => c.id === callId)
    if (!call || call.phase === 'completed') return
    call.phase = phase
    if (phase === 'connected') call.connectedAt = call.connectedAt ?? now
  })
  const call = store.db.calls.find((c) => c.id === callId)
  return call ? toPublicCall(call) : null
}

export function completePublicCall(
  store: DataStore,
  callId: string,
  disposition: ContactStatus,
  config?: ServerConfig
): { call: PublicCall; next: QueueNextPublic } {
  const existing = store.db.calls.find((x) => x.id === callId)
  if (config && existing?.providerCallSid) {
    void hangupLiveCall(config, existing).catch(() => undefined)
  }
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
      if (isSequenceStopStatus(disposition)) {
        cancelQueuedFollowups(db, contact.id, now, `Stopped: ${disposition.replace('_', ' ')}`)
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
    sendAt?: number
    stepId?: string
  }
): Promise<
  | { ok: true; status: 201; body: { message: PublicMessage } }
  | { ok: false; status: 502; body: { error: string; message: PublicMessage } }
> {
  const messageChannel = input.channel ?? 'email'
  const now = Date.now()
  const messageId = uid('msg')
  const subject = interpolateTemplate(
    input.subject ?? (messageChannel === 'linkedin' ? 'LinkedIn message' : '(no subject)'),
    contact
  )
  const body = interpolateTemplate(input.body ?? '', contact)
  let finalStatus: MessageStatus = input.status ?? 'sent'
  if (finalStatus === 'queued' && input.sendAt == null) {
    finalStatus = 'queued'
  }
  let mode: Message['mode'] = 'demo'
  let providerMessageId: string | undefined
  let providerThreadId: string | undefined
  let providerAccountId: number | undefined
  let error: string | undefined
  // Drafts keep their send day so the queue can still schedule them by step.
  const sendAt =
    finalStatus === 'queued'
      ? input.sendAt ?? now
      : finalStatus === 'draft'
        ? input.sendAt
        : undefined
  const shouldSendNow = finalStatus === 'sent'

  if (shouldSendNow && messageChannel === 'email') {
    if (!contact.email?.trim()) {
      finalStatus = 'failed'
      error = 'This contact has no email address.'
    } else if (input.sandbox) {
      mode = 'demo'
      providerMessageId = `sandbox_mail_${now}`
      console.log('[jargon] email send skipped (sandbox)')
    } else {
      try {
        const result = await sendPlatformGmail(config, {
          to: contact.email,
          subject,
          body
        })
        mode = result.mode
        providerMessageId = result.id
      } catch (err) {
        finalStatus = 'failed'
        error = err instanceof Error ? err.message : 'Send failed'
      }
    }
  }

  if (shouldSendNow && messageChannel === 'linkedin') {
    try {
      const result = await sendHeyReachLinkedInMessage({
        store,
        config,
        orgId: contact.orgId,
        linkedinUrl: contact.linkedinUrl ?? '',
        message: body,
        subject,
        contact: {
          name: contact.name,
          company: contact.company,
          title: contact.title,
          email: contact.email
        },
        sandbox: input.sandbox
      })
      mode = result.mode
      providerMessageId = result.id
      providerThreadId = result.conversationId
      providerAccountId = result.accountId
    } catch (err) {
      finalStatus = 'failed'
      error = err instanceof Error ? err.message : 'LinkedIn send failed'
    }
  }

  store.update((db) => {
    db.messages.unshift({
      id: messageId,
      orgId: contact.orgId,
      projectId: contact.projectId,
      contactId: contact.id,
      subject,
      body,
      status: finalStatus,
      channel: messageChannel,
      mode,
      providerMessageId,
      providerThreadId,
      providerAccountId,
      error,
      sandbox: input.sandbox,
      createdAt: now,
      updatedAt: now,
      sentAt: finalStatus === 'sent' ? now : undefined,
      sendAt,
      stepId: input.stepId
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

export function findOrgMessage(store: DataStore, orgId: string, messageId: string) {
  return store.db.messages.find((m) => m.id === messageId && m.orgId === orgId) ?? null
}

export function getPublicSequence(store: DataStore, orgId: string, projectId: string) {
  const project = findOrgProject(store, orgId, projectId)
  if (!project) return null
  const steps = store.db.steps
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.order - b.order)
  return {
    projectId,
    goal: project.spec?.goal ?? project.answers.goal,
    spec: project.spec,
    fieldCatalog: project.fieldCatalog?.length
      ? project.fieldCatalog
      : catalogFromContacts(store.db.contacts.filter((c) => c.projectId === projectId)),
    steps: steps.map(toPublicStep)
  }
}

export function updatePublicSequence(
  store: DataStore,
  orgId: string,
  projectId: string,
  input: { goal?: string; steps?: unknown }
): { ok: true; sequence: NonNullable<ReturnType<typeof getPublicSequence>> } | { ok: false; error: string } {
  const project = findOrgProject(store, orgId, projectId)
  if (!project) return { ok: false, error: 'Project not found' }
  const parsed = parseDeploySpec({
    goal: input.goal ?? project.spec?.goal,
    segment: project.spec?.segment,
    primarySurface: project.spec?.primarySurface,
    channels: project.spec?.channels,
    kind: project.spec?.kind,
    steps: input.steps ?? project.spec?.steps
  })
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const steps = parsed.spec?.steps ?? project.spec?.steps
  if (!steps?.length) return { ok: false, error: 'spec.steps is required' }
  const spec = {
    ...(project.spec ?? {
      goal: input.goal ?? 'Book a meeting',
      segment: project.segment,
      primarySurface: 'inbox' as const,
      channels: ['email' as const],
      steps,
      kind: project.kind
    }),
    ...(parsed.spec ?? {}),
    steps
  }
  const now = Date.now()
  store.update((db) => {
    const next = db.projects.find((p) => p.id === projectId)
    if (!next) return
    next.spec = { ...spec, channels: spec.channels.length ? spec.channels : next.spec?.channels ?? ['email'] }
    next.answers = { ...next.answers, goal: next.spec.goal }
    next.updatedAt = now
    const sequence = db.sequences.find((s) => s.projectId === projectId)
    if (sequence) {
      sequence.goal = next.spec.goal
      sequence.name = `${formatChannels(next.spec.channels)} · ${next.spec.goal}`
      sequence.updatedAt = now
    }
    const previous = db.steps.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order)
    const usedIds = new Set<string>()
    db.steps = db.steps.filter((s) => s.projectId !== projectId)
    db.steps.push(
      ...next.spec.steps.map((step, order) => ({
        id: reuseStepId(previous, step, order, usedIds),
        orgId,
        sequenceId: sequence?.id ?? uid('seq'),
        projectId,
        day: step.day,
        channel: step.channel,
        label: step.label,
        subject: step.subject,
        body: step.body,
        order
      }))
    )
  })
  const sequence = getPublicSequence(store, orgId, projectId)
  if (!sequence) return { ok: false, error: 'Sequence update failed' }
  return { ok: true, sequence }
}

export function listPublicMessages(
  store: DataStore,
  opts: {
    orgId: string
    projectId?: string
    contactId?: string
    status?: MessageStatus
    limit?: number
    offset?: number
  }
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const rows = store.db.messages.filter((m) => {
    if (m.orgId !== opts.orgId) return false
    if (opts.projectId && m.projectId !== opts.projectId) return false
    if (opts.contactId && m.contactId !== opts.contactId) return false
    if (opts.status && m.status !== opts.status) return false
    return true
  })
  const sliced = rows.slice(offset, offset + limit)
  return {
    messages: sliced.map(toPublicMessage),
    total: rows.length,
    limit,
    offset
  }
}

export function patchPublicMessage(
  store: DataStore,
  orgId: string,
  messageId: string,
  input: { subject?: string; body?: string; status?: MessageStatus; sendAt?: number; stepId?: string }
): { ok: true; message: PublicMessage } | { ok: false; error: string } {
  const message = findOrgMessage(store, orgId, messageId)
  if (!message) return { ok: false, error: 'Message not found' }
  if (message.status === 'sent') return { ok: false, error: 'Sent messages cannot be edited' }
  if (input.status === 'sent') {
    return { ok: false, error: 'Use send on the draft instead of PATCH status=sent' }
  }
  const contact = findOrgContact(store, orgId, message.contactId)
  store.update((db) => {
    const row = db.messages.find((m) => m.id === messageId)
    if (!row) return
    if (typeof input.subject === 'string') {
      row.subject = contact ? interpolateTemplate(input.subject, contact) : input.subject
    }
    if (typeof input.body === 'string') {
      row.body = contact ? interpolateTemplate(input.body, contact) : input.body
    }
    if (input.status) row.status = input.status
    if (input.sendAt !== undefined) row.sendAt = input.sendAt
    if (typeof input.stepId === 'string' && input.stepId.trim()) row.stepId = input.stepId.trim()
    row.updatedAt = Date.now()
  })
  return { ok: true, message: toPublicMessage(store.db.messages.find((m) => m.id === messageId)!) }
}

export async function deliverPublicMessage(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  messageId: string,
  sandbox?: boolean
): Promise<
  | { ok: true; status: 200; body: { message: PublicMessage } }
  | { ok: false; status: 404 | 409 | 502; body: { error: string; message?: PublicMessage } }
> {
  const message = findOrgMessage(store, orgId, messageId)
  if (!message) return { ok: false, status: 404, body: { error: 'Message not found' } }
  if (message.status === 'sent') {
    return { ok: false, status: 409, body: { error: 'Message already sent', message: toPublicMessage(message) } }
  }
  const contact = findOrgContact(store, orgId, message.contactId)
  if (!contact) return { ok: false, status: 404, body: { error: 'Contact not found' } }
  const now = Date.now()
  let mode: Message['mode'] = message.mode
  let providerMessageId = message.providerMessageId
  let providerThreadId = message.providerThreadId
  let providerAccountId = message.providerAccountId
  let error: string | undefined
  let finalStatus: MessageStatus = 'sent'
  const demo = sandbox || message.sandbox

  if (message.channel === 'email') {
    if (!contact.email?.trim()) {
      finalStatus = 'failed'
      error = 'This contact has no email address.'
    } else if (demo) {
      mode = 'demo'
      providerMessageId = `sandbox_mail_${now}`
      console.log('[jargon] email send skipped (sandbox)')
    } else {
      try {
        const result = await sendPlatformGmail(config, {
          to: contact.email,
          subject: message.subject,
          body: message.body
        })
        mode = result.mode
        providerMessageId = result.id
      } catch (err) {
        finalStatus = 'failed'
        error = err instanceof Error ? err.message : 'Send failed'
      }
    }
  } else {
    try {
      const result = await sendHeyReachLinkedInMessage({
        store,
        config,
        orgId,
        linkedinUrl: contact.linkedinUrl ?? '',
        message: message.body,
        subject: message.subject,
        contact: {
          name: contact.name,
          company: contact.company,
          title: contact.title,
          email: contact.email
        },
        sandbox: demo
      })
      mode = result.mode
      providerMessageId = result.id
      providerThreadId = result.conversationId
      providerAccountId = result.accountId
    } catch (err) {
      finalStatus = 'failed'
      error = err instanceof Error ? err.message : 'LinkedIn send failed'
    }
  }

  store.update((db) => {
    const row = db.messages.find((m) => m.id === messageId)
    if (!row) return
    row.status = finalStatus
    row.mode = mode
    row.providerMessageId = providerMessageId
    row.providerThreadId = providerThreadId
    row.providerAccountId = providerAccountId
    row.error = error
    row.updatedAt = now
    row.sentAt = finalStatus === 'sent' ? now : undefined
    if (finalStatus === 'sent') {
      const c = db.contacts.find((x) => x.id === contact.id)
      if (c) {
        c.status = c.status === 'queued' ? 'active' : c.status
        c.stepIndex = c.stepIndex + 1
        c.updatedAt = now
        const done = new Set(c.channelsDone ?? [])
        done.add(message.channel === 'linkedin' ? 'linkedin' : 'email')
        c.channelsDone = [...done]
      }
    }
  })
  const updated = toPublicMessage(store.db.messages.find((m) => m.id === messageId)!)
  if (finalStatus === 'failed') {
    return { ok: false, status: 502, body: { error: error ?? 'Send failed', message: updated } }
  }
  return { ok: true, status: 200, body: { message: updated } }
}

export type EnrollSkip = { contactId: string; stepId?: string; reason: string }

function isOpenCadenceMessage(message: Message): boolean {
  return message.status !== 'cancelled' && message.status !== 'failed'
}

function reuseStepId(
  previous: SequenceStep[],
  step: { channel: SequenceStep['channel']; day: number },
  order: number,
  usedIds: Set<string>
): string {
  const sameIndex = previous[order]
  if (sameIndex && sameIndex.channel === step.channel && !usedIds.has(sameIndex.id)) {
    usedIds.add(sameIndex.id)
    return sameIndex.id
  }
  const sameDay = previous.find(
    (row) => row.channel === step.channel && row.day === step.day && !usedIds.has(row.id)
  )
  if (sameDay) {
    usedIds.add(sameDay.id)
    return sameDay.id
  }
  return uid('step')
}

function openCadenceDrafts(store: DataStore, contactId: string, channel: 'email' | 'linkedin'): Message[] {
  return store.db.messages
    .filter(
      (m) => m.contactId === contactId && m.channel === channel && isOpenCadenceMessage(m)
    )
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
}

function takeDraftForStep(drafts: Message[], stepId: string, claimed: Set<string>): Message | undefined {
  const bound = drafts.find((m) => m.stepId === stepId && !claimed.has(m.id))
  if (bound) return bound
  return drafts.find((m) => !m.stepId && !claimed.has(m.id))
}

function resolveDraftStep(
  steps: Array<PublicStep & { channel: 'email' | 'linkedin' }>,
  input?: { stepId?: string; day?: number }
): (PublicStep & { channel: 'email' | 'linkedin' }) | undefined {
  if (input?.stepId) return steps.find((step) => step.id === input.stepId)
  if (input?.day != null && Number.isFinite(input.day)) {
    return steps.find((step) => step.day === input.day) ?? steps[0]
  }
  return steps[0]
}

/** Save researched copy onto the matching cadence step. Never creates a second draft that hides the first. */
export async function upsertPublicDraft(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  contactId: string,
  input: {
    subject?: string
    body: string
    channel?: 'email' | 'linkedin'
    sandbox?: boolean
    stepId?: string
    day?: number
  }
): Promise<
  | { ok: true; status: 200 | 201; body: { message: PublicMessage } }
  | { ok: false; status: 404 | 502; body: { error: string; message?: PublicMessage } }
> {
  const contact = findOrgContact(store, orgId, contactId)
  if (!contact) return { ok: false, status: 404, body: { error: 'Contact not found' } }
  const channel = input.channel ?? 'email'
  const sequence = getPublicSequence(store, orgId, contact.projectId)
  const steps = (sequence?.steps ?? []).filter(
    (step): step is PublicStep & { channel: 'email' | 'linkedin' } =>
      step != null && step.channel === channel
  )
  const step = resolveDraftStep(steps, input)
  const claimed = new Set<string>()
  const existing = step
    ? takeDraftForStep(openCadenceDrafts(store, contactId, channel), step.id, claimed)
    : openCadenceDrafts(store, contactId, channel).find((m) => !m.stepId)
  if (existing && existing.status !== 'sent') {
    const patched = patchPublicMessage(store, orgId, existing.id, {
      subject: input.subject,
      body: input.body,
      stepId: step?.id ?? existing.stepId
    })
    if (!patched.ok) return { ok: false, status: 404, body: { error: patched.error } }
    markContactEnriched(store, contactId)
    return { ok: true, status: 200, body: { message: patched.message } }
  }
  const created = await sendPublicMessage(store, config, contact, {
    subject: input.subject,
    body: input.body,
    channel,
    status: 'draft',
    sandbox: input.sandbox,
    stepId: step?.id
  })
  if (!created.ok) return created
  markContactEnriched(store, contactId)
  return { ok: true, status: 201, body: created.body }
}

export function projectIsSequenced(store: DataStore, projectId: string): boolean {
  if (store.db.contacts.some((c) => c.projectId === projectId && enrolledAtOf(c) != null)) return true
  return store.db.messages.some((m) => m.projectId === projectId && Boolean(m.stepId))
}

function markContactEnriched(store: DataStore, contactId: string): void {
  store.update((db) => {
    const row = db.contacts.find((c) => c.id === contactId)
    if (!row) return
    const now = Date.now()
    row.enrichedAt = now
    row.updatedAt = now
  })
}

function mergeContactContext(store: DataStore, contactId: string, context: string[]): void {
  store.update((db) => {
    const row = db.contacts.find((c) => c.id === contactId)
    if (!row) return
    const merged = [...(row.context ?? [])]
    for (const line of context) {
      const text = line.trim()
      if (text && !merged.includes(text)) merged.push(text)
    }
    row.context = merged.slice(0, 8)
    row.updatedAt = Date.now()
  })
}

export function savePublicTalkTrack(
  store: DataStore,
  orgId: string,
  contactId: string,
  input: { body: string; context?: string[]; stepId?: string }
): { ok: true; contact: PublicContact } | { ok: false; error: string } {
  const contact = findOrgContact(store, orgId, contactId)
  if (!contact) return { ok: false, error: 'Contact not found' }
  const body = input.body.trim()
  if (!body) return { ok: false, error: 'Talk track is empty' }
  store.update((db) => {
    const row = db.contacts.find((c) => c.id === contactId)
    if (!row) return
    const now = Date.now()
    const prev =
      row.attrs?.[ATTR_TALK_TRACKS] &&
      typeof row.attrs[ATTR_TALK_TRACKS] === 'object' &&
      !Array.isArray(row.attrs[ATTR_TALK_TRACKS])
        ? { ...(row.attrs[ATTR_TALK_TRACKS] as Record<string, string>) }
        : {}
    if (input.stepId) prev[input.stepId] = body
    row.attrs = {
      ...(row.attrs ?? {}),
      [ATTR_TALK_TRACK]: body,
      ...(Object.keys(prev).length ? { [ATTR_TALK_TRACKS]: prev } : {})
    }
    if (input.context?.length) {
      const merged = [...(row.context ?? [])]
      for (const line of input.context) {
        const text = line.trim()
        if (text && !merged.includes(text)) merged.push(text)
      }
      row.context = merged.slice(0, 8)
    }
    row.enrichedAt = now
    row.updatedAt = now
    db.activities.unshift({
      id: uid('act'),
      orgId: row.orgId,
      projectId: row.projectId,
      contactId: row.id,
      kind: 'note',
      summary: `Saved talk track for ${row.name}`,
      createdAt: now
    })
  })
  return { ok: true, contact: toPublicContact(store.db.contacts.find((c) => c.id === contactId)!) }
}

export type ResearchCopyInput = {
  contactId: string
  body: string
  subject?: string
  channel?: Channel
  stepId?: string
  day?: number
  context?: string[]
}

export async function savePublicResearch(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  drafts: ResearchCopyInput[],
  opts?: { sandbox?: boolean; enroll?: boolean }
): Promise<
  | { ok: true; saved: number; failed: number; enrolled?: number }
  | { ok: false; error: string }
> {
  if (!findOrgProject(store, orgId, projectId)) return { ok: false, error: 'Project not found' }
  if (!drafts.length) return { ok: false, error: 'research is empty' }
  let saved = 0
  let failed = 0
  for (const draft of drafts) {
    const contact = findOrgContact(store, orgId, draft.contactId)
    if (!contact || contact.projectId !== projectId) {
      failed += 1
      continue
    }
    const channel = draft.channel ?? 'email'
    if (channel === 'call') {
      const result = savePublicTalkTrack(store, orgId, draft.contactId, {
        body: draft.body,
        context: draft.context,
        stepId: draft.stepId
      })
      if (result.ok) saved += 1
      else failed += 1
      continue
    }
    const result = await upsertPublicDraft(store, config, orgId, draft.contactId, {
      subject: draft.subject,
      body: draft.body,
      channel,
      sandbox: opts?.sandbox,
      stepId: draft.stepId,
      day: draft.day
    })
    if (result.ok) {
      if (draft.context?.length) mergeContactContext(store, draft.contactId, draft.context)
      saved += 1
    } else failed += 1
  }
  let enrolled: number | undefined
  if (opts?.enroll !== false) {
    const started = await enrollPublicSequence(store, config, orgId, projectId, {
      sandbox: opts?.sandbox
    })
    if (started.ok) enrolled = started.contacts
  }
  return { ok: true, saved, failed, enrolled }
}

export async function addPublicContactsAndEnroll(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  inputs: DeployContactInput[]
): Promise<
  | { ok: true; added: number; contactCount: number; contacts: PublicContact[] }
  | { ok: false; error: string }
> {
  const result = addPublicContacts(store, orgId, projectId, inputs)
  if (!result.ok) return result
  if (projectIsSequenced(store, projectId)) {
    await enrollPublicSequence(store, config, orgId, projectId, {
      contactIds: result.contacts.map((c) => c.id)
    })
  }
  return result
}

export async function enrollPublicSequence(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  input?: {
    startAt?: number
    contactIds?: string[]
    sandbox?: boolean
  }
): Promise<
  | {
      ok: true
      projectId: string
      startAt: number
      contacts: number
      steps: number
      queued: number
      skipped: EnrollSkip[]
      messages: PublicMessage[]
    }
  | { ok: false; error: string }
> {
  const sequence = getPublicSequence(store, orgId, projectId)
  if (!sequence) return { ok: false, error: 'Project not found' }
  const steps = sequence.steps.filter((step): step is PublicStep => Boolean(step))
  if (!steps.length) return { ok: false, error: 'Sequence has no steps' }
  const all = store.db.contacts.filter((c) => c.projectId === projectId && c.orgId === orgId)
  const wanted = input?.contactIds?.length
    ? all.filter((c) => input.contactIds!.includes(c.id))
    : all
  if (!wanted.length) return { ok: false, error: 'No contacts to enroll' }
  const startAt = Number.isFinite(input?.startAt) ? Number(input!.startAt) : Date.now()
  const skipped: EnrollSkip[] = []
  const created: PublicMessage[] = []

  for (const contact of wanted) {
    if (isSequenceStopStatus(contact.status)) {
      skipped.push({ contactId: contact.id, reason: `Contact is ${contact.status.replace('_', ' ')}` })
      continue
    }
    const claimed = new Set<string>()
    for (const step of steps) {
      if (step.channel === 'call') {
        if (!contact.phone?.trim()) {
          skipped.push({ contactId: contact.id, stepId: step.id, reason: 'Missing phone' })
        }
        continue
      }
      if (step.channel === 'email' && !contact.email?.trim()) {
        skipped.push({ contactId: contact.id, stepId: step.id, reason: 'Missing email' })
        continue
      }
      if (step.channel === 'linkedin' && !contact.linkedinUrl?.trim()) {
        skipped.push({ contactId: contact.id, stepId: step.id, reason: 'Missing LinkedIn URL' })
        continue
      }
      const sendAt = startAt + Number(step.day || 0) * DAY_MS
      const existing = takeDraftForStep(
        openCadenceDrafts(store, contact.id, step.channel),
        step.id,
        claimed
      )
      if (existing) {
        claimed.add(existing.id)
        if (existing.stepId === step.id && existing.sendAt != null) {
          skipped.push({ contactId: contact.id, stepId: step.id, reason: 'Already enrolled' })
          continue
        }
        // Keep Claude's researched copy. Only attach the step and send day.
        const patched = patchPublicMessage(store, orgId, existing.id, {
          stepId: step.id,
          sendAt: existing.sendAt ?? sendAt
        })
        if (patched.ok) created.push(patched.message)
        continue
      }
      const result = await sendPublicMessage(store, config, contact, {
        subject: step.subject,
        body: step.body ?? '',
        channel: step.channel,
        // Enrollment drafts the cadence; nothing leaves until a human sends it.
        status: 'draft',
        sendAt,
        stepId: step.id,
        sandbox: input?.sandbox
      })
      if (!result.ok) {
        skipped.push({
          contactId: contact.id,
          stepId: step.id,
          reason: result.body.error
        })
        continue
      }
      created.push(result.body.message)
    }
  }

  store.update((db) => {
    const now = Date.now()
    for (const contact of wanted) {
      if (isSequenceStopStatus(contact.status)) continue
      const row = db.contacts.find((c) => c.id === contact.id)
      if (!row) continue
      if (row.status === 'queued') {
        row.status = 'active'
      }
      if (enrolledAtOf(row) == null) {
        row.attrs = { ...(row.attrs ?? {}), [ATTR_ENROLLED_AT]: startAt }
      }
      row.updatedAt = now
    }
    const project = db.projects.find((p) => p.id === projectId)
    if (project) project.updatedAt = now
    db.activities.unshift({
      id: uid('act'),
      orgId,
      projectId,
      kind: 'campaign',
      summary: `Started sequence · ${wanted.length} contacts · ${steps.length} steps`,
      createdAt: now
    })
  })

  return {
    ok: true,
    projectId,
    startAt,
    contacts: wanted.length,
    steps: steps.length,
    queued: created.length,
    skipped,
    messages: created
  }
}

export async function dispatchDueMessages(
  store: DataStore,
  config: ServerConfig
): Promise<number> {
  const now = Date.now()
  const due = store.db.messages.filter(
    (m) => m.status === 'queued' && (m.sendAt ?? 0) <= now
  )
  let sent = 0
  for (const message of due) {
    const result = await deliverPublicMessage(store, config, message.orgId, message.id, message.sandbox)
    if (result.ok) sent += 1
  }
  return sent
}

export { isContactStatus, nextQueueContact }
