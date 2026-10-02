import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { Channel, FieldDef, Project } from './types'
import { toPublicConnection } from './connections'
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
  buildWorkspaceTasks,
  summarizeTasks,
  type TaskStats,
  type WorkspaceTask
} from './workspaceTasks'

/** Current widget URI. Claude caches HTML by this string — bump when the bundle changes. */
export const EMAIL_WORKSPACE_URI = 'ui://jargon/email-workspace.html?v=priorityhml1'

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

export function scheduleAsk(projectId: string): string {
  return `Ask the user once whether to run project ${projectId} on a schedule. Default: every Sunday at 6pm in their timezone. If they name another cadence, use that. If they say yes, propose a Claude scheduled task and wait for them to confirm with Schedule. Do not say it is scheduled until they confirm. The task instructions must say: call resume_workspace for this project, then list_crm_contacts, enroll everyone with enroll_hubspot people "all", research anyone new, and save_research. Tell them the task must be allowed to use Jargon's write tools, or a later run stops on an Allow card. After they answer, call note_schedule_choice. If they say no, call note_schedule_choice with declined and do not create a task.`
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
  const projectRows = store.db.contacts.filter((c) => c.projectId === projectId && isPriorityContact(c))
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
  const tasks = buildWorkspaceTasks({ contacts, steps, messages, calls: projectCalls })
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
      ? `Research each contact and save_research personalized email copy for project ${project.id}. Do not start a sequence. Pass research only as the save_research argument — do not paste JSON into chat.`
      : `Research each of the ${listed.total} contacts and their companies now. Then call save_research for project ${project.id} with talk tracks (channel: call), email copy, and LinkedIn notes for every sequence step. That enrolls everyone and opens the flow. Do not wait to be asked. Do not paste the research JSON into chat. Do not leave {{first_name}} placeholders as the send copy.`
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
    nextAction: ws.nextAction,
    taskStats: ws.taskStats,
    stats: ws.stats
  }
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

export const JARGON_MCP_INSTRUCTIONS = `Jargon runs outbound for this account on managed infrastructure: email, phone, and LinkedIn are sent by Jargon (customers do not bring API keys). Jargon stores contacts and builds the requested tool — including the cadence ladder (days, channels, labels). Claude researches people and companies and writes send copy and talk tracks via save_research. Tasks then opens with personalized work.

Priority pipeline: when the user asks to build a priority pipeline or prioritize contacts, call deploy_tool with that sentence as workspace and no contact table. Hydrate whoever is already connected — Railway, Postgres, HubSpot — or a list they paste. Do not call resume_workspace first. Then call show_tasks with the projectId. Stop. Only people with an email, phone, or LinkedIn URL are ranked. Do not save_research and do not ask to schedule. Do not enroll HubSpot if the workspace already has people from another source.

On any other new chat, call resume_workspace before import_list or deploy_tool. If a workspace already exists, continue it. Contacts already have priority.rank, priority.motion (inbound or outbound), and priority.signals from any source. The queue is sorted best first. Do not regroup by warmth and do not drop cold contacts.

Bring a list through Claude when no warehouse or CRM is connected: import_list / deploy_tool with a markdown table or CSV in the workspace argument. If they name a source (Railway, HubSpot, a pasted table), use that source only.

One workspace, three jobs. The in-chat UI is always Contacts, Sequence, and Tasks (plus Inbox for replies, or Queue for a live dialer). Do not treat those as different apps.

Ownership — do not compete with Jargon on structure:
- NEVER write a multi-day sequence outline, day ladder, or step-by-step cadence plan in chat. Do not invent or narrate "Day 0… Day 10" copy for the user to read as the sequence.
- Jargon owns cadence structure via import_list / deploy_tool / update_sequence. Your job after structure exists is researched copy via save_research only.
- If the user asks for N steps over D days (or an explicit day ladder), put that ask in the import/deploy workspace text and let Jargon build the steps. Read the returned steps. If they do not match, call update_sequence with the full ladder (structure + short templates only) — do not re-paste the plan into chat.

- User provides a list (another Claude connector, CSV, pasted table) and asks for a dialer, sequencer, cadence, or LinkedIn motion.
- import_list / deploy_tool ingests the list and builds cadence structure only. Do not show Tasks yet.
- Immediately research each company and prospect. Then save_research with personalized talk tracks (channel: call), email copy, and LinkedIn notes for every step. Pass stepId or day for follow-ups. One Allow card for the whole list. Pass the JSON only as the research tool argument — never paste it into chat. Follow nextAction on the deploy payload. Do not wait to be asked.
- save_research enrolls everyone and opens the flow with that copy. Sequence is the cadence structure (days, channels, labels). Fallback templates may use {{first_name}} — those are not the send copy.
- After the sequence is saved, follow nextAction: ask once whether to run this workspace on a schedule. Default every Sunday at 6pm. Create the Claude scheduled task only after they confirm with Schedule, then call note_schedule_choice. An Allow click on a Jargon tool does not create that schedule.
- Enrollment is a chat action, never a button in the app. When the user says to enroll people, call enroll_hubspot if they are in HubSpot, or start_sequence if they are already in the workspace. The flow opens. Use show_tasks only when they want to work what is due.
- Tasks is today's work: they click through — send the email, run the call with the talk track, send the LinkedIn note, skip, or reschedule. Open it with show_tasks; read it with list_tasks.
- Phone calls stay in the in-chat dialer. Do not send the user to dashboardUrl to place a call.
- Queue (dialer / work the list today / multi-channel) is contact-by-contact Email, Call, LinkedIn.
- One-off / a handful / just send these → Contacts with a composer. save_research or save_draft then send_draft. Do not enroll unless they asked for a cadence.
- Inbox / mailbox / replies / what's been sent → the message log. Not the send path for a cadence.

Path:
1. Ingest with import_list (contacts from chat, CSV, another connector, or a pasted table). Prefer that over deploy_tool without contacts.
2. On Claude's Allow card, summary is the sentence the user reads. Never pass a contacts array or nested spec — put people in workspace as a markdown table or CSV. State the goal, audience, and any requested step count / day span in that text — do not outline the full cadence in chat.
3. Research each company/prospect now and save_research the copy. The flow opens after that. dashboardUrl is the full web tool (billing, Connect Claude, huge lists).

Never prefix dashboardPath with www.jargonlabs.co.`
