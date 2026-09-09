#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { jargonFetch, toolError, toolResult } from './client.js'

const ContactStatus = z.enum([
  'queued',
  'active',
  'completed',
  'replied',
  'no_answer',
  'interested',
  'not_interested'
])

function createServer(): McpServer {
  const server = new McpServer({ name: 'jargon', version: '0.1.0' })

  server.registerTool(
    'get_me',
    {
      title: 'Who am I',
      description: 'Current Jargon user, org, plan, credit balance, and live/sandbox outbound flags.',
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        return toolResult(await jargonFetch('GET', '/me'))
      } catch (err) {
        return toolError(err)
      }
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
    async () => {
      try {
        return toolResult(await jargonFetch('GET', '/account/credits'))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'get_usage',
    {
      title: 'Get usage',
      description: 'Credit and outbound usage for the current billing period.',
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        return toolResult(await jargonFetch('GET', '/account/usage'))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'create_billing_link',
    {
      title: 'Create billing link',
      description:
        'Return a URL to upgrade, buy credits, or open the billing portal. Do not collect card details — send the user to this URL.',
      inputSchema: z.object({
        intent: z.enum(['upgrade', 'topup', 'portal']),
        plan: z.enum(['team', 'scale']).optional(),
        packId: z.enum(['credits_500', 'credits_2000', 'credits_10000']).optional()
      })
    },
    async (body) => {
      try {
        return toolResult(await jargonFetch('POST', '/account/billing-link', { body }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'list_prospects',
    {
      title: 'List prospects',
      description:
        'List prospects already in this org (CRM/warehouse snapshots). Do not cache PII locally. Do not pass org_id.',
      inputSchema: z.object({
        projectId: z.string().optional().describe('Limit to one workspace'),
        status: ContactStatus.optional(),
        q: z.string().optional().describe('Search name, company, title, email, city'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      }),
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      try {
        return toolResult(await jargonFetch('GET', '/prospects', { query: args }))
      } catch (err) {
        return toolError(err)
      }
    }
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
      try {
        return toolResult(await jargonFetch('GET', `/prospects/${id}`))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List workspaces',
      description: 'List Jargon workspaces for this API key. Share each project.dashboardUrl (https://jargonlabs.co/tools/…), not www.',
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        return toolResult(await jargonFetch('GET', '/projects'))
      } catch (err) {
        return toolError(err)
      }
    }
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
      try {
        return toolResult(await jargonFetch('GET', `/projects/${id}`))
      } catch (err) {
        return toolError(err)
      }
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
    linkedin: z.string().optional(),
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
        prompt: z.string().min(1).describe('What to build, e.g. Dialer for these 10 RevOps leaders'),
        contacts: z.array(ContactInput).min(1).max(100).describe('The exact people to put in the queue')
      })
    },
    async ({ prompt, contacts }) => {
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt, contacts } }))
      } catch (err) {
        return toolError(err)
      }
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
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt, contacts } }))
      } catch (err) {
        return toolError(err)
      }
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
      try {
        return toolResult(
          await jargonFetch('POST', `/projects/${projectId}/contacts`, { body: { contacts } })
        )
      } catch (err) {
        return toolError(err)
      }
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
      try {
        return toolResult(await jargonFetch('GET', `/projects/${projectId}/contacts`, { query }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'queue_next',
    {
      title: 'Next in queue',
      description: 'Next actionable contact plus current step template. Empty queue returns remaining: 0.',
      inputSchema: z.object({ projectId: z.string() }),
      annotations: { readOnlyHint: true }
    },
    async ({ projectId }) => {
      try {
        return toolResult(await jargonFetch('GET', `/projects/${projectId}/queue/next`))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'send_message',
    {
      title: 'Send email or LinkedIn',
      description:
        'Send (default) or draft an email/LinkedIn message. Live keys send real email. Always sends Idempotency-Key.',
      inputSchema: z.object({
        contactId: z.string(),
        body: z.string(),
        channel: z.enum(['email', 'linkedin']).optional(),
        status: z.enum(['draft', 'queued', 'sent']).optional(),
        subject: z.string().optional()
      })
    },
    async ({ contactId, ...body }) => {
      try {
        return toolResult(
          await jargonFetch('POST', `/contacts/${contactId}/messages`, { body, idempotency: true })
        )
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'start_call',
    {
      title: 'Start call',
      description: 'Start a dial session. Live keys can place real calls. Always sends Idempotency-Key.',
      inputSchema: z.object({ contactId: z.string() })
    },
    async ({ contactId }) => {
      try {
        return toolResult(
          await jargonFetch('POST', `/contacts/${contactId}/calls`, { idempotency: true })
        )
      } catch (err) {
        return toolError(err)
      }
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
      try {
        return toolResult(
          await jargonFetch('POST', `/calls/${callId}/complete`, { body: { disposition } })
        )
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'disposition',
    {
      title: 'Log disposition',
      description: 'Log an outcome on a contact without an open call.',
      inputSchema: z.object({
        contactId: z.string(),
        status: ContactStatus,
        note: z.string().optional(),
        advanceStep: z.boolean().optional()
      })
    },
    async ({ contactId, ...body }) => {
      try {
        return toolResult(await jargonFetch('POST', `/contacts/${contactId}/disposition`, { body }))
      } catch (err) {
        return toolError(err)
      }
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
      try {
        return toolResult(await jargonFetch('POST', `/contacts/${contactId}/notes`, { body: { note } }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  return server
}

serveStdio(() => createServer())
