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

// Claude renders the raw argument object on its approval card and truncates it
// after a few lines, so whichever field a tool declares first is what the user
// actually reads. `summary` is declared first on every tool that writes so the
// card opens with a sentence instead of a wall of JSON. It never reaches the API.
// Optional, not required: the in-chat workspace calls these same tools from
// button clicks without one, and those calls never surface an approval card.
const Summary = z
  .string()
  .min(1)
  .max(160)
  .optional()
  .describe(
    'Always provide this. One plain-language sentence telling the user what this call will do, shown on the approval card before it runs. Name the people, workspace, or channel involved. No ids, field names, tool names, or JSON. Example: "Add 12 RevOps leaders to a new outbound queue."'
  )

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

function createServer(): McpServer {
  const server = new McpServer({ name: 'jargon', version: '0.1.0' })

  server.registerTool(
    'get_me',
    {
      ...display('Check your Jargon account', HINTS.read),
      description: 'Current Jargon user, org, plan, credit balance, and live/sandbox outbound flags.'
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
      ...display('Check your credit balance', HINTS.read),
      description:
        'Remaining API credits, monthly grant, and refresh date. Free — does not consume credits.'
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
      ...display('Check your usage this period', HINTS.read),
      description: 'Credit and outbound usage for the current billing period.'
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
      ...display('Open your billing page', HINTS.send),
      description:
        'Return a URL to upgrade, buy credits, or open the billing portal. Do not collect card details — send the user to this URL.',
      inputSchema: z.object({
        summary: Summary,
        intent: z.enum(['upgrade', 'topup', 'portal']),
        plan: z.enum(['team', 'scale']).optional(),
        packId: z.enum(['credits_500', 'credits_2000', 'credits_10000']).optional()
      })
    },
    async ({ summary: _summary, ...body }) => {
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
      ...display('Look up your prospects', HINTS.read),
      description:
        'List prospects already in this org (CRM/warehouse snapshots). Do not cache PII locally. Do not pass org_id.',
      inputSchema: z.object({
        projectId: z.string().optional().describe('Limit to one workspace'),
        status: ContactStatus.optional(),
        q: z.string().optional().describe('Search name, company, title, email, city'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      })
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
      ...display('Look up one prospect', HINTS.read),
      description: 'Get one prospect by id.',
      inputSchema: z.object({ id: z.string() })
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
      ...display('List your outbound workspaces', HINTS.read),
      description: 'List Jargon workspaces for this API key. Share each project.dashboardUrl (https://jargonlabs.co/tools/…), not www.'
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
      ...display('Open one outbound workspace', HINTS.read),
      description:
        'Get one workspace. Share dashboardUrl with the user (https://jargonlabs.co/tools/…). Never prefix dashboardPath with www.jargonlabs.co — that host is the API.',
      inputSchema: z.object({ id: z.string() })
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
      ...display('Add these people to an outbound list', HINTS.write),
      description:
        'Ingest people and create an outbound workspace. summary is the sentence on Claude\'s Allow card. Put people in workspace as a markdown table or CSV — never as a contacts array. Jargon sequences everyone into Tasks. Then research each contact and save_research talk tracks / email / LinkedIn copy. After success, share dashboardUrl (https://jargonlabs.co/tools/…) — never www.jargonlabs.co/tools.',
      inputSchema: z.object({
        summary: Summary,
        workspace: z
          .string()
          .min(1)
          .describe(
            'What to build, plus the people as a markdown table or CSV (Name, Company, Title, Email, LinkedIn). Do not pass a contacts array.'
          )
      })
    },
    async ({ workspace }) => {
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt: workspace } }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'deploy_tool',
    {
      ...display('Set up a new outbound workspace', HINTS.write),
      description:
        'Create an outbound workspace. summary is the sentence on Claude\'s Allow card. Describe the cadence in workspace (days, channels). Jargon builds the tool and sequences everyone into Tasks. Then research each company/prospect and save_research personalized copy — do not treat {{first_name}} placeholders as the send copy. Include a markdown people table or CSV to ingest a list, or omit the table to hydrate HubSpot/Railway. After success, share dashboardUrl (https://jargonlabs.co/tools/…) — never www.jargonlabs.co/tools.',
      inputSchema: z.object({
        summary: Summary,
        workspace: z
          .string()
          .min(1)
          .describe(
            'What to build. Include a markdown people table to ingest a list, or omit the table to hydrate HubSpot/Railway.'
          )
      })
    },
    async ({ workspace }) => {
      try {
        return toolResult(await jargonFetch('POST', '/tools/deploy', { body: { prompt: workspace } }))
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'add_contacts',
    {
      ...display('Add more people to an existing list', HINTS.write),
      description: 'Append people from any source to an existing workspace queue.',
      inputSchema: z.object({
        summary: Summary,
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
      ...display('Show the next person in the queue', HINTS.read),
      description: 'Next actionable contact plus current step template. Empty queue returns remaining: 0.',
      inputSchema: z.object({ projectId: z.string() })
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
      ...display('Send an email or LinkedIn message', HINTS.send),
      description:
        'Send (default) or draft an email/LinkedIn message. Live keys send real email. Always sends Idempotency-Key.',
      inputSchema: z.object({
        summary: Summary,
        contactId: z.string(),
        body: z.string(),
        channel: z.enum(['email', 'linkedin']).optional(),
        status: z.enum(['draft', 'queued', 'sent']).optional(),
        subject: z.string().optional(),
        sendAt: z.union([z.number(), z.string()]).optional()
      })
    },
    async ({ contactId, summary: _summary, ...body }) => {
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
      ...display('Start a call', HINTS.send),
      description: 'Start a dial session. Live keys can place real calls. Always sends Idempotency-Key.',
      inputSchema: z.object({ summary: Summary, contactId: z.string() })
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
      ...display('Log how a call ended', HINTS.write),
      description: 'Complete an open call with a disposition.',
      inputSchema: z.object({
        summary: Summary,
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
      ...display('Log an outcome on a contact', HINTS.write),
      description: 'Log an outcome on a contact without an open call.',
      inputSchema: z.object({
        summary: Summary,
        contactId: z.string(),
        status: ContactStatus,
        note: z.string().optional(),
        advanceStep: z.boolean().optional()
      })
    },
    async ({ contactId, summary: _summary, ...body }) => {
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
      ...display('Add a note to a contact', HINTS.write),
      description: 'Append a note to a contact.',
      inputSchema: z.object({
        summary: Summary,
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
      ...display('Open the outbound workspace', HINTS.read),
      description:
        'Sequence steps plus field catalog. Shared fallback templates may use {{first_name}}. Personalized send copy lives on drafts — research each prospect and save_draft.',
      inputSchema: z.object({ projectId: z.string() })
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
      ...display('Rewrite the cadence steps', HINTS.overwrite),
      description:
        'Change cadence structure (days, channels, labels) without redeploying. Do not put per-person researched copy here — use save_draft.',
      inputSchema: z.object({
        summary: Summary,
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
    'start_sequence',
    {
      ...display('Start sending the cadence', HINTS.send),
      description:
        'Enroll contacts into the cadence. Deploy already enrolls cadences and dialers. Keeps copy already saved with save_draft / save_research.',
      inputSchema: z.object({
        summary: Summary,
        projectId: z.string(),
        startAt: z.union([z.number(), z.string()]).optional(),
        contactIds: z.array(z.string()).optional()
      })
    },
    async ({ projectId, startAt, contactIds }) => {
      try {
        return toolResult(
          await jargonFetch('POST', `/projects/${projectId}/sequence/start`, {
            body: { startAt, contactIds }
          })
        )
      } catch (err) {
        return toolError(err)
      }
    }
  )

  server.registerTool(
    'save_draft',
    {
      ...display('Save a draft message', HINTS.write),
      description:
        'Save researched, personalized copy for a contact. Overwrites any placeholder template for that step. Pass stepId or day for follow-ups.',
      inputSchema: z.object({
        summary: Summary,
        contactId: z.string(),
        body: z.string(),
        subject: z.string().optional(),
        channel: z.enum(['email', 'linkedin']).optional(),
        stepId: z.string().optional(),
        day: z.number().int().min(0).max(30).optional()
      })
    },
    async ({ contactId, summary: _summary, ...body }) => {
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
    'save_research',
    {
      ...display('Save researched copy for the list', HINTS.write),
      description:
        'Save researched talk tracks, email copy, and LinkedIn notes for every contact in one Allow, then Tasks is ready. research is a JSON array of {contactId, channel, body, subject?, stepId?, context?}. Call this immediately after import_list / deploy_tool.',
      inputSchema: z.object({
        summary: Summary,
        projectId: z.string(),
        research: z
          .string()
          .min(1)
          .describe(
            'JSON array of {contactId, channel: email|linkedin|call, body, subject?, stepId?, context?: string[]}'
          )
      })
    },
    async ({ projectId, research }) => {
      try {
        return toolResult(
          await jargonFetch('POST', `/projects/${projectId}/research`, {
            body: { research },
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
      ...display('List saved drafts', HINTS.read),
      description: 'List draft or queued messages in a workspace.',
      inputSchema: z.object({
        projectId: z.string(),
        contactId: z.string().optional(),
        status: z.enum(['draft', 'queued', 'sent', 'failed']).optional()
      })
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
      ...display('Edit a saved draft', HINTS.write),
      description: 'Edit draft copy or reschedule sendAt.',
      inputSchema: z.object({
        summary: Summary,
        messageId: z.string(),
        subject: z.string().optional(),
        body: z.string().optional(),
        sendAt: z.union([z.number(), z.string()]).optional()
      })
    },
    async ({ messageId, summary: _summary, ...body }) => {
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
      ...display('Send a saved draft now', HINTS.send),
      description: 'Send a saved draft now.',
      inputSchema: z.object({ summary: Summary, messageId: z.string() })
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
