import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Router } from 'express'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { requireApiKey, toPublicUser } from './auth'
import { readIdempotency, writeIdempotency } from './idempotency'
import { consumeRateLimit } from './rateLimit'
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
  getPublicSequence,
  isContactStatus,
  listPublicContacts,
  listPublicMessages,
  listPublicProspects,
  listPublicProjects,
  toPublicContact,
  nextQueueContact,
  patchPublicMessage,
  sendPublicMessage,
  startPublicCall,
  toPublicProject,
  toPublicQueueNext,
  updatePublicSequence
} from './publicApi'
import type { BillingService } from './billing/types'
import { chargeIfLive, meBillingFields, projectNamesFor, refundCredits } from './billing'
import { claudeConnectorStatus } from './mcpOauth'
import { inspectTwilioVoice } from './providers/twilio'

function paramId(value: string | string[] | undefined): string {
  if (!value) return ''
  return Array.isArray(value) ? value[0] : value
}

function loadOpenApi(): unknown {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(process.cwd(), 'openapi.json'),
    join(here, '../../openapi.json')
  ]
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      /* try next */
    }
  }
  return { error: 'openapi.json not found' }
}

function parseSendAt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const asNum = Number(value)
    if (Number.isFinite(asNum) && value.trim() !== '') return asNum
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function idempotencyHeader(req: { header: (n: string) => string | undefined }): string {
  return (req.header('idempotency-key') ?? '').trim()
}

function parseContactListQuery(req: {
  query: { status?: unknown; q?: unknown; limit?: unknown; offset?: unknown }
}):
  | { ok: true; status?: import('./types').ContactStatus; q?: string; limit?: number; offset?: number }
  | { ok: false; error: string } {
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined
  let status: import('./types').ContactStatus | undefined
  if (statusRaw !== undefined) {
    if (!isContactStatus(statusRaw)) return { ok: false, error: 'invalid status' }
    status = statusRaw
  }
  const limit = req.query.limit ? Number(req.query.limit) : undefined
  const offset = req.query.offset ? Number(req.query.offset) : undefined
  if (
    (limit !== undefined && !Number.isFinite(limit)) ||
    (offset !== undefined && !Number.isFinite(offset))
  ) {
    return { ok: false, error: 'limit and offset must be numbers' }
  }
  return {
    ok: true,
    status,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    limit,
    offset
  }
}

export function createV1Router(store: DataStore, config: ServerConfig, billing: BillingService): Router {
  const router = Router()
  const auth = requireApiKey(store, config)
  const openapi = loadOpenApi()

  router.get('/openapi.json', (_req, res) => {
    res.json(openapi)
  })

  router.get('/me', auth, async (req, res) => {
    const org = req.auth!.org
    const environment = req.auth!.environment
    const sandbox = environment === 'sandbox'
    const credits = await billing.getCredits(org.id)
    res.json({
      user: toPublicUser(req.auth!.user),
      org: { id: org.id, name: org.name, slug: org.slug },
      environment,
      outbound: {
        email: sandbox ? 'sandbox' : config.google.refreshToken ? 'live' : 'demo',
        voice: sandbox ? 'sandbox' : inspectTwilioVoice(config).ok ? 'live' : 'demo',
        linkedin: sandbox ? 'sandbox' : config.heyreach.apiKey ? 'live' : 'demo'
      },
      ...meBillingFields(credits),
      claude: claudeConnectorStatus(store, config, org.id)
    })
  })

  router.get('/account/credits', auth, async (req, res) => {
    res.json(await billing.getCredits(req.auth!.org.id))
  })

  router.get('/account/usage', auth, async (req, res) => {
    res.json(await billing.getUsage(req.auth!.org.id, projectNamesFor(store, req.auth!.org.id)))
  })

  router.post('/account/billing-link', auth, async (req, res) => {
    const intent = req.body?.intent as 'upgrade' | 'topup' | 'portal' | undefined
    if (intent !== 'upgrade' && intent !== 'topup' && intent !== 'portal') {
      res.status(400).json({ error: 'intent must be upgrade, topup, or portal' })
      return
    }
    try {
      const link = await billing.createBillingLink({
        orgId: req.auth!.org.id,
        email: req.auth!.user.email,
        name: req.auth!.org.name,
        intent,
        plan: req.body?.plan,
        packId: req.body?.packId
      })
      res.json(link)
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not create billing link' })
    }
  })

  router.get('/projects', auth, (req, res) => {
    res.json({ projects: listPublicProjects(store, req.auth!.org.id, config.appUrl) })
  })

  router.post('/tools/deploy', auth, async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''
    if (!prompt) {
      res.status(400).json({ error: 'prompt required' })
      return
    }
    const parsed = parseDeployContacts(req.body?.contacts)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }
    const result = await deployPublicTool(
      store,
      config,
      req.auth!.org.id,
      prompt,
      parsed.contacts,
      req.body?.spec
    )
    res.status(result.status).json(result.body)
  })

  router.get('/projects/:id', auth, (req, res) => {
    const project = findOrgProject(store, req.auth!.org.id, paramId(req.params.id))
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(toPublicProject(store.db.contacts, project, config.appUrl))
  })

  router.get('/projects/:id/contacts', auth, (req, res) => {
    const project = findOrgProject(store, req.auth!.org.id, paramId(req.params.id))
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const parsed = parseContactListQuery(req)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }
    res.json(listPublicContacts(store, project.id, parsed))
  })

  router.post('/projects/:id/contacts', auth, (req, res) => {
    const project = findOrgProject(store, req.auth!.org.id, paramId(req.params.id))
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const parsed = parseRequiredContacts(req.body?.contacts)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }
    const result = addPublicContacts(store, req.auth!.org.id, project.id, parsed.contacts)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    res.status(201).json(result)
  })

  router.get('/prospects', auth, (req, res) => {
    const parsed = parseContactListQuery(req)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined
    if (projectId && !findOrgProject(store, req.auth!.org.id, projectId)) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(
      listPublicProspects(store, {
        orgId: req.auth!.org.id,
        projectId,
        status: parsed.status,
        q: parsed.q,
        limit: parsed.limit,
        offset: parsed.offset
      })
    )
  })

  router.get('/prospects/:id', auth, (req, res) => {
    const contact = findOrgContact(store, req.auth!.org.id, paramId(req.params.id))
    if (!contact) {
      res.status(404).json({ error: 'Prospect not found' })
      return
    }
    res.json(toPublicContact(contact))
  })

  router.get('/projects/:id/queue/next', auth, (req, res) => {
    const project = findOrgProject(store, req.auth!.org.id, paramId(req.params.id))
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const next = nextQueueContact(store.db, project.id)
    res.json(next ? toPublicQueueNext(next, project.fieldCatalog) : emptyQueue())
  })

  router.post('/contacts/:id/messages', auth, async (req, res) => {
    const idemKey = idempotencyHeader(req)
    if (!idemKey) {
      res.status(400).json({ error: 'Idempotency-Key required', code: 'idempotency_required' })
      return
    }
    const path = req.originalUrl.split('?')[0] ?? req.path
    const prior = readIdempotency(store, req.auth!.org.id, idemKey, 'POST', path)
    if ('conflict' in prior && prior.conflict) {
      res.status(422).json({ error: 'Idempotency-Key reused for a different request', code: 'idempotency_conflict' })
      return
    }
    if ('hit' in prior && prior.hit) {
      res.setHeader('Idempotent-Replay', 'true')
      res.status(prior.status).json(prior.body)
      return
    }
    const limited = consumeRateLimit(store, req.auth!.org.id, 'message', req.auth!.environment)
    if (!limited.ok) {
      res.setHeader('Retry-After', String(limited.retryAfterSec))
      res.status(429).json({ error: 'Rate limit exceeded', code: 'rate_limited' })
      return
    }
    const contact = findOrgContact(store, req.auth!.org.id, paramId(req.params.id))
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const { subject, body, status, channel, sendAt } = req.body as {
      subject?: string
      body?: string
      status?: 'draft' | 'queued' | 'sent'
      channel?: 'email' | 'linkedin'
      sendAt?: number | string
    }
    if (body === undefined || typeof body !== 'string') {
      res.status(400).json({ error: 'body required' })
      return
    }
    if (status && !['draft', 'queued', 'sent'].includes(status)) {
      res.status(400).json({ error: 'invalid status' })
      return
    }
    if (channel && channel !== 'email' && channel !== 'linkedin') {
      res.status(400).json({ error: 'invalid channel' })
      return
    }
    if (status === 'queued' && sendAt == null) {
      res.status(400).json({ error: 'sendAt is required when status is queued' })
      return
    }
    const sendAtMs = parseSendAt(sendAt)
    if (status === 'queued' && sendAtMs == null) {
      res.status(400).json({ error: 'sendAt must be a unix timestamp (ms) or ISO date' })
      return
    }
    const sandbox = req.auth!.environment === 'sandbox'
    const willSend = (status ?? 'sent') === 'sent'
    const billableReason = channel === 'linkedin' ? 'linkedin' : 'email'
    let charge: Awaited<ReturnType<typeof chargeIfLive>> | null = null
    if (willSend) {
      charge = await chargeIfLive(billing, {
        orgId: req.auth!.org.id,
        sandbox,
        reason: billableReason,
        projectId: contact.projectId,
        apiKeyId: req.auth!.apiKeyId
      })
      if (!charge.ok) {
        res.status(402).json({
          error: charge.error,
          code: charge.code,
          billingUrl: charge.billingUrl,
          remaining: charge.remaining
        })
        return
      }
      res.setHeader('X-Credits-Used', String(charge.creditsUsed))
      res.setHeader('X-Credits-Remaining', String(charge.remaining))
    }
    const result = await sendPublicMessage(store, config, contact, {
      subject,
      body,
      status,
      channel,
      sandbox,
      sendAt: sendAtMs
    })
    if (!result.ok && charge?.ok && charge.creditsUsed > 0) {
      await refundCredits(billing, req.auth!.org.id, charge.creditsUsed, 'refund')
    }
    const payload =
      result.ok && charge?.ok
        ? { ...result.body, creditsUsed: charge.creditsUsed, creditsRemaining: charge.remaining }
        : result.body
    writeIdempotency(store, req.auth!.org.id, idemKey, 'POST', path, result.status, payload)
    res.status(result.status).json(payload)
  })

  router.post('/contacts/:id/calls', auth, async (req, res) => {
    const idemKey = idempotencyHeader(req)
    if (!idemKey) {
      res.status(400).json({ error: 'Idempotency-Key required', code: 'idempotency_required' })
      return
    }
    const path = req.originalUrl.split('?')[0] ?? req.path
    const prior = readIdempotency(store, req.auth!.org.id, idemKey, 'POST', path)
    if ('conflict' in prior && prior.conflict) {
      res.status(422).json({ error: 'Idempotency-Key reused for a different request', code: 'idempotency_conflict' })
      return
    }
    if ('hit' in prior && prior.hit) {
      res.setHeader('Idempotent-Replay', 'true')
      res.status(prior.status).json(prior.body)
      return
    }
    const limited = consumeRateLimit(store, req.auth!.org.id, 'call', req.auth!.environment)
    if (!limited.ok) {
      res.setHeader('Retry-After', String(limited.retryAfterSec))
      res.status(429).json({ error: 'Rate limit exceeded', code: 'rate_limited' })
      return
    }
    const contact = findOrgContact(store, req.auth!.org.id, paramId(req.params.id))
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const sandbox = req.auth!.environment === 'sandbox'
    const charge = await chargeIfLive(billing, {
      orgId: req.auth!.org.id,
      sandbox,
      reason: 'call',
      projectId: contact.projectId,
      apiKeyId: req.auth!.apiKeyId
    })
    if (!charge.ok) {
      res.status(402).json({
        error: charge.error,
        code: charge.code,
        billingUrl: charge.billingUrl,
        remaining: charge.remaining
      })
      return
    }
    const call = startPublicCall(store, config, contact, sandbox)
    const body = { call, creditsUsed: charge.creditsUsed, creditsRemaining: charge.remaining }
    res.setHeader('X-Credits-Used', String(charge.creditsUsed))
    res.setHeader('X-Credits-Remaining', String(charge.remaining))
    writeIdempotency(store, req.auth!.org.id, idemKey, 'POST', path, 201, body)
    res.status(201).json(body)
  })

  router.post('/calls/:id/complete', auth, (req, res) => {
    const { disposition } = req.body as { disposition?: string }
    if (!isContactStatus(disposition)) {
      res.status(400).json({ error: 'valid disposition required' })
      return
    }
    const call = findOrgCall(store, req.auth!.org.id, paramId(req.params.id))
    if (!call) {
      res.status(404).json({ error: 'Call not found' })
      return
    }
    res.json(completePublicCall(store, call.id, disposition))
  })

  router.post('/contacts/:id/disposition', auth, (req, res) => {
    const { status, note, advanceStep } = req.body as {
      status?: string
      note?: string
      advanceStep?: boolean
    }
    if (!isContactStatus(status)) {
      res.status(400).json({ error: 'valid status required' })
      return
    }
    const contact = findOrgContact(store, req.auth!.org.id, paramId(req.params.id))
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    res.json(applyDisposition(store, contact.id, { status, note, advanceStep }))
  })

  router.post('/contacts/:id/notes', auth, (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : ''
    if (!note.trim()) {
      res.status(400).json({ error: 'note required' })
      return
    }
    const contact = findOrgContact(store, req.auth!.org.id, paramId(req.params.id))
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    res.json({ contact: addPublicNote(store, contact.id, note) })
  })

  router.get('/projects/:id/sequence', auth, (req, res) => {
    const sequence = getPublicSequence(store, req.auth!.org.id, paramId(req.params.id))
    if (!sequence) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(sequence)
  })

  router.patch('/projects/:id/sequence', auth, (req, res) => {
    const result = updatePublicSequence(store, req.auth!.org.id, paramId(req.params.id), {
      goal: typeof req.body?.goal === 'string' ? req.body.goal : undefined,
      steps: req.body?.steps
    })
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    res.json(result.sequence)
  })

  router.get('/projects/:id/messages', auth, (req, res) => {
    const project = findOrgProject(store, req.auth!.org.id, paramId(req.params.id))
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined
    if (statusRaw && !['draft', 'queued', 'sent', 'failed'].includes(statusRaw)) {
      res.status(400).json({ error: 'invalid status' })
      return
    }
    res.json(
      listPublicMessages(store, {
        orgId: req.auth!.org.id,
        projectId: project.id,
        contactId: typeof req.query.contactId === 'string' ? req.query.contactId : undefined,
        status: statusRaw as 'draft' | 'queued' | 'sent' | 'failed' | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined
      })
    )
  })

  router.patch('/messages/:id', auth, (req, res) => {
    const sendAtMs = parseSendAt(req.body?.sendAt)
    const result = patchPublicMessage(store, req.auth!.org.id, paramId(req.params.id), {
      subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
      body: typeof req.body?.body === 'string' ? req.body.body : undefined,
      status:
        req.body?.status === 'draft' || req.body?.status === 'queued' ? req.body.status : undefined,
      sendAt: sendAtMs
    })
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    res.json({ message: result.message })
  })

  router.post('/messages/:id/send', auth, async (req, res) => {
    const message = findOrgMessage(store, req.auth!.org.id, paramId(req.params.id))
    if (!message) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    const sandbox = req.auth!.environment === 'sandbox'
    const charge = await chargeIfLive(billing, {
      orgId: req.auth!.org.id,
      sandbox,
      reason: message.channel === 'linkedin' ? 'linkedin' : 'email',
      projectId: message.projectId,
      apiKeyId: req.auth!.apiKeyId
    })
    if (!charge.ok) {
      res.status(402).json({
        error: charge.error,
        code: charge.code,
        billingUrl: charge.billingUrl,
        remaining: charge.remaining
      })
      return
    }
    const result = await deliverPublicMessage(
      store,
      config,
      req.auth!.org.id,
      message.id,
      sandbox
    )
    if (!result.ok && charge.creditsUsed > 0) {
      await refundCredits(billing, req.auth!.org.id, charge.creditsUsed, 'refund')
    }
    if (!result.ok) {
      res.status(result.status).json(result.body)
      return
    }
    res.setHeader('X-Credits-Used', String(charge.creditsUsed))
    res.setHeader('X-Credits-Remaining', String(charge.remaining))
    res.json({
      ...result.body,
      creditsUsed: charge.creditsUsed,
      creditsRemaining: charge.remaining
    })
  })

  return router
}
