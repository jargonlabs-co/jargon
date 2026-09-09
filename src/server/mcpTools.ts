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
  deployPublicTool,
  emptyQueue,
  findOrgCall,
  findOrgContact,
  findOrgProject,
  isContactStatus,
  listPublicContacts,
  listPublicProjects,
  listPublicProspects,
  nextQueueContact,
  sendPublicMessage,
  startPublicCall,
  toPublicContact,
  toPublicProject,
  toPublicQueueNext
} from './publicApi'
import type { BillingService } from './billing/types'
import { chargeIfLive, meBillingFields, projectNamesFor, refundCredits } from './billing'
import { claudeConnectorStatus } from './mcpOauth'

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
          voice: sandbox ? 'sandbox' : config.twilio.accountSid ? 'live' : 'demo',
          linkedin: sandbox ? 'sandbox' : config.heyreach.apiKey ? 'live' : 'demo'
        },
        ...meBillingFields(credits),
        claude: claudeConnectorStatus(store, config, org.id),
        ingest:
          'To build a dialer from any researched list, call deploy_tool and put the people in prompt as a JSON array (name, company, title, email, phone, linkedinUrl). Prefer import_list if that tool is visible.'
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

  const ContactInput = z.object({
    name: z.string().min(1).describe('Full name'),
    company: z.string().optional(),
    title: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    city: z.string().optional(),
    linkedinUrl: z.string().optional(),
    linkedin: z.string().optional().describe('Alias for linkedinUrl'),
    notes: z.string().optional(),
    context: z.array(z.string()).optional()
  })

  server.registerTool(
    'import_list',
    {
      title: 'Import list into a dialer',
      description:
        'Ingest people from anywhere (Crustdata, research, a ranked list, a CSV) and create an outbound dialer from that exact list. contacts is required. Does not read HubSpot or Railway. After success, share dashboardUrl (https://jargonlabs.co/tools/…) — never www.jargonlabs.co/tools.',
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .describe('What to build, e.g. Dialer for these 10 RevOps leaders'),
        contacts: z
          .array(ContactInput)
          .min(1)
          .max(100)
          .describe('The exact people to put in the queue')
      })
    },
    async ({ prompt, contacts }) => {
      const parsed = parseRequiredContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const result = await deployPublicTool(
        store,
        config,
        actor.orgId,
        prompt,
        parsed.contacts
      )
      if (!result.ok) return fail(result.body.error)
      return ok(result.body)
    }
  )

  server.registerTool(
    'deploy_tool',
    {
      title: 'Deploy workspace from CRM',
      description:
        'Create an outbound workspace. To ingest a researched list, pass contacts[] or put a JSON array of people (name, company, title, email, phone, linkedinUrl) in prompt. That exact list becomes the queue. Omit both only to hydrate HubSpot/Railway. After success, share dashboardUrl (https://jargonlabs.co/tools/…) — never www.jargonlabs.co/tools.',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('What to deploy from the connected CRM/warehouse'),
        contacts: z
          .array(ContactInput)
          .min(1)
          .max(100)
          .optional()
          .describe('Optional override list. Prefer import_list when you already have people.')
      })
    },
    async ({ prompt, contacts }) => {
      const parsed = parseDeployContacts(contacts)
      if (!parsed.ok) return fail(parsed.error)
      const result = await deployPublicTool(
        store,
        config,
        actor.orgId,
        prompt,
        parsed.contacts
      )
      if (!result.ok) return fail(result.body.error)
      return ok(result.body)
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
      return ok(next ? toPublicQueueNext(next) : emptyQueue())
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
        subject: z.string().optional()
      })
    },
    async ({ contactId, ...input }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
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
      const result = await sendPublicMessage(store, config, contact, { ...input, sandbox })
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
}
