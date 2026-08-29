import express from 'express'
import type { Request } from 'express'
import cors from 'cors'
import type { Server } from 'http'
import { JsonStore } from './store'
import { seedProject } from './seed'
import { analyticsFor, bundleProject } from './queries'
import type { ContactStatus, MessageStatus, ProjectKind } from './types'
import { loadConfig, type ServerConfig } from './config'
import {
  authPayload,
  createSession,
  destroySession,
  requireAuth,
  toPublicUser
} from './auth'
import { hashPassword, uid, verifyPassword } from './crypto'
import {
  consumeOAuthState,
  getConnection,
  readSecrets,
  toPublicConnection,
  upsertConnection
} from './connections'
import {
  exchangeHubSpotCode,
  fetchHubSpotProspects,
  finishHubSpotOAuthHtml,
  hubspotAuthUrl,
  prospectsToContacts
} from './providers/hubspot'
import {
  exchangeGmailCode,
  finishGmailOAuthHtml,
  gmailAuthUrl,
  refreshGmailAccessToken,
  sendGmailMessage
} from './providers/gmail'
import {
  createTwilioVoiceToken,
  ensureTwilioConnection,
  voiceTwiml
} from './providers/twilio'
import {
  applyApolloEnrichment,
  apolloProspectsToContacts,
  enrichContactFromApollo,
  ensureApolloConnection,
  resolveApolloApiKey,
  searchGtmSoftwareProspects,
  validateApolloKey
} from './providers/apollo'
import {
  ensureCrustdataConnection,
  resolveCrustdataApiKey,
  searchGtmSoftwarePeople,
  searchPeopleFromPrompt,
  validateCrustdataKey
} from './providers/crustdata'
import { prospectsToContacts } from './providers/prospects'
import {
  DEFAULT_SUPABASE_TABLE,
  ensureSupabaseConnection,
  fetchSupabaseProspects,
  resolveSupabaseConnection,
  validateSupabaseConnection
} from './providers/supabase'
import {
  addPreviewComment,
  buildSharedPreview,
  createShareLink,
  resolveShareLink,
  revokeShareLink,
  toPublicComment
} from './share'
import { createApiKey, listApiKeys, revokeApiKey } from './apiKeys'
import {
  billingSnapshot,
  createBillingPortalSession,
  createCheckoutSession,
  ensureSubscription,
  handleStripeWebhook
} from './billing'
import { listPortalBuilds } from './portal'
import { inferDeployParams } from './deploy'
import { createProjectRecord } from './projectCreate'

function shareLinkApiBase(req: Request, config: ServerConfig): string {
  const host = req.get('host')
  if (host) {
    const hostname = host.split(':')[0]
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return `http://${host}`.replace(/\/$/, '')
    }
  }
  return config.publicUrl.replace(/\/$/, '')
}

export function createApi(store: JsonStore, config: ServerConfig = loadConfig()) {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))

  app.post(
    '/billing/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        await handleStripeWebhook(
          store,
          config,
          req.body as Buffer,
          req.headers['stripe-signature'] as string | undefined
        )
        res.json({ received: true })
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Webhook failed' })
      }
    }
  )

  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))

  const auth = requireAuth(store)
  const paramId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      multiTenant: true,
      demoMode: config.demoMode,
      providers: {
        hubspot: config.hubspot.clientId ? 'live' : 'demo',
        gmail: config.google.clientId ? 'live' : 'demo',
        twilio:
          config.twilio.accountSid &&
          config.twilio.apiKeySid &&
          config.twilio.apiKeySecret &&
          config.twilio.twimlAppSid
            ? 'live'
            : 'demo',
        apollo: config.apollo.apiKey ? 'live' : 'unset',
        crustdata: config.crustdata.apiKey ? 'live' : 'unset',
        supabase:
          config.supabase.projectUrl && config.supabase.apiKey ? 'live' : 'unset'
      },
      publicUrl: config.publicUrl,
      previewUrl: config.previewUrl,
      features: { sharePreview: true, deploy: true, cli: true }
    })
  })

  // ——— Auth ———
  app.post('/auth/register', (req, res) => {
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
    ensureApolloConnection(store, orgId, config)
    ensureTwilioConnection(store, orgId, config)
    ensureSubscription(store, orgId)
    const { token } = createSession(store, userId, orgId)
    res.status(201).json(authPayload(store, token, user, org))
  })

  app.post('/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' })
      return
    }
    const user = store.db.users.find((u) => u.email === email.trim().toLowerCase())
    if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }
    const membership = store.db.memberships.find((m) => m.userId === user.id)
    const org = membership && store.db.orgs.find((o) => o.id === membership.orgId)
    if (!org) {
      res.status(500).json({ error: 'No organization for user' })
      return
    }
    ensureApolloConnection(store, org.id, config)
    ensureTwilioConnection(store, org.id, config)
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
    ensureApolloConnection(store, req.auth!.org.id, config)
    ensureCrustdataConnection(store, req.auth!.org.id, config)
    ensureSubscription(store, req.auth!.org.id)
    res.json({
      user: toPublicUser(req.auth!.user),
      org: req.auth!.org,
      demoMode: config.demoMode,
      apolloConfigured: Boolean(config.apollo.apiKey),
      billing: billingSnapshot(store, req.auth!.org.id, config)
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

  // ——— Billing ———
  app.get('/billing', auth, (req, res) => {
    res.json(billingSnapshot(store, req.auth!.org.id, config))
  })

  app.post('/billing/checkout', auth, async (req, res) => {
    try {
      const result = await createCheckoutSession(
        store,
        config,
        req.auth!.org.id,
        req.auth!.user.email
      )
      res.json(result)
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Checkout unavailable' })
    }
  })

  app.post('/billing/portal', auth, async (req, res) => {
    try {
      const result = await createBillingPortalSession(store, config, req.auth!.org.id)
      res.json(result)
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Billing portal unavailable' })
    }
  })


  // ——— Connections ———
  app.get('/connections', auth, (req, res) => {
    ensureApolloConnection(store, req.auth!.org.id, config)
    ensureCrustdataConnection(store, req.auth!.org.id, config)
    ensureSupabaseConnection(store, req.auth!.org.id, config)
    ensureTwilioConnection(store, req.auth!.org.id, config)
    const list = store.db.connections
      .filter((c) => c.orgId === req.auth!.org.id)
      .map(toPublicConnection)
    res.json(list)
  })

  app.post('/connections/:provider/start', auth, async (req, res) => {
    const provider = paramId(req.params.provider)
    const { org, user } = req.auth!
    if (provider === 'hubspot') {
      const url = hubspotAuthUrl(store, config, org.id, user.id)
      res.json({ url })
      return
    }
    if (provider === 'gmail') {
      const url = gmailAuthUrl(store, config, org.id, user.id)
      res.json({ url })
      return
    }
    if (provider === 'twilio') {
      const conn = ensureTwilioConnection(store, org.id, config)
      res.json({ connection: toPublicConnection(conn) })
      return
    }
    if (provider === 'apollo') {
      const { apiKey: bodyKey } = req.body as { apiKey?: string }
      const apiKey = (bodyKey?.trim() || config.apollo.apiKey).trim()
      if (!apiKey) {
        res.status(400).json({ error: 'API key required — set APOLLO_API_KEY or paste a key' })
        return
      }
      const validated = await validateApolloKey(apiKey)
      if (!validated.ok) {
        res.status(400).json({ error: validated.error })
        return
      }
      const demo = apiKey === 'demo'
      const conn = upsertConnection(store, {
        orgId: org.id,
        provider: 'apollo',
        status: 'connected',
        accountLabel: validated.label,
        secrets: { accessToken: apiKey },
        meta: {
          mode: demo ? 'demo' : 'live',
          source: bodyKey?.trim() ? 'manual' : 'env'
        }
      })
      res.json({ connection: toPublicConnection(conn) })
      return
    }
    if (provider === 'crustdata') {
      const { apiKey: bodyKey } = req.body as { apiKey?: string }
      const apiKey = (bodyKey?.trim() || config.crustdata.apiKey).trim()
      if (!apiKey) {
        res.status(400).json({ error: 'API key required — set CRUSTDATA_API_KEY or paste a key' })
        return
      }
      const validated = await validateCrustdataKey(apiKey)
      if (!validated.ok) {
        res.status(400).json({ error: validated.error })
        return
      }
      const demo = apiKey === 'demo'
      const conn = upsertConnection(store, {
        orgId: org.id,
        provider: 'crustdata',
        status: 'connected',
        accountLabel: validated.label,
        secrets: { accessToken: apiKey },
        meta: {
          mode: demo ? 'demo' : 'live',
          source: bodyKey?.trim() ? 'manual' : 'env',
          ...(validated.credits !== undefined
            ? { creditsRemaining: String(Math.floor(validated.credits)) }
            : {})
        }
      })
      res.json({ connection: toPublicConnection(conn) })
      return
    }
    if (provider === 'supabase') {
      const { projectUrl, apiKey, table } = req.body as {
        projectUrl?: string
        apiKey?: string
        table?: string
      }
      const resolvedUrl = (projectUrl?.trim() || config.supabase.projectUrl).trim()
      const resolvedKey = (apiKey?.trim() || config.supabase.apiKey).trim()
      const resolvedTable = (table?.trim() || config.supabase.table || DEFAULT_SUPABASE_TABLE).trim()
      if (!resolvedUrl || !resolvedKey) {
        res.status(400).json({
          error: 'Supabase URL and API key required — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
        })
        return
      }
      const validated = await validateSupabaseConnection({
        projectUrl: resolvedUrl,
        apiKey: resolvedKey,
        table: resolvedTable
      })
      if (!validated.ok) {
        res.status(400).json({ error: validated.error })
        return
      }
      const conn = upsertConnection(store, {
        orgId: org.id,
        provider: 'supabase',
        status: 'connected',
        accountLabel: validated.label,
        secrets: {
          accessToken: resolvedKey,
          extra: { projectUrl: resolvedUrl, table: resolvedTable }
        },
        meta: {
          mode: 'live',
          source: projectUrl?.trim() || apiKey?.trim() ? 'manual' : 'env',
          projectUrl: resolvedUrl,
          table: resolvedTable,
          ...(validated.rowCount !== undefined
            ? { rowCount: String(validated.rowCount) }
            : {})
        }
      })
      res.json({ connection: toPublicConnection(conn) })
      return
    }
    res.status(400).json({ error: 'Unknown provider' })
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
      res.send(finishHubSpotOAuthHtml(config, true, 'You can return to the Jargon desktop app.'))
    } catch (err) {
      res
        .status(500)
        .send(finishHubSpotOAuthHtml(config, false, err instanceof Error ? err.message : 'Error'))
    }
  })

  app.get('/oauth/gmail/callback', async (req, res) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string }
      if (!code || !state) {
        res.status(400).send(finishGmailOAuthHtml(config, false, 'Missing code/state'))
        return
      }
      const oauth = consumeOAuthState(store, state)
      if (!oauth) {
        res.status(400).send(finishGmailOAuthHtml(config, false, 'Invalid or expired state'))
        return
      }
      const tokens = await exchangeGmailCode(config, code)
      const existing = getConnection(store, oauth.orgId, 'gmail')
      const previousSecrets = existing ? readSecrets(existing) : undefined
      upsertConnection(store, {
        orgId: oauth.orgId,
        provider: 'gmail',
        status: 'connected',
        accountLabel: tokens.accountLabel,
        secrets: {
          ...tokens,
          // Google may omit a refresh token on a later authorization.
          refreshToken: tokens.refreshToken ?? previousSecrets?.refreshToken
        },
        meta: { mode: code === 'demo' || !config.google.clientId ? 'demo' : 'live' }
      })
      res.send(finishGmailOAuthHtml(config, true, 'You can return to the Jargon desktop app.'))
    } catch (err) {
      res
        .status(500)
        .send(finishGmailOAuthHtml(config, false, err instanceof Error ? err.message : 'Error'))
    }
  })

  app.post('/connections/gmail/test', auth, async (req, res) => {
    const { to } = req.body as { to?: string }
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ error: 'A valid recipient email is required' })
      return
    }

    const orgId = req.auth!.org.id
    const conn = getConnection(store, orgId, 'gmail')
    if (!conn || conn.status !== 'connected') {
      res.status(400).json({ error: 'Gmail not connected' })
      return
    }

    try {
      let secrets = readSecrets(conn)
      if (
        secrets.accessToken !== 'demo-gmail-token' &&
        secrets.expiresAt &&
        secrets.expiresAt <= Date.now() + 5 * 60 * 1000
      ) {
        secrets = await refreshGmailAccessToken(config, secrets)
        upsertConnection(store, {
          orgId,
          provider: 'gmail',
          status: 'connected',
          accountLabel: conn.accountLabel,
          secrets,
          meta: conn.meta
        })
      }

      const result = await sendGmailMessage({
        accessToken: secrets.accessToken,
        to,
        subject: 'Jargon Gmail connection test',
        body:
          'Your Jargon Gmail connection is working.\n\nThis message was sent through the Gmail API from your connected account.',
        demo: secrets.accessToken === 'demo-gmail-token' || !config.google.clientId
      })
      res.json(result)
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Test send failed' })
    }
  })

  app.post('/connections/apollo/sync', auth, async (req, res) => {
    const { projectId, limit } = req.body as { projectId?: string; limit?: number }
    const orgId = req.auth!.org.id
    const count = Math.min(Math.max(limit ?? 100, 1), 100)
    const resolved = resolveApolloApiKey(store, orgId, config)
    if (!resolved) {
      res.status(400).json({ error: 'Apollo not connected — set APOLLO_API_KEY in .env' })
      return
    }

    try {
      const result = await searchGtmSoftwareProspects(resolved.apiKey, count, resolved.demo)
      if (!projectId) {
        res.json({ prospects: result.prospects, count: result.prospects.length, mode: result.mode })
        return
      }
      const project = store.db.projects.find((p) => p.id === projectId && p.orgId === orgId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const contacts = apolloProspectsToContacts(orgId, projectId, result.prospects)
      const conn = getConnection(store, orgId, 'apollo')
      store.update((db) => {
        db.contacts = db.contacts.filter((c) => c.projectId !== projectId)
        db.contacts.push(...contacts)
        if (conn) {
          const c = db.connections.find((x) => x.id === conn.id)
          if (c) {
            c.lastSyncAt = Date.now()
            c.updatedAt = Date.now()
          }
        }
        const p = db.projects.find((x) => x.id === projectId)
        if (p) {
          p.answers = {
            ...p.answers,
            prospect_source: result.mode === 'live' ? 'apollo' : 'apollo_demo',
            prospect_count: String(contacts.length),
            segment: p.answers.segment || 'Software · GTM titles'
          }
          p.updatedAt = Date.now()
        }
        db.activities.unshift({
          id: uid('act'),
          orgId,
          projectId,
          kind: 'sync',
          summary: `Pulled ${contacts.length} GTM software prospects from Apollo`,
          createdAt: Date.now()
        })
        const campaign = db.campaigns.find((x) => x.projectId === projectId && x.state === 'ACTIVE')
        if (campaign) {
          campaign.total = contacts.length
          campaign.updatedAt = Date.now()
        }
      })
      res.json(bundleProject(store.db, projectId))
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Apollo sync failed' })
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
    const count = Math.min(Math.max(limit ?? 100, 1), 100)
    try {
      const prospects = await fetchHubSpotProspects(
        secrets.accessToken,
        count,
        secrets.accessToken === 'demo-hubspot-token' || !config.hubspot.clientId
      )
      if (!projectId) {
        res.json({ prospects, count: prospects.length })
        return
      }
      const project = store.db.projects.find((p) => p.id === projectId && p.orgId === orgId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const contacts = prospectsToContacts(orgId, projectId, prospects)
      store.update((db) => {
        db.contacts = db.contacts.filter((c) => c.projectId !== projectId)
        db.contacts.push(...contacts)
        const c = db.connections.find((x) => x.id === conn.id)
        if (c) {
          c.lastSyncAt = Date.now()
          c.updatedAt = Date.now()
        }
        project.updatedAt = Date.now()
        db.activities.unshift({
          id: uid('act'),
          orgId,
          projectId,
          kind: 'sync',
          summary: `Synced ${contacts.length} prospects from HubSpot`,
          createdAt: Date.now()
        })
        const campaign = db.campaigns.find((x) => x.projectId === projectId && x.state === 'ACTIVE')
        if (campaign) {
          campaign.total = contacts.length
          campaign.updatedAt = Date.now()
        }
      })
      res.json(bundleProject(store.db, projectId))
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Sync failed' })
    }
  })

  app.post('/connections/supabase/sync', auth, async (req, res) => {
    const { projectId, limit } = req.body as { projectId?: string; limit?: number }
    const orgId = req.auth!.org.id
    const resolved = resolveSupabaseConnection(store, orgId, config)
    if (!resolved) {
      res.status(400).json({
        error: 'Supabase not connected — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env'
      })
      return
    }
    const count = Math.min(Math.max(limit ?? 100, 1), 500)
    try {
      const result = await fetchSupabaseProspects({
        projectUrl: resolved.projectUrl,
        apiKey: resolved.apiKey,
        table: resolved.table,
        limit: count,
        columnMap: resolved.columnMap
      })
      if (!projectId) {
        res.json({ prospects: result.prospects, count: result.prospects.length, mode: result.mode })
        return
      }
      const project = store.db.projects.find((p) => p.id === projectId && p.orgId === orgId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const contacts = prospectsToContacts(orgId, projectId, result.prospects, 'supabase')
      const conn = getConnection(store, orgId, 'supabase')
      store.update((db) => {
        db.contacts = db.contacts.filter((c) => c.projectId !== projectId)
        db.contacts.push(...contacts)
        if (conn) {
          const c = db.connections.find((x) => x.id === conn.id)
          if (c) {
            c.lastSyncAt = Date.now()
            c.updatedAt = Date.now()
          }
        }
        const p = db.projects.find((x) => x.id === projectId)
        if (p) {
          p.answers = {
            ...p.answers,
            prospect_source: 'supabase',
            prospect_count: String(contacts.length),
            segment: p.answers.segment || `Supabase · ${resolved.table}`
          }
          p.updatedAt = Date.now()
        }
        db.activities.unshift({
          id: uid('act'),
          orgId,
          projectId,
          kind: 'sync',
          summary: `Pulled ${contacts.length} prospects from Supabase (${resolved.table})`,
          createdAt: Date.now()
        })
        const campaign = db.campaigns.find((x) => x.projectId === projectId && x.state === 'ACTIVE')
        if (campaign) {
          campaign.total = contacts.length
          campaign.updatedAt = Date.now()
        }
      })
      res.json(bundleProject(store.db, projectId))
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Supabase sync failed' })
    }
  })

  app.post('/connections/crustdata/sync', auth, async (req, res) => {
    const { projectId, limit, prompt } = req.body as {
      projectId?: string
      limit?: number
      prompt?: string
    }
    const orgId = req.auth!.org.id
    const resolved = resolveCrustdataApiKey(store, orgId, config)
    if (!resolved) {
      res.status(400).json({ error: 'Crustdata not connected — set CRUSTDATA_API_KEY in .env' })
      return
    }

    const project = projectId
      ? store.db.projects.find((p) => p.id === projectId && p.orgId === orgId)
      : undefined
    const searchPrompt = prompt?.trim() || project?.prompt || 'Find prospects to contact today'
    const count = Math.min(Math.max(limit ?? Number(project?.answers.prospect_count ?? 20), 1), 100)

    try {
      const result = await searchPeopleFromPrompt(
        resolved.apiKey,
        searchPrompt,
        count,
        resolved.demo
      )
      if (!projectId) {
        res.json({
          prospects: result.prospects,
          count: result.prospects.length,
          mode: result.mode,
          querySummary: result.querySummary
        })
        return
      }
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const contacts = prospectsToContacts(orgId, projectId, result.prospects, 'crustdata')
      const conn = getConnection(store, orgId, 'crustdata')
      store.update((db) => {
        db.contacts = db.contacts.filter((c) => c.projectId !== projectId)
        db.contacts.push(...contacts)
        if (conn) {
          const c = db.connections.find((x) => x.id === conn.id)
          if (c) {
            c.lastSyncAt = Date.now()
            c.updatedAt = Date.now()
          }
        }
        const p = db.projects.find((x) => x.id === projectId)
        if (p) {
          p.answers = {
            ...p.answers,
            prospect_source: result.mode === 'live' ? 'crustdata' : 'crustdata_demo',
            prospect_count: String(contacts.length),
            crustdata_query: result.querySummary,
            segment: p.answers.segment || result.querySummary
          }
          p.updatedAt = Date.now()
        }
        db.activities.unshift({
          id: uid('act'),
          orgId,
          projectId,
          kind: 'sync',
          summary: `Pulled ${contacts.length} GTM prospects from Crustdata`,
          createdAt: Date.now()
        })
        const campaign = db.campaigns.find((x) => x.projectId === projectId && x.state === 'ACTIVE')
        if (campaign) {
          campaign.total = contacts.length
          campaign.updatedAt = Date.now()
        }
      })
      res.json(bundleProject(store.db, projectId))
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Crustdata sync failed' })
    }
  })

  app.get('/voice/token', auth, (req, res) => {
    ensureTwilioConnection(store, req.auth!.org.id, config)
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
        } else if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed' || callStatus === 'canceled') {
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
    const { prompt, share, label, kind, answers } = req.body as {
      prompt?: string
      share?: boolean
      label?: string
      kind?: ProjectKind
      answers?: Record<string, string>
    }
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt required' })
      return
    }
    const inferred = inferDeployParams(prompt.trim())
    const orgId = req.auth!.org.id
    const userId = req.auth!.user.id
    try {
      const projectId = await createProjectRecord(store, config, {
        orgId,
        prompt: prompt.trim(),
        kind: kind ?? inferred.kind,
        answers: { ...inferred.answers, ...(answers ?? {}) }
      })
      const bundle = bundleProject(store.db, projectId)
      let shareUrl: string | undefined
      let shareToken: string | undefined
      if (share !== false) {
        const created = createShareLink(store, {
          orgId,
          userId,
          projectId,
          label: label?.trim() || bundle.project.name,
          previewBaseUrl: config.previewUrl,
          apiBaseUrl: shareLinkApiBase(req, config)
        })
        shareUrl = created.url
        shareToken = created.token
      }
      res.status(201).json({
        projectId,
        project: bundle.project,
        contactCount: bundle.contacts.length,
        prospectSource: bundle.project.answers.prospect_source,
        shareUrl,
        shareToken,
        bundle
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

  app.post('/contacts/:id/enrich', auth, async (req, res) => {
    const orgId = req.auth!.org.id
    const contact = store.db.contacts.find(
      (c) => c.id === paramId(req.params.id) && c.orgId === orgId
    )
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const resolved = resolveApolloApiKey(store, orgId, config)
    if (!resolved) {
      res.status(400).json({ error: 'Apollo not connected — set APOLLO_API_KEY in .env' })
      return
    }
    try {
      const enrichment = await enrichContactFromApollo(
        resolved.apiKey,
        contact,
        resolved.demo
      )
      if (!enrichment.person && !enrichment.organization) {
        res.status(404).json({ error: 'No Apollo match found for this contact' })
        return
      }
      const patch = applyApolloEnrichment(contact, enrichment)
      let updated = contact
      const conn = getConnection(store, orgId, 'apollo')
      store.update((db) => {
        const c = db.contacts.find((x) => x.id === contact.id)
        if (!c) return
        Object.assign(c, patch)
        updated = c
        db.activities.unshift({
          id: uid('act'),
          orgId,
          projectId: c.projectId,
          contactId: c.id,
          kind: 'sync',
          summary: `Apollo enriched${enrichment.organization?.industry ? ` · ${enrichment.organization.industry}` : ''}`,
          createdAt: Date.now()
        })
        const project = db.projects.find((p) => p.id === c.projectId)
        if (project) project.updatedAt = Date.now()
        if (conn) {
          const apolloConn = db.connections.find((x) => x.id === conn.id)
          if (apolloConn) {
            apolloConn.lastSyncAt = Date.now()
            apolloConn.updatedAt = Date.now()
          }
        }
      })
      res.json({
        contact: updated,
        enrichment: {
          mode: enrichment.mode,
          matchedPerson: Boolean(enrichment.person),
          matchedOrganization: Boolean(enrichment.organization)
        },
        bundle: bundleProject(store.db, contact.projectId)
      })
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Apollo enrichment failed' })
    }
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
    const now = Date.now()
    const messageId = uid('msg')
    let finalStatus: MessageStatus = status ?? 'draft'
    let mode: 'demo' | 'gmail' = 'demo'
    let providerMessageId: string | undefined
    let error: string | undefined

    if (finalStatus === 'sent' && (channel ?? 'email') === 'email') {
      const conn = getConnection(store, contact.orgId, 'gmail')
      if (conn?.status === 'connected') {
        try {
          let secrets = readSecrets(conn)
          if (
            secrets.accessToken !== 'demo-gmail-token' &&
            secrets.expiresAt &&
            secrets.expiresAt <= Date.now() + 5 * 60 * 1000
          ) {
            secrets = await refreshGmailAccessToken(config, secrets)
            upsertConnection(store, {
              orgId: contact.orgId,
              provider: 'gmail',
              status: 'connected',
              accountLabel: conn.accountLabel,
              secrets,
              meta: conn.meta
            })
          }
          const result = await sendGmailMessage({
            accessToken: secrets.accessToken,
            to: contact.email,
            subject: subject ?? '(no subject)',
            body: body ?? '',
            demo: secrets.accessToken === 'demo-gmail-token' || !config.google.clientId
          })
          mode = result.mode
          providerMessageId = result.id
        } catch (err) {
          finalStatus = 'failed'
          error = err instanceof Error ? err.message : 'Send failed'
        }
      } else if (config.google.clientId) {
        finalStatus = 'failed'
        error = 'Gmail not connected'
      } else {
        mode = 'demo'
        providerMessageId = `demo_mail_${Date.now()}`
      }
    }

    store.update((db) => {
      db.messages.unshift({
        id: messageId,
        orgId: contact.orgId,
        projectId: contact.projectId,
        contactId: contact.id,
        subject: subject ?? '(no subject)',
        body: body ?? '',
        status: finalStatus,
        channel: channel ?? 'email',
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
        done.add('email')
        c.channelsDone = [...done]
      }
      db.activities.unshift({
        id: uid('act'),
        orgId: contact.orgId,
        projectId: contact.projectId,
        contactId: contact.id,
        kind:
          finalStatus === 'sent'
            ? 'email'
            : channel === 'linkedin'
              ? 'linkedin'
              : finalStatus === 'failed'
                ? 'email'
                : 'draft',
        summary:
          finalStatus === 'sent'
            ? `Sent email to ${contact.name}`
            : finalStatus === 'failed'
              ? `Failed to email ${contact.name}: ${error}`
              : `Saved ${channel ?? 'email'} draft for ${contact.name}`,
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

  app.post('/projects/:id/share', auth, (req, res) => {
    const projectId = paramId(req.params.id)
    const project = store.db.projects.find(
      (p) => p.id === projectId && p.orgId === req.auth!.org.id
    )
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    try {
      const { label } = req.body as { label?: string }
      const created = createShareLink(store, {
        orgId: req.auth!.org.id,
        userId: req.auth!.user.id,
        projectId,
        label,
        previewBaseUrl: config.previewUrl,
        apiBaseUrl: shareLinkApiBase(req, config)
      })
      res.status(201).json({
        id: created.share.id,
        label: created.share.label,
        url: created.url,
        token: created.token,
        expiresAt: created.share.expiresAt,
        createdAt: created.share.createdAt
      })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not create share link' })
    }
  })

  app.get('/projects/:id/shares', auth, (req, res) => {
    const projectId = paramId(req.params.id)
    const project = store.db.projects.find(
      (p) => p.id === projectId && p.orgId === req.auth!.org.id
    )
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const shares = store.db.shareLinks
      .filter((s) => s.projectId === projectId && s.orgId === req.auth!.org.id && !s.revokedAt)
      .map((s) => ({
        id: s.id,
        label: s.label,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
        commentCount: store.db.previewComments.filter((c) => c.shareLinkId === s.id).length
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
    res.json(shares)
  })

  app.get('/projects/:id/feedback', auth, (req, res) => {
    const projectId = paramId(req.params.id)
    const project = store.db.projects.find(
      (p) => p.id === projectId && p.orgId === req.auth!.org.id
    )
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const shareIds = new Set(
      store.db.shareLinks
        .filter((s) => s.projectId === projectId && s.orgId === req.auth!.org.id)
        .map((s) => s.id)
    )
    const comments = store.db.previewComments
      .filter((c) => shareIds.has(c.shareLinkId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => {
        const share = store.db.shareLinks.find((s) => s.id === c.shareLinkId)
        return { ...toPublicComment(c), shareLabel: share?.label ?? 'Shared preview' }
      })
    res.json(comments)
  })

  app.delete('/shares/:id', auth, (req, res) => {
    const shareId = paramId(req.params.id)
    const ok = revokeShareLink(store, shareId, req.auth!.org.id)
    if (!ok) {
      res.status(404).json({ error: 'Share link not found' })
      return
    }
    res.status(204).end()
  })

  app.get('/share/:token', (req, res) => {
    const token = paramId(req.params.token)
    const share = resolveShareLink(store, token)
    if (!share) {
      res.status(404).json({ error: 'Share link not found or expired' })
      return
    }
    const payload = buildSharedPreview(store, share)
    if (!payload) {
      res.status(404).json({ error: 'Preview unavailable' })
      return
    }
    res.json(payload)
  })

  app.get('/share/:token/comments', (req, res) => {
    const token = paramId(req.params.token)
    const share = resolveShareLink(store, token)
    if (!share) {
      res.status(404).json({ error: 'Share link not found or expired' })
      return
    }
    const comments = store.db.previewComments
      .filter((c) => c.shareLinkId === share.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(toPublicComment)
    res.json(comments)
  })

  app.post('/share/:token/comments', (req, res) => {
    const token = paramId(req.params.token)
    const share = resolveShareLink(store, token)
    if (!share) {
      res.status(404).json({ error: 'Share link not found or expired' })
      return
    }
    const body = req.body as {
      authorName?: string
      authorEmail?: string
      body?: string
      contactId?: string
      section?: 'queue' | 'talk_track' | 'email' | 'general'
      pinX?: number
      pinY?: number
      parentId?: string
    }
    try {
      const comment = addPreviewComment(store, share, {
        authorName: body.authorName ?? '',
        authorEmail: body.authorEmail,
        body: body.body ?? '',
        contactId: body.contactId,
        section: body.section,
        pinX: body.pinX,
        pinY: body.pinY,
        parentId: body.parentId
      })
      res.status(201).json(toPublicComment(comment))
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not post comment' })
    }
  })

  return app
}

function mutateCampaign(
  store: JsonStore,
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
  store: JsonStore,
  preferredPort = 8787,
  options?: { host?: string; config?: ServerConfig }
): Promise<{ server: Server; port: number; config: ServerConfig }> {
  const config = options?.config ?? loadConfig({ port: preferredPort })
  const host = options?.host ?? config.host
  // Auto-attach Apollo (and Twilio) for every existing org when env keys are present
  for (const org of store.db.orgs) {
    ensureApolloConnection(store, org.id, config)
    ensureCrustdataConnection(store, org.id, config)
    ensureTwilioConnection(store, org.id, config)
  }
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
