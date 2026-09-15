import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { toPublicUser } from './auth'
import type { McpActor } from './mcpOauth'
import { parseDeployContacts, parseRequiredContacts } from './deployContacts'
import {
  addPublicContacts,
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
  updatePublicSequence
} from './publicApi'
import type { BillingService } from './billing/types'
import { chargeIfLive, meBillingFields, projectNamesFor, refundCredits } from './billing'
import { claudeConnectorStatus } from './mcpOauth'
import { inspectTwilioVoice } from './providers/twilio'
import { getEmailWorkspace } from './emailWorkspace'
import { EMAIL_WORKSPACE_TOOL_META } from './mcpApps'
import {
  createProposal,
  deleteProposal,
  fallbackSummary,
  getProposal,
  namesList,
  type ConfirmFact,
  type McpProposal
} from './mcpProposals'
const ContactStatus = z.enum([
  'queued',
  'active',
  'completed',
  'replied',
  'no_answer',
  'interested',
  'not_interested'
])

// Headline on the in-chat confirmation card. Write tools are read-only previews
// that open that card; the write itself is an app-only `run_*` / `run_proposal`.
const Summary = z
  .string()
  .min(1)
  .max(160)
  .optional()
  .describe(
    'Always provide this. One plain-language sentence for the confirmation card. Name the people, workspace, or channel involved. No ids, field names, tool names, or JSON. Example: "Add 12 RevOps leaders to a new outbound queue."'
  )

const APP_ONLY_META = { ui: { visibility: ['app'] as const } }

const PENDING_INSTRUCTION =
  'A confirmation card is showing. Wait for the user to confirm or decline. Do not call this tool again until they do.'

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
  focus?: 'tasks'
) {
  const ws = getEmailWorkspace(store, config, orgId, projectId, { sandbox, focus })
  if (!ws) return fail('Project not found')
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(ws) }],
    _meta: EMAIL_WORKSPACE_TOOL_META
  }
}

function confirmOk(proposal: McpProposal) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          view: 'confirm_action',
          status: 'pending_confirmation',
          proposalId: proposal.id,
          title: proposal.title,
          summary: proposal.summary,
          facts: proposal.facts,
          confirmLabel: proposal.confirmLabel,
          instruction: PENDING_INSTRUCTION
        })
      }
    ],
    _meta: EMAIL_WORKSPACE_TOOL_META
  }
}

function personFact(contacts: Array<{ name?: string }> | undefined, count = contacts?.length ?? 0): ConfirmFact {
  const names = namesList(contacts)
  if (names) return { label: count === 1 ? 'Person' : 'People', value: names }
  return { label: 'People', value: count === 1 ? '1 person' : `${count} people` }
}

export function registerJargonTools(
  server: McpServer,
  store: DataStore,
  config: ServerConfig,
  actor: McpActor,
  billing: BillingService
): void {
  const sandbox = actor.environment === 'sandbox'

  function queueWrite(
    tool: string,
    title: string,
    confirmLabel: string,
    summary: string,
    facts: ConfirmFact[],
    args: Record<string, unknown>
  ) {
    return confirmOk(
      createProposal({
        orgId: actor.orgId,
        userId: actor.userId,
        tool,
        title,
        confirmLabel,
        summary,
        facts,
        args
      })
    )
  }

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
          'Import a list with import_list or deploy_tool. Those open a confirmation card — wait for the user to confirm. Then the matching outbound UI appears. Describe the UI in prompt: a three-channel queue, sequence, one-off emails, or inbox. For a cadence, write spec.steps with {{field}} templates. For one-offs, save_draft / send_draft. Reopen with show_email_workspace.'
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
      ...display('Open your billing page', HINTS.read),
      description:
        'Open a confirmation card for a billing URL (upgrade, top-up, or portal). Claude must not collect card details. Does not create the link until the user confirms.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: BillingLinkInput
    },
    async ({ summary, intent, plan, packId }) =>
      queueWrite(
        'create_billing_link',
        'Open your billing page',
        intent === 'upgrade' ? 'Get upgrade link' : intent === 'topup' ? 'Get top-up link' : 'Open billing',
        summary?.trim() ||
          (intent === 'upgrade' ? 'Open a link to upgrade your Jargon plan' : intent === 'topup' ? 'Open a link to buy more credits' : 'Open your Jargon billing portal'),
        [{ label: 'Action', value: intent === 'upgrade' ? 'Upgrade plan' : intent === 'topup' ? 'Buy credits' : 'Manage billing' }],
        { intent, plan, packId }
      )
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
  const SpecInput = z
    .object({
      goal: z.string().optional().describe('What success looks like'),
      segment: z.string().optional(),
      primarySurface: z
        .enum(['queue', 'dial', 'inbox', 'linkedin', 'sequence'])
        .optional()
        .describe('Which screen the rep opens first'),
      channels: z
        .array(z.enum(['email', 'call', 'linkedin']))
        .min(1)
        .max(3)
        .optional()
        .describe('Channels to run, in order. Overrides prompt inference.'),
      steps: z.array(SpecStep).min(1).max(8).optional()
    })
    .optional()
    .describe('Optional motion spec. If omitted, Jargon compiles it from prompt.')

  const ImportListInput = z.object({
    summary: Summary,
    prompt: z
      .string()
      .min(1)
      .describe('What to build, e.g. outbound queue for these 10 RevOps leaders'),
    contacts: z
      .array(ContactInput)
      .min(1)
      .max(100)
      .describe('The exact people to put in the queue'),
    spec: SpecInput
  })
  const DeployToolInput = z.object({
    summary: Summary,
    prompt: z.string().min(1).describe('What to build: LinkedIn queue, email sequencer, dialer, cadence, etc.'),
    contacts: z
      .array(ContactInput)
      .min(1)
      .max(100)
      .optional()
      .describe('Optional override list. Prefer import_list when you already have people.'),
    spec: SpecInput
  })
  const AddContactsInput = z.object({
    summary: Summary,
    projectId: z.string(),
    contacts: z.array(ContactInput).min(1).max(100)
  })

  async function execDeploy(prompt: string, contacts: unknown, spec: unknown) {
    const parsed = parseDeployContacts(contacts)
    if (!parsed.ok) return fail(parsed.error)
    const result = await deployPublicTool(store, config, actor.orgId, prompt, parsed.contacts, spec)
    if (!result.ok) return fail(result.body.error)
    return workspaceOk(store, config, actor.orgId, result.body.projectId, sandbox)
  }

  async function execImportList(prompt: string, contacts: unknown, spec: unknown) {
    const parsed = parseRequiredContacts(contacts)
    if (!parsed.ok) return fail(parsed.error)
    const result = await deployPublicTool(store, config, actor.orgId, prompt, parsed.contacts, spec)
    if (!result.ok) return fail(result.body.error)
    return workspaceOk(store, config, actor.orgId, result.body.projectId, sandbox)
  }

  async function execAddContacts(projectId: string, contacts: unknown) {
    const parsed = parseRequiredContacts(contacts)
    if (!parsed.ok) return fail(parsed.error)
    const result = addPublicContacts(store, actor.orgId, projectId, parsed.contacts)
    if (!result.ok) return fail(result.error)
    return ok(result)
  }

  server.registerTool(
    'import_list',
    {
      ...display('Add these people to an outbound list', HINTS.read),
      description:
        'Ingest people from chat, another connector, or a pasted table. Opens a confirmation card — does not add anyone until the user confirms. The prompt picks the chrome: a contact queue (email + phone + LinkedIn), sequence, one-off emails, or inbox. Extra fields become template variables. For a cadence, pass spec.steps with {{field}} templates. contacts is required.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: ImportListInput
    },
    async ({ summary, prompt, contacts, spec }) => {
      const parsed = parseRequiredContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const count = parsed.contacts.length
      return queueWrite(
        'import_list',
        'Add these people to an outbound list',
        'Add to Jargon',
        summary?.trim() || fallbackSummary('Add', namesList(parsed.contacts), count),
        [personFact(parsed.contacts, count), { label: 'Workspace', value: prompt.trim() }],
        { prompt, contacts, spec }
      )
    }
  )

  server.registerTool(
    'run_import_list',
    {
      ...display('Add these people to an outbound list', HINTS.write),
      description: 'Execute a confirmed import. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: ImportListInput.omit({ summary: true })
    },
    async ({ prompt, contacts, spec }) => execImportList(prompt, contacts, spec)
  )

  server.registerTool(
    'deploy_tool',
    {
      ...display('Set up a new outbound workspace', HINTS.read),
      description:
        'Create an outbound workspace from a prompt. Opens a confirmation card — does not create anything until the user confirms. Pass contacts[] for a researched list, or omit contacts to hydrate HubSpot/Railway. dashboardUrl is the full web tool — never prefix dashboardPath with www.jargonlabs.co.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: DeployToolInput
    },
    async ({ summary, prompt, contacts, spec }) => {
      const parsed = parseDeployContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const rows = parsed.contacts ?? []
      const facts: ConfirmFact[] = rows.length
        ? [personFact(rows, rows.length)]
        : [{ label: 'People', value: 'Your connected HubSpot or Railway list' }]
      facts.push({ label: 'Workspace', value: prompt.trim() })
      return queueWrite(
        'deploy_tool',
        'Set up a new outbound workspace',
        'Create workspace',
        summary?.trim() ||
          (rows.length
            ? fallbackSummary('Set up a workspace for', namesList(rows), rows.length)
            : `Set up a workspace: ${prompt.trim()}`),
        facts,
        { prompt, contacts, spec }
      )
    }
  )

  server.registerTool(
    'run_deploy_tool',
    {
      ...display('Set up a new outbound workspace', HINTS.write),
      description: 'Execute a confirmed deploy. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: DeployToolInput.omit({ summary: true })
    },
    async ({ prompt, contacts, spec }) => execDeploy(prompt, contacts, spec)
  )

  server.registerTool(
    'add_contacts',
    {
      ...display('Add more people to an existing list', HINTS.read),
      description:
        'Append people from any source to an existing workspace queue. Opens a confirmation card — does not add anyone until the user confirms.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: AddContactsInput
    },
    async ({ summary, projectId, contacts }) => {
      const parsed = parseRequiredContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const project = findOrgProject(store, actor.orgId, projectId)
      if (!project) return fail('Project not found')
      const count = parsed.contacts.length
      return queueWrite(
        'add_contacts',
        'Add more people to an existing list',
        'Add people',
        summary?.trim() || fallbackSummary('Add', namesList(parsed.contacts), count),
        [personFact(parsed.contacts, count), { label: 'Workspace', value: project.name }],
        { projectId, contacts }
      )
    }
  )

  server.registerTool(
    'run_add_contacts',
    {
      ...display('Add more people to an existing list', HINTS.write),
      description: 'Execute a confirmed add. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: AddContactsInput.omit({ summary: true })
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
      ...display('Send an email or LinkedIn message', HINTS.read),
      description:
        'Send or draft email/LinkedIn. Opens a confirmation card — does not send until the user confirms. Live login can send real email and spends credits.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: SendMessageInput
    },
    async ({ summary, contactId, body, channel, status, subject, sendAt }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      const kind = channel === 'linkedin' ? 'LinkedIn' : 'email'
      const verb = status === 'draft' ? 'Save a draft' : status === 'queued' ? 'Schedule' : 'Send'
      return queueWrite(
        'send_message',
        'Send an email or LinkedIn message',
        status === 'draft' ? 'Save draft' : status === 'queued' ? 'Schedule' : 'Send',
        summary?.trim() || `${verb} ${kind} to ${contact.name}`,
        [
          { label: 'To', value: contact.name },
          { label: 'Channel', value: kind },
          ...(subject ? [{ label: 'Subject', value: subject }] : [])
        ],
        { contactId, body, channel, status, subject, sendAt }
      )
    }
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
      ...display('Start a call', HINTS.read),
      description:
        'Start a dial session. Opens a confirmation card — does not dial until the user confirms. Live login can place real calls and spends credits.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: StartCallInput
    },
    async ({ summary, contactId }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return queueWrite(
        'start_call',
        'Start a call',
        'Start call',
        summary?.trim() || `Start a call with ${contact.name}`,
        [{ label: 'Person', value: contact.name }],
        { contactId }
      )
    }
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
      ...display('Log how a call ended', HINTS.read),
      description: 'Complete an open call with a disposition. Opens a confirmation card first.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: CompleteCallInput
    },
    async ({ summary, callId, disposition }) => {
      if (!isContactStatus(disposition)) return fail('invalid disposition')
      const call = findOrgCall(store, actor.orgId, callId)
      if (!call) return fail('Call not found')
      const contact = findOrgContact(store, actor.orgId, call.contactId)
      return queueWrite(
        'complete_call',
        'Log how a call ended',
        'Save outcome',
        summary?.trim() || `Log ${disposition.replaceAll('_', ' ')}${contact ? ` for ${contact.name}` : ''}`,
        [
          ...(contact ? [{ label: 'Person', value: contact.name }] : []),
          { label: 'Outcome', value: disposition.replaceAll('_', ' ') }
        ],
        { callId, disposition }
      )
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
      ...display('Log an outcome on a contact', HINTS.read),
      description: 'Log an outcome without an open call. Opens a confirmation card first.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: DispositionInput
    },
    async ({ summary, contactId, status, note, advanceStep, channel }) => {
      if (!isContactStatus(status)) return fail('invalid status')
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return queueWrite(
        'disposition',
        'Log an outcome on a contact',
        'Save outcome',
        summary?.trim() || `Log ${status.replaceAll('_', ' ')} for ${contact.name}`,
        [
          { label: 'Person', value: contact.name },
          { label: 'Outcome', value: status.replaceAll('_', ' ') }
        ],
        { contactId, status, note, advanceStep, channel }
      )
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
      ...display('Add a note to a contact', HINTS.read),
      description: 'Append a note to a contact. Opens a confirmation card first.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: AddNoteInput
    },
    async ({ summary, contactId, note }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return queueWrite(
        'add_note',
        'Add a note to a contact',
        'Add note',
        summary?.trim() || `Add a note on ${contact.name}`,
        [{ label: 'Person', value: contact.name }],
        { contactId, note }
      )
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
        'Open the outbound UI (queue, sequence, inbox, or one-off emails) with steps, catalog, contacts, and messages. Prefer this or show_email_workspace over dumping JSON into chat.',
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
        'Reopen the outbound UI in Claude (queue, sequence, one-off emails, or inbox). Call after import_list, deploy_tool, or writing drafts.',
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
        'Open the task view in Claude: every sequence step that is due for every enrolled contact, in due order. The user clicks through them one at a time — send the email, log the call, send the LinkedIn note. Use this when they ask what is due today or want to work their tasks.',
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
    channel: z.enum(['email', 'linkedin']).optional()
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
    return workspaceOk(store, config, actor.orgId, projectId, sandbox)
  }

  async function execSaveDraft(contactId: string, body: string, subject?: string, channel?: 'email' | 'linkedin') {
    const contact = findOrgContact(store, actor.orgId, contactId)
    if (!contact) return fail('Contact not found')
    const result = await sendPublicMessage(store, config, contact, {
      subject,
      body,
      channel,
      status: 'draft',
      sandbox
    })
    if (!result.ok) return fail(result.body.error)
    return ok(result.body)
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
      ...display('Rewrite the cadence steps', HINTS.read),
      description:
        'Replace sequence steps without redeploying. Opens a confirmation card first. Templates may use catalog keys such as {{first_name}} and {{funding_round}}.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: UpdateSequenceInput
    },
    async ({ summary, projectId, goal, steps }) => {
      const project = findOrgProject(store, actor.orgId, projectId)
      if (!project) return fail('Project not found')
      return queueWrite(
        'update_sequence',
        'Rewrite the cadence steps',
        'Save steps',
        summary?.trim() || `Update the cadence in ${project.name}`,
        [
          { label: 'Workspace', value: project.name },
          { label: 'Steps', value: String(steps.length) }
        ],
        { projectId, goal, steps }
      )
    }
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
      ...display('Start sending the cadence', HINTS.read),
      description:
        'Enroll contacts into the shared cadence. Opens a confirmation card — does not queue mail until the user confirms. For sequences only — not one-off sends. Idempotent per contact+step. Replies cancel later queued emails.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: StartSequenceInput
    },
    async ({ summary, projectId, startAt, contactIds }) => {
      const project = findOrgProject(store, actor.orgId, projectId)
      if (!project) return fail('Project not found')
      const who = contactIds?.length ? `${contactIds.length} contacts` : 'everyone in the workspace'
      return queueWrite(
        'start_sequence',
        'Start sending the cadence',
        'Start sequence',
        summary?.trim() || `Start the cadence for ${who} in ${project.name}`,
        [
          { label: 'Workspace', value: project.name },
          { label: 'Enroll', value: who }
        ],
        { projectId, startAt, contactIds }
      )
    }
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
    'save_draft',
    {
      ...display('Save a draft message', HINTS.read),
      description:
        'Save proposed copy for a contact. Opens a confirmation card first. Templates are interpolated from attrs.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: SaveDraftInput
    },
    async ({ summary, contactId, body, subject, channel }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      const kind = channel === 'linkedin' ? 'LinkedIn' : 'email'
      return queueWrite(
        'save_draft',
        'Save a draft message',
        'Save draft',
        summary?.trim() || `Save a ${kind} draft for ${contact.name}`,
        [
          { label: 'To', value: contact.name },
          { label: 'Channel', value: kind }
        ],
        { contactId, body, subject, channel }
      )
    }
  )

  server.registerTool(
    'run_save_draft',
    {
      ...display('Save a draft message', HINTS.write),
      description: 'Execute a confirmed draft save. Not for the model.',
      _meta: APP_ONLY_META,
      inputSchema: SaveDraftInput.omit({ summary: true })
    },
    async ({ contactId, body, subject, channel }) => execSaveDraft(contactId, body, subject, channel)
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
      ...display('Edit a saved draft', HINTS.read),
      description: 'Edit draft/queued copy or reschedule sendAt. Opens a confirmation card first.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: UpdateDraftInput
    },
    async ({ summary, messageId, subject, body, sendAt, status }) => {
      const message = findOrgMessage(store, actor.orgId, messageId)
      if (!message) return fail('Message not found')
      const contact = findOrgContact(store, actor.orgId, message.contactId)
      return queueWrite(
        'update_draft',
        'Edit a saved draft',
        'Save draft',
        summary?.trim() || `Edit the draft${contact ? ` for ${contact.name}` : ''}`,
        contact ? [{ label: 'To', value: contact.name }] : [],
        { messageId, subject, body, sendAt, status }
      )
    }
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
      ...display('Send a saved draft now', HINTS.read),
      description: 'Send a saved draft now. Opens a confirmation card first. Spends credits on live email.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: SendDraftInput
    },
    async ({ summary, messageId }) => {
      const message = findOrgMessage(store, actor.orgId, messageId)
      if (!message) return fail('Message not found')
      const contact = findOrgContact(store, actor.orgId, message.contactId)
      const kind = message.channel === 'linkedin' ? 'LinkedIn' : 'email'
      return queueWrite(
        'send_draft',
        'Send a saved draft now',
        'Send now',
        summary?.trim() || `Send the ${kind} draft${contact ? ` to ${contact.name}` : ''}`,
        [
          ...(contact ? [{ label: 'To', value: contact.name }] : []),
          { label: 'Channel', value: kind }
        ],
        { messageId }
      )
    }
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

  async function runConfirmed(proposal: McpProposal) {
    const a = proposal.args
    switch (proposal.tool) {
      case 'create_billing_link':
        return execCreateBillingLink(
          a.intent as 'upgrade' | 'topup' | 'portal',
          a.plan as 'team' | 'scale' | undefined,
          a.packId as 'credits_500' | 'credits_2000' | 'credits_10000' | undefined
        )
      case 'import_list':
        return execImportList(String(a.prompt), a.contacts, a.spec)
      case 'deploy_tool':
        return execDeploy(String(a.prompt), a.contacts, a.spec)
      case 'add_contacts':
        return execAddContacts(String(a.projectId), a.contacts)
      case 'send_message':
        return execSendMessage({
          contactId: String(a.contactId),
          body: String(a.body),
          channel: a.channel as 'email' | 'linkedin' | undefined,
          status: a.status as 'draft' | 'queued' | 'sent' | undefined,
          subject: a.subject as string | undefined,
          sendAt: a.sendAt as number | string | undefined
        })
      case 'start_call':
        return execStartCall(String(a.contactId))
      case 'complete_call': {
        const disposition = a.disposition
        if (!isContactStatus(disposition)) return fail('invalid disposition')
        const call = findOrgCall(store, actor.orgId, String(a.callId))
        if (!call) return fail('Call not found')
        return ok(completePublicCall(store, call.id, disposition))
      }
      case 'disposition': {
        const status = a.status
        if (!isContactStatus(status)) return fail('invalid status')
        const contact = findOrgContact(store, actor.orgId, String(a.contactId))
        if (!contact) return fail('Contact not found')
        return ok(
          applyDisposition(store, contact.id, {
            status,
            note: a.note as string | undefined,
            advanceStep: a.advanceStep as boolean | undefined,
            channel: a.channel as 'email' | 'call' | 'linkedin' | undefined
          })
        )
      }
      case 'add_note': {
        const contact = findOrgContact(store, actor.orgId, String(a.contactId))
        if (!contact) return fail('Contact not found')
        return ok({ contact: addPublicNote(store, contact.id, String(a.note)) })
      }
      case 'update_sequence':
        return execUpdateSequence(String(a.projectId), a.goal as string | undefined, a.steps)
      case 'start_sequence':
        return execStartSequence(
          String(a.projectId),
          a.startAt as number | string | undefined,
          a.contactIds as string[] | undefined
        )
      case 'save_draft':
        return execSaveDraft(
          String(a.contactId),
          String(a.body),
          a.subject as string | undefined,
          a.channel as 'email' | 'linkedin' | undefined
        )
      case 'update_draft':
        return execUpdateDraft(
          String(a.messageId),
          a.subject as string | undefined,
          a.body as string | undefined,
          a.sendAt as number | string | undefined,
          a.status as 'draft' | 'queued' | undefined
        )
      case 'send_draft':
        return execSendDraft(String(a.messageId))
      default:
        return fail('Unknown action')
    }
  }

  server.registerTool(
    'run_proposal',
    {
      ...display('Confirm a Jargon action', HINTS.write),
      description: 'Run a pending confirmation from the in-chat card. Not for the model.',
      inputSchema: z.object({ proposalId: z.string() }),
      _meta: APP_ONLY_META
    },
    async ({ proposalId }) => {
      const proposal = getProposal(actor.orgId, proposalId)
      if (!proposal) return fail('This confirmation expired. Ask Claude to try again.')
      const result = await runConfirmed(proposal)
      if (!('isError' in result && result.isError)) deleteProposal(proposal.id)
      return result
    }
  )

  server.registerTool(
    'cancel_proposal',
    {
      ...display('Cancel a Jargon action', HINTS.write),
      description: 'Discard a pending confirmation. Not for the model.',
      inputSchema: z.object({ proposalId: z.string() }),
      _meta: APP_ONLY_META
    },
    async ({ proposalId }) => {
      const proposal = getProposal(actor.orgId, proposalId)
      if (proposal) deleteProposal(proposal.id)
      return ok({ view: 'confirm_action', status: 'cancelled', proposalId })
    }
  )
}
