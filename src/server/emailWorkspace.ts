import type { DataStore } from './store'
import type { ServerConfig } from './config'
import type { Channel, FieldDef, Project } from './types'
import { toPublicConnection } from './connections'
import { interpolateTemplate } from '../shared/fieldCatalog'
import {
  dashboardFor,
  findOrgProject,
  getPublicSequence,
  listPublicContacts,
  listPublicMessages,
  type PublicContact,
  type PublicMessage,
  type PublicStep
} from './publicApi'
import { inferMcpSurface, type McpSurface } from '../shared/workspaceSpec'

/** Current widget URI. Claude caches HTML by this string — bump when the bundle changes. */
export const EMAIL_WORKSPACE_URI = 'ui://jargon/email-workspace.html?v=surfaces1'

/** Serve the current HTML under every URI Claude may still have cached from tools/list. */
export const EMAIL_WORKSPACE_URIS = [
  'ui://jargon/email-workspace.html',
  'ui://jargon/email-workspace-v2.html',
  'ui://jargon/email-workspace.html?v=enroll1',
  EMAIL_WORKSPACE_URI
] as const

export type EmailWorkspaceSource = {
  provider: string
  status: string
  accountLabel?: string
}

export type EmailWorkspace = {
  view: 'email_workspace' | 'overflow'
  surface: McpSurface
  projectId: string
  name: string
  goal: string
  dashboardUrl: string
  dashboardPath: string
  contactCount: number
  channels: Channel[]
  emailLive: boolean
  sandbox: boolean
  catalog: FieldDef[]
  steps: PublicStep[]
  contacts: Array<
    PublicContact & {
      preview?: { subject: string; body: string }
    }
  >
  contactsTotal: number
  messages: PublicMessage[]
  sources: EmailWorkspaceSource[]
  stats: {
    drafts: number
    queued: number
    sent: number
    missingEmail: number
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
  opts?: { sandbox?: boolean }
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
  const emailStep = steps.find((step) => step.channel === 'email')
  const contacts = listed.contacts.map((contact) => {
    const preview = emailStep
      ? {
          subject: interpolateTemplate(emailStep.subject ?? '', contact),
          body: interpolateTemplate(emailStep.body ?? '', contact)
        }
      : undefined
    return { ...contact, preview }
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
  const email = isEmailMotion(project, steps)
  const surface = inferMcpSurface({
    prompt: project.prompt || '',
    primarySurface: project.spec?.primarySurface,
    channels: projectChannels(project).length ? projectChannels(project) : steps.map((s) => s.channel),
    steps
  })
  return {
    view: email && surface !== 'overflow' ? 'email_workspace' : 'overflow',
    surface: email ? surface : 'overflow',
    projectId: project.id,
    name: project.name,
    goal: sequence.goal || project.spec?.goal || project.answers.goal || '',
    dashboardUrl: dashboard.dashboardUrl,
    dashboardPath: dashboard.dashboardPath,
    contactCount: listed.total,
    channels: projectChannels(project).length ? projectChannels(project) : steps.map((s) => s.channel),
    emailLive: !opts?.sandbox && Boolean(config.google.refreshToken),
    sandbox: Boolean(opts?.sandbox),
    catalog: sequence.fieldCatalog ?? [],
    steps,
    contacts,
    contactsTotal: listed.total,
    messages,
    sources,
    stats: {
      drafts: messages.filter((m) => m.status === 'draft' && m.channel === 'email').length,
      queued: messages.filter((m) => m.status === 'queued' && m.channel === 'email').length,
      sent: messages.filter((m) => m.status === 'sent' && m.channel === 'email').length,
      missingEmail: listed.contacts.filter((c) => !c.email?.trim()).length
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
  sources: [{ provider: 'hubspot', status: 'connected', accountLabel: 'Northwind CRM' }],
  stats: { drafts: 0, queued: 0, sent: 0, missingEmail: 1 }
}

export const JARGON_MCP_INSTRUCTIONS = `Jargon runs outbound email for this account (platform Gmail). Claude researches people and companies, then Jargon stores contacts, drafts, and sends. The in-chat UI is chosen from the user's request — not always a sequencer.

Describe the interface in prompt (and spec.primarySurface when it helps):
- Sequence / cadence / over N days → sequence flow. Put templates in spec.steps with {{first_name}}, {{company}}, and catalog keys. Call start_sequence (or the user clicks Start sequence) to enroll everyone by step day. Day 0 sends immediately. Later days send automatically. Replies cancel remaining queued emails.
- One-off / a handful of emails / just send these → one composer per person. save_draft then send_draft or send_message. Do not call start_sequence unless they asked for a cadence.
- Inbox / mailbox / replies / what's been sent → message list for the workspace.
- Dialer, LinkedIn queue, today queue → overflow; share dashboardUrl (https://jargonlabs.co/tools/…).

Path:
1. Ingest with import_list (contacts from chat, another connector, or a pasted table) or deploy_tool without contacts to hydrate HubSpot/Railway.
2. Those tools open the matching outbound UI in Claude. Do not dump JSON — the UI is the workspace.
3. Re-open with show_email_workspace. dashboardUrl is overflow only (dialer, billing, CRM connect, huge lists).

Never prefix dashboardPath with www.jargonlabs.co.`
