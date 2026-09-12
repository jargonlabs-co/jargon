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

const ContactStatus = z.enum([
  'queued',
  'active',
  'completed',
  'replied',
  'no_answer',
  'interested',
  'not_interested'
])

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
  sandbox: boolean
) {
  const ws = getEmailWorkspace(store, config, orgId, projectId, { sandbox })
  if (!ws) return fail('Project not found')
  return ok(ws)
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
      title: 'Who am I',
      description:
        'Current Jargon user, org, plan, credit balance, and outbound flags. Does not consume credits.',
      annotations: { readOnlyHint: true }
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
          'Import a list with import_list or deploy_tool (CRM hydrate). That opens the Email workspace UI in Claude. Write spec.steps with {{field}} templates, or save_draft. User edits and sends in the UI. Reopen with show_email_workspace. dashboardUrl is overflow only.'
      })
    }
  )

  server.registerTool(
    'get_credits',
    {
      title: 'Get credits',
      description:
        'Remaining API credits, monthly grant, and refresh date. Free — does not consume credits.',
      annotations: { readOnlyHint: true }
    },
    async () => ok(await billing.getCredits(actor.orgId))
  )

  server.registerTool(
    'get_usage',
    {
      title: 'Get usage',
      description: 'Credit and outbound usage for the current billing period, including by tool.',
      annotations: { readOnlyHint: true }
    },
    async () => ok(await billing.getUsage(actor.orgId, projectNamesFor(store, actor.orgId)))
  )

  server.registerTool(
    'create_billing_link',
    {
      title: 'Create billing link',
      description:
        'Return a URL to upgrade the plan, buy credit top-ups, or open the billing portal. Claude must not collect card details — send the user to this URL.',
      inputSchema: z.object({
        intent: z.enum(['upgrade', 'topup', 'portal']).describe('upgrade plan, buy credits, or manage payment method'),
        plan: z.enum(['team', 'scale']).optional(),
        packId: z.enum(['credits_500', 'credits_2000', 'credits_10000']).optional()
      })
    },
    async ({ intent, plan, packId }) => {
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
  )

  server.registerTool(
    'list_prospects',
    {
      title: 'List prospects',
      description: 'List prospects already in this org. Do not cache PII. Do not pass org_id.',
      inputSchema: z.object({
        projectId: z.string().optional(),
        status: ContactStatus.optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      }),
      annotations: { readOnlyHint: true }
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
      title: 'Get prospect',
      description: 'Get one prospect by id.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true }
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
      title: 'List workspaces',
      description: 'List workspaces for this account. Share each project.dashboardUrl (https://jargonlabs.co/tools/…), not www.',
      annotations: { readOnlyHint: true }
    },
    async () => ok({ projects: listPublicProjects(store, actor.orgId, config.appUrl) })
  )

  server.registerTool(
    'get_project',
    {
      title: 'Get workspace',
      description:
        'Get one workspace. Share dashboardUrl with the user (https://jargonlabs.co/tools/…). Never prefix dashboardPath with www.jargonlabs.co — that host is the API.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true }
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

  server.registerTool(
    'import_list',
    {
      title: 'Import list into an outbound workspace',
      description:
        'Ingest people from chat, another connector, or a pasted table and open the Email workspace UI in Claude. Extra fields become sequence variables. Pass spec.steps with {{field}} templates for email copy. contacts is required.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .describe('What to build, e.g. LinkedIn queue for these 10 RevOps leaders'),
        contacts: z
          .array(ContactInput)
          .min(1)
          .max(100)
          .describe('The exact people to put in the queue'),
        spec: SpecInput
      })
    },
    async ({ prompt, contacts, spec }) => {
      const parsed = parseRequiredContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const result = await deployPublicTool(
        store,
        config,
        actor.orgId,
        prompt,
        parsed.contacts,
        spec
      )
      if (!result.ok) return fail(result.body.error)
      return workspaceOk(store, config, actor.orgId, result.body.projectId, sandbox)
    }
  )

  server.registerTool(
    'deploy_tool',
    {
      title: 'Deploy outbound workspace',
      description:
        'Create an outbound workspace from a prompt and open the Email workspace UI when the motion includes email. Pass contacts[] for a researched list, or omit contacts to hydrate HubSpot/Railway. Pass spec.steps with {{field}} templates. dashboardUrl is overflow (inbox, dialer) — never prefix dashboardPath with www.jargonlabs.co.',
      _meta: EMAIL_WORKSPACE_TOOL_META,
      inputSchema: z.object({
        prompt: z.string().min(1).describe('What to build: LinkedIn queue, email sequencer, dialer, cadence, etc.'),
        contacts: z
          .array(ContactInput)
          .min(1)
          .max(100)
          .optional()
          .describe('Optional override list. Prefer import_list when you already have people.'),
        spec: SpecInput
      })
    },
    async ({ prompt, contacts, spec }) => {
      const parsed = parseDeployContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const result = await deployPublicTool(
        store,
        config,
        actor.orgId,
        prompt,
        parsed.contacts,
        spec
      )
      if (!result.ok) return fail(result.body.error)
      return workspaceOk(store, config, actor.orgId, result.body.projectId, sandbox)
    }
  )

  server.registerTool(
    'add_contacts',
    {
      title: 'Add contacts to a workspace',
      description: 'Append people from any source to an existing workspace queue.',
      inputSchema: z.object({
        projectId: z.string(),
        contacts: z.array(ContactInput).min(1).max(100)
      })
    },
    async ({ projectId, contacts }) => {
      const parsed = parseRequiredContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const result = addPublicContacts(store, actor.orgId, projectId, parsed.contacts)
      if (!result.ok) return fail(result.error)
      return ok(result)
    }
  )

  server.registerTool(
    'list_contacts',
    {
      title: 'List workspace contacts',
      description: 'List contacts in one workspace.',
      inputSchema: z.object({
        projectId: z.string(),
        status: ContactStatus.optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ projectId, ...query }) => {
      if (!findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      return ok(listPublicContacts(store, projectId, query))
    }
  )

  server.registerTool(
    'queue_next',
    {
      title: 'Next in queue',
      description: 'Next actionable contact plus current step template.',
      inputSchema: z.object({ projectId: z.string() }),
      annotations: { readOnlyHint: true }
    },
    async ({ projectId }) => {
      if (!findOrgProject(store, actor.orgId, projectId)) return fail('Project not found')
      const next = nextQueueContact(store.db, projectId)
      const project = findOrgProject(store, actor.orgId, projectId)
      return ok(next ? toPublicQueueNext(next, project?.fieldCatalog) : emptyQueue())
    }
  )

  server.registerTool(
    'send_message',
    {
      title: 'Send email or LinkedIn',
      description: 'Send or draft email/LinkedIn. Live login can send real email and spends credits.',
      inputSchema: z.object({
        contactId: z.string(),
        body: z.string(),
        channel: z.enum(['email', 'linkedin']).optional(),
        status: z.enum(['draft', 'queued', 'sent']).optional(),
        subject: z.string().optional(),
        sendAt: z.union([z.number(), z.string()]).optional().describe('Required if status is queued. Unix ms or ISO date.')
      })
    },
    async ({ contactId, ...input }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
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
  )

  server.registerTool(
    'start_call',
    {
      title: 'Start call',
      description: 'Start a dial session. Live login can place real calls and spends credits.',
      inputSchema: z.object({ contactId: z.string() })
    },
    async ({ contactId }) => {
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
  )

  server.registerTool(
    'complete_call',
    {
      title: 'Complete call',
      description: 'Complete an open call with a disposition.',
      inputSchema: z.object({
        callId: z.string(),
        disposition: ContactStatus
      })
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
      title: 'Log disposition',
      description: 'Log an outcome without an open call.',
      inputSchema: z.object({
        contactId: z.string(),
        status: ContactStatus,
        note: z.string().optional(),
        advanceStep: z.boolean().optional()
      })
    },
    async ({ contactId, status, note, advanceStep }) => {
      if (!isContactStatus(status)) return fail('invalid status')
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return ok(applyDisposition(store, contact.id, { status, note, advanceStep }))
    }
  )

  server.registerTool(
    'add_note',
    {
      title: 'Add note',
      description: 'Append a note to a contact.',
      inputSchema: z.object({
        contactId: z.string(),
        note: z.string().min(1)
      })
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
      title: 'Get sequence',
      description:
        'Open the Email workspace UI with sequence steps, field catalog, and contacts. Prefer this or show_email_workspace over dumping JSON into chat.',
      inputSchema: z.object({ projectId: z.string() }),
      annotations: { readOnlyHint: true },
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox)
  )

  server.registerTool(
    'show_email_workspace',
    {
      title: 'Show email workspace',
      description:
        'Open the interactive Email workspace in Claude: edit sequence templates, preview people, save drafts, send or schedule Gmail. Call after import_list, deploy_tool, or writing drafts.',
      inputSchema: z.object({ projectId: z.string() }),
      annotations: { readOnlyHint: true },
      _meta: EMAIL_WORKSPACE_TOOL_META
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox)
  )

  server.registerTool(
    'load_email_workspace',
    {
      title: 'Load email workspace',
      description: 'Reload email workspace data for the in-chat UI. Not for the model.',
      inputSchema: z.object({ projectId: z.string() }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ['app'] } }
    },
    async ({ projectId }) => workspaceOk(store, config, actor.orgId, projectId, sandbox)
  )

  server.registerTool(
    'update_sequence',
    {
      title: 'Update sequence',
      description:
        'Replace sequence steps without redeploying. Templates may use catalog keys such as {{first_name}} and {{funding_round}}.',
      inputSchema: z.object({
        projectId: z.string(),
        goal: z.string().optional(),
        steps: z.array(SpecStep).min(1).max(8)
      })
    },
    async ({ projectId, goal, steps }) => {
      const result = updatePublicSequence(store, actor.orgId, projectId, { goal, steps })
      if (!result.ok) return fail(result.error)
      return ok(result.sequence)
    }
  )

  server.registerTool(
    'save_draft',
    {
      title: 'Save draft',
      description:
        'Save proposed copy for a contact. Templates are interpolated from attrs. User can edit via update_draft then send_draft.',
      inputSchema: z.object({
        contactId: z.string(),
        body: z.string(),
        subject: z.string().optional(),
        channel: z.enum(['email', 'linkedin']).optional()
      })
    },
    async ({ contactId, ...input }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      const result = await sendPublicMessage(store, config, contact, {
        ...input,
        status: 'draft',
        sandbox
      })
      if (!result.ok) return fail(result.body.error)
      return ok(result.body)
    }
  )

  server.registerTool(
    'list_drafts',
    {
      title: 'List drafts',
      description: 'List draft or queued messages in a workspace.',
      inputSchema: z.object({
        projectId: z.string(),
        contactId: z.string().optional(),
        status: z.enum(['draft', 'queued', 'sent', 'failed']).optional()
      }),
      annotations: { readOnlyHint: true }
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
      title: 'Update draft',
      description: 'Edit draft/queued copy or reschedule sendAt.',
      inputSchema: z.object({
        messageId: z.string(),
        subject: z.string().optional(),
        body: z.string().optional(),
        sendAt: z.union([z.number(), z.string()]).optional()
      })
    },
    async ({ messageId, subject, body, sendAt }) => {
      const parsedSendAt =
        typeof sendAt === 'number' ? sendAt : typeof sendAt === 'string' ? Date.parse(sendAt) : undefined
      const result = patchPublicMessage(store, actor.orgId, messageId, {
        subject,
        body,
        sendAt: Number.isFinite(parsedSendAt) ? parsedSendAt : undefined
      })
      if (!result.ok) return fail(result.error)
      return ok({ message: result.message })
    }
  )

  server.registerTool(
    'send_draft',
    {
      title: 'Send draft',
      description: 'Send a saved draft now. Spends credits on live email.',
      inputSchema: z.object({ messageId: z.string() })
    },
    async ({ messageId }) => {
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
  )
}
