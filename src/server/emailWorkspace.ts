import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { Channel, FieldDef, Project } from './types'
import { toPublicConnection } from './connections'
import { doNotCallNote } from './compliance'
import { orgAllowsDncCalls } from './planLimits'
import { interpolateTemplate } from '../shared/fieldCatalog'
import { voiceIsLive } from './providers/voice'
import { platformGmailReady } from './providers/gmail'
import {
  dashboardFor,
  findOrgProject,
  getPublicSequence,
  listPublicMessages,
  toPublicCall,
  toPublicContact,
  type PublicCall,
  type PublicContact,
  type PublicMessage,
  type PublicStep
} from './publicApi'
import {
  isPriorityContact,
  isPriorityPipelinePrompt,
  leadIdentity,
  rankLeads,
  type LeadPriority
} from '../shared/priorityOverlay'
import { inferMcpDefaultTab, inferMcpSurface, motionComplete, nextChannel, type McpSurface, type McpTab } from '../shared/workspaceSpec'
import {
  annotateOpenCallNotes,
  buildWorkspaceTasks,
  summarizeTasks,
  type TaskStats,
  type WorkspaceTask
} from './workspaceTasks'

/** Current widget URI. Claude caches HTML by this string — bump when the bundle changes. */
export const EMAIL_WORKSPACE_URI = 'ui://jargon/email-workspace.html?v=sched2'

/** Serve the current HTML under every URI Claude may still have cached from tools/list. */
export const EMAIL_WORKSPACE_URIS = [
  'ui://jargon/email-workspace.html',
  'ui://jargon/email-workspace-v2.html',
  'ui://jargon/email-workspace.html?v=enroll1',
  'ui://jargon/email-workspace.html?v=surfaces1',
  'ui://jargon/email-workspace.html?v=queue1',
  'ui://jargon/email-workspace.html?v=tasks1',
  'ui://jargon/email-workspace.html?v=dialer1',
  'ui://jargon/email-workspace.html?v=confirm1',
  'ui://jargon/email-workspace.html?v=nl1',
  'ui://jargon/email-workspace.html?v=liopen1',
  'ui://jargon/email-workspace.html?v=copy1',
  'ui://jargon/email-workspace.html?v=flow1',
  'ui://jargon/email-workspace.html?v=send1',
  'ui://jargon/email-workspace.html?v=plivo1',
  'ui://jargon/email-workspace.html?v=call2',
  'ui://jargon/email-workspace.html?v=call3',
  'ui://jargon/email-workspace.html?v=call4',
  'ui://jargon/email-workspace.html?v=engage1',
  'ui://jargon/email-workspace.html?v=engage2',
  'ui://jargon/email-workspace.html?v=engage3',
  'ui://jargon/email-workspace.html?v=engage4',
  'ui://jargon/email-workspace.html?v=engage5',
  'ui://jargon/email-workspace.html?v=engage6',
  'ui://jargon/email-workspace.html?v=warmth1',
  'ui://jargon/email-workspace.html?v=priority1',
  'ui://jargon/email-workspace.html?v=priority2',
  'ui://jargon/email-workspace.html?v=flowfirst1',
  'ui://jargon/email-workspace.html?v=todobands1',
  'ui://jargon/email-workspace.html?v=prioritylmh1',
  'ui://jargon/email-workspace.html?v=loadfix1',
  'ui://jargon/email-workspace.html?v=slimws1',
  'ui://jargon/email-workspace.html?v=onect1',
  'ui://jargon/email-workspace.html?v=priorityhml1',
  'ui://jargon/email-workspace.html?v=mailfmt1',
  'ui://jargon/email-workspace.html?v=personcopy1',
  'ui://jargon/email-workspace.html?v=dnc1',
  'ui://jargon/email-workspace.html?v=admin1',
  'ui://jargon/email-workspace.html?v=sched1',
  'ui://jargon/email-workspace.html?v=territory1',
  EMAIL_WORKSPACE_URI
] as const

export type EmailWorkspaceSource = {
  provider: string
  status: string
  accountLabel?: string
}

export type WorkspaceContact = PublicContact & {
  nextChannel?: Channel | null
  preview?: { subject: string; body: string }
  linkedinPreview?: { body: string }
  /** Present when the contact can be scored. Computed for the app; not a CRM field. */
  priority?: LeadPriority
}

export type StepStat = {
  stepId: string
  drafted: number
  queued: number
  sent: number
  skipped: number
  due: number
}

export type EmailWorkspace = {
  view: 'email_workspace' | 'queue' | 'overflow'
  surface: McpSurface
  /** Tab the app should land on. Lifecycle default unless a tool set focus. */
  focus?: McpTab
  defaultTab: McpTab
  /** The signed-in rep. Manual tasks are theirs. */
  assignee?: { id: string; name: string }
  projectId: string
  name: string
  goal: string
  dashboardUrl: string
  dashboardPath: string
  contactCount: number
  channels: Channel[]
  emailLive: boolean
  voiceLive: boolean
  linkedinLive: boolean
  sandbox: boolean
  catalog: FieldDef[]
  steps: PublicStep[]
  contacts: WorkspaceContact[]
  contactsTotal: number
  messages: PublicMessage[]
  openCall: PublicCall | null
  sources: EmailWorkspaceSource[]
  /** Every sequence step for every enrolled contact, oldest due date first. */
  tasks: WorkspaceTask[]
  taskStats: TaskStats
  stepStats: StepStat[]
  /** True until Claude has saved researched copy / talk tracks for everyone. */
  researchPending: boolean
  /** Instruction the model should follow immediately. */
  nextAction?: string
  stats: {
    drafts: number
    queued: number
    sent: number
    missingEmail: number
    remaining: number
    emailed: number
    called: number
    linkedin: number
  }
}

function projectChannels(project: Project): Channel[] {
  if (project.spec?.channels?.length) return project.spec.channels
  return []
}

function stepStatsFor(
  steps: PublicStep[],
  tasks: WorkspaceTask[],
  messages: PublicMessage[]
): StepStat[] {
  return steps.map((step) => {
    const forStep = tasks.filter((t) => t.stepId === step.id)
    const msgs = messages.filter((m) => m.stepId === step.id)
    return {
      stepId: step.id,
      drafted: msgs.filter((m) => m.status === 'draft').length,
      queued: msgs.filter((m) => m.status === 'queued').length,
      sent: msgs.filter((m) => m.status === 'sent').length,
      skipped: forStep.filter((t) => t.state === 'skipped').length,
      due: forStep.filter((t) => t.bucket === 'overdue' || t.bucket === 'today').length
    }
  })
}

export function isEmailMotion(project: Project, steps: Array<{ channel: string }>): boolean {
  if (projectChannels(project).includes('email')) return true
  return steps.some((step) => step.channel === 'email')
}

/** What a Claude scheduled task must do. The task runs with no one in the chat. */
export const SCHEDULED_BUILD =
  'A Claude scheduled task builds the sequence with the Jargon connector the same way a person asking in chat does. Do not ask questions and do not wait for the user. Call resume_workspace first. If there is no workspace yet, or copy is still the template, call deploy_tool or import_list for whoever is connected — HubSpot, Railway, Postgres, or the people named in the task. Do not open the template sequence. Then write personalized copy from each contact\'s fields and call save_research once. save_research enrolls everyone and opens the sequence in that chat. If copy is already saved, call enroll_hubspot for new people — that opens the sequence — and save_research only for people still on the template. Do not create a second workspace when one already has copy. Do not finish on a text summary alone. Do not outline the day ladder. If the sequence is not in the chat, call show_tasks once. Do not say a scheduled run cannot build or display the workspace.'

export function scheduleAsk(projectId: string): string {
  return `Ask the user once whether Jargon may run project ${projectId} on its own. Default: every Sunday at 6pm in their timezone. If they name another cadence, or a CRM segment such as disqualified leads, use that. If they say yes, this is the one Allow: call note_schedule_choice with accepted, and pass leadStatus, lifecycleStage, or listId when they named a segment. That grant lets Jargon pull the segment, enroll it on the agent lane, and queue ready people for reps with no further prompt. Also propose a Claude scheduled task and wait for them to confirm with Schedule. The task instructions must be: ${SCHEDULED_BUILD} Use project ${projectId}. After they answer, call note_schedule_choice. If they say no, call note_schedule_choice with declined and do not create a task.`
}

export function getEmailWorkspace(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  opts?: { sandbox?: boolean; focus?: McpTab; userId?: string }
): EmailWorkspace | null {
  const project = findOrgProject(store, orgId, projectId)
  if (!project) return null
  const sequence = getPublicSequence(store, orgId, projectId)
  if (!sequence) return null
  const steps = sequence.steps.filter((step): step is PublicStep => Boolean(step))
  const dashboard = dashboardFor(project.id, config.appUrl)
  const projectRows = store.db.contacts.filter(
    (c) => c.projectId === projectId && isPriorityContact(c) && c.lane !== 'agent'
  )
  const rankedRows = rankLeads(projectRows, leadIdentity).slice(0, 50)
  const listed = { contacts: rankedRows.map(toPublicContact), total: projectRows.length }
  const priorityById = new Map(
    rankedRows.flatMap((contact) => (contact.priority ? [[contact.id, contact.priority] as const] : []))
  )
  const messages = listPublicMessages(store, {
    orgId,
    projectId,
    limit: 200,
    offset: 0
  }).messages
  const channels = projectChannels(project).length
    ? projectChannels(project)
    : (steps.map((s) => s.channel).filter((ch, i, all) => all.indexOf(ch) === i) as Channel[])
  const spec = project.spec ?? {
    goal: sequence.goal || '',
    segment: project.segment || '',
    primarySurface: 'queue' as const,
    channels,
    steps: steps.map((s) => ({
      day: s.day,
      channel: s.channel,
      label: s.label,
      subject: s.subject,
      body: s.body
    })),
    kind: project.kind
  }
  const emailStep = steps.find((step) => step.channel === 'email')
  const linkedinStep = steps.find((step) => step.channel === 'linkedin')
  const contacts: WorkspaceContact[] = listed.contacts.map((contact) => {
    const preview = emailStep
      ? {
          subject: interpolateTemplate(emailStep.subject ?? '', contact),
          body: interpolateTemplate(emailStep.body ?? '', contact)
        }
      : undefined
    const linkedinPreview = linkedinStep
      ? { body: interpolateTemplate(linkedinStep.body ?? '', contact) }
      : undefined
    return {
      ...contact,
      preview,
      linkedinPreview,
      nextChannel: nextChannel(contact, spec),
      priority: priorityById.get(contact.id)
    }
  })
  const sources = store.db.connections
    .filter(
      (c) =>
        c.orgId === orgId &&
        (c.provider === 'hubspot' || c.provider === 'railway' || c.provider === 'postgres')
    )
    .map((c) => {
      const pub = toPublicConnection(c)
      return {
        provider: pub.provider,
        status: pub.status,
        accountLabel: pub.accountLabel
      }
    })
  const surface = inferMcpSurface({
    prompt: project.prompt || '',
    primarySurface: project.spec?.primarySurface,
    channels,
    steps
  })
  const projectCalls = store.db.calls.filter((c) => c.projectId === projectId).map(toPublicCall)
  const openCallRow = store.db.calls.find(
    (c) => c.projectId === projectId && c.phase !== 'completed' && c.phase !== 'failed'
  )
  const tasks = annotateOpenCallNotes(
    buildWorkspaceTasks({ contacts, steps, messages, calls: projectCalls }),
    dncNotesFor(store, orgId, contacts)
  )
  if (priorityById.size) {
    tasks.sort(
      (a, b) =>
        (priorityById.get(a.contactId)?.rank ?? 9999) - (priorityById.get(b.contactId)?.rank ?? 9999) ||
        a.dueAt - b.dueAt ||
        a.contactName.localeCompare(b.contactName)
    )
  }
  const taskStats = summarizeTasks(tasks)
  const defaultTab = inferMcpDefaultTab({
    surface,
    focus: opts?.focus,
    enrolled: taskStats.enrolled > 0
  })
  const remaining = contacts.filter((c) => !motionComplete(c, spec)).length
  const priorityPipeline = isPriorityPipelinePrompt(project.prompt || '')
  const researchPending = !priorityPipeline && contacts.length > 0 && contacts.some((c) => !c.enrichedAt)
  const schedulePending =
    !priorityPipeline && !researchPending && taskStats.enrolled > 0 && !project.brief?.scheduleChoice
  const nextAction = researchPending
    ? surface === 'one_off'
      ? `Write personalized email copy from each contact's fields (context and attrs) for project ${project.id}. Do not invent company facts. Do not start a sequence. Pass research only as the save_research argument — do not paste JSON into chat.`
      : `Write personalized talk tracks (channel: call), email copy, and LinkedIn notes for every sequence step from each contact's fields (context and attrs from their source). Then call save_research for project ${project.id}. Do not invent funding, hiring, or tenure. That enrolls everyone and opens the one workspace. Do not call show_email_workspace, show_tasks, or get_sequence. Do not wait to be asked. Do not paste the research JSON into chat. Do not leave {{first_name}} placeholders as the send copy.`
    : schedulePending
      ? scheduleAsk(project.id)
      : undefined
  const view =
    surface === 'overflow' ? 'overflow' : surface === 'queue' || surface === 'tasks' ? 'queue' : 'email_workspace'
  return {
    view,
    surface,
    focus: opts?.focus ?? defaultTab,
    defaultTab,
    assignee: opts?.userId
      ? {
          id: opts.userId,
          name: store.db.users.find((u) => u.id === opts.userId)?.name || 'You'
        }
      : undefined,
    projectId: project.id,
    name: project.name,
    goal: sequence.goal || project.spec?.goal || project.answers.goal || '',
    dashboardUrl: dashboard.dashboardUrl,
    dashboardPath: dashboard.dashboardPath,
    contactCount: listed.total,
    channels,
    emailLive: !opts?.sandbox && platformGmailReady(config),
    voiceLive: !opts?.sandbox && voiceIsLive(config),
    linkedinLive: !opts?.sandbox && Boolean(config.heyreach.apiKey.trim()),
    sandbox: Boolean(opts?.sandbox),
    catalog: sequence.fieldCatalog ?? [],
    steps,
    contacts,
    contactsTotal: listed.total,
    messages,
    openCall: openCallRow ? toPublicCall(openCallRow) : null,
    sources,
    tasks,
    taskStats,
    stepStats: stepStatsFor(steps, tasks, messages),
    researchPending,
    nextAction,
    stats: {
      drafts: messages.filter((m) => m.status === 'draft' && m.channel === 'email').length,
      queued: messages.filter((m) => m.status === 'queued' && m.channel === 'email').length,
      sent: messages.filter((m) => m.status === 'sent' && m.channel === 'email').length,
      missingEmail: listed.contacts.filter((c) => !c.email?.trim()).length,
      remaining,
      emailed: listed.contacts.filter((c) => (c.channelsDone ?? []).includes('email')).length,
      called: listed.contacts.filter((c) => (c.channelsDone ?? []).includes('call')).length,
      linkedin: listed.contacts.filter((c) => (c.channelsDone ?? []).includes('linkedin')).length
    }
  }
}

/** Short payload for Claude chat. The in-chat app loads the full workspace separately. */
export function workspaceBrief(ws: EmailWorkspace) {
  return {
    projectId: ws.projectId,
    name: ws.name,
    contactCount: ws.contactCount,
    focus: ws.focus,
    defaultTab: ws.defaultTab,
    researchPending: ws.researchPending,
    nextAction:
      ws.nextAction ??
      'The sequence is open in this chat. Say what is due in one sentence. Do not outline the day ladder. Do not call show_email_workspace or show_tasks again.',
    taskStats: ws.taskStats,
    stats: ws.stats
  }
}

/** Claude drops tool results around 150k characters and the app then cannot paint a scheduled run. */
export const WORKSPACE_VIEW_CAP = 100_000

function clipText(value: unknown, max: number): unknown {
  return typeof value === 'string' && value.length > max ? value.slice(0, max) : value
}

function clipPreview(value: unknown, max: number): unknown {
  if (!value || typeof value !== 'object') return value
  const row = { ...(value as Record<string, unknown>) }
  row.body = clipText(row.body, max)
  if ('subject' in row) row.subject = clipText(row.subject, 80)
  return row
}

function viewRow(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function slimContact(contact: unknown, dropHeavy: boolean): unknown {
  const row = viewRow(contact)
  if (!row) return contact
  const next = { ...row }
  next.preview = clipPreview(next.preview, 180)
  next.linkedinPreview = clipPreview(next.linkedinPreview, 180)
  if (dropHeavy) {
    delete next.attrs
    delete next.context
    delete next.preview
    delete next.linkedinPreview
    delete next.notes
  }
  return next
}

function slimTask(task: unknown, bodyMax: number): unknown {
  const row = viewRow(task)
  if (!row) return task
  const next = { ...row }
  next.body = clipText(next.body, bodyMax)
  if ('subject' in next) next.subject = clipText(next.subject, 140)
  return next
}

/** The to-do the rep would open for each person: soonest open step, not a later one. */
function nextOpenTaskIds(tasks: unknown[]): Set<string> {
  const best = new Map<string, Record<string, unknown>>()
  for (const task of tasks) {
    const row = viewRow(task)
    if (!row || typeof row.contactId !== 'string' || typeof row.id !== 'string') continue
    if (row.owner === 'auto' || row.state === 'done' || row.state === 'skipped') continue
    const prev = best.get(row.contactId)
    const due = Number(row.dueAt || 0)
    const order = Number(row.stepOrder || 0)
    const prevDue = Number(prev?.dueAt || 0)
    const prevOrder = Number(prev?.stepOrder || 0)
    if (!prev || due < prevDue || (due === prevDue && order < prevOrder)) best.set(row.contactId, row)
  }
  return new Set([...best.values()].map((row) => String(row.id)))
}

function dropOneTask(tasks: unknown[], protect: Set<string>): unknown[] {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const id = viewRow(tasks[i])?.id
    if (typeof id === 'string' && protect.has(id)) continue
    return tasks.slice(0, i).concat(tasks.slice(i + 1))
  }
  return tasks.slice(0, -1)
}

/** Keep the people the remaining to-dos point at. Dropping contacts on their own orphans every row after the first. */
function contactsForTasks(contacts: unknown[], tasks: unknown[]): unknown[] | null {
  const needed = new Set<string>()
  for (const task of tasks) {
    const id = viewRow(task)?.contactId
    if (typeof id === 'string') needed.add(id)
  }
  if (!needed.size) return null
  const kept = contacts.filter((contact) => {
    const id = viewRow(contact)?.id
    return typeof id === 'string' && needed.has(id)
  })
  return kept.length ? kept : null
}

/**
 * Keep a payload the in-chat app can draw (projectId, contacts, tasks) without a second tool call.
 * Scheduled runs cannot fetch the workspace after the fact.
 * Every task that stays must still have its contact — the to-do view looks the person up by id.
 */
export function fitWorkspaceView(view: Record<string, unknown>, cap = WORKSPACE_VIEW_CAP): Record<string, unknown> {
  const next: Record<string, unknown> = { ...view }
  const size = () => JSON.stringify(next).length
  if (size() <= cap) return next

  const messages = Array.isArray(next.messages) ? next.messages : []
  next.messages = messages.map((message) => {
    const row = viewRow(message)
    if (!row) return message
    return { ...row, body: clipText(row.body, 180), subject: clipText(row.subject, 80) }
  })
  if (size() <= cap) return next

  next.messages = []
  let contacts = (Array.isArray(next.contacts) ? next.contacts : []).map((contact) => slimContact(contact, false))
  next.contacts = contacts
  if (size() <= cap) return next

  let tasks = Array.isArray(next.tasks) ? [...next.tasks] : []
  contacts = contacts.map((contact) => slimContact(contact, true))
  next.contacts = contacts
  next.catalog = []
  next.calls = []
  if (size() <= cap) return next

  const referenced = contactsForTasks(contacts, tasks)
  if (referenced && referenced.length < contacts.length) {
    contacts = referenced
    next.contacts = contacts
    if (size() <= cap) return next
  }

  tasks = tasks.map((task) => slimTask(task, 2000))
  next.tasks = tasks
  if (size() <= cap) return next

  while (size() > cap && tasks.length > 1) {
    const before = tasks.length
    tasks = dropOneTask(tasks, nextOpenTaskIds(tasks))
    if (tasks.length === before) tasks = tasks.slice(0, -1)
    next.tasks = tasks
    const kept = contactsForTasks(contacts, tasks)
    if (kept) {
      contacts = kept
      next.contacts = contacts
    }
  }
  if (size() <= cap) return next

  next.tasks = tasks.map((task) => slimTask(task, 180))
  return next
}

/** Drop web-workspace links from model-facing MCP JSON. Keep billingUrl. */
export function withoutDashboard(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(withoutDashboard)
  if (data && typeof data === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === 'dashboardUrl' || key === 'dashboardPath') continue
      next[key] = withoutDashboard(value)
    }
    return next
  }
  return data
}

export const SAMPLE_EMAIL_WORKSPACE: EmailWorkspace = {
  view: 'email_workspace',
  surface: 'sequence',
  defaultTab: 'contacts',
  focus: 'contacts',
  projectId: 'proj_preview',
  name: 'GTM Engineers · US',
  goal: 'Book a 20-minute intro',
  dashboardUrl: 'https://jargonlabs.co/tools/proj_preview',
  dashboardPath: '/tools/proj_preview',
  contactCount: 3,
  channels: ['email'],
  emailLive: true,
  voiceLive: false,
  linkedinLive: false,
  sandbox: false,
  catalog: [
    { key: 'first_name', label: 'First name', type: 'string', origin: 'identity' },
    { key: 'company', label: 'Company', type: 'string', origin: 'identity' },
    { key: 'title', label: 'Title', type: 'string', origin: 'identity' },
    { key: 'funding_round', label: 'Funding round', type: 'string', origin: 'attrs' }
  ],
  steps: [
    {
      id: 'step_1',
      day: 0,
      channel: 'email',
      label: 'Intro',
      subject: '{{first_name}} — GTM hiring at {{company}}',
      body: 'Hi {{first_name}},\n\nSaw {{company}} is in a {{funding_round}} and hiring GTM engineers. Worth a 20-minute intro?\n\nTara',
      order: 0
    },
    {
      id: 'step_2',
      day: 3,
      channel: 'email',
      label: 'Bump',
      subject: 'Re: {{company}} GTM hiring',
      body: 'Hi {{first_name}}, bumping this in case it got buried.\n\nTara',
      order: 1
    }
  ],
  contacts: [
    {
      id: 'ct_1',
      projectId: 'proj_preview',
      name: 'Alex Chen',
      company: 'Northwind',
      title: 'Head of GTM Eng',
      email: 'alex@northwind.com',
      phone: '',
      city: 'Austin',
      status: 'queued',
      stepIndex: 0,
      notes: '',
      attrs: { funding_round: 'Series B' },
      createdAt: 0,
      updatedAt: 0,
      preview: {
        subject: 'Alex — GTM hiring at Northwind',
        body: 'Hi Alex,\n\nSaw Northwind is in a Series B and hiring GTM engineers. Worth a 20-minute intro?\n\nTara'
      }
    },
    {
      id: 'ct_2',
      projectId: 'proj_preview',
      name: 'Priya Shah',
      company: 'Harbor',
      title: 'VP RevOps',
      email: 'priya@harbor.io',
      phone: '',
      city: 'NYC',
      status: 'queued',
      stepIndex: 0,
      notes: '',
      attrs: { funding_round: 'Series A' },
      createdAt: 0,
      updatedAt: 0,
      preview: {
        subject: 'Priya — GTM hiring at Harbor',
        body: 'Hi Priya,\n\nSaw Harbor is in a Series A and hiring GTM engineers. Worth a 20-minute intro?\n\nTara'
      }
    },
    {
      id: 'ct_3',
      projectId: 'proj_preview',
      name: 'Sam Ortiz',
      company: 'Lumen',
      title: 'GTM Engineer',
      email: '',
      phone: '',
      city: 'Denver',
      status: 'queued',
      stepIndex: 0,
      notes: '',
      attrs: { funding_round: 'Seed' },
      createdAt: 0,
      updatedAt: 0,
      preview: {
        subject: 'Sam — GTM hiring at Lumen',
        body: 'Hi Sam,\n\nSaw Lumen is in a Seed and hiring GTM engineers. Worth a 20-minute intro?\n\nTara'
      }
    }
  ],
  contactsTotal: 3,
  messages: [],
  openCall: null,
  sources: [{ provider: 'hubspot', status: 'connected', accountLabel: 'Northwind CRM' }],
  tasks: [],
  taskStats: summarizeTasks([]),
  stepStats: [
    { stepId: 'step_1', drafted: 0, queued: 0, sent: 0, skipped: 0, due: 0 },
    { stepId: 'step_2', drafted: 0, queued: 0, sent: 0, skipped: 0, due: 0 }
  ],
  researchPending: false,
  stats: {
    drafts: 0,
    queued: 0,
    sent: 0,
    missingEmail: 1,
    remaining: 3,
    emailed: 0,
    called: 0,
    linkedin: 0
  }
}

export const SAMPLE_QUEUE_WORKSPACE: EmailWorkspace = {
  view: 'queue',
  surface: 'queue',
  defaultTab: 'queue',
  focus: 'queue',
  projectId: 'proj_preview_queue',
  name: 'GTM Engineers · US',
  goal: 'Book a 20-minute intro',
  dashboardUrl: 'https://jargonlabs.co/tools/proj_preview_queue',
  dashboardPath: '/tools/proj_preview_queue',
  contactCount: 3,
  channels: ['email', 'call', 'linkedin'],
  emailLive: true,
  voiceLive: false,
  linkedinLive: false,
  sandbox: false,
  catalog: [
    { key: 'first_name', label: 'First name', type: 'string', origin: 'identity' },
    { key: 'company', label: 'Company', type: 'string', origin: 'identity' },
    { key: 'title', label: 'Title', type: 'string', origin: 'identity' }
  ],
  steps: [
    {
      id: 'step_1',
      day: 0,
      channel: 'email',
      label: 'Intro email',
      subject: 'Quick idea for {{company}}',
      body: 'Hi {{first_name}},\n\nNoticed {{company}} and thought it was worth a 12-min look toward booking a 20-minute intro.\n\nTara',
      order: 0
    },
    {
      id: 'step_2',
      day: 0,
      channel: 'call',
      label: 'Discovery dial',
      body: 'Reference the intro email. Ask how {{company}} runs outbound today and who owns it.',
      order: 1
    },
    {
      id: 'step_3',
      day: 2,
      channel: 'linkedin',
      label: 'LinkedIn note',
      body: 'Hi {{first_name}}, noticed {{company}} and thought it was worth a short note toward booking a 20-minute intro.',
      order: 2
    }
  ],
  contacts: rankLeads(
    [
    {
      id: 'ct_1',
      projectId: 'proj_preview_queue',
      name: 'Alex Chen',
      company: 'Northwind',
      title: 'Head of GTM Eng',
      email: 'alex@northwind.com',
      phone: '+1 (415) 555-0142',
      city: 'Austin',
      status: 'active',
      stepIndex: 0,
      notes: '',
      linkedinUrl: 'https://www.linkedin.com/in/alexchen',
      channelsDone: [],
      nextChannel: 'email',
      createdAt: 0,
      updatedAt: 0,
      preview: {
        subject: 'Quick idea for Northwind',
        body: 'Hi Alex,\n\nNoticed Northwind and thought it was worth a 12-min look toward booking a 20-minute intro.\n\nTara'
      },
      linkedinPreview: {
        body: 'Hi Alex, noticed Northwind and thought it was worth a short note toward booking a 20-minute intro.'
      }
    },
    {
      id: 'ct_2',
      projectId: 'proj_preview_queue',
      name: 'Priya Shah',
      company: 'Harbor',
      title: 'VP RevOps',
      email: 'priya@harbor.io',
      phone: '+1 (212) 555-0199',
      city: 'NYC',
      status: 'queued',
      stepIndex: 1,
      notes: '',
      linkedinUrl: 'https://www.linkedin.com/in/priyashah',
      channelsDone: ['email'],
      nextChannel: 'call',
      createdAt: 0,
      updatedAt: 0,
      preview: {
        subject: 'Quick idea for Harbor',
        body: 'Hi Priya,\n\nNoticed Harbor and thought it was worth a 12-min look toward booking a 20-minute intro.\n\nTara'
      },
      linkedinPreview: {
        body: 'Hi Priya, noticed Harbor and thought it was worth a short note toward booking a 20-minute intro.'
      }
    },
    {
      id: 'ct_3',
      projectId: 'proj_preview_queue',
      name: 'Sam Ortiz',
      company: 'Lumen',
      title: 'GTM Engineer',
      email: 'sam@lumen.dev',
      phone: '',
      city: 'Denver',
      status: 'queued',
      stepIndex: 2,
      notes: '',
      linkedinUrl: 'https://www.linkedin.com/in/samortiz',
      channelsDone: ['email', 'call'],
      nextChannel: 'linkedin',
      createdAt: 0,
      updatedAt: 0,
      preview: {
        subject: 'Quick idea for Lumen',
        body: 'Hi Sam,\n\nNoticed Lumen and thought it was worth a 12-min look toward booking a 20-minute intro.\n\nTara'
      },
      linkedinPreview: {
        body: 'Hi Sam, noticed Lumen and thought it was worth a short note toward booking a 20-minute intro.'
      }
    }
  ],
    leadIdentity
  ),
  contactsTotal: 3,
  messages: [],
  openCall: null,
  sources: [{ provider: 'hubspot', status: 'connected', accountLabel: 'Northwind CRM' }],
  tasks: [],
  taskStats: summarizeTasks([]),
  stepStats: [
    { stepId: 'step_1', drafted: 0, queued: 0, sent: 0, skipped: 0, due: 0 },
    { stepId: 'step_2', drafted: 0, queued: 0, sent: 0, skipped: 0, due: 0 },
    { stepId: 'step_3', drafted: 0, queued: 0, sent: 0, skipped: 0, due: 0 }
  ],
  researchPending: false,
  stats: {
    drafts: 0,
    queued: 0,
    sent: 0,
    missingEmail: 0,
    remaining: 3,
    emailed: 2,
    called: 1,
    linkedin: 0
  }
}

const SAMPLE_DAY_MS = 86_400_000
/** Two enrollment dates so the preview shows overdue, due-today, and upcoming tasks together. */
const SAMPLE_ENROLLED_YESTERDAY = Date.now() - SAMPLE_DAY_MS
const SAMPLE_ENROLLED_TODAY = Math.max(new Date().setHours(0, 0, 0, 0), Date.now() - 3 * 3_600_000)

function sampleEmail(
  id: string,
  contactId: string,
  contact: string,
  enrolledAt: number,
  sent: boolean
): PublicMessage {
  return {
    id,
    contactId,
    projectId: 'proj_preview_queue',
    channel: 'email',
    status: sent ? 'sent' : 'queued',
    subject: `Quick idea for ${contact}`,
    body: `Hi there,\n\nNoticed ${contact} and thought it was worth a 12-min look toward booking a 20-minute intro.\n\nTara`,
    mode: sent ? 'gmail' : 'demo',
    createdAt: enrolledAt,
    sendAt: enrolledAt,
    sentAt: sent ? enrolledAt : undefined,
    stepId: 'step_1'
  }
}

function sampleLinkedIn(
  id: string,
  contactId: string,
  first: string,
  contact: string,
  enrolledAt: number
): PublicMessage {
  return {
    id,
    contactId,
    projectId: 'proj_preview_queue',
    channel: 'linkedin',
    status: 'queued',
    subject: '',
    body: `Hi ${first}, noticed ${contact} and thought it was worth a short note toward booking a 20-minute intro.`,
    mode: 'demo',
    createdAt: enrolledAt,
    sendAt: enrolledAt + 2 * SAMPLE_DAY_MS,
    stepId: 'step_3'
  }
}

const SAMPLE_TASK_MESSAGES: PublicMessage[] = [
  sampleEmail('msg_1', 'ct_1', 'Northwind', SAMPLE_ENROLLED_YESTERDAY, true),
  sampleLinkedIn('msg_2', 'ct_1', 'Alex', 'Northwind', SAMPLE_ENROLLED_YESTERDAY),
  sampleEmail('msg_3', 'ct_2', 'Harbor', SAMPLE_ENROLLED_YESTERDAY, true),
  sampleLinkedIn('msg_4', 'ct_2', 'Priya', 'Harbor', SAMPLE_ENROLLED_YESTERDAY),
  sampleEmail('msg_5', 'ct_3', 'Lumen', SAMPLE_ENROLLED_TODAY, false),
  sampleLinkedIn('msg_6', 'ct_3', 'Sam', 'Lumen', SAMPLE_ENROLLED_TODAY)
]

const SAMPLE_TASK_CALLS: PublicCall[] = [
  {
    id: 'call_1',
    contactId: 'ct_2',
    projectId: 'proj_preview_queue',
    phase: 'completed',
    disposition: 'no_answer',
    mode: 'demo',
    startedAt: SAMPLE_ENROLLED_YESTERDAY + 3_600_000,
    endedAt: SAMPLE_ENROLLED_YESTERDAY + 3_700_000
  }
]

const SAMPLE_TASKS = buildWorkspaceTasks({
  contacts: SAMPLE_QUEUE_WORKSPACE.contacts,
  steps: SAMPLE_QUEUE_WORKSPACE.steps,
  messages: SAMPLE_TASK_MESSAGES,
  calls: SAMPLE_TASK_CALLS
})

export const SAMPLE_TASKS_WORKSPACE: EmailWorkspace = {
  ...SAMPLE_QUEUE_WORKSPACE,
  surface: 'tasks',
  defaultTab: 'tasks',
  focus: 'tasks',
  messages: SAMPLE_TASK_MESSAGES,
  tasks: SAMPLE_TASKS,
  taskStats: summarizeTasks(SAMPLE_TASKS),
  stepStats: stepStatsFor(SAMPLE_QUEUE_WORKSPACE.steps, SAMPLE_TASKS, SAMPLE_TASK_MESSAGES),
  stats: {
    ...SAMPLE_QUEUE_WORKSPACE.stats,
    queued: 3,
    sent: 2
  }
}

const DNC_CALL_OVERRIDE = `Account override: if a contact is do-not-call or DNC, still include a call step and put their phone number on it. Keep the note that says the number is DNC. The rep can place the call.`

export function jargonMcpInstructions(store: DataStore, orgId: string): string {
  if (!orgAllowsDncCalls(store, orgId)) return JARGON_MCP_INSTRUCTIONS
  return `${JARGON_MCP_INSTRUCTIONS}\n\n${DNC_CALL_OVERRIDE}`
}

function dncNotesFor(
  store: DataStore,
  orgId: string,
  contacts: Array<Pick<PublicContact, 'id' | 'email' | 'phone' | 'linkedinUrl'>>
): Map<string, string> {
  const notes = new Map<string, string>()
  if (!orgAllowsDncCalls(store, orgId)) return notes
  for (const contact of contacts) {
    if (!contact.phone?.trim()) continue
    const note = doNotCallNote(store.db, orgId, contact)
    if (note) notes.set(contact.id, note)
  }
  return notes
}

export const ADMIN_REPORT_ROUTE =
  'Reporting comes first. A rep drilldown, team or org performance, meetings booked, or results over a period such as last quarter is show_admin, once. That is the reporting tool and it opens the admin view. Pass range quarter for last quarter, or 7d, 30d, or 90d. Pass focus reps for a drilldown, sequences, meetings, or territories. Do not call deploy_tool, import_list, resume_workspace, list_projects, or get_usage. Do not create a workspace. Summarize the summary field in one sentence.'

export const JARGON_MCP_INSTRUCTIONS = `${ADMIN_REPORT_ROUTE}

Jargon runs outbound for this account: email sends from the mailbox the customer connected at jargonlabs.co (Account → Data → Sending mailbox, Gmail or Outlook), and replies there stop the sequence; phone and LinkedIn are sent by Jargon (customers do not bring API keys). If an email send says to connect or reconnect a mailbox, tell the user to do that on the Data page. Jargon stores contacts and builds the requested tool — including the cadence ladder (days, channels, labels). Contact and company facts come from the customer's source — HubSpot, a Railway or Postgres table, or a list they paste — including whatever enrichment tool wrote into it. Each contact carries those facts in context and attrs. Claude writes send copy and talk tracks from those fields via save_research, which opens the one workspace.

Priority pipeline: when the user asks to build a priority pipeline or prioritize contacts, call deploy_tool with that sentence as workspace and no contact table. Hydrate whoever is already connected — Railway, Postgres, HubSpot — or a list they paste. Do not call resume_workspace first. Then call show_tasks with the projectId. Stop. Only people with an email, phone, or LinkedIn URL are ranked. Rank and signals come from fields on the source (intent, seniority, funding, hiring, CRM warmth) — do not invent them. Do not save_research and do not ask to schedule. Do not enroll HubSpot if the workspace already has people from another source.

On any other new chat that is not a report or rep drilldown, call resume_workspace before import_list or deploy_tool. It returns JSON and does not open a workspace. If a workspace already exists and the user is continuing it, call show_email_workspace or show_tasks once. If they are building a new sequence, do not open the resumed one. Contacts already have priority.rank, priority.motion (inbound or outbound), and priority.signals from any source. The queue is sorted best first. Do not regroup by warmth and do not drop cold contacts.

Bring a list through Claude when no warehouse or CRM is connected: import_list / deploy_tool with a markdown table or CSV in the workspace argument. If they name a source (Railway, HubSpot, a pasted table), use that source only.

One workspace, three jobs. The in-chat UI is always Contacts, Sequence, and Tasks (plus Inbox for replies, or Queue for a live dialer). Do not treat those as different apps.

Ownership — do not compete with Jargon on structure:
- NEVER write a multi-day sequence outline, day ladder, or step-by-step cadence plan in chat. Do not invent or narrate "Day 0… Day 10" copy for the user to read as the sequence.
- Jargon owns cadence structure via import_list / deploy_tool / update_sequence. After a sequence exists, researched per-person copy is save_research. Edits to that sequence are update_sequence on the same projectId.
- If the user edits the sequence they already have — copy, subject, body, talk track, tone, wording, or the ladder — call update_sequence on that projectId. Pass every step with day, channel, label, subject, and body. The subject and body you pass are what the sequence stores. Do not call deploy_tool or import_list for an edit. Those create a second sequence and leave the rewrite off the one they asked about. Do not leave the rewrite only in chat. save_research does not change the sequence steps.
- If the user asks for N steps or touchpoints over D days (or an explicit day ladder) on a new sequence, put that ask in the import/deploy workspace text and let Jargon build the steps. Read the returned steps. If they do not match, call update_sequence on that same project with the full ladder, including subject and body when they gave wording — do not re-paste the plan into chat.

- User provides a list (another Claude connector, CSV, pasted table) and asks for a dialer, sequencer, cadence, or LinkedIn motion.
- import_list / deploy_tool ingests the list and builds cadence structure only. Do not open a workspace yet. Do not call show_email_workspace, show_tasks, or get_sequence to preview the template sequence.
- If nextAction / pendingEnrichment is set, HubSpot contacts were just added and enrichment is still writing email, phone, LinkedIn, or company fields. Call list_crm_contacts again until those fields exist. Do not enroll and do not save_research until HubSpot has the enrichment.
- Once people are reachable, write personalized talk tracks, email copy, and LinkedIn notes from each contact's fields (context and attrs). Do not invent funding, hiring, tenure, or other company facts the source did not provide. Then save_research. Pass stepId or day for follow-ups. One Allow card for the whole list. Pass the JSON only as the research tool argument — never paste it into chat. Follow nextAction on the deploy payload. Do not wait to be asked.
- save_research enrolls everyone and opens the one workspace for this build, with that copy. Do not also call show_email_workspace or show_tasks. Sequence is the cadence structure (days, channels, labels). Fallback templates may use {{first_name}} — those are not the send copy, and they must not be shown as a workspace.
- After the sequence is saved, follow nextAction: ask once whether Jargon may run this workspace on its own. Default every Sunday at 6pm. If they name a segment (disqualified, a lifecycle stage, a HubSpot list), pass it on note_schedule_choice. accepted is the one grant: Jargon then pulls that segment and queues reps without another prompt. Also create a Claude scheduled task only after they confirm with Schedule. ${SCHEDULED_BUILD} An Allow click on any other Jargon tool does not create that schedule or that grant.
- Enrollment is a chat action, never a button in the app. When the user says to enroll people, call enroll_hubspot if they are in HubSpot, or start_sequence if they are already in the workspace. When personalized copy is already saved, that call opens the sequence — do not also call show_tasks or show_email_workspace. If you still need save_research, this enroll does not open a workspace; save_research does. Use show_tasks when they want to work what is due and nothing else has opened the sequence.
- Tasks is today's work: they click through — send the email, run the call with the talk track, send the LinkedIn note, skip, or reschedule. Open it with show_tasks; read it with list_tasks.
- When the user asks how the team or org performed — a rep productivity drilldown, meetings booked, calls, emails, or replies over a period such as last quarter — call show_admin once. That opens the org view. Pass range quarter for last quarter, or 7d, 30d, or 90d. Pass focus reps, sequences, meetings, or territories. Use territories when they ask for sales territory, productivity by territory, or which message converts in a territory. Summarize the summary field in one sentence. Do not paste the table, and do not call show_tasks or get_usage for that.
- Phone calls stay in the in-chat dialer. Do not send the user to the web dashboard to place a call.
- Never share dashboardUrl, dashboardPath, or a jargonlabs.co/tools/… link. A build displays one in-chat workspace: the one save_research opens after personalized copy is saved. A priority pipeline displays one workspace: the show_tasks call after deploy. Do not tell them to open the web workspace.
- Send the user to the web dashboard only to update billing or plans (call create_billing_link, or https://jargonlabs.co/billing) or to contact support (https://jargonlabs.co).
- Queue (dialer / work the list today / multi-channel) is contact-by-contact Email, Call, LinkedIn.
- One-off / a handful / just send these → Contacts with a composer. save_research or save_draft then send_draft. Do not enroll unless they asked for a cadence.
- Inbox / mailbox / replies / what's been sent → the message log. Not the send path for a cadence.

Path:
1. Ingest with import_list (contacts from chat, CSV, another connector, or a pasted table). Prefer that over deploy_tool without contacts.
2. On Claude's Allow card, summary is the sentence the user reads. Never pass a contacts array or nested spec — put people in workspace as a markdown table or CSV. State the goal, audience, and any requested step count / day span in that text — do not outline the full cadence in chat.
3. When contacts are reachable (email, phone, or LinkedIn) and have their source fields, write the copy and save_research. The flow opens after that in Claude. Do not link the web workspace.`
