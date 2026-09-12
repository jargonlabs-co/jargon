import type { DataStore } from './store'
import type {
  CallSession,
  Contact,
  ContactStatus,
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
import { inspectTwilioVoice } from './providers/twilio'
import { inferDeployParams } from './deploy'
import { createProjectRecord } from './projectCreate'
import { formatChannels, parseDeploySpec } from '../shared/workspaceSpec'
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
    sendAt: message.sendAt
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
  specOverride?: unknown
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
    const publicProject = toPublicProject(store.db.contacts, project, config.appUrl)
    return {
      ok: true,
      status: 201,
      body: {
        projectId,
        contactCount: publicProject.contactCount,
        dashboardPath: publicProject.dashboardPath,
        dashboardUrl: publicProject.dashboardUrl,
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
  const twilioReady = inspectTwilioVoice(config).ok
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
    sendAt?: number
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
  let error: string | undefined
  const sendAt = finalStatus === 'queued' ? input.sendAt ?? now : undefined
  const shouldSendNow = finalStatus === 'sent'

  if (shouldSendNow && messageChannel === 'email') {
    if (input.sandbox) {
      mode = 'demo'
      providerMessageId = `sandbox_mail_${now}`
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
          message: body,
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
      subject,
      body,
      status: finalStatus,
      channel: messageChannel,
      mode,
      providerMessageId,
      error,
      sandbox: input.sandbox,
      createdAt: now,
      updatedAt: now,
      sentAt: finalStatus === 'sent' ? now : undefined,
      sendAt
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
    db.steps = db.steps.filter((s) => s.projectId !== projectId)
    db.steps.push(
      ...next.spec.steps.map((step, order) => ({
        id: uid('step'),
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
  input: { subject?: string; body?: string; status?: MessageStatus; sendAt?: number }
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
  let error: string | undefined
  let finalStatus: MessageStatus = 'sent'
  const demo = sandbox || message.sandbox

  if (message.channel === 'email') {
    if (demo) {
      mode = 'demo'
      providerMessageId = `sandbox_mail_${now}`
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
    if (demo) {
      mode = 'demo'
      providerMessageId = `sandbox_li_${now}`
    } else {
      const apiKey = config.heyreach.apiKey.trim() || 'demo'
      const heyreachDemo = !config.heyreach.apiKey.trim() || apiKey === 'demo'
      try {
        const result = await sendHeyReachLinkedInMessage({
          apiKey,
          linkedinUrl: contact.linkedinUrl ?? '',
          message: message.body,
          demo: heyreachDemo
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
    const row = db.messages.find((m) => m.id === messageId)
    if (!row) return
    row.status = finalStatus
    row.mode = mode
    row.providerMessageId = providerMessageId
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
