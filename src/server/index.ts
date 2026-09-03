import express from 'express'
import cors from 'cors'
import type { Server } from 'http'
import type { DataStore } from './store'
import { analyticsFor, bundleProject } from './queries'
import type { ContactStatus, MessageStatus, ProjectKind } from './types'
import { loadConfig, type ServerConfig } from './config'
import {
  authPayload,
  createSession,
  destroySession,
  provisionLocalTenant,
  requireAuth,
  toPublicUser
} from './auth'
import { hashPassword, uid, verifyPassword } from './crypto'
import {
  ensureSupabaseUser,
  signInWithPassword,
  signUpWithPassword,
  supabaseConfigured
} from './providers/supabaseAuth'
import {
  consumeOAuthState,
  getConnection,
  readSecrets,
  toPublicConnection,
  upsertConnection
} from './connections'
import { sendPlatformGmail } from './providers/gmail'
import {
  createTwilioVoiceToken,
  voiceTwiml
} from './providers/twilio'
import {
  sendHeyReachLinkedInMessage
} from './providers/heyreach'
import {
  exchangeHubSpotCode,
  fetchHubSpotContacts,
  finishHubSpotOAuthHtml,
  hubspotAuthUrl,
  writeHubSpotContactsToProjects
} from './providers/hubspot'
import { createApiKey, listApiKeys, revokeApiKey } from './apiKeys'
import { listPortalBuilds } from './portal'
import { inferDeployParams } from './deploy'
import { createProjectRecord } from './projectCreate'

export function createApi(store: DataStore, config: ServerConfig = loadConfig()) {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))

  const auth = requireAuth(store, config)
  const paramId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      multiTenant: true,
      demoMode: config.demoMode,
      providers: {
        hubspot: config.hubspot.clientId ? 'live' : 'demo',
        gmail: config.google.refreshToken ? 'live' : 'demo',
        twilio:
          config.twilio.accountSid &&
          config.twilio.apiKeySid &&
          config.twilio.apiKeySecret &&
          config.twilio.twimlAppSid
            ? 'live'
            : 'demo',
        heyreach: config.heyreach.apiKey ? 'live' : 'unset',
        auth: supabaseConfigured(config) ? 'supabase' : 'local'
      },
      publicUrl: config.publicUrl,
      storage: process.env.DATABASE_URL ? 'postgres' : 'json',
      userCount: store.db.users.length,
      features: { deploy: true, cli: true }
    })
  })

  // ——— Auth (Supabase-backed when configured) ———
  app.post('/auth/register', async (req, res) => {
    const { email, password, name, orgName } = req.body as {
      email?: string
      password?: string
      name?: string
      orgName?: string
    }
    if (!email?.trim() || !password || password.length < 6) {
      res.status(400).json({ error: 'email and password (6+ chars) required' })
      return
    }
    const normalized = email.trim().toLowerCase()

    if (supabaseConfigured(config)) {
      try {
        if (store.db.users.some((u) => u.email === normalized)) {
          res.status(409).json({ error: 'Email already registered' })
          return
        }
        const { accessToken, supabaseUser } = await signUpWithPassword(config, {
          email: normalized,
          password,
          name: name?.trim()
        })
        const { user, org } = provisionLocalTenant(store, {
          email: normalized,
          name: name?.trim(),
          orgName: orgName?.trim(),
          supabaseUserId: supabaseUser.id
        })
        res.status(201).json(authPayload(store, accessToken, user, org))
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Register failed' })
      }
      return
    }

    if (store.db.users.some((u) => u.email === normalized)) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }
    const now = Date.now()
    const { hash, salt } = hashPassword(password)
    const userId = uid('user')
    const orgId = uid('org')
    store.update((db) => {
      db.users.push({
        id: userId,
        email: normalized,
        name: name?.trim() || normalized.split('@')[0],
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: now,
        updatedAt: now
      })
      db.orgs.push({
        id: orgId,
        name: orgName?.trim() || `${name || 'My'} Workspace`,
        slug: `${normalized.split('@')[0]}-${orgId.slice(-6)}`,
        createdAt: now,
        updatedAt: now
      })
      db.memberships.push({
        id: uid('mem'),
        orgId,
        userId,
        role: 'owner',
        createdAt: now
      })
    })
    const user = store.db.users.find((u) => u.id === userId)!
    const org = store.db.orgs.find((o) => o.id === orgId)!
    const { token } = createSession(store, userId, orgId)
    res.status(201).json(authPayload(store, token, user, org))
  })

  app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' })
      return
    }
    const normalized = email.trim().toLowerCase()

    if (supabaseConfigured(config)) {
      try {
        let accessToken: string
        let supabaseUserId: string
        try {
          const signed = await signInWithPassword(config, { email: normalized, password })
          accessToken = signed.accessToken
          supabaseUserId = signed.supabaseUser.id
        } catch {
          // Legacy local-password users: migrate into Supabase on successful verify.
          const legacy = store.db.users.find((u) => u.email === normalized)
          if (
            !legacy?.passwordHash ||
            !legacy.passwordSalt ||
            !verifyPassword(password, legacy.passwordHash, legacy.passwordSalt)
          ) {
            res.status(401).json({ error: 'Invalid credentials' })
            return
          }
          await ensureSupabaseUser(config, {
            email: normalized,
            password,
            name: legacy.name
          })
          const signed = await signInWithPassword(config, { email: normalized, password })
          accessToken = signed.accessToken
          supabaseUserId = signed.supabaseUser.id
          store.update((db) => {
            const row = db.users.find((u) => u.id === legacy.id)
            if (row) {
              row.supabaseUserId = supabaseUserId
              row.passwordHash = undefined
              row.passwordSalt = undefined
              row.updatedAt = Date.now()
            }
          })
        }

        const { user, org } = provisionLocalTenant(store, {
          email: normalized,
          supabaseUserId
        })
        res.json(authPayload(store, accessToken, user, org))
      } catch (err) {
        res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid credentials' })
      }
      return
    }

    const user = store.db.users.find((u) => u.email === normalized)
    if (
      !user ||
      !user.passwordHash ||
      !user.passwordSalt ||
      !verifyPassword(password, user.passwordHash, user.passwordSalt)
    ) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }
    const membership = store.db.memberships.find((m) => m.userId === user.id)
    const org = membership && store.db.orgs.find((o) => o.id === membership.orgId)
    if (!org) {
      res.status(500).json({ error: 'No organization for user' })
      return
    }
    const { token } = createSession(store, user.id, org.id)
    res.json(authPayload(store, token, user, org))
  })

  app.post('/auth/logout', auth, (req, res) => {
    if (req.auth!.via === 'session') {
      destroySession(store, req.auth!.token)
    }
    res.status(204).end()
  })

  app.post('/auth/api-keys', auth, (req, res) => {
    const { name } = req.body as { name?: string }
    const { apiKey, token } = createApiKey(store, {
      orgId: req.auth!.org.id,
      userId: req.auth!.user.id,
      name: name?.trim() || 'API key'
    })
    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      key: token,
      createdAt: apiKey.createdAt
    })
  })

  app.get('/auth/api-keys', auth, (req, res) => {
    res.json(listApiKeys(store, req.auth!.org.id))
  })

  app.delete('/auth/api-keys/:id', auth, (req, res) => {
    const ok = revokeApiKey(store, req.auth!.org.id, paramId(req.params.id))
    if (!ok) {
      res.status(404).json({ error: 'API key not found' })
      return
    }
    res.status(204).end()
  })

  app.get('/auth/me', auth, (req, res) => {
    res.json({
      user: toPublicUser(req.auth!.user),
      org: req.auth!.org,
      demoMode: config.demoMode,
      outbound: {
        email: config.google.refreshToken ? 'live' : 'demo',
        voice: config.twilio.accountSid ? 'live' : 'demo',
        linkedin: config.heyreach.apiKey ? 'live' : 'demo'
      }
    })
  })

  // ——— Portal & account ———
  app.get('/portal/builds', auth, (req, res) => {
    res.json({ builds: listPortalBuilds(store, req.auth!.org.id) })
  })

  app.patch('/account/org', auth, (req, res) => {
    const { name } = req.body as { name?: string }
    const trimmed = name?.trim()
    if (!trimmed) {
      res.status(400).json({ error: 'name required' })
      return
    }
    const orgId = req.auth!.org.id
    store.update((db) => {
      const org = db.orgs.find((o) => o.id === orgId)
      if (org) {
        org.name = trimmed
        org.updatedAt = Date.now()
      }
    })
    const org = store.db.orgs.find((o) => o.id === orgId)!
    res.json({ org })
  })

  // ——— Data layer (customer) ———
  app.get('/connections', auth, (req, res) => {
    const list = store.db.connections
      .filter((c) => c.orgId === req.auth!.org.id && c.provider === 'hubspot')
      .map(toPublicConnection)
    res.json(list)
  })

  app.post('/connections/:provider/start', auth, async (req, res) => {
    const provider = paramId(req.params.provider)
    if (provider === 'gmail' || provider === 'twilio' || provider === 'heyreach') {
      res.status(400).json({
        error: 'Email, calling, and LinkedIn are sent by Jargon. Connect HubSpot for your data.'
      })
      return
    }
    if (provider !== 'hubspot') {
      res.status(400).json({ error: 'Unknown data source. Connect HubSpot.' })
      return
    }
    const { org, user } = req.auth!
    const url = hubspotAuthUrl(store, config, org.id, user.id)
    res.json({ url })
  })

  app.get('/oauth/hubspot/callback', async (req, res) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string }
      if (!code || !state) {
        res.status(400).send(finishHubSpotOAuthHtml(config, false, 'Missing code/state'))
        return
      }
      const oauth = consumeOAuthState(store, state)
      if (!oauth) {
        res.status(400).send(finishHubSpotOAuthHtml(config, false, 'Invalid or expired state'))
        return
      }
      const tokens = await exchangeHubSpotCode(config, code)
      upsertConnection(store, {
        orgId: oauth.orgId,
        provider: 'hubspot',
        status: 'connected',
        accountLabel: tokens.accountLabel,
        secrets: tokens,
        meta: { mode: code === 'demo' || !config.hubspot.clientId ? 'demo' : 'live' }
      })
      const demo = tokens.accessToken === 'demo-hubspot-token' || !config.hubspot.clientId
      const prospects = await fetchHubSpotContacts(tokens.accessToken, 100, demo)
      writeHubSpotContactsToProjects(store, oauth.orgId, prospects)
      res.send(
        finishHubSpotOAuthHtml(
          config,
          true,
          `Loaded ${prospects.length} contacts into your tools.`
        )
      )
    } catch (err) {
      res
        .status(500)
        .send(finishHubSpotOAuthHtml(config, false, err instanceof Error ? err.message : 'Error'))
    }
  })

  app.post('/connections/hubspot/sync', auth, async (req, res) => {
    const { projectId, limit } = req.body as { projectId?: string; limit?: number }
    const orgId = req.auth!.org.id
    const conn = getConnection(store, orgId, 'hubspot')
    if (!conn || conn.status !== 'connected') {
      res.status(400).json({ error: 'HubSpot not connected' })
      return
    }
    const secrets = readSecrets(conn)
    const demo = secrets.accessToken === 'demo-hubspot-token' || !config.hubspot.clientId
    try {
      const prospects = await fetchHubSpotContacts(
        secrets.accessToken,
        limit ?? 100,
        demo
      )
      const count = writeHubSpotContactsToProjects(store, orgId, prospects, projectId)
      const connRow = store.db.connections.find((c) => c.id === conn.id)
      if (connRow) {
        store.update((db) => {
          const c = db.connections.find((x) => x.id === conn.id)
          if (c) {
            c.lastSyncAt = Date.now()
            c.updatedAt = Date.now()
          }
        })
      }
      if (projectId) {
        res.json(bundleProject(store.db, projectId))
        return
      }
      res.json({ count, source: 'hubspot' })
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'HubSpot sync failed' })
    }
  })

  app.get('/voice/token', auth, (req, res) => {
    const identity = `user_${req.auth!.user.id}`
    const token = createTwilioVoiceToken(config, identity)
    res.json(token)
  })

  app.post('/voice/twiml', (req, res) => {
    const to = String(req.body.To ?? req.query.To ?? '')
    const from = config.twilio.fromNumber || '+15555550100'
    res.type('text/xml').send(voiceTwiml(to, from))
  })

  app.post('/voice/status', (req, res) => {
    const callSid = String(req.body.CallSid ?? '')
    const callStatus = String(req.body.CallStatus ?? '')
    if (callSid) {
      store.update((db) => {
        const call = db.calls.find((c) => c.providerCallSid === callSid)
        if (!call) return
        if (callStatus === 'in-progress' || callStatus === 'answered') {
          call.phase = 'connected'
          call.connectedAt = call.connectedAt ?? Date.now()
        } else if (
          callStatus === 'completed' ||
          callStatus === 'busy' ||
          callStatus === 'no-answer' ||
          callStatus === 'failed' ||
          callStatus === 'canceled'
        ) {
          if (call.phase !== 'completed') {
            call.phase = callStatus === 'completed' ? 'connected' : 'failed'
          }
        }
      })
    }
    res.status(204).end()
  })

  // ——— Projects (tenant-scoped) ———
  app.get('/projects', auth, (req, res) => {
    const orgId = req.auth!.org.id
    const projects = store.db.projects
      .filter((p) => p.orgId === orgId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    res.json(projects)
  })

  app.post('/projects', auth, async (req, res) => {
    const { prompt, kind, answers } = req.body as {
      prompt?: string
      kind?: ProjectKind
      answers?: Record<string, string>
    }
    if (!prompt || !kind) {
      res.status(400).json({ error: 'prompt and kind required' })
      return
    }
    const orgId = req.auth!.org.id
    try {
      const projectId = await createProjectRecord(store, config, {
        orgId,
        prompt,
        kind,
        answers: answers ?? {}
      })
      res.status(201).json(bundleProject(store.db, projectId))
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Project create failed' })
    }
  })

  app.post('/tools/deploy', auth, async (req, res) => {
    const { prompt, kind, answers } = req.body as {
      prompt?: string
      kind?: ProjectKind
      answers?: Record<string, string>
    }
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt required' })
      return
    }
    const inferred = inferDeployParams(prompt.trim())
    const orgId = req.auth!.org.id
    try {
      const projectId = await createProjectRecord(store, config, {
        orgId,
        prompt: prompt.trim(),
        kind: kind ?? inferred.kind,
        answers: { ...inferred.answers, ...(answers ?? {}) }
      })
      const bundle = bundleProject(store.db, projectId)
      if (!bundle) {
        res.status(500).json({ error: 'Project created but could not be loaded' })
        return
      }
      res.status(201).json({
        projectId,
        project: bundle.project,
        contactCount: bundle.contacts.length,
        bundle,
        dashboardPath: `/tools/${projectId}`
      })
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Deploy failed' })
    }
  })

  app.get('/projects/:id', auth, (req, res) => {
    const project = store.db.projects.find(
      (p) => p.id === paramId(req.params.id) && p.orgId === req.auth!.org.id
    )
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    store.update((db) => {
      const p = db.projects.find((x) => x.id === paramId(req.params.id))
      if (p) p.updatedAt = Date.now()
    })
    res.json(bundleProject(store.db, paramId(req.params.id)))
  })

  app.delete('/projects/:id', auth, (req, res) => {
    const id = paramId(req.params.id)
    const project = store.db.projects.find((p) => p.id === id && p.orgId === req.auth!.org.id)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    store.update((db) => {
      db.projects = db.projects.filter((p) => p.id !== id)
      db.campaigns = db.campaigns.filter((c) => c.projectId !== id)
      db.sequences = db.sequences.filter((s) => s.projectId !== id)
      db.steps = db.steps.filter((s) => s.projectId !== id)
      db.contacts = db.contacts.filter((c) => c.projectId !== id)
      db.calls = db.calls.filter((c) => c.projectId !== id)
      db.messages = db.messages.filter((m) => m.projectId !== id)
      db.activities = db.activities.filter((a) => a.projectId !== id)
    })
    res.status(204).end()
  })

  app.get('/projects/:id/analytics', auth, (req, res) => {
    const project = store.db.projects.find(
      (p) => p.id === paramId(req.params.id) && p.orgId === req.auth!.org.id
    )
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(analyticsFor(store.db, paramId(req.params.id)))
  })

  app.get('/projects/:id/activities', auth, (req, res) => {
    const project = store.db.projects.find(
      (p) => p.id === paramId(req.params.id) && p.orgId === req.auth!.org.id
    )
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const items = store.db.activities
      .filter((a) => a.projectId === paramId(req.params.id))
      .sort((a, b) => b.createdAt - a.createdAt)
    res.json(items)
  })

  app.post('/campaigns/:id/pause', auth, (req, res) => {
    const campaign = mutateCampaign(store, paramId(req.params.id), req.auth!.org.id, 'PAUSED')
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }
    res.json(campaign)
  })

  app.post('/campaigns/:id/run', auth, (req, res) => {
    const campaign = mutateCampaign(store, paramId(req.params.id), req.auth!.org.id, 'ACTIVE')
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }
    res.json(campaign)
  })

  app.patch('/contacts/:id', auth, (req, res) => {
    let contact = store.db.contacts.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === req.auth!.org.id
    )
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    store.update((db) => {
      const c = db.contacts.find((x) => x.id === paramId(req.params.id))
      if (!c) return
      Object.assign(c, req.body, { updatedAt: Date.now(), orgId: c.orgId, id: c.id })
      contact = c
      const project = db.projects.find((p) => p.id === c.projectId)
      if (project) project.updatedAt = Date.now()
    })
    res.json(contact)
  })

  app.post('/contacts/:id/calls', auth, (req, res) => {
    const contact = store.db.contacts.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === req.auth!.org.id
    )
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const now = Date.now()
    const callId = uid('call')
    const twilioReady = Boolean(config.twilio.accountSid && config.twilio.apiKeySid)
    const mode = twilioReady ? 'twilio' : 'demo'
    store.update((db) => {
      db.contacts.forEach((c) => {
        if (c.projectId !== contact.projectId) return
        if (c.id === contact.id) {
          c.status = 'active'
          c.updatedAt = now
        } else if (c.status === 'active') {
          c.status = 'queued'
          c.updatedAt = now
        }
      })
      db.calls.unshift({
        id: callId,
        orgId: contact.orgId,
        projectId: contact.projectId,
        contactId: contact.id,
        phase: 'dialing',
        mode,
        providerCallSid: mode === 'twilio' ? undefined : undefined,
        startedAt: now
      })
      db.activities.unshift({
        id: uid('act'),
        orgId: contact.orgId,
        projectId: contact.projectId,
        contactId: contact.id,
        kind: 'call',
        summary: `Dialing ${contact.name}`,
        createdAt: now
      })
      const project = db.projects.find((p) => p.id === contact.projectId)
      if (project) project.updatedAt = now
    })

    // Demo softphone: simulate connect. Live Twilio: client SDK updates via status webhook.
    if (mode === 'demo') {
      setTimeout(() => {
        store.update((db) => {
          const call = db.calls.find((c) => c.id === callId)
          if (!call || call.phase !== 'dialing') return
          call.phase = 'connected'
          call.connectedAt = Date.now()
          db.activities.unshift({
            id: uid('act'),
            orgId: call.orgId,
            projectId: call.projectId,
            contactId: call.contactId,
            kind: 'call',
            summary: `Connected with ${contact.name}`,
            createdAt: Date.now()
          })
        })
      }, 1100)
    }

    res.status(201).json(store.db.calls.find((c) => c.id === callId))
  })

  app.post('/calls/:id/complete', auth, (req, res) => {
    const { disposition } = req.body as { disposition?: ContactStatus }
    if (!disposition) {
      res.status(400).json({ error: 'disposition required' })
      return
    }
    const call = store.db.calls.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === req.auth!.org.id
    )
    if (!call) {
      res.status(404).json({ error: 'Call not found' })
      return
    }
    const now = Date.now()
    store.update((db) => {
      const c = db.calls.find((x) => x.id === paramId(req.params.id))
      if (!c) return
      c.phase = 'completed'
      c.disposition = disposition
      c.endedAt = now
      const contact = db.contacts.find((x) => x.id === c.contactId)
      if (contact) {
        contact.status = disposition
        contact.updatedAt = now
        const done = new Set(contact.channelsDone ?? [])
        done.add('call')
        contact.channelsDone = [...done]
        if (disposition === 'interested' || disposition === 'completed' || disposition === 'replied') {
          contact.stepIndex = Math.min(contact.stepIndex + 1, 99)
        }
      }
      const campaign = db.campaigns.find(
        (camp) => camp.projectId === c.projectId && camp.state === 'ACTIVE'
      )
      if (campaign) {
        campaign.done = Math.min(campaign.total, campaign.done + 1)
        campaign.updatedAt = now
        const completed = db.calls.filter(
          (x) => x.projectId === c.projectId && x.phase === 'completed'
        )
        const answered = completed.filter(
          (x) => x.disposition && x.disposition !== 'no_answer'
        ).length
        campaign.answerRatio = completed.length ? (answered / completed.length) * 100 : 0
      }
      const next = db.contacts.find(
        (x) => x.projectId === c.projectId && x.status === 'queued' && x.id !== c.contactId
      )
      if (next) {
        next.status = 'active'
        next.updatedAt = now
      }
      db.activities.unshift({
        id: uid('act'),
        orgId: c.orgId,
        projectId: c.projectId,
        contactId: c.contactId,
        kind: 'call',
        summary: `Call completed · ${disposition.replace('_', ' ')}`,
        createdAt: now
      })
      const project = db.projects.find((p) => p.id === c.projectId)
      if (project) project.updatedAt = now
    })
    res.json({
      call: store.db.calls.find((c) => c.id === paramId(req.params.id)),
      bundle: bundleProject(store.db, call.projectId)
    })
  })

  app.post('/contacts/:id/messages', auth, async (req, res) => {
    const contact = store.db.contacts.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === req.auth!.org.id
    )
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
    const messageChannel = channel ?? 'email'
    const now = Date.now()
    const messageId = uid('msg')
    let finalStatus: MessageStatus = status ?? 'draft'
    let mode: 'demo' | 'gmail' | 'heyreach' = 'demo'
    let providerMessageId: string | undefined
    let error: string | undefined

    if (finalStatus === 'sent' && messageChannel === 'email') {
      try {
        const result = await sendPlatformGmail(config, {
          to: contact.email,
          subject: subject ?? '(no subject)',
          body: body ?? ''
        })
        mode = result.mode
        providerMessageId = result.id
      } catch (err) {
        finalStatus = 'failed'
        error = err instanceof Error ? err.message : 'Send failed'
      }
    }

    if (finalStatus === 'sent' && messageChannel === 'linkedin') {
      const apiKey = config.heyreach.apiKey.trim() || 'demo'
      const demo = !config.heyreach.apiKey.trim() || apiKey === 'demo'
      try {
        const result = await sendHeyReachLinkedInMessage({
          apiKey,
          linkedinUrl: contact.linkedinUrl ?? '',
          message: body ?? '',
          demo
        })
        mode = result.mode
        providerMessageId = result.id
      } catch (err) {
        finalStatus = 'failed'
        error = err instanceof Error ? err.message : 'LinkedIn send failed'
      }
    }

    store.update((db) => {
      db.messages.unshift({
        id: messageId,
        orgId: contact.orgId,
        projectId: contact.projectId,
        contactId: contact.id,
        subject: subject ?? (messageChannel === 'linkedin' ? 'LinkedIn message' : '(no subject)'),
        body: body ?? '',
        status: finalStatus,
        channel: messageChannel,
        mode,
        providerMessageId,
        error,
        createdAt: now,
        updatedAt: now,
        sentAt: finalStatus === 'sent' ? now : undefined
      })
      const c = db.contacts.find((x) => x.id === contact.id)
      if (c && finalStatus === 'sent') {
        c.status = c.status === 'queued' ? 'active' : c.status
        c.stepIndex = c.stepIndex + 1
        c.updatedAt = now
        const done = new Set(c.channelsDone ?? [])
        done.add(messageChannel === 'linkedin' ? 'linkedin' : 'email')
        c.channelsDone = [...done]
      }
      db.activities.unshift({
        id: uid('act'),
        orgId: contact.orgId,
        projectId: contact.projectId,
        contactId: contact.id,
        kind:
          finalStatus === 'sent'
            ? messageChannel === 'linkedin'
              ? 'linkedin'
              : 'email'
            : messageChannel === 'linkedin'
              ? 'linkedin'
              : finalStatus === 'failed'
                ? 'email'
                : 'draft',
        summary:
          finalStatus === 'sent'
            ? messageChannel === 'linkedin'
              ? `Sent LinkedIn message to ${contact.name}`
              : `Sent email to ${contact.name}`
            : finalStatus === 'failed'
              ? `Failed to ${messageChannel === 'linkedin' ? 'message' : 'email'} ${contact.name}: ${error}`
              : `Saved ${messageChannel} draft for ${contact.name}`,
        createdAt: now
      })
      const project = db.projects.find((p) => p.id === contact.projectId)
      if (project) project.updatedAt = now
    })

    if (finalStatus === 'failed') {
      res.status(502).json({
        error: error ?? 'Send failed',
        message: store.db.messages.find((m) => m.id === messageId),
        bundle: bundleProject(store.db, contact.projectId)
      })
      return
    }

    res.status(201).json({
      message: store.db.messages.find((m) => m.id === messageId),
      bundle: bundleProject(store.db, contact.projectId)
    })
  })

  app.post('/contacts/:id/notes', auth, (req, res) => {
    const { note } = req.body as { note?: string }
    if (!note?.trim()) {
      res.status(400).json({ error: 'note required' })
      return
    }
    const contact = store.db.contacts.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === req.auth!.org.id
    )
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const now = Date.now()
    store.update((db) => {
      const c = db.contacts.find((x) => x.id === paramId(req.params.id))
      if (!c) return
      const stamped = `${new Date(now).toLocaleString()}: ${note.trim()}`
      c.notes = c.notes ? `${c.notes}\n${stamped}` : stamped
      c.updatedAt = now
      db.activities.unshift({
        id: uid('act'),
        orgId: c.orgId,
        projectId: c.projectId,
        contactId: c.id,
        kind: 'note',
        summary: note.trim(),
        createdAt: now
      })
    })
    res.json(store.db.contacts.find((c) => c.id === paramId(req.params.id)))
  })

  app.get('/calls/:id', auth, (req, res) => {
    const call = store.db.calls.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === req.auth!.org.id
    )
    if (!call) {
      res.status(404).json({ error: 'Call not found' })
      return
    }
    res.json(call)
  })

  return app
}

function mutateCampaign(
  store: DataStore,
  id: string,
  orgId: string,
  state: 'ACTIVE' | 'PAUSED'
) {
  let campaign = store.db.campaigns.find((c) => c.id === id && c.orgId === orgId)
  if (!campaign) return null
  store.update((db) => {
    const c = db.campaigns.find((x) => x.id === id)
    if (!c) return
    c.state = state
    c.updatedAt = Date.now()
    db.activities.unshift({
      id: uid('act'),
      orgId: c.orgId,
      projectId: c.projectId,
      kind: 'campaign',
      summary: `${c.name} marked ${state}`,
      createdAt: Date.now()
    })
    campaign = c
  })
  return campaign
}

export async function startApiServer(
  store: DataStore,
  preferredPort = 8787,
  options?: { host?: string; config?: ServerConfig }
): Promise<{ server: Server; port: number; config: ServerConfig }> {
  const config = options?.config ?? loadConfig({ port: preferredPort })
  const host = options?.host ?? config.host
  const app = createApi(store, config)

  async function listen(port: number): Promise<{ server: Server; port: number }> {
    return await new Promise((resolve, reject) => {
      const server = app.listen(port, host, () => resolve({ server, port }))
      server.on('error', reject)
    })
  }

  try {
    const result = await listen(preferredPort)
    config.port = result.port
    if (result.port !== preferredPort || !config.publicUrl) {
      config.publicUrl = `http://127.0.0.1:${result.port}`
    }
    return { ...result, config }
  } catch {
    const result = await listen(0)
    config.port = result.port
    config.publicUrl = `http://127.0.0.1:${result.port}`
    return { ...result, config }
  }
}
