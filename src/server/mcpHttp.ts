import { AsyncLocalStorage } from 'async_hooks'
import type { Express, Request, Response } from 'express'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { DataStore } from './store'
import type { ServerConfig } from './config'
import { requireAuth } from './auth'
import {
  authorizationServerMetadata,
  exchangeAuthCode,
  issueAuthCode,
  mcpResourceUrl,
  protectedResourceMetadata,
  registerMcpClient,
  resolveMcpBearer,
  wwwAuthenticate,
  type McpActor
} from './mcpOauth'
import { registerJargonTools } from './mcpTools'
import type { BillingService } from './billing/types'

const actorStore = new AsyncLocalStorage<McpActor>()

export function mountMcp(
  app: Express,
  store: DataStore,
  config: ServerConfig,
  billing: BillingService
): void {
  const handler = createMcpHandler(() => {
    const actor = actorStore.getStore()
    if (!actor) throw new Error('MCP actor missing')
    const server = new McpServer({ name: 'jargon', version: '1.1.0' })
    registerJargonTools(server, store, config, actor, billing)
    return server
  })
  const node = toNodeHandler(handler)
  const auth = requireAuth(store, config)

  const sendMeta = (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata(config))
  }
  app.get('/.well-known/oauth-protected-resource', sendMeta)
  app.get('/.well-known/oauth-protected-resource/mcp', sendMeta)
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(authorizationServerMetadata(config))
  })

  app.post('/oauth/register', (req, res) => {
    try {
      const body = req.body as { client_name?: string; redirect_uris?: string[] }
      const created = registerMcpClient(store, body)
      res.status(201).json({
        ...created,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code']
      })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed' })
    }
  })

  app.get('/oauth/authorize', (req, res) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') params.set(key, value)
    }
    if (!params.get('client_id') || !params.get('redirect_uri') || !params.get('code_challenge')) {
      res.status(400).json({ error: 'client_id, redirect_uri, and code_challenge required' })
      return
    }
    res.redirect(302, `${config.appUrl}/connect/claude?${params.toString()}`)
  })

  app.post('/oauth/authorize/consent', auth, (req, res) => {
    const { client_id, redirect_uri, code_challenge, state } = req.body as {
      client_id?: string
      redirect_uri?: string
      code_challenge?: string
      state?: string
    }
    if (!client_id || !redirect_uri || !code_challenge) {
      res.status(400).json({ error: 'client_id, redirect_uri, and code_challenge required' })
      return
    }
    try {
      const code = issueAuthCode(store, {
        clientId: client_id,
        userId: req.auth!.user.id,
        orgId: req.auth!.org.id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        state
      })
      const next = new URL(redirect_uri)
      next.searchParams.set('code', code)
      if (state) next.searchParams.set('state', state)
      res.json({ redirect: next.toString() })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Consent failed' })
    }
  })

  app.post('/oauth/token', (req, res) => {
    const body = req.body as {
      grant_type?: string
      code?: string
      client_id?: string
      redirect_uri?: string
      code_verifier?: string
    }
    if (body.grant_type && body.grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' })
      return
    }
    if (!body.code || !body.client_id || !body.redirect_uri || !body.code_verifier) {
      res.status(400).json({ error: 'code, client_id, redirect_uri, and code_verifier required' })
      return
    }
    try {
      const tokens = exchangeAuthCode(store, {
        code: body.code,
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier
      })
      res.json(tokens)
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Token exchange failed' })
    }
  })

  app.all('/mcp', (req, res) => {
    const actor = resolveMcpBearer(store, req.header('authorization'))
    if (!actor) {
      res.setHeader('WWW-Authenticate', wwwAuthenticate(config))
      res.status(401).json({ error: 'Unauthorized', code: 'mcp_auth_required' })
      return
    }
    void actorStore.run(actor, () => {
      const incoming = req as unknown as Parameters<typeof node>[0]
      void node(incoming, res, req.body)
    })
  })
}

export { mcpResourceUrl }
