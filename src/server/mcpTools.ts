import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { toPublicUser } from './auth'
import type { McpActor } from './mcpOauth'
import { extractContactsFromPrompt, extractRecordsFromText, parseDeployContacts, parseRequiredContacts } from './deployContacts'
import { upsertEnrichment } from './enrichment'
import {
  addPublicContactsAndEnroll,
  addPublicNote,
  applyDisposition,
  completePublicCall,
  deliverPublicMessage,
  deployPublicTool,
  emptyQueue,
  enrollHubSpotContacts,
  enrollPublicSequence,
  latestWorkspace,
  listHubSpotContactsForEnroll,
  promoteToRep,
  saveWorkspaceBrief,
  findOrgCall,
  findOrgContact,
  findOrgMessage,
  findOrgProject,
  getPublicSequence,
  isContactStatus,
  listPublicContacts,
  listPublicMessages,
  listPublicProjects,
  listPublicProspects,
  nextQueueContact,
  patchPublicMessage,
  reportPublicCallProgress,
  sendPublicMessage,
  startPublicCall,
  toPublicContact,
  toPublicProject,
  toPublicQueueNext,
  updatePublicSequence,
  upsertPublicDraft,
  unenrollPublicContact,
  setStepSendMode,
  skipPublicTask,
  savePublicResearch,
  savePublicTalkTrack,
  type ResearchCopyInput
} from './publicApi'
import type { BillingService } from './billing/types'
import { chargeIfLive, meBillingFields, projectNamesFor, refundCredits } from './billing'
import { claudeConnectorStatus } from './mcpOauth'
import { createVoiceToken, inspectLiveVoice, voiceIsLive } from './providers/voice'
import { toE164 } from '../shared/phone'
import { platformGmailReady } from './providers/gmail'
import { buildAdminReport, isAdminReportAsk, type AdminFocus, type AdminRange } from './adminReport'
import { bookPublicMeeting } from './calendar'
import {
  ADMIN_REPORT_ROUTE,
  fitWorkspaceView,
  getEmailWorkspace,
  SCHEDULED_BUILD,
  withoutDashboard,
  workspaceBrief
} from './emailWorkspace'
import { EMAIL_WORKSPACE_TOOL_META } from './mcpApps'
import { shouldAutoStartSequence, type McpTab } from '../shared/workspaceSpec'
import { isPriorityContact, isPriorityPipelinePrompt, leadIdentity, rankLeads } from '../shared/priorityOverlay'
import { parseWarmthFilter } from '../shared/warmth'

const ContactStatus = z.enum([
  'queued',
  'active',
  'completed',
  'replied',
  'no_answer',
  'interested',
  'not_interested',
  'meeting_booked'
])

// Claude's Allow card dumps nested objects/arrays as a JSON fence. Write tools
// that the model calls only take strings — `summary` first so it sorts before
// `workspace` — and the write runs when the user clicks Allow.
const Summary = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The sentence shown on Claude\'s Allow card. Name the people and what Jargon will do. No ids, field names, tool names, or JSON. Example: "Add Tara Debek at Jargon to an 8-day outbound cadence."'
  )

const APP_ONLY_META = { ui: { visibility: ['app'] as const } }

const HINTS = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  overwrite: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  send: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
} as const

// Spec precedence is `title` then `annotations.title`; set both so older clients
// also show the plain-language name rather than the snake_case tool id.
function display(title: string, hints: (typeof HINTS)[keyof typeof HINTS]) {
  return { title, annotations: { title, ...hints } }
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(withoutDashboard(data), null, 2) }] }
}

function fail(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true
  }
}

function failCharge(charge: { error: string; billingUrl?: string }) {
  return fail(
    charge.billingUrl
      ? `${charge.error} Open ${charge.billingUrl} to update billing or your plan, or to contact support.`
      : charge.error
  )
}

const OPEN_NOTE =
  'The sequence is open in this chat. Summarize in one or two sentences. Do not outline the day ladder. Do not call show_tasks or show_email_workspace.'

function workspaceOk(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  sandbox: boolean,
  focus?: McpTab,
  userId?: string,
  opts?: { embed?: boolean }
) {
  try {
    const ws = getEmailWorkspace(store, config, orgId, projectId, {
      sandbox,
      focus,
      userId
    })
    if (!ws) return fail('Project not found')
    const show = opts?.embed !== false
    const view = withoutDashboard(ws) as Record<string, unknown>
    const fitted = fitWorkspaceView(view)
    const forModel = show ? workspaceBrief(ws) : fitted
    const body: {
      content: Array<{ type: 'text'; text: string }>
      structuredContent?: Record<string, unknown>
      _meta?: typeof EMAIL_WORKSPACE_TOOL_META
    } = {
      content: [{ type: 'text', text: JSON.stringify(forModel, null, 2) }],
      // The model reads the brief. The app paints from structuredContent, including
      // a reload, so a trimmed list still has each to-do's contact.
      structuredContent: fitted
    }
    if (show) body._meta = EMAIL_WORKSPACE_TOOL_META
    return body
  } catch (err) {
    return fail(err)
  }
}

function noteOpened(result: ReturnType<typeof workspaceOk>, note = OPEN_NOTE) {
  if (!result || !('content' in result) || !result.content?.[0] || 'isError' in result) return result
  try {
    const brief = JSON.parse(result.content[0].text) as Record<string, unknown>
    brief.nextAction = note
    result.content[0].text = JSON.stringify(brief, null, 2)
  } catch {
    /* keep the brief */
  }
  return result
}

export function registerJargonTools(
  server: McpServer,
  store: DataStore,
  config: ServerConfig,
  actor: McpActor,
  billing: BillingService
): void {
  const sandbox = actor.environment === 'sandbox'

  server.registerTool(
    'get_me',
    {
      ...display('Check your Jargon account', HINTS.read),
      description:
        'Current Jargon user, org, plan, credit balance, and outbound flags. Does not consume credits.'
    },
    async () => {
      const user = store.db.users.find((u) => u.id === actor.userId)
      const org = store.db.orgs.find((o) => o.id === actor.orgId)
      if (!user || !org) return fail('Account not found')
      const credits = await billing.getCredits(org.id)
      return ok({
        user: toPublicUser(user),
        org: { id: org.id, name: org.name, slug: org.slug },
        environment: actor.environment,
        outbound: {
          email: sandbox ? 'sandbox' : platformGmailReady(config) ? 'live' : 'demo',
          voice: sandbox ? 'sandbox' : voiceIsLive(config) ? 'live' : 'demo',
          linkedin: sandbox ? 'sandbox' : config.heyreach.apiKey ? 'live' : 'demo'
        },
        ...meBillingFields(credits),
        claude: claudeConnectorStatus(store, config, org.id),
        ingest:
        `${ADMIN_REPORT_ROUTE} If the user asks to build a priority pipeline or prioritize contacts, call deploy_tool with their sentence as workspace and no contact table, then show_tasks once. Hydrate Railway, Postgres, HubSpot, or a pasted list — whichever they have. Do not resume_workspace first, do not save_research, and do not ask to schedule. Do not enroll HubSpot when the workspace already has people. Otherwise, in a new chat that is not a report or rep drilldown, call resume_workspace first — it returns JSON and does not open a workspace. Contacts are already ranked from any source. Import a list with import_list or deploy_tool when nothing is connected. Do not open the template sequence. Then save_research, which opens the one workspace. Do not call show_email_workspace, show_tasks, or get_sequence in that build. After the sequence is saved, ask once whether Jargon may run it on its own. accepted on note_schedule_choice is the grant. ${SCHEDULED_BUILD} Reopen an already personalized workspace later with show_email_workspace only when the user asks to see it, never in the same turn as save_research. Do not share a web workspace URL — send the user to jargonlabs.co only for billing, plans, or support.`
      })
    }
  )

  server.registerTool(
    'get_credits',
    {
      ...display('Check your credit balance', HINTS.read),
      description:
        'Remaining API credits, monthly grant, and refresh date. Free — does not consume credits.'
    },
    async () => ok(await billing.getCredits(actor.orgId))
  )

  server.registerTool(
    'get_usage',
    {
      ...display('Check your usage this period', HINTS.read),
      description:
        'Credit balance for the current billing period only. Not a rep drilldown and not a date range such as last quarter. Call show_admin for that.'
    },
    async () => ok(await billing.getUsage(actor.orgId, projectNamesFor(store, actor.orgId)))
  )

  const BillingLinkInput = z.object({
    summary: Summary,
    intent: z.enum(['upgrade', 'topup', 'portal']).describe('upgrade plan, buy credits, or manage payment method'),
    plan: z.enum(['team', 'scale']).optional(),
    packId: z.enum(['credits_500', 'credits_2000', 'credits_10000']).optional()
  })

  async function execCreateBillingLink(intent: 'upgrade' | 'topup' | 'portal', plan?: 'team' | 'scale', packId?: 'credits_500' | 'credits_2000' | 'credits_10000') {
    const org = store.db.orgs.find((o) => o.id === actor.orgId)
    const user = store.db.users.find((u) => u.id === actor.userId)
    try {
      return ok(
        await billing.createBillingLink({
          orgId: actor.orgId,
          email: user?.email,
          name: org?.name,
          intent,
          plan,
          packId
        })
      )
    } catch (err) {
      return fail(err)
    }
  }

  server.registerTool(
    'create_billing_link',
    {
      ...display('Open your billing page', HINTS.send),
      description:
        'Return a URL to upgrade the plan, buy credit top-ups, or open the billing portal. Claude must not collect card details — send the user to this URL (the web dashboard). This is the only reason to send them to jargonlabs.co besides contacting support.',
      inputSchema: BillingLinkInput
    },
    async ({ intent, plan, packId }) => execCreateBillingLink(intent, plan, packId)
  )

  server.registerTool(
    'run_create_billing_link',
    {
      ...display('Open your billing page', HINTS.send),
      description: 'Create a billing URL after the user confirms. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: BillingLinkInput.omit({ summary: true })
    },
    async ({ intent, plan, packId }) => execCreateBillingLink(intent, plan, packId)
  )

  server.registerTool(
    'list_prospects',
    {
      ...display('Look up your prospects', HINTS.read),
      description: 'List prospects already in this org. Do not cache PII. Do not pass org_id.',
      inputSchema: z.object({
        projectId: z.string().optional(),
        status: ContactStatus.optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      })
    },
    async (args) =>
      ok(
        listPublicProspects(store, {
          orgId: actor.orgId,
          projectId: args.projectId,
          status: args.status,
          q: args.q,
          limit: args.limit,
          offset: args.offset
        })
      )
  )

  server.registerTool(
    'get_prospect',
    {
      ...display('Look up one prospect', HINTS.read),
      description: 'Get one prospect by id.',
      inputSchema: z.object({ id: z.string() })
    },
    async ({ id }) => {
      const contact = findOrgContact(store, actor.orgId, id)
      if (!contact) return fail('Prospect not found')
      return ok(toPublicContact(contact))
    }
  )

  server.registerTool(
    'list_projects',
    {
      ...display('List your outbound workspaces', HINTS.read),
      description:
        'List workspaces for this account. Not a performance report. For a rep drilldown or last quarter, call show_admin. Do not share dashboardUrl — reopen one in Claude with show_email_workspace.'
    },
    async () => ok({ projects: listPublicProjects(store, actor.orgId, config.appUrl) })
  )

  server.registerTool(
    'get_project',
    {
      ...display('Open one outbound workspace', HINTS.read),
      description:
        'Get one workspace. Do not share dashboardUrl. Reopen it in Claude with show_email_workspace.',
      inputSchema: z.object({ id: z.string() })
    },
    async ({ id }) => {
      const project = findOrgProject(store, actor.orgId, id)
      if (!project) return fail('Project not found')
      return ok(toPublicProject(store.db.contacts, project, config.appUrl))
    }
  )

  const ContactInput = z
    .object({
      name: z.string().min(1).describe('Full name'),
      company: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      city: z.string().optional(),
      linkedinUrl: z.string().optional(),
      linkedin: z.string().optional().describe('Alias for linkedinUrl'),
      notes: z.string().optional(),
      context: z.array(z.string()).optional(),
      attrs: z.record(z.string(), z.unknown()).optional()
    })
    .passthrough()

  const SpecStep = z.object({
    day: z.number().int().min(0).max(30).optional(),
    channel: z.enum(['email', 'call', 'linkedin']),
    label: z.string().optional(),
    subject: z.string().optional().describe('Email subject stored on this sequence step. Required when the user is editing copy.'),
    body: z
      .string()
      .optional()
      .describe('Email body, LinkedIn note, or call talk track stored on this sequence step. When the user edits copy, pass the rewritten text here.'),
    mode: z.enum(['manual', 'auto']).optional(),
    contactIds: z
      .array(z.string())
      .optional()
      .describe(
        'Only these people get this step. Contact ids or exact names. Omit to leave the current audience. Pass [] to put the step back on everyone.'
      )
  })

  const ImportListInput = z.object({
    summary: Summary,
    workspace: z
      .string()
      .min(1)
      .describe(
        'What to build, plus the people as a markdown table, CSV, or JSON with columns Name, Company, Title, Email, LinkedIn. Do not pass a contacts array.'
      )
  })
  const DeployToolInput = z.object({
    summary: Summary,
    workspace: z
      .string()
      .min(1)
      .describe(
        'What to build: outbound dialer, sequencer, cadence, etc. To ingest a list, include a markdown table, CSV, or JSON (Name, Company, Title, Email, LinkedIn). Omit the table only to hydrate HubSpot/Railway.'
      )
  })
  const AddContactsInput = z.object({
    summary: Summary,
    workspaceId: z.string().describe('The workspace to add people to'),
    people: z
      .string()
      .min(1)
      .describe('People as a markdown table, CSV, or JSON (Name, Company, Title, Email, LinkedIn).')
  })

  async function execDeploy(prompt: string, contacts: unknown, spec: unknown) {
    if (isAdminReportAsk(prompt)) {
      return fail(
        'This is a report, not a cadence. Call show_admin once. For last quarter pass range quarter and focus reps. Do not create a workspace.'
      )
    }
    const parsed = parseDeployContacts(contacts)
    if (!parsed.ok) return fail(parsed.error)
    const pipeline = isPriorityPipelinePrompt(prompt)
    const result = await deployPublicTool(
      store,
      config,
      actor.orgId,
      prompt,
      parsed.contacts,
      spec,
      { enroll: pipeline, billing }
    )
    if (!result.ok) return fail(result.body.error)
    return ok(result.body)
  }

  async function execImportList(workspace: string) {
    const contacts = extractContactsFromPrompt(workspace)
    if (!contacts?.length) {
      return fail(
        'Put the people in workspace as a markdown table, CSV, or JSON (Name, Company, Title, Email, LinkedIn).'
      )
    }
    return execDeploy(workspace, contacts, undefined)
  }

  async function execAddContacts(projectId: string, contacts: unknown) {
    const parsed = parseRequiredContacts(contacts)
    if (!parsed.ok) return fail(parsed.error)
    const result = await addPublicContactsAndEnroll(store, config, actor.orgId, projectId, parsed.contacts)
    if (!result.ok) return fail(result.error)
    return ok(result)
  }

  async function execAddPeople(projectId: string, people: string) {
    const contacts = extractContactsFromPrompt(people)
    if (!contacts?.length) {
      return fail('Put the people as a markdown table (Name | Company | Title | Email | LinkedIn).')
    }
    return execAddContacts(projectId, contacts)
  }

  server.registerTool(
    'import_list',
    {
      ...display('Add these people to an outbound list', HINTS.write),
      description:
        'Ingest people and build the cadence structure. summary is the sentence on Claude\'s Allow card. Put people in workspace as a markdown table, CSV, or JSON. State the goal, audience, and any step count / day span (e.g. "5 touchpoints over 14 days" or "7 steps over 10 days") — Jargon builds the ladder; do not write the full day-by-day sequence in chat. Does not open a workspace. Do not call get_sequence, show_email_workspace, or show_tasks to preview the template. Research each company/prospect next, then call save_research once; that enrolls everyone and opens the one workspace, with personalized copy. Do not share a web workspace URL.',
      inputSchema: ImportListInput
    },
    async ({ workspace }) => execImportList(workspace)
  )

  server.registerTool(
    'run_import_list',
    {
      ...display('Add these people to an outbound list', HINTS.write),
      description: 'Execute an import from the in-chat workspace. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: ImportListInput.omit({ summary: true })
    },
    async ({ workspace }) => execImportList(workspace)
  )

  server.registerTool(
    'deploy_tool',
    {
      ...display('Set up a new outbound workspace', HINTS.write),
      description:
        'Create a new outbound workspace (structure only). Do not call this to edit a sequence that already exists — call update_sequence on that projectId, with subject and body set to the rewritten copy. Do not call this for a report, rep drilldown, or last quarter — call show_admin. summary is the sentence on Claude\'s Allow card. State goal, audience, channels, and any step count / day span in workspace — Jargon owns the cadence ladder; do not outline Day 0…N in chat. Include a markdown table, CSV, or JSON to ingest a list, or omit it to hydrate Railway, Postgres, or HubSpot. Only people with an email, phone, or LinkedIn URL are kept. Does not open the workspace — follow nextAction. Do not call get_sequence, show_email_workspace, or show_tasks to preview the template sequence. If nextAction says enrichment is still writing, wait and call list_crm_contacts again; do not save_research on empty people. When contacts are ready, research each from its fields (context and attrs from the source), then save_research. That enrolls everyone and opens the one workspace. Exception: a priority pipeline (for example "build a priority pipeline for this week") is the sentence alone, no table. Then call show_tasks once — that is the only workspace to open. Do not save_research. Do not share a web workspace URL — work stays in Claude.',
      inputSchema: DeployToolInput
    },
    async ({ workspace }) => execDeploy(workspace, extractContactsFromPrompt(workspace), undefined)
  )

  server.registerTool(
    'run_deploy_tool',
    {
      ...display('Set up a new outbound workspace', HINTS.write),
      description: 'Execute a deploy from the in-chat workspace. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: DeployToolInput.omit({ summary: true })
    },
    async ({ workspace }) => execDeploy(workspace, extractContactsFromPrompt(workspace), undefined)
  )

  server.registerTool(
    'add_contacts',
    {
      ...display('Add more people to an existing list', HINTS.write),
      description:
        'Append people to a workspace. summary is the sentence on Claude\'s Allow card. Put people as a markdown table — never as a contacts array.',
      inputSchema: AddContactsInput
    },
    async ({ workspaceId, people }) => execAddPeople(workspaceId, people)
  )

  server.registerTool(
    'run_add_contacts',
    {
      ...display('Add more people to an existing list', HINTS.write),
      description: 'Execute an add from the in-chat workspace. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({
        projectId: z.string(),
        contacts: z.array(ContactInput).min(1).max(100)
      })
    },
    async ({ projectId, contacts }) => execAddContacts(projectId, contacts)
  )

  server.registerTool(
    'list_contacts',
    {
      ...display('List the people in a workspace', HINTS.read),
      description:
        'List contacts in one workspace. Each contact includes priority.rank, priority.motion (inbound or outbound), and priority.signals. Sorted best-first.',
      inputSchema: z.object({
        projectId: z.string(),
        status: ContactStatus.optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      })
    },
    async ({ projectId, ...query }) => {
      if (!findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      const listed = listPublicContacts(store, projectId, query)
      const contacts = listed.contacts.filter(isPriorityContact)
      return ok({ ...listed, contacts: rankLeads(contacts, leadIdentity), total: contacts.length })
    }
  )

  server.registerTool(
    'queue_next',
    {
      ...display('Show the next person in the queue', HINTS.read),
      description: 'Next actionable contact plus current step template.',
      inputSchema: z.object({ projectId: z.string() })
    },
    async ({ projectId }) => {
      if (!findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      const next = nextQueueContact(store.db, projectId)
      const project = findOrgProject(store, actor.orgId, projectId)
      return ok(next ? toPublicQueueNext(next, project?.fieldCatalog) : emptyQueue())
    }
  )

  const SendMessageInput = z.object({
    summary: Summary,
    contactId: z.string(),
    body: z.string(),
    channel: z.enum(['email', 'linkedin']).optional(),
    status: z.enum(['draft', 'queued', 'sent']).optional(),
    subject: z.string().optional(),
    sendAt: z.union([z.number(), z.string()]).optional().describe('Required if status is queued. Unix ms or ISO date.')
  })
  const StartCallInput = z.object({
    summary: Summary,
    contactId: z.string(),
    to: z.string().optional().describe('Number to dial. Overrides the contact phone, including when the contact has none.'),
    stepId: z.string().optional().describe('Sequence step this call completes. Omit for an ad-hoc dial.')
  })
  const CompleteCallInput = z.object({
    summary: Summary,
    callId: z.string(),
    disposition: ContactStatus
  })
  const DispositionInput = z.object({
    summary: Summary,
    contactId: z.string(),
    status: ContactStatus,
    note: z.string().optional(),
    advanceStep: z.boolean().optional(),
    channel: z.enum(['email', 'call', 'linkedin']).optional()
  })
  const AddNoteInput = z.object({
    summary: Summary,
    contactId: z.string(),
    note: z.string().min(1)
  })

  async function execSendMessage(input: {
    contactId: string
    body: string
    channel?: 'email' | 'linkedin'
    status?: 'draft' | 'queued' | 'sent'
    subject?: string
    sendAt?: number | string
  }) {
    const contact = findOrgContact(store, actor.orgId, input.contactId)
    if (!contact) return fail('Contact not found')
    const sendAt =
      typeof input.sendAt === 'number'
        ? input.sendAt
        : typeof input.sendAt === 'string'
          ? Date.parse(input.sendAt)
          : undefined
    if (input.status === 'queued' && !Number.isFinite(sendAt)) {
      return fail('sendAt is required when status is queued (unix ms or ISO date)')
    }
    const status = input.status ?? 'draft'
    const willSend = status === 'sent'
    const billableReason = input.channel === 'linkedin' ? 'linkedin' : 'email'
    let charge: Awaited<ReturnType<typeof chargeIfLive>> | null = null
    if (willSend) {
      charge = await chargeIfLive(billing, {
        orgId: actor.orgId,
        sandbox,
        reason: billableReason,
        projectId: contact.projectId
      })
      if (!charge.ok) return failCharge(charge)
    }
    const result = await sendPublicMessage(store, config, contact, {
      subject: input.subject,
      body: input.body,
      channel: input.channel,
      status,
      sandbox,
      sendAt: Number.isFinite(sendAt) ? sendAt : undefined,
      userId: actor.userId
    })
    if (!result.ok) {
      if (charge?.ok && charge.creditsUsed > 0) {
        await refundCredits(billing, actor.orgId, charge.creditsUsed, 'refund')
      }
      return fail(result.body.error)
    }
    return ok(
      charge?.ok
        ? { ...result.body, creditsUsed: charge.creditsUsed, creditsRemaining: charge.remaining }
        : result.body
    )
  }

  async function execStartCall(contactId: string, to?: string, stepId?: string) {
    const contact = findOrgContact(store, actor.orgId, contactId)
    if (!contact) return fail('Contact not found')
    if (!toE164(to || contact.phone || '')) return fail('Enter a valid phone number.')
    if (!sandbox) {
      const live = inspectLiveVoice(config)
      if (!live.ok) return fail(live.error)
    }
    const charge = await chargeIfLive(billing, {
      orgId: actor.orgId,
      sandbox,
      reason: 'call',
      projectId: contact.projectId
    })
    if (!charge.ok) return failCharge(charge)
    try {
      return ok({
        call: startPublicCall(store, config, contact, sandbox, to, actor.userId, stepId),
        creditsUsed: charge.creditsUsed,
        creditsRemaining: charge.remaining
      })
    } catch (err) {
      if (charge.creditsUsed > 0) {
        await refundCredits(billing, actor.orgId, charge.creditsUsed, 'refund')
      }
      return fail(err)
    }
  }

  async function execVoiceToken() {
    if (sandbox) return fail('Calling is not available for this session.')
    const identity = `user_${actor.userId}`.replace(/[^A-Za-z0-9_-]/g, '_')
    try {
      return ok(
        await createVoiceToken(config, identity, {
          store,
          orgId: actor.orgId
        })
      )
    } catch (err) {
      return fail(err)
    }
  }

  async function execReportCallProgress(callId: string, phase: 'ringing' | 'connected' | 'failed') {
    const call = findOrgCall(store, actor.orgId, callId)
    if (!call) return fail('Call not found')
    const next = reportPublicCallProgress(store, actor.orgId, callId, phase)
    if (!next) return fail('Call not found')
    return ok({ call: next })
  }

  server.registerTool(
    'send_message',
    {
      ...display('Send an email or LinkedIn message', HINTS.send),
      description:
        'Send or draft one email or LinkedIn message. summary is the sentence on Claude\'s Allow card. Omitting status saves a draft and does not send. Pass status sent only when the user asks to send that one message now. Do not use this to deliver a list that was just added. Auto-send is the user\'s switch on the email step, not this tool. A live send spends credits.',
      inputSchema: SendMessageInput
    },
    async (input) => execSendMessage(input)
  )

  server.registerTool(
    'run_send_message',
    {
      ...display('Send an email or LinkedIn message', HINTS.send),
      description: 'Execute a confirmed send. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: SendMessageInput.omit({ summary: true })
    },
    async (input) => execSendMessage(input)
  )

  server.registerTool(
    'start_call',
    {
      ...display('Start a call', HINTS.send),
      description:
        'Start a call in the in-chat dialer. summary is the sentence on Claude\'s Allow card. Live login places a real call and spends credits. Do not send the user to the web dashboard to dial.',
      inputSchema: StartCallInput
    },
    async ({ contactId, to, stepId }) => execStartCall(contactId, to, stepId)
  )

  server.registerTool(
    'run_start_call',
    {
      ...display('Start a call', HINTS.send),
      description: 'Execute a confirmed dial. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: StartCallInput.omit({ summary: true })
    },
    async ({ contactId, to, stepId }) => execStartCall(contactId, to, stepId)
  )

  server.registerTool(
    'run_voice_token',
    {
      ...display('Issue calling credentials', HINTS.read),
      description: 'Issue Plivo softphone credentials for the in-chat dialer. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({})
    },
    async () => execVoiceToken()
  )

  server.registerTool(
    'run_report_call_progress',
    {
      ...display('Update call progress', HINTS.write),
      description: 'Update an open call phase from the in-chat dialer. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({
        callId: z.string(),
        phase: z.enum(['ringing', 'connected', 'failed'])
      })
    },
    async ({ callId, phase }) => execReportCallProgress(callId, phase)
  )

  server.registerTool(
    'complete_call',
    {
      ...display('Log how a call ended', HINTS.write),
      description: 'Complete an open call with a disposition. summary is the sentence on Claude\'s Allow card.',
      inputSchema: CompleteCallInput
    },
    async ({ callId, disposition }) => {
      if (!isContactStatus(disposition)) return fail('invalid disposition')
      const call = findOrgCall(store, actor.orgId, callId)
      if (!call) return fail('Call not found')
      return ok(completePublicCall(store, call.id, disposition, config))
    }
  )

  server.registerTool(
    'run_complete_call',
    {
      ...display('Log how a call ended', HINTS.write),
      description: 'Execute a confirmed call log. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: CompleteCallInput.omit({ summary: true })
    },
    async ({ callId, disposition }) => {
      if (!isContactStatus(disposition)) return fail('invalid disposition')
      const call = findOrgCall(store, actor.orgId, callId)
      if (!call) return fail('Call not found')
      return ok(completePublicCall(store, call.id, disposition, config))
    }
  )

  server.registerTool(
    'disposition',
    {
      ...display('Log an outcome on a contact', HINTS.write),
      description: 'Log an outcome without an open call. summary is the sentence on Claude\'s Allow card.',
      inputSchema: DispositionInput
    },
    async ({ contactId, status, note, advanceStep, channel }) => {
      if (!isContactStatus(status)) return fail('invalid status')
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return ok(applyDisposition(store, contact.id, { status, note, advanceStep, channel, userId: actor.userId }))
    }
  )

  server.registerTool(
    'run_disposition',
    {
      ...display('Log an outcome on a contact', HINTS.write),
      description: 'Execute a confirmed disposition. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: DispositionInput.omit({ summary: true })
    },
    async ({ contactId, status, note, advanceStep, channel }) => {
      if (!isContactStatus(status)) return fail('invalid status')
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return ok(applyDisposition(store, contact.id, { status, note, advanceStep, channel, userId: actor.userId }))
    }
  )

  server.registerTool(
    'add_note',
    {
      ...display('Add a note to a contact', HINTS.write),
      description: 'Append a note to a contact. summary is the sentence on Claude\'s Allow card.',
      inputSchema: AddNoteInput
    },
    async ({ contactId, note }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return ok({ contact: addPublicNote(store, contact.id, note) })
    }
  )

  server.registerTool(
    'upsert_enrichment',
    {
      ...display('Add enrichment to people', HINTS.write),
      description:
        'Merge researched or enriched fields onto people already in Jargon. summary is the sentence on Claude\'s Allow card. rows is a markdown table, CSV, or JSON with one row per person, keyed by email, LinkedIn URL, CRM id, or contactId, plus any fields (e.g. intent_topics, funding_stage, technologies, phone). Extra fields become attrs; blank email/phone/title are filled; context lines are appended. Use this when nextAction or missingFields says people are missing requested fields — people who now have every requested field are enrolled automatically. Only send values from a real source; never guess.',
      inputSchema: z.object({
        summary: Summary,
        projectId: z.string().optional().describe('Limit matching to one workspace'),
        rows: z.string().min(1).describe('One row per person: a key column (email, LinkedIn, CRM id, or contactId) plus the fields to add.')
      })
    },
    async ({ projectId, rows }) => {
      if (projectId && !findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      const records = extractRecordsFromText(rows)
      if (!records?.length) return fail('rows must include a key column (email, LinkedIn URL, CRM id, or contactId) and at least one person')
      return ok(await upsertEnrichment(store, config, actor.orgId, records, { projectId, sandbox }))
    }
  )

  server.registerTool(
    'run_add_note',
    {
      ...display('Add a note to a contact', HINTS.write),
      description: 'Execute a confirmed note. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: AddNoteInput.omit({ summary: true })
    },
    async ({ contactId, note }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return ok({ contact: addPublicNote(store, contact.id, note) })
    }
  )

  server.registerTool(
    'get_sequence',
    {
      ...display('Read the cadence steps', HINTS.read),
      description:
        'Read cadence steps as JSON, including subject and body. Those fields are the sequence copy. Does not open a workspace. When the user edits copy or the ladder does not match, call update_sequence on this same projectId with the rewritten subject and body. Do not call deploy_tool or import_list to edit an existing sequence — that creates a second one. Do not call this to display the template sequence.',
      inputSchema: z.object({ projectId: z.string() })
    },
    async ({ projectId }) => {
      const sequence = getPublicSequence(store, actor.orgId, projectId)
      if (!sequence) return fail('Project not found')
      return ok(sequence)
    }
  )

  server.registerTool(
    'show_email_workspace',
    {
      ...display('Open your outbound workspace', HINTS.read),
      description:
        'Reopen an outbound workspace that already has personalized copy. Call only when the user asks to see existing work. Do not call it during a build, after deploy_tool or import_list, before save_research, or in the same turn as save_research. save_research is the one workspace a build displays. Do not use this to show the template sequence.',
      inputSchema: z.object({ projectId: z.string() }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox, undefined, actor.userId)
  )

  server.registerTool(
    'show_tasks',
    {
      ...display("Show what's due today", HINTS.read),
      description:
        'Open Tasks in Claude: every sequence step due for enrolled contacts, in due order. The user clicks through them — send, skip, reschedule, log a call, send LinkedIn. Call this once when they ask what is due, or once after a priority-pipeline deploy. Do not call it to preview a template cadence, and do not call it in the same turn as save_research — that already opened the workspace.',
      inputSchema: z.object({ projectId: z.string() }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks', actor.userId)
  )

  server.registerTool(
    'show_admin',
    {
      ...display('Rep drilldown', HINTS.read),
      description:
        'This is the reporting tool. Open the rep drilldown in Claude: meetings, calls, connects, emails, and replies for the whole account. Call this once when the user asks how the team performed, for a rep productivity drilldown, which sequence booked meetings, productivity by sales territory, the highest converting message in a territory, or results over a period such as last quarter. Pass range quarter for last quarter (the previous calendar quarter), or 7d, 30d, or 90d. If they do not name a window, pass 30d. Pass focus reps for a productivity drilldown, sequences for a breakdown by sequence, meetings for meetings booked, or territories for territory productivity and the winning message in each territory. The app shows the numbers. Summarize the summary field in one sentence. Do not paste the table. Do not call deploy_tool, list_projects, show_tasks, list_tasks, or get_usage for this.',
      inputSchema: z.object({
        range: z
          .enum(['7d', '30d', '90d', 'quarter'])
          .optional()
          .describe('quarter is the previous calendar quarter. Use it for "last quarter".'),
        start: z.string().optional().describe('ISO start. Pass with end instead of range.'),
        end: z.string().optional().describe('ISO end, or YYYY-MM-DD inclusive.'),
        focus: z
          .enum(['reps', 'sequences', 'meetings', 'territories'])
          .optional()
          .describe('reps, sequences, meetings, or territories. Defaults to reps.')
      }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ range, start, end, focus }) => {
      const built = buildAdminReport(store, actor.orgId, {
        range: range as AdminRange | undefined,
        start,
        end,
        focus: focus as AdminFocus | undefined
      })
      if (!built.ok) return fail(built.error)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(built.report, null, 2) }],
        structuredContent: built.report,
        _meta: EMAIL_WORKSPACE_TOOL_META
      }
    }
  )

  server.registerTool(
    'list_tasks',
    {
      ...display("List what's due", HINTS.read),
      description:
        'Sequence steps due for enrolled contacts, as JSON. Use to answer questions about workload; use show_tasks when the user wants to work them.',
      inputSchema: z.object({
        projectId: z.string(),
        bucket: z
          .enum(['open', 'overdue', 'today', 'upcoming', 'done', 'skipped', 'all'])
          .optional()
          .describe('Defaults to open — overdue plus due today.'),
        contactId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional()
      })
    },
    async ({ projectId, bucket, contactId, limit }) => {
      const ws = getEmailWorkspace(store, config, actor.orgId, projectId, { sandbox, userId: actor.userId })
      if (!ws) return fail('Project not found')
      const want = bucket ?? 'open'
      const tasks = ws.tasks.filter((task) => {
        if (contactId && task.contactId !== contactId) return false
        if (want === 'all') return true
        if (want === 'open') return task.bucket === 'overdue' || task.bucket === 'today'
        return task.bucket === want
      })
      return ok({
        projectId: ws.projectId,
        name: ws.name,
        stats: ws.taskStats,
        tasks: tasks.slice(0, limit ?? 50).map((task) => ({
          id: task.id,
          contactId: task.contactId,
          contact: task.contactName,
          company: task.contactMeta,
          channel: task.channel,
          step: task.stepLabel,
          day: task.day,
          dueAt: new Date(task.dueAt).toISOString(),
          state: task.state,
          bucket: task.bucket,
          subject: task.subject,
          reason: task.reason
        })),
        total: tasks.length
      })
    }
  )

  server.registerTool(
    'load_email_workspace',
    {
      ...display('Load email workspace', HINTS.read),
      description: 'Reload email workspace data for the in-chat UI. Not for the model.',
      inputSchema: z.object({ projectId: z.string() }),
      _meta: { ui: { visibility: ['app'] } }
    },
    async ({ projectId }) =>
      workspaceOk(store, config, actor.orgId, projectId, sandbox, undefined, actor.userId, { embed: false })
  )

  const UpdateSequenceInput = z.object({
    summary: Summary,
    projectId: z.string(),
    goal: z.string().optional(),
    steps: z.array(SpecStep).min(1).max(8)
  })
  const StartSequenceInput = z.object({
    summary: Summary,
    projectId: z.string(),
    startAt: z
      .union([z.number(), z.string()])
      .optional()
      .describe('When day 0 should send. Unix ms or ISO date. Defaults to now.'),
    contactIds: z.array(z.string()).optional().describe('Limit to these contacts. Defaults to everyone in the workspace.')
  })
  const SaveDraftInput = z.object({
    summary: Summary,
    contactId: z.string(),
    body: z.string(),
    subject: z.string().optional(),
    channel: z.enum(['email', 'linkedin', 'call']).optional(),
    stepId: z
      .string()
      .optional()
      .describe('Sequence step to bind this copy to. Pass this when writing a follow-up, not only the first email.'),
    day: z
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .describe('Alternative to stepId: the cadence day this copy belongs to.')
  })
  const SaveResearchInput = z.object({
    summary: Summary,
    projectId: z.string(),
    research: z
      .string()
      .min(1)
      .describe(
        'JSON array of researched copy. Each item: {contactId, channel: email|linkedin|call, body, subject?, stepId?, context?: string[]}. Call channel body is the talk track. One Allow card for the whole list.'
      )
  })
  const UpdateDraftInput = z.object({
    summary: Summary,
    messageId: z.string(),
    subject: z.string().optional(),
    body: z.string().optional(),
    sendAt: z.union([z.number(), z.string()]).optional(),
    status: z.enum(['draft', 'queued']).optional()
  })
  const SendDraftInput = z.object({ summary: Summary, messageId: z.string() })

  function stripSendMode(steps: unknown): unknown {
    if (!Array.isArray(steps)) return steps
    return steps.map((step) => {
      if (!step || typeof step !== 'object') return step
      const { mode: _mode, ...rest } = step as { mode?: unknown }
      return rest
    })
  }

  async function execUpdateSequence(
    projectId: string,
    goal: string | undefined,
    steps: unknown,
    opts?: { fromApp?: boolean }
  ) {
    const saved = opts?.fromApp ? steps : stripSendMode(steps)
    const result = updatePublicSequence(store, actor.orgId, projectId, { goal, steps: saved })
    if (!result.ok) return fail(result.error)
    return ok(result.sequence)
  }

  function enrolledOk(projectId: string, result: { enrolled: number; listed: number; skipped: number }) {
    const ws = getEmailWorkspace(store, config, actor.orgId, projectId, { sandbox, userId: actor.userId })
    if (ws && !ws.researchPending) {
      const opened = noteOpened(
        workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks', actor.userId)
      )
      if (opened && 'content' in opened && opened.content?.[0] && !('isError' in opened)) {
        try {
          const brief = JSON.parse(opened.content[0].text) as Record<string, unknown>
          brief.enrolled = result.enrolled
          brief.listed = result.listed
          brief.skipped = result.skipped
          opened.content[0].text = JSON.stringify(brief, null, 2)
        } catch {
          /* counts stay out of the brief */
        }
      }
      return opened
    }
    return ok({
      display: false,
      projectId,
      enrolled: result.enrolled,
      listed: result.listed,
      skipped: result.skipped,
      nextAction:
        'This did not open a workspace. These people still need personalized copy. Call save_research and do not call show_email_workspace or show_tasks. save_research opens the one workspace.'
    })
  }

  async function execStartSequence(
    projectId: string,
    startAt?: number | string,
    contactIds?: string[],
    opts?: { forApp?: boolean }
  ) {
    const project = findOrgProject(store, actor.orgId, projectId)
    if (!project) return fail('Project not found')
    if (!isPriorityPipelinePrompt(project.prompt || '')) {
      const unresearched = store.db.contacts.filter(
        (c) => c.projectId === projectId && (!contactIds?.length || contactIds.includes(c.id)) && !c.enrichedAt
      )
      if (unresearched.length) {
        return fail(
          `${unresearched.length} of these people do not have personalized copy yet. Write their talk tracks, email copy, and LinkedIn notes from each contact's fields, then call save_research for project ${projectId} — that enrolls them. Do not start the sequence on template copy.`
        )
      }
    }
    const parsedStart =
      typeof startAt === 'number' ? startAt : typeof startAt === 'string' ? Date.parse(startAt) : undefined
    const result = await enrollPublicSequence(store, config, actor.orgId, projectId, {
      startAt: Number.isFinite(parsedStart) ? parsedStart : undefined,
      contactIds,
      sandbox
    })
    if (!result.ok) return fail(result.error)
    if (opts?.forApp) {
      return workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks', actor.userId, { embed: false })
    }
    return noteOpened(workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks', actor.userId))
  }

  async function execSaveDraft(
    contactId: string,
    body: string,
    subject?: string,
    channel?: 'email' | 'linkedin' | 'call',
    stepId?: string,
    day?: number
  ) {
    if (channel === 'call') {
      const result = savePublicTalkTrack(store, actor.orgId, contactId, { body, stepId })
      if (!result.ok) return fail(result.error)
      return ok({ contact: result.contact })
    }
    const result = await upsertPublicDraft(store, config, actor.orgId, contactId, {
      subject,
      body,
      channel,
      sandbox,
      stepId,
      day
    })
    if (!result.ok) return fail(result.body.error)
    return ok(result.body)
  }

  function parseResearchDrafts(raw: string): { ok: true; drafts: ResearchCopyInput[] } | { ok: false; error: string } {
    const trimmed = raw.trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      const start = trimmed.indexOf('[')
      const end = trimmed.lastIndexOf(']')
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(trimmed.slice(start, end + 1))
        } catch {
          return { ok: false, error: 'research must be a JSON array of {contactId, channel, body, subject?, stepId?, context?}' }
        }
      } else {
        return { ok: false, error: 'research must be a JSON array of {contactId, channel, body, subject?, stepId?, context?}' }
      }
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      return { ok: false, error: 'research must include at least one {contactId, channel, body}' }
    }
    const drafts: ResearchCopyInput[] = []
    for (const [i, row] of parsed.entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, error: `research[${i}] must be an object` }
      }
      const rec = row as Record<string, unknown>
      const contactId = typeof rec.contactId === 'string' ? rec.contactId.trim() : ''
      const body = typeof rec.body === 'string' ? rec.body : ''
      if (!contactId) return { ok: false, error: `research[${i}].contactId is required` }
      if (!body.trim()) return { ok: false, error: `research[${i}].body is required` }
      const channel =
        rec.channel === 'email' || rec.channel === 'linkedin' || rec.channel === 'call'
          ? rec.channel
          : undefined
      const context = Array.isArray(rec.context)
        ? rec.context.filter((line): line is string => typeof line === 'string' && Boolean(line.trim()))
        : undefined
      drafts.push({
        contactId,
        body,
        subject: typeof rec.subject === 'string' ? rec.subject : undefined,
        channel,
        stepId: typeof rec.stepId === 'string' ? rec.stepId : undefined,
        day: typeof rec.day === 'number' ? rec.day : undefined,
        context
      })
    }
    return { ok: true, drafts }
  }

  async function execSaveResearch(projectId: string, research: string) {
    const parsed = parseResearchDrafts(research)
    if (!parsed.ok) return fail(parsed.error)
    const project = findOrgProject(store, actor.orgId, projectId)
    if (!project) return fail('Project not found')
    const enroll = shouldAutoStartSequence({
      prompt: project.prompt || '',
      primarySurface: project.spec?.primarySurface,
      channels: project.spec?.channels,
      steps: project.spec?.steps
    })
    const result = await savePublicResearch(store, config, actor.orgId, projectId, parsed.drafts, {
      sandbox,
      enroll
    })
    if (!result.ok) return fail(result.error)
    return workspaceOk(store, config, actor.orgId, projectId, sandbox, enroll ? 'sequence' : 'contacts', actor.userId)
  }

  async function execUpdateDraft(
    messageId: string,
    subject?: string,
    body?: string,
    sendAt?: number | string,
    status?: 'draft' | 'queued'
  ) {
    const parsedSendAt =
      typeof sendAt === 'number' ? sendAt : typeof sendAt === 'string' ? Date.parse(sendAt) : undefined
    const result = patchPublicMessage(store, actor.orgId, messageId, {
      subject,
      body,
      status,
      sendAt: Number.isFinite(parsedSendAt) ? parsedSendAt : undefined
    })
    if (!result.ok) return fail(result.error)
    return ok({ message: result.message })
  }

  async function execSendDraft(messageId: string) {
    const message = findOrgMessage(store, actor.orgId, messageId)
    if (!message) return fail('Message not found')
    const charge = await chargeIfLive(billing, {
      orgId: actor.orgId,
      sandbox,
      reason: message.channel === 'linkedin' ? 'linkedin' : 'email',
      projectId: message.projectId
    })
    if (!charge.ok) return failCharge(charge)
    const result = await deliverPublicMessage(store, config, actor.orgId, messageId, sandbox, actor.userId)
    if (!result.ok) {
      if (charge.creditsUsed > 0) {
        await refundCredits(billing, actor.orgId, charge.creditsUsed, 'refund')
      }
      return fail(result.body.error)
    }
    return ok({
      ...result.body,
      creditsUsed: charge.creditsUsed,
      creditsRemaining: charge.remaining
    })
  }

  server.registerTool(
    'update_sequence',
    {
      ...display('Rewrite the cadence steps', HINTS.overwrite),
      description:
        'Edit the sequence the user already has. Do not call deploy_tool or import_list for this — those create a second sequence. Use when the ladder does not match, or when they edit copy, subject, body, tone, or a talk track, or when a step should be only for specific people. summary is the sentence on Claude\'s Allow card. Pass every step. subject and body are the sequence copy and are what gets stored. A rewrite that stays in chat is not saved. Do not pass mode. Auto-send is the user\'s switch on the email step. To put a step on specific people — a call for one person, a note for a few — pass contactIds on that step (ids or exact names). Omit contactIds on steps that stay on everyone. Pass contactIds as [] to put a limited step back on everyone. Do not put the person\'s name in the label instead. Per-person copy still goes to save_draft or save_research. Do not re-narrate the ladder in chat after updating.',
      inputSchema: UpdateSequenceInput
    },
    async ({ projectId, goal, steps }) => execUpdateSequence(projectId, goal, steps)
  )

  server.registerTool(
    'run_update_sequence',
    {
      ...display('Rewrite the cadence steps', HINTS.overwrite),
      description: 'Execute a confirmed sequence update. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: UpdateSequenceInput.omit({ summary: true })
    },
    async ({ projectId, goal, steps }) => execUpdateSequence(projectId, goal, steps, { fromApp: true })
  )

  server.registerTool(
    'start_sequence',
    {
      ...display('Start sending the cadence', HINTS.send),
      description:
        'Enroll people who are already in this workspace into the sequence and open it in the chat. Use this when the user says to enroll these people and they are already contacts here, including at the end of a scheduled run. Never call this before save_research has written their copy. Do not also call show_tasks or show_email_workspace. summary is the sentence on Claude\'s Allow card. Pass contactIds to enroll a subset. Enrolling does not send email. Mail stays a draft unless the user has turned Auto-send on for that step. Do not call send_message to deliver a list. Do not tell the user to enroll from the app.',
      inputSchema: StartSequenceInput,
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId, startAt, contactIds }) => execStartSequence(projectId, startAt, contactIds)
  )

  server.registerTool(
    'run_start_sequence',
    {
      ...display('Start sending the cadence', HINTS.send),
      description: 'Execute a confirmed enroll. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: StartSequenceInput.omit({ summary: true })
    },
    async ({ projectId, startAt, contactIds }) => execStartSequence(projectId, startAt, contactIds, { forApp: true })
  )

  server.registerTool(
    'enroll_hubspot',
    {
      ...display('Enroll people from HubSpot', HINTS.send),
      description:
        'Pull people from the connected HubSpot portal into this workspace and onto the sequence. summary is the sentence on Claude\'s Allow card. people is names, emails, or "all". This does not send email. Each email stays a draft unless the user has already turned Auto-send on for that step. Do not call send_message for these people. Do not turn auto-send on. If nextAction / pendingEnrichment says enrichment is still writing those fields, wait and retry — do not save_research on placeholder copy. If you still need personalized copy, this does not open a workspace — call save_research next and do not call show_email_workspace or show_tasks. If copy is already saved, this opens the sequence in the chat. Do not also call show_tasks.',
      inputSchema: z.object({
        summary: Summary,
        projectId: z.string(),
        people: z.string().min(1).describe('Names, emails, "all", or a warmth bucket such as "hot,warm".')
      }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId, people }) => {
      const listed = await listHubSpotContactsForEnroll(store, config, actor.orgId)
      if (!listed.ok) return fail(listed.error)
      if (!listed.connected) return fail('HubSpot is not connected')
      const warmth = parseWarmthFilter(people)
      if (warmth !== 'all') {
        const result = await enrollHubSpotContacts(store, config, actor.orgId, projectId, [], sandbox, warmth)
        if (!result.ok) return fail(result.error)
        return enrolledOk(projectId, result)
      }
      const query = people.trim().toLowerCase()
      const enrollAll = query === 'all' || query === 'everyone'
      const needles = enrollAll
        ? []
        : query.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean)
      const picked = enrollAll
        ? listed.contacts
        : listed.contacts.filter((contact) =>
            needles.some((needle) =>
              contact.name.toLowerCase().includes(needle) ||
              contact.email.toLowerCase().includes(needle) ||
              contact.company.toLowerCase().includes(needle)
            )
          )
      if (!picked.length) return fail('No HubSpot contacts matched')
      const result = await enrollHubSpotContacts(
        store,
        config,
        actor.orgId,
        projectId,
        picked.map((contact) => contact.externalId),
        sandbox
      )
      if (!result.ok) return fail(result.error)
      return enrolledOk(projectId, result)
    }
  )

  server.registerTool(
    'list_crm_contacts',
    {
      ...display('Pull CRM contacts by warmth', HINTS.read),
      description:
        'Pull contacts from the connected HubSpot portal that have an email, phone, or LinkedIn URL. When the workspace has a saved segment (lead status, lifecycle stage, or list), only that slice is returned. Each contact includes priority.rank, priority.motion (inbound or outbound), and priority.signals from HubSpot fields (intent, seniority, hiring, whatever your enrichment tool wrote). Sorted best-first. Does not enroll them. If pendingEnrichment is set, enrichment is still writing contact info — call this again before enroll_hubspot or save_research. Do not regroup by warmth.',
      inputSchema: z.object({
        projectId: z.string().optional().describe('Workspace whose saved segment to apply. Omit to use the latest workspace.')
      })
    },
    async ({ projectId }) => {
      const result = await listHubSpotContactsForEnroll(store, config, actor.orgId, projectId)
      if (!result.ok) return fail(result.error)
      return ok(result)
    }
  )

  server.registerTool(
    'resume_workspace',
    {
      ...display('Resume the saved outbound workspace', HINTS.read),
      description:
        'Read the latest saved workspace as JSON: brief, whether copy is still a template, and what to do next. Does not open a workspace. Do not call this for a rep drilldown, team performance, or last quarter — call show_admin. Otherwise call this first in a new Claude chat, and first on a scheduled run, before import_list or deploy_tool. If the user is building a new sequence, do not open this workspace. If they are continuing work that already has personalized copy, call show_email_workspace or show_tasks once. On a scheduled run, follow nextAction and build the sequence: deploy_tool or import_list, then save_research, which opens it. Do not ask the user.',
      inputSchema: z.object({
        projectId: z.string().optional().describe('Workspace to resume. Omit to read the most recently updated one.')
      })
    },
    async ({ projectId }) => {
      const project = projectId
        ? findOrgProject(store, actor.orgId, projectId)
        : latestWorkspace(store, actor.orgId)
      if (!project) {
        return fail(
          'No saved workspace yet. Call deploy_tool or import_list now — including on a scheduled run. Do not ask the user. save_research then opens the sequence.'
        )
      }
      const brief = project.brief ?? saveWorkspaceBrief(store, actor.orgId, project.id)
      const ws = getEmailWorkspace(store, config, actor.orgId, project.id, { sandbox, userId: actor.userId })
      if (!ws) return fail('Project not found')
      return ok({
        projectId: project.id,
        name: ws.name,
        contactCount: ws.contactCount,
        researchPending: ws.researchPending,
        enrolled: ws.taskStats.enrolled,
        brief,
        nextAction: ws.researchPending
          ? 'Copy is still the template. Do not open a workspace. Finish personalization with save_research now, including on a scheduled run — that opens the one workspace. Do not ask the user. Do not wait.'
          : project.brief?.unattended === 'accepted' || project.brief?.scheduleChoice === 'accepted'
            ? 'This workspace is on a schedule. Refresh it now. New people whose copy is saved: call enroll_hubspot, which opens the sequence. People still on the template: call save_research, which opens the sequence. Do not ask the user. Do not create a second workspace. Do not finish on a text summary. If nothing is left to build, call show_tasks once.'
            : 'This did not open a workspace. If the user is continuing this one, call show_email_workspace once. If they asked to build a new sequence, or this is a scheduled run building one, do not open this one — deploy_tool or import_list, then save_research.'
      })
    }
  )

  server.registerTool(
    'note_schedule_choice',
    {
      ...display('Remember the schedule answer', HINTS.write),
      description:
        'Record whether the user allowed Jargon to run this workspace on its own. accepted is the one grant: Jargon pulls the segment, enrolls the agent lane, and promotes ready people with no further prompt. declined means they said no. Also pass the segment they named. This does not create the Claude task. That task, after they confirm with Schedule, builds the sequence itself with the Jargon connector: resume_workspace, deploy_tool or import_list when needed, then save_research, which opens it.',
      inputSchema: z.object({
        summary: Summary,
        projectId: z.string(),
        choice: z.enum(['accepted', 'declined']),
        cadence: z.string().optional().describe('The cadence they approved, such as "every Sunday at 6pm".'),
        leadStatus: z.string().optional().describe('HubSpot lead status to work, such as Disqualified.'),
        lifecycleStage: z.string().optional().describe('HubSpot lifecycle stage to work.'),
        listId: z.string().optional().describe('HubSpot list id to work.')
      })
    },
    async ({ projectId, choice, cadence, leadStatus, lifecycleStage, listId }) => {
      if (!findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      const segment =
        leadStatus?.trim() || lifecycleStage?.trim() || listId?.trim()
          ? {
              leadStatus: leadStatus?.trim() || undefined,
              lifecycleStage: lifecycleStage?.trim() || undefined,
              listId: listId?.trim() || undefined
            }
          : undefined
      const brief = saveWorkspaceBrief(store, actor.orgId, projectId, {
        scheduleChoice: choice,
        cadence,
        unattended: choice,
        nextAgentRunAt: choice === 'accepted' ? Date.now() : undefined,
        ...(segment ? { segment } : {})
      })
      if (!brief) return fail('Project not found')
      return ok({ brief })
    }
  )

  server.registerTool(
    'promote_to_rep',
    {
      ...display('Queue people for a rep', HINTS.write),
      description:
        'Move people off the agent lane and onto the rep queue in this workspace. summary is the sentence on Claude\'s Allow card. Use this when someone the agent worked is ready for a human. Does not open a workspace. Call show_tasks once afterward if the user is in the chat.',
      inputSchema: z.object({
        summary: Summary,
        contactIds: z.string().describe('Contact ids, separated by commas or newlines.')
      })
    },
    async ({ contactIds }) => {
      const ids = contactIds.split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean)
      const result = promoteToRep(store, actor.orgId, ids)
      if (!result.ok) return fail(result.error)
      return ok(result)
    }
  )

  server.registerTool(
    'book_meeting',
    {
      ...display('Send a calendar invite', HINTS.send),
      description:
        'Create a calendar event on the connected Gmail or Outlook mailbox and email the invite to the contact. summary is the sentence on Claude\'s Allow card. start is an ISO date. This stops the sequence for that person and logs the meeting.',
      inputSchema: z.object({
        summary: Summary,
        contactId: z.string(),
        start: z.string().describe('ISO 8601 start, such as 2026-10-14T18:00:00Z'),
        durationMinutes: z.number().int().min(15).max(240).optional(),
        title: z.string().max(200).optional(),
        note: z.string().max(2000).optional()
      })
    },
    async ({ contactId, start, durationMinutes, title, note }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      const result = await bookPublicMeeting(store, config, contact, {
        start,
        durationMinutes,
        title,
        note,
        userId: actor.userId
      })
      if (!result.ok) return fail(result.error)
      return ok(result)
    }
  )

  server.registerTool(
    'run_list_hubspot_contacts',
    {
      ...display('List HubSpot contacts', HINTS.read),
      description: 'Contacts available to enroll from the connected HubSpot portal. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({ projectId: z.string() })
    },
    async () => {
      const result = await listHubSpotContactsForEnroll(store, config, actor.orgId)
      if (!result.ok) return fail(result.error)
      return ok(result)
    }
  )

  server.registerTool(
    'run_enroll_hubspot',
    {
      ...display('Enroll HubSpot contacts', HINTS.send),
      description: 'Add the selected HubSpot contacts to this workspace. Does not enroll them and does not send email. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({
        projectId: z.string(),
        externalIds: z.array(z.string()).min(1).max(100)
      })
    },
    async ({ projectId, externalIds }) => {
      const result = await enrollHubSpotContacts(store, config, actor.orgId, projectId, externalIds, sandbox)
      if (!result.ok) return fail(result.error)
      return workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks', actor.userId)
    }
  )

  server.registerTool(
    'run_set_step_mode',
    {
      ...display('Set email auto-send', HINTS.write),
      description: 'Turn auto-send on or off for one email step. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({
        projectId: z.string(),
        stepId: z.string(),
        mode: z.enum(['manual', 'auto'])
      })
    },
    async ({ projectId, stepId, mode }) => {
      const result = setStepSendMode(store, actor.orgId, projectId, stepId, mode)
      if (!result.ok) return fail(result.error)
      return workspaceOk(store, config, actor.orgId, projectId, sandbox, 'sequence', actor.userId)
    }
  )

  server.registerTool(
    'run_unenroll_contact',
    {
      ...display('Unenroll a contact', HINTS.write),
      description: 'Stop remaining cadence steps for one contact. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({ contactId: z.string() })
    },
    async ({ contactId }) => {
      const result = unenrollPublicContact(store, actor.orgId, contactId)
      if (!result.ok) return fail(result.error)
      return workspaceOk(store, config, actor.orgId, result.contact.projectId, sandbox, undefined, actor.userId)
    }
  )

  server.registerTool(
    'run_skip_task',
    {
      ...display('Skip this task', HINTS.write),
      description: 'Skip one sequence step for one contact. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: z.object({ contactId: z.string(), stepId: z.string() })
    },
    async ({ contactId, stepId }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      const result = skipPublicTask(store, actor.orgId, contactId, stepId)
      if (!result.ok) return fail(result.error)
      return workspaceOk(store, config, actor.orgId, contact.projectId, sandbox, 'tasks', actor.userId)
    }
  )

  server.registerTool(
    'save_draft',
    {
      ...display('Save a draft message', HINTS.write),
      description:
        'Save researched, personalized copy for one contact. summary is the sentence on Claude\'s Allow card. Use channel call for a talk track, email/linkedin for send copy. Write from the contact\'s fields (context and attrs) — do not invent enrichment. Prefer save_research to write the whole list in one Allow. Pass stepId or day for follow-ups.',
      inputSchema: SaveDraftInput
    },
    async ({ contactId, body, subject, channel, stepId, day }) =>
      execSaveDraft(contactId, body, subject, channel, stepId, day)
  )

  server.registerTool(
    'save_research',
    {
      ...display('Save researched copy for the list', HINTS.write),
      description:
        'Required after import_list / deploy_tool. Write personalized talk tracks, email copy, and LinkedIn notes from each contact\'s fields (context and attrs from its source) — this enrolls the cadence and opens the one workspace for the build. Do not also call show_email_workspace or show_tasks. Do not invent funding, hiring, or tenure. summary is the sentence on Claude\'s Allow card. research is a JSON array string — pass it only as the tool argument, never paste it into chat. Do not leave {{first_name}} placeholders as the send copy.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: SaveResearchInput
    },
    async ({ projectId, research }) => execSaveResearch(projectId, research)
  )

  server.registerTool(
    'run_save_research',
    {
      ...display('Save researched copy for the list', HINTS.write),
      description: 'Execute a confirmed research save. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: SaveResearchInput.omit({ summary: true })
    },
    async ({ projectId, research }) => execSaveResearch(projectId, research)
  )

  server.registerTool(
    'run_save_draft',
    {
      ...display('Save a draft message', HINTS.write),
      description: 'Execute a confirmed draft save. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: SaveDraftInput.omit({ summary: true })
    },
    async ({ contactId, body, subject, channel, stepId, day }) =>
      execSaveDraft(contactId, body, subject, channel, stepId, day)
  )

  server.registerTool(
    'list_drafts',
    {
      ...display('List saved drafts', HINTS.read),
      description: 'List draft or queued messages in a workspace.',
      inputSchema: z.object({
        projectId: z.string(),
        contactId: z.string().optional(),
        status: z.enum(['draft', 'queued', 'sent', 'failed', 'cancelled']).optional()
      })
    },
    async ({ projectId, contactId, status }) => {
      if (!findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      return ok(
        listPublicMessages(store, {
          orgId: actor.orgId,
          projectId,
          contactId,
          status: status ?? 'draft'
        })
      )
    }
  )

  server.registerTool(
    'update_draft',
    {
      ...display('Edit a saved draft', HINTS.write),
      description: 'Edit draft/queued copy or reschedule sendAt. summary is the sentence on Claude\'s Allow card.',
      inputSchema: UpdateDraftInput
    },
    async ({ messageId, subject, body, sendAt, status }) =>
      execUpdateDraft(messageId, subject, body, sendAt, status)
  )

  server.registerTool(
    'run_update_draft',
    {
      ...display('Edit a saved draft', HINTS.write),
      description: 'Execute a confirmed draft edit. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: UpdateDraftInput.omit({ summary: true })
    },
    async ({ messageId, subject, body, sendAt, status }) =>
      execUpdateDraft(messageId, subject, body, sendAt, status)
  )

  server.registerTool(
    'send_draft',
    {
      ...display('Send a saved draft now', HINTS.send),
      description: 'Send a saved draft now. summary is the sentence on Claude\'s Allow card. Spends credits on live email.',
      inputSchema: SendDraftInput
    },
    async ({ messageId }) => execSendDraft(messageId)
  )

  server.registerTool(
    'run_send_draft',
    {
      ...display('Send a saved draft now', HINTS.send),
      description: 'Execute a confirmed send. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: SendDraftInput.omit({ summary: true })
    },
    async ({ messageId }) => execSendDraft(messageId)
  )
}
