import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { Channel, FieldDef, Project } from './types'
import { toPublicConnection } from './connections'
import { interpolateTemplate } from '../shared/fieldCatalog'
import { inspectTwilioVoice } from './providers/twilio'
import {
  dashboardFor,
  findOrgProject,
  getPublicSequence,
  listPublicContacts,
  listPublicMessages,
  toPublicCall,
  type PublicCall,
  type PublicContact,
  type PublicMessage,
  type PublicStep
} from './publicApi'
import { inferMcpSurface, motionComplete, nextChannel, type McpSurface } from '../shared/workspaceSpec'
import {
  buildWorkspaceTasks,
  summarizeTasks,
  type TaskStats,
  type WorkspaceTask
} from './workspaceTasks'

/** Current widget URI. Claude caches HTML by this string — bump when the bundle changes. */
export const EMAIL_WORKSPACE_URI = 'ui://jargon/email-workspace.html?v=dialer1'

/** Serve the current HTML under every URI Claude may still have cached from tools/list. */
export const EMAIL_WORKSPACE_URIS = [
  'ui://jargon/email-workspace.html',
  'ui://jargon/email-workspace-v2.html',
  'ui://jargon/email-workspace.html?v=enroll1',
  'ui://jargon/email-workspace.html?v=surfaces1',
  'ui://jargon/email-workspace.html?v=queue1',
  'ui://jargon/email-workspace.html?v=tasks1',
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
}

export type EmailWorkspace = {
  view: 'email_workspace' | 'queue' | 'overflow'
  surface: McpSurface
  /** Tab the app should land on, regardless of the inferred surface. */
  focus?: 'tasks'
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

export function isEmailMotion(project: Project, steps: Array<{ channel: string }>): boolean {
  if (projectChannels(project).includes('email')) return true
  return steps.some((step) => step.channel === 'email')
}

export function getEmailWorkspace(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  opts?: { sandbox?: boolean; focus?: 'tasks' }
): EmailWorkspace | null {
  const project = findOrgProject(store, orgId, projectId)
  if (!project) return null
  const sequence = getPublicSequence(store, orgId, projectId)
  if (!sequence) return null
  const steps = sequence.steps.filter((step): step is PublicStep => Boolean(step))
  const dashboard = dashboardFor(project.id, config.appUrl)
  const listed = listPublicContacts(store, projectId, { limit: 50, offset: 0 })
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
      nextChannel: nextChannel(contact, spec)
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
  const remaining = contacts.filter((c) => !motionComplete(c, spec)).length
  const view =
    surface === 'overflow' ? 'overflow' : surface === 'queue' || surface === 'tasks' ? 'queue' : 'email_workspace'
  return {
    view,
    surface,
    focus: opts?.focus,
    projectId: project.id,
    name: project.name,
    goal: sequence.goal || project.spec?.goal || project.answers.goal || '',
    dashboardUrl: dashboard.dashboardUrl,
    dashboardPath: dashboard.dashboardPath,
    contactCount: listed.total,
    channels,
    emailLive: !opts?.sandbox && Boolean(config.google.refreshToken),
    voiceLive: !opts?.sandbox && inspectTwilioVoice(config).ok,
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
    taskStats: summarizeTasks(tasks),
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

export const SAMPLE_EMAIL_WORKSPACE: EmailWorkspace = {
  view: 'email_workspace',
  surface: 'sequence',
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
  contacts: [
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
  contactsTotal: 3,
  messages: [],
  openCall: null,
  sources: [{ provider: 'hubspot', status: 'connected', accountLabel: 'Northwind CRM' }],
  tasks: [],
  taskStats: summarizeTasks([]),
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
  focus: 'tasks',
  messages: SAMPLE_TASK_MESSAGES,
  tasks: SAMPLE_TASKS,
  taskStats: summarizeTasks(SAMPLE_TASKS),
  stats: {
    ...SAMPLE_QUEUE_WORKSPACE.stats,
    queued: 3,
    sent: 2
  }
}

export const JARGON_MCP_INSTRUCTIONS = `Jargon runs outbound for this account: email (platform Gmail), phone, and LinkedIn. Claude researches people and companies, then Jargon stores contacts and runs the motion. The in-chat UI is chosen from the user's request.

Describe the interface in prompt (and spec.channels / spec.primarySurface when it helps):
- Outbound tool / today queue / dialer / LinkedIn / multi-channel → a contact queue with Email, Call, and LinkedIn actions. Default is all three channels. The user works the list in Claude.
- Sequence / cadence / over N days (email-only) → sequence flow. Put templates in spec.steps with {{first_name}}, {{company}}, and catalog keys. Call start_sequence (or the user clicks Start sequence) to enroll everyone by step day.
- Task view / daily tasks / what's due today → one dated task per sequence step per enrolled contact. The user clicks through them: send the email, log the call, send the LinkedIn note. Open it with show_tasks; read it with list_tasks. Tasks only exist after start_sequence.
- One-off / a handful of emails / just send these → one composer per person. save_draft then send_draft or send_message. Do not call start_sequence unless they asked for a cadence.
- Inbox / mailbox / replies / what's been sent → message list for the workspace.

Path:
1. Ingest with import_list (contacts from chat, another connector, or a pasted table) or deploy_tool without contacts to hydrate HubSpot/Railway.
2. Those tools open the matching outbound UI in Claude. Do not dump JSON — the UI is the workspace.
3. Re-open with show_email_workspace, or show_tasks for the day's task list. dashboardUrl is the full web tool (billing, CRM connect, huge lists).

Never prefix dashboardPath with www.jargonlabs.co.`
