import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Router } from 'express'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { requireApiKey, toPublicUser } from './auth'
import { readIdempotency, writeIdempotency } from './idempotency'
import { consumeRateLimit } from './rateLimit'
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
  listPublicProspects,
  listPublicProjects,
  toPublicContact,
  nextQueueContact,
  sendPublicMessage,
  startPublicCall,
  toPublicProject,
  toPublicQueueNext
} from './publicApi'

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

export function createV1Router(store: DataStore, config: ServerConfig): Router {
  const router = Router()
  const auth = requireApiKey(store, config)
  const openapi = loadOpenApi()

  router.get('/openapi.json', (_req, res) => {
    res.json(openapi)
  })

  router.get('/me', auth, (req, res) => {
    const org = req.auth!.org
    const environment = req.auth!.environment
    const sandbox = environment === 'sandbox'
    res.json({
      user: toPublicUser(req.auth!.user),
      org: { id: org.id, name: org.name, slug: org.slug },
      environment,
      outbound: {
        email: sandbox ? 'sandbox' : config.google.refreshToken ? 'live' : 'demo',
        voice: sandbox ? 'sandbox' : config.twilio.accountSid ? 'live' : 'demo',
        linkedin: sandbox ? 'sandbox' : config.heyreach.apiKey ? 'live' : 'demo'
      }
    })
  })

  router.get('/projects', auth, (req, res) => {
    res.json({ projects: listPublicProjects(store, req.auth!.org.id) })
  })

  router.post('/tools/deploy', auth, async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''
    if (!prompt) {
      res.status(400).json({ error: 'prompt required' })
      return
    }
    const result = await deployPublicTool(store, config, req.auth!.org.id, prompt)
    res.status(result.status).json(result.body)
  })

  router.get('/projects/:id', auth, (req, res) => {
    const project = findOrgProject(store, req.auth!.org.id, paramId(req.params.id))
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(toPublicProject(store.db.contacts, project))
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
    res.json(next ? toPublicQueueNext(next) : emptyQueue())
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
    const { subject, body, status, channel } = req.body as {
      subject?: string
      body?: string
      status?: 'draft' | 'queued' | 'sent'
      channel?: 'email' | 'linkedin'
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
    const result = await sendPublicMessage(store, config, contact, {
      subject,
      body,
      status,
      channel,
      sandbox: req.auth!.environment === 'sandbox'
    })
    writeIdempotency(store, req.auth!.org.id, idemKey, 'POST', path, result.status, result.body)
    res.status(result.status).json(result.body)
  })

  router.post('/contacts/:id/calls', auth, (req, res) => {
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
    const call = startPublicCall(store, config, contact, req.auth!.environment === 'sandbox')
    const body = { call }
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

  return router
}
