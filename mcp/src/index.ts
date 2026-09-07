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
      description: 'Current Jargon user, org, and live/sandbox outbound flags for this API key.',
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
      description: 'List Jargon workspaces (dialer / today queue) for this API key.',
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
      description: 'Get one workspace. dashboardPath is relative to https://jargonlabs.co.',
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

  server.registerTool(
    'deploy_tool',
    {
      title: 'Deploy workspace',
      description:
        'Materialize a dialer/today-queue workspace from a prompt. Hydrates contacts from the connected Railway/HubSpot source. Returns projectId, contactCount, dashboardPath.',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('What to deploy, e.g. Today queue for GTM Engineers in the US')
      })
    },
    async ({ prompt }) => {
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt } }))
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
