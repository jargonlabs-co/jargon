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

  const SpecStep = z.object({
    day: z.number().int().min(0).max(30).optional(),
    channel: z.enum(['email', 'call', 'linkedin']),
    label: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional()
  })
  const SpecInput = z
    .object({
      goal: z.string().optional(),
      segment: z.string().optional(),
      primarySurface: z.enum(['queue', 'dial', 'inbox', 'linkedin', 'sequence']).optional(),
      channels: z.array(z.enum(['email', 'call', 'linkedin'])).min(1).max(3).optional(),
      steps: z.array(SpecStep).min(1).max(8).optional()
    })
    .optional()

  const ContactInput = z
    .object({
      name: z.string().min(1).describe('Full name'),
      company: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      city: z.string().optional(),
      linkedinUrl: z.string().optional(),
      linkedin: z.string().optional(),
      notes: z.string().optional(),
      context: z.array(z.string()).optional(),
      attrs: z.record(z.string(), z.unknown()).optional()
    })
    .passthrough()

  server.registerTool(
    'import_list',
    {
      title: 'Import list into an outbound workspace',
      description:
        'Ingest people from anywhere (Crustdata, research, a ranked list, a CSV) and create an outbound tool from that exact list — LinkedIn, email, phone, or a mix. Describe the motion in prompt. Optionally pass spec.channels / spec.primarySurface. contacts is required. Does not read HubSpot or Railway. After success, share dashboardUrl (https://jargonlabs.co/tools/…) — never www.jargonlabs.co/tools.',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('What to build, e.g. LinkedIn queue for these 10 RevOps leaders'),
        contacts: z.array(ContactInput).min(1).max(100).describe('The exact people to put in the queue'),
        spec: SpecInput
      })
    },
    async ({ prompt, contacts, spec }) => {
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt, contacts, spec } }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'deploy_tool',
    {
      title: 'Deploy outbound workspace',
      description:
        'Create an outbound workspace from a prompt. Pass spec to control channels (email, call, linkedin) and which screen opens first. To ingest a researched list, pass contacts[] or put people in prompt. Omit both only to hydrate HubSpot/Railway. After success, share dashboardUrl (https://jargonlabs.co/tools/…) — never www.jargonlabs.co/tools.',
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
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt, contacts, spec } }))
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
        subject: z.string().optional(),
        sendAt: z.union([z.number(), z.string()]).optional()
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

  server.registerTool(
    'get_sequence',
    {
      title: 'Get sequence',
      description:
        'Sequence steps plus field catalog. Show this in Claude. Templates use {{first_name}} and catalog keys.',
      inputSchema: z.object({ projectId: z.string() }),
      annotations: { readOnlyHint: true }
    },
    async ({ projectId }) => {
      try {
        return toolResult(await jargonFetch('GET', `/projects/${projectId}/sequence`))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'update_sequence',
    {
      title: 'Update sequence',
      description: 'Replace sequence steps without redeploying.',
      inputSchema: z.object({
        projectId: z.string(),
        goal: z.string().optional(),
        steps: z.array(SpecStep).min(1).max(8)
      })
    },
    async ({ projectId, goal, steps }) => {
      try {
        return toolResult(
          await jargonFetch('PATCH', `/projects/${projectId}/sequence`, { body: { goal, steps } })
        )
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'save_draft',
    {
      title: 'Save draft',
      description: 'Save proposed copy for a contact. Interpolates catalog fields.',
      inputSchema: z.object({
        contactId: z.string(),
        body: z.string(),
        subject: z.string().optional(),
        channel: z.enum(['email', 'linkedin']).optional()
      })
    },
    async ({ contactId, ...body }) => {
      try {
        return toolResult(
          await jargonFetch('POST', `/contacts/${contactId}/messages`, {
            body: { ...body, status: 'draft' },
            idempotency: true
          })
        )
      } catch (err) {
        return toolError(err)
      }
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
      try {
        return toolResult(
          await jargonFetch('GET', `/projects/${projectId}/messages`, {
            query: { contactId, status: status ?? 'draft' }
          })
        )
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'update_draft',
    {
      title: 'Update draft',
      description: 'Edit draft copy or reschedule sendAt.',
      inputSchema: z.object({
        messageId: z.string(),
        subject: z.string().optional(),
        body: z.string().optional(),
        sendAt: z.union([z.number(), z.string()]).optional()
      })
    },
    async ({ messageId, ...body }) => {
      try {
        return toolResult(await jargonFetch('PATCH', `/messages/${messageId}`, { body }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'send_draft',
    {
      title: 'Send draft',
      description: 'Send a saved draft now.',
      inputSchema: z.object({ messageId: z.string() })
    },
    async ({ messageId }) => {
      try {
        return toolResult(
          await jargonFetch('POST', `/messages/${messageId}/send`, { idempotency: true })
        )
      } catch (err) {
        return toolError(err)
      }
    }
  )

  return server
}

serveStdio(() => createServer())
