import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { toPublicUser } from './auth'
import type { McpActor } from './mcpOauth'
import {
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
  actor: McpActor
): void {
  const sandbox = actor.environment === 'sandbox'

  server.registerTool(
    'get_me',
    {
      title: 'Who am I',
      description: 'Current Jargon user, org, and outbound flags for this login.',
      annotations: { readOnlyHint: true }
    },
    async () => {
      const user = store.db.users.find((u) => u.id === actor.userId)
      const org = store.db.orgs.find((o) => o.id === actor.orgId)
      if (!user || !org) return fail('Account not found')
      return ok({
        user: toPublicUser(user),
        org: { id: org.id, name: org.name, slug: org.slug },
        environment: actor.environment,
        outbound: {
          email: sandbox ? 'sandbox' : config.google.refreshToken ? 'live' : 'demo',
          voice: sandbox ? 'sandbox' : config.twilio.accountSid ? 'live' : 'demo',
          linkedin: sandbox ? 'sandbox' : config.heyreach.apiKey ? 'live' : 'demo'
        }
      })
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
      description: 'List workspaces for this account.',
      annotations: { readOnlyHint: true }
    },
    async () => ok({ projects: listPublicProjects(store, actor.orgId) })
  )

  server.registerTool(
    'get_project',
    {
      title: 'Get workspace',
      description: 'Get one workspace. dashboardPath is on jargonlabs.co.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      const project = findOrgProject(store, actor.orgId, id)
      if (!project) return fail('Project not found')
      return ok(toPublicProject(store.db.contacts, project))
    }
  )

  server.registerTool(
    'deploy_tool',
    {
      title: 'Deploy workspace',
      description: 'Create a dialer/today-queue workspace from a prompt. Hydrates from connected CRM/warehouse.',
      inputSchema: z.object({ prompt: z.string().min(1) })
    },
    async ({ prompt }) => {
      const result = await deployPublicTool(store, config, actor.orgId, prompt)
      if (!result.ok) return fail(result.body.error)
      return ok(result.body)
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
      description: 'Send or draft email/LinkedIn. Live login can send real email.',
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
      const result = await sendPublicMessage(store, config, contact, { ...input, sandbox })
      if (!result.ok) return fail(result.body.error)
      return ok(result.body)
    }
  )

  server.registerTool(
    'start_call',
    {
      title: 'Start call',
      description: 'Start a dial session. Live login can place real calls.',
      inputSchema: z.object({ contactId: z.string() })
    },
    async ({ contactId }) => {
      const contact = findOrgContact(store, actor.orgId, contactId)
      if (!contact) return fail('Contact not found')
      return ok({ call: startPublicCall(store, config, contact, sandbox) })
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
