import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { toPublicUser } from './auth'
import type { McpActor } from './mcpOauth'
import { extractContactsFromPrompt, parseDeployContacts, parseRequiredContacts } from './deployContacts'
import {
  addPublicContactsAndEnroll,
  addPublicNote,
  applyDisposition,
  completePublicCall,
  deliverPublicMessage,
  deployPublicTool,
  emptyQueue,
  enrollPublicSequence,
  findOrgCall,
  findOrgContact,
  findOrgMessage,
  findOrgProject,
  isContactStatus,
  listPublicContacts,
  listPublicMessages,
  listPublicProjects,
  listPublicProspects,
  nextQueueContact,
  patchPublicMessage,
  sendPublicMessage,
  startPublicCall,
  toPublicContact,
  toPublicProject,
  toPublicQueueNext,
  updatePublicSequence,
  upsertPublicDraft,
  unenrollPublicContact,
  skipPublicTask,
  savePublicResearch,
  savePublicTalkTrack,
  type ResearchCopyInput
} from './publicApi'
import type { BillingService } from './billing/types'
import { chargeIfLive, meBillingFields, projectNamesFor, refundCredits } from './billing'
import { claudeConnectorStatus } from './mcpOauth'
import { inspectTwilioVoice } from './providers/twilio'
import { getEmailWorkspace } from './emailWorkspace'
import { EMAIL_WORKSPACE_TOOL_META } from './mcpApps'
import { shouldAutoStartSequence, type McpTab } from '../shared/workspaceSpec'

const ContactStatus = z.enum([
  'queued',
  'active',
  'completed',
  'replied',
  'no_answer',
  'interested',
  'not_interested'
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
  send: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
} as const

// Spec precedence is `title` then `annotations.title`; set both so older clients
// also show the plain-language name rather than the snake_case tool id.
function display(title: string, hints: (typeof HINTS)[keyof typeof HINTS]) {
  return { title, annotations: { title, ...hints } }
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function fail(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true
  }
}

function workspaceOk(
  store: DataStore,
  config: ServerConfig,
  orgId: string,
  projectId: string,
  sandbox: boolean,
  focus?: McpTab
) {
  const ws = getEmailWorkspace(store, config, orgId, projectId, { sandbox, focus })
  if (!ws) return fail('Project not found')
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(ws) }],
    _meta: EMAIL_WORKSPACE_TOOL_META
  }
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
          email: sandbox ? 'sandbox' : config.google.refreshToken ? 'live' : 'demo',
          voice: sandbox ? 'sandbox' : inspectTwilioVoice(config).ok ? 'live' : 'demo',
          linkedin: sandbox ? 'sandbox' : config.heyreach.apiKey ? 'live' : 'demo'
        },
        ...meBillingFields(credits),
        claude: claudeConnectorStatus(store, config, org.id),
        ingest:
        'Import a list with import_list or deploy_tool. Put people in workspace as a markdown table, CSV, or JSON (Name, Company, Title, Email, LinkedIn). summary is the one sentence on Claude\'s Allow card — never pass a contacts array. Jargon ingests the list, builds the sequencer or dialer, sequences everyone into Tasks, then you research each person and save_research talk tracks / email / LinkedIn copy. For one-offs, save_draft / send_draft. Reopen with show_email_workspace.'
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
      description: 'Credit and outbound usage for the current billing period, including by tool.'
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
        'Return a URL to upgrade the plan, buy credit top-ups, or open the billing portal. Claude must not collect card details — send the user to this URL.',
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
      description: 'List workspaces for this account. Share each project.dashboardUrl (https://jargonlabs.co/tools/…), not www.'
    },
    async () => ok({ projects: listPublicProjects(store, actor.orgId, config.appUrl) })
  )

  server.registerTool(
    'get_project',
    {
      ...display('Open one outbound workspace', HINTS.read),
      description:
        'Get one workspace. Share dashboardUrl with the user (https://jargonlabs.co/tools/…). Never prefix dashboardPath with www.jargonlabs.co — that host is the API.',
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
    subject: z.string().optional(),
    body: z.string().optional()
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
    const parsed = parseDeployContacts(contacts)
    if (!parsed.ok) return fail(parsed.error)
    const result = await deployPublicTool(store, config, actor.orgId, prompt, parsed.contacts, spec)
    if (!result.ok) return fail(result.body.error)
    return workspaceOk(store, config, actor.orgId, result.body.projectId, sandbox)
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
        'Ingest people and open Contacts / Sequence / Tasks. summary is the sentence on Claude\'s Allow card. Put people in workspace as a markdown table, CSV, or JSON. Describe the cadence (days, channels) in the same text. Jargon sequences everyone into Tasks. Then research each company/prospect and save_research personalized talk tracks, email copy, and LinkedIn notes in one call.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
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
        'Create an outbound workspace. summary is the sentence on Claude\'s Allow card. Describe the cadence in workspace (days, channels, goal). Include a markdown table, CSV, or JSON to ingest a list, or omit it to hydrate HubSpot/Railway. Jargon builds the tool, sequences everyone into Tasks, then you research each contact and save_research talk tracks / email / LinkedIn copy. dashboardUrl is the full web tool — never prefix dashboardPath with www.jargonlabs.co.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
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
      description: 'List contacts in one workspace.',
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
      return ok(listPublicContacts(store, projectId, query))
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
  const StartCallInput = z.object({ summary: Summary, contactId: z.string() })
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
    const willSend = (input.status ?? 'sent') === 'sent'
    const billableReason = input.channel === 'linkedin' ? 'linkedin' : 'email'
    let charge: Awaited<ReturnType<typeof chargeIfLive>> | null = null
    if (willSend) {
      charge = await chargeIfLive(billing, {
        orgId: actor.orgId,
        sandbox,
        reason: billableReason,
        projectId: contact.projectId
      })
      if (!charge.ok) {
        return fail(
          JSON.stringify({
            error: charge.error,
            code: charge.code,
            billingUrl: charge.billingUrl,
            remaining: charge.remaining
          })
        )
      }
    }
    const result = await sendPublicMessage(store, config, contact, {
      subject: input.subject,
      body: input.body,
      channel: input.channel,
      status: input.status,
      sandbox,
      sendAt: Number.isFinite(sendAt) ? sendAt : undefined
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

  async function execStartCall(contactId: string) {
    const contact = findOrgContact(store, actor.orgId, contactId)
    if (!contact) return fail('Contact not found')
    const charge = await chargeIfLive(billing, {
      orgId: actor.orgId,
      sandbox,
      reason: 'call',
      projectId: contact.projectId
    })
    if (!charge.ok) {
      return fail(
        JSON.stringify({
          error: charge.error,
          code: charge.code,
          billingUrl: charge.billingUrl,
          remaining: charge.remaining
        })
      )
    }
    return ok({
      call: startPublicCall(store, config, contact, sandbox),
      creditsUsed: charge.creditsUsed,
      creditsRemaining: charge.remaining
    })
  }

  server.registerTool(
    'send_message',
    {
      ...display('Send an email or LinkedIn message', HINTS.send),
      description:
        'Send or draft email/LinkedIn. summary is the sentence on Claude\'s Allow card. Live login can send real email and spends credits.',
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
        'Start a dial session. summary is the sentence on Claude\'s Allow card. Live login can place real calls and spends credits.',
      inputSchema: StartCallInput
    },
    async ({ contactId }) => execStartCall(contactId)
  )

  server.registerTool(
    'run_start_call',
    {
      ...display('Start a call', HINTS.send),
      description: 'Execute a confirmed dial. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: StartCallInput.omit({ summary: true })
    },
    async ({ contactId }) => execStartCall(contactId)
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
      return ok(completePublicCall(store, call.id, disposition))
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
      return ok(completePublicCall(store, call.id, disposition))
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
      return ok(applyDisposition(store, contact.id, { status, note, advanceStep, channel }))
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
      return ok(applyDisposition(store, contact.id, { status, note, advanceStep, channel }))
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
      ...display('Open the outbound workspace', HINTS.read),
      description:
        'Open the outbound workspace in Claude: Contacts, Sequence, and Tasks (Queue for a dialer). Prefer this or show_email_workspace over dumping JSON into chat.',
      inputSchema: z.object({ projectId: z.string() }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox)
  )

  server.registerTool(
    'show_email_workspace',
    {
      ...display('Open your outbound workspace', HINTS.read),
      description:
        'Reopen the outbound workspace in Claude (Contacts, Sequence, Tasks). Call after import_list, deploy_tool, or writing drafts. After a cadence is started, prefer show_tasks.',
      inputSchema: z.object({ projectId: z.string() }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox)
  )

  server.registerTool(
    'show_tasks',
    {
      ...display("Show what's due today", HINTS.read),
      description:
        'Open Tasks in Claude: every sequence step due for enrolled contacts, in due order. The user clicks through them — send, skip, reschedule, log a call, send LinkedIn. Use this when they ask what is due today or want to work their tasks.',
      inputSchema: z.object({ projectId: z.string() }),
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks')
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
      const ws = getEmailWorkspace(store, config, actor.orgId, projectId, { sandbox })
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
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox)
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

  async function execUpdateSequence(projectId: string, goal: string | undefined, steps: unknown) {
    const result = updatePublicSequence(store, actor.orgId, projectId, { goal, steps })
    if (!result.ok) return fail(result.error)
    return ok(result.sequence)
  }

  async function execStartSequence(projectId: string, startAt?: number | string, contactIds?: string[]) {
    const parsedStart =
      typeof startAt === 'number' ? startAt : typeof startAt === 'string' ? Date.parse(startAt) : undefined
    const result = await enrollPublicSequence(store, config, actor.orgId, projectId, {
      startAt: Number.isFinite(parsedStart) ? parsedStart : undefined,
      contactIds,
      sandbox
    })
    if (!result.ok) return fail(result.error)
    return workspaceOk(store, config, actor.orgId, projectId, sandbox, 'tasks')
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
    return workspaceOk(store, config, actor.orgId, projectId, sandbox, enroll ? 'tasks' : 'contacts')
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
    if (!charge.ok) {
      return fail(
        JSON.stringify({
          error: charge.error,
          code: charge.code,
          billingUrl: charge.billingUrl,
          remaining: charge.remaining
        })
      )
    }
    const result = await deliverPublicMessage(store, config, actor.orgId, messageId, sandbox)
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
        'Change cadence structure (days, channels, labels) without redeploying. summary is the sentence on Claude\'s Allow card. Shared fallback templates may use {{first_name}} and catalog keys. Do not put per-person researched copy here — use save_draft so start_sequence cannot overwrite it.',
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
    async ({ projectId, goal, steps }) => execUpdateSequence(projectId, goal, steps)
  )

  server.registerTool(
    'start_sequence',
    {
      ...display('Start sending the cadence', HINTS.send),
      description:
        'Enroll contacts into the cadence and open Tasks. summary is the sentence on Claude\'s Allow card. Deploy already enrolls cadences and dialers — use this to re-enroll or enroll a subset. Keeps copy already saved with save_draft / save_research. Pass contactIds to enroll a subset.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: StartSequenceInput
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
    async ({ projectId, startAt, contactIds }) => execStartSequence(projectId, startAt, contactIds)
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
      return workspaceOk(store, config, actor.orgId, result.contact.projectId, sandbox)
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
      return workspaceOk(store, config, actor.orgId, contact.projectId, sandbox, 'tasks')
    }
  )

  server.registerTool(
    'save_draft',
    {
      ...display('Save a draft message', HINTS.write),
      description:
        'Save researched, personalized copy for one contact. summary is the sentence on Claude\'s Allow card. Use channel call for a talk track, email/linkedin for send copy. Prefer save_research to write the whole list in one Allow. Pass stepId or day for follow-ups.',
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
        'Save researched talk tracks, email copy, and LinkedIn notes for every contact in one Allow, then open Tasks. summary is the sentence on Claude\'s Allow card. research is a JSON array — not nested objects on the card. Call this immediately after import_list / deploy_tool. Do not leave {{first_name}} placeholders as the send copy.',
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
