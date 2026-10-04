import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import { createApi } from '../src/server/index.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
import { adminTokenMatches, decryptJson, DEV_ENCRYPTION_KEY, encryptJson } from '../src/server/crypto.ts'
import { isProduction } from '../src/server/env.ts'
import { checkProductionConfig } from '../src/server/production.ts'
import { plivoV3Signature, plivoWebhookBase, verifyPlivoSignature } from '../src/server/providers/plivo.ts'
import { createHash } from 'node:crypto'
import { sweepExpired } from '../src/server/housekeeping.ts'
import {
  exchangeAuthCode,
  issueAuthCode,
  refreshAccessToken,
  registerMcpClient,
  resolveMcpBearer
} from '../src/server/mcpOauth.ts'
import { unsubscribeUrl } from '../src/server/compliance.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Database } from '../src/server/types.ts'

function memoryStore(db: Database): DataStore {
  return {
    get db() {
      return db
    },
    persist() {},
    update(mutator) {
      mutator(db)
      return db
    }
  }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('production detection', () => {
  it('treats Railway and NODE_ENV=production as production', () => {
    assert.equal(isProduction({ RAILWAY_ENVIRONMENT: 'production' }), true)
    assert.equal(isProduction({ NODE_ENV: 'production' }), true)
    assert.equal(isProduction({}), false)
  })

  it('lets JARGON_ENV=development opt out', () => {
    assert.equal(isProduction({ RAILWAY_ENVIRONMENT: 'x', JARGON_ENV: 'development' }), false)
  })
})

describe('production config check', () => {
  const base: ServerConfig = {
    ...loadConfig(),
    publicUrl: 'https://api.jargonlabs.co',
    appUrl: 'https://jargonlabs.co',
    supabase: { url: 'https://x.supabase.co', anonKey: 'a', serviceRoleKey: 's' }
  }
  const goodEnv = {
    JARGON_ENCRYPTION_KEY: 'k'.repeat(48),
    DATABASE_URL: 'postgres://x'
  }

  it('passes with the required settings', () => {
    assert.deepEqual(checkProductionConfig(base, goodEnv).errors, [])
  })

  it('rejects a missing, short, or public encryption key', () => {
    assert.match(checkProductionConfig(base, { ...goodEnv, JARGON_ENCRYPTION_KEY: '' }).errors.join(), /not set/)
    assert.match(checkProductionConfig(base, { ...goodEnv, JARGON_ENCRYPTION_KEY: 'short' }).errors.join(), /32/)
    assert.match(
      checkProductionConfig(base, { ...goodEnv, JARGON_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY }).errors.join(),
      /public dev key/
    )
  })

  it('rejects JSON-file storage, demo mode, and missing auth', () => {
    const errors = checkProductionConfig(
      { ...base, supabase: { url: '', anonKey: '', serviceRoleKey: '' } },
      { ...goodEnv, DATABASE_URL: '', JARGON_DEMO_MODE: '1' }
    ).errors.join('\n')
    assert.match(errors, /DATABASE_URL/)
    assert.match(errors, /JARGON_DEMO_MODE/)
    assert.match(errors, /SUPABASE/)
  })
})

describe('encryption key rotation', () => {
  it('decrypts secrets written under a previous key', () => {
    const cipher = withEnv({ JARGON_ENCRYPTION_KEY: 'old-key', JARGON_ENCRYPTION_KEY_PREVIOUS: undefined }, () =>
      encryptJson({ accessToken: 'tok' })
    )
    withEnv({ JARGON_ENCRYPTION_KEY: 'new-key', JARGON_ENCRYPTION_KEY_PREVIOUS: undefined }, () => {
      assert.throws(() => decryptJson(cipher))
    })
    withEnv({ JARGON_ENCRYPTION_KEY: 'new-key', JARGON_ENCRYPTION_KEY_PREVIOUS: 'old-key' }, () => {
      assert.deepEqual(decryptJson(cipher), { accessToken: 'tok' })
    })
  })
})

describe('admin token', () => {
  it('never matches when unset', () => {
    withEnv({ JARGON_ADMIN_TOKEN: undefined }, () => {
      assert.equal(adminTokenMatches('Bearer '), false)
      assert.equal(adminTokenMatches(undefined), false)
    })
  })

  it('matches only the exact bearer token', () => {
    withEnv({ JARGON_ADMIN_TOKEN: 'secret-admin' }, () => {
      assert.equal(adminTokenMatches('Bearer secret-admin'), true)
      assert.equal(adminTokenMatches('Bearer secret-admi'), false)
      assert.equal(adminTokenMatches('secret-admin'), false)
    })
  })
})

describe('plivo webhook signatures', () => {
  // Vectors verified against plivo-node 4.79.0 validateV3Signature.
  const token = 'tok_secret_1234567890'
  const params = {
    To: 'sip:jargon123@phone.plivo.com',
    From: 'sip:ep@phone.plivo.com',
    'X-PH-CallId': 'call_abc',
    CallUUID: 'uuid-1',
    Direction: 'outbound'
  }

  it('matches the Plivo SDK for POST callbacks', () => {
    assert.equal(
      plivoV3Signature(token, 'https://api.example.com/voice/plivo/answer', 'nonce42', params),
      'seKB4VHDGE4bT2MXLxx8W+BaQmIh3M615pzCyePR2Jg='
    )
    assert.equal(
      plivoV3Signature(token, 'https://api.example.com/voice/plivo/answer?b=2&a=1', 'n2', params),
      'O4VN2sbUjrZi4ZzHhuIW4UxnNqhi+Zrudbdr7HlGfpo='
    )
  })

  it('rejects tampered bodies and missing headers', () => {
    const url = 'https://api.example.com/voice/plivo/answer'
    const signature = 'seKB4VHDGE4bT2MXLxx8W+BaQmIh3M615pzCyePR2Jg='
    assert.equal(verifyPlivoSignature({ authToken: token, url, nonce: 'nonce42', signature, params }), true)
    assert.equal(
      verifyPlivoSignature({ authToken: token, url, nonce: 'nonce42', signature, params: { ...params, To: '+15550000000' } }),
      false
    )
    assert.equal(verifyPlivoSignature({ authToken: token, url, nonce: undefined, signature, params }), false)
    assert.equal(verifyPlivoSignature({ authToken: '', url, nonce: 'nonce42', signature, params }), false)
  })
})

describe('mcp client registration', () => {
  it('reuses a client for identical redirect URIs instead of growing state', () => {
    const store = memoryStore(migrateDatabase({}))
    const a = registerMcpClient(store, { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] })
    const b = registerMcpClient(store, { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] })
    assert.equal(a.client_id, b.client_id)
    assert.equal(store.db.mcpOAuthClients.length, 1)
  })

  it('issues rotating refresh tokens so the connector survives past the access-token lifetime', () => {
    const store = memoryStore(
      migrateDatabase({ memberships: [{ id: 'm1', orgId: 'org_a', userId: 'user_a', role: 'owner', createdAt: 0 }] })
    )
    const { client_id } = registerMcpClient(store, { redirect_uris: ['https://claude.ai/cb'] })
    const verifier = 'v'.repeat(50)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const code = issueAuthCode(store, {
      clientId: client_id,
      userId: 'user_a',
      orgId: 'org_a',
      redirectUri: 'https://claude.ai/cb',
      codeChallenge: challenge
    })
    const first = exchangeAuthCode(store, { code, clientId: client_id, redirectUri: 'https://claude.ai/cb', codeVerifier: verifier })
    assert.ok(first.refresh_token)
    assert.equal(resolveMcpBearer(store, `Bearer ${first.access_token}`)?.orgId, 'org_a')

    const second = refreshAccessToken(store, { refreshToken: first.refresh_token, clientId: client_id })
    assert.equal(resolveMcpBearer(store, `Bearer ${second.access_token}`)?.orgId, 'org_a')
    assert.equal(resolveMcpBearer(store, `Bearer ${first.access_token}`), null, 'old access token is replaced')
    assert.throws(() => refreshAccessToken(store, { refreshToken: first.refresh_token }), /Invalid or expired/)
    assert.throws(() => refreshAccessToken(store, { refreshToken: second.refresh_token, clientId: 'other' }), /client_id/)

    store.update((db) => {
      db.memberships = []
    })
    assert.throws(() => refreshAccessToken(store, { refreshToken: second.refresh_token }), /Invalid or expired/)
  })

  it('housekeeping drops expired auth state but keeps live and refreshable tokens', () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const store = memoryStore(
      migrateDatabase({
        sessions: [
          { id: 's_old', userId: 'u', orgId: 'o', tokenHash: 'a', createdAt: 0, expiresAt: now - 1 },
          { id: 's_live', userId: 'u', orgId: 'o', tokenHash: 'b', createdAt: 0, expiresAt: now + day }
        ],
        mcpAccessTokens: [
          { id: 't_refreshable', tokenHash: 'x', clientId: 'c_live', userId: 'u', orgId: 'o', createdAt: 0, expiresAt: now - 1, refreshExpiresAt: now + day },
          { id: 't_dead', tokenHash: 'y', clientId: 'c_dead', userId: 'u', orgId: 'o', createdAt: 0, expiresAt: now - 1 }
        ],
        mcpOAuthClients: [
          { id: 'cl1', clientId: 'c_live', clientName: 'Claude', redirectUris: [], createdAt: now - 60 * day },
          { id: 'cl2', clientId: 'c_dead', clientName: 'Claude', redirectUris: [], createdAt: now - 60 * day },
          { id: 'cl3', clientId: 'c_new', clientName: 'Claude', redirectUris: [], createdAt: now }
        ],
        rateWindows: [
          { id: 'r_old', orgId: 'o', action: 'message', windowStart: now - 3 * day, count: 1 },
          { id: 'r_now', orgId: 'o', action: 'message', windowStart: now, count: 1 }
        ]
      } as Partial<Database>)
    )
    assert.equal(sweepExpired(store, now), 4)
    assert.deepEqual(store.db.sessions.map((s) => s.id), ['s_live'])
    assert.deepEqual(store.db.mcpAccessTokens.map((t) => t.id), ['t_refreshable'])
    assert.deepEqual(store.db.mcpOAuthClients.map((c) => c.clientId), ['c_live', 'c_new'])
    assert.deepEqual(store.db.rateWindows.map((w) => w.id), ['r_now'])
    assert.equal(sweepExpired(store, now), 0)
  })

  it('rejects oversized registrations', () => {
    const store = memoryStore(migrateDatabase({}))
    assert.throws(() =>
      registerMcpClient(store, { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://x/${i}`) })
    )
  })
})

describe('public HTTP surface', () => {
  let server: Server
  let baseUrl = ''
  const store = memoryStore(migrateDatabase({}))
  const token = 'tok_secret_1234567890'
  const loaded = loadConfig()
  const config: ServerConfig = {
    ...loaded,
    plivo: { ...loaded.plivo, authToken: token },
    outboundPools: {
      ...loaded.outboundPools,
      voiceEndpoints: [
        { id: 'voice_a', fromNumber: '+15550000001', endpointUsername: 'endpointa' },
        { id: 'voice_b', fromNumber: '+15550000002', endpointUsername: 'endpointb' }
      ]
    }
  }

  before(async () => {
    const app = await createApi(store, config)
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })

  after(() => {
    server?.close()
  })

  it('answers MCP OAuth discovery for the canonical host and legacy aliases', async () => {
    const { authorizationServerMetadata, originFor, protectedResourceMetadata } = await import('../src/server/mcpOauth.ts')
    const cfg = { ...config, publicUrl: 'https://api.jargonlabs.co', publicUrlAliases: ['https://www.jargonlabs.co'] }
    assert.equal(originFor(cfg, 'www.jargonlabs.co'), 'https://www.jargonlabs.co')
    assert.equal(originFor(cfg, 'api.jargonlabs.co'), 'https://api.jargonlabs.co')
    assert.equal(originFor(cfg, 'evil.example'), 'https://api.jargonlabs.co', 'unknown hosts get the canonical origin')
    assert.equal(protectedResourceMetadata(cfg, originFor(cfg, 'www.jargonlabs.co')).resource, 'https://www.jargonlabs.co/mcp')
    assert.equal(authorizationServerMetadata(cfg).token_endpoint, 'https://api.jargonlabs.co/oauth/token')

    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)
    const meta = (await res.json()) as { resource: string }
    assert.equal(meta.resource, `${config.publicUrl.replace(/\/$/, '')}/mcp`)
  })

  it('keeps /health minimal', async () => {
    const res = await fetch(`${baseUrl}/health`)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['ok', 'storage'])
  })

  it('hides /health/details without the admin token', async () => {
    const res = await fetch(`${baseUrl}/health/details`)
    assert.equal(res.status, 404)
  })

  it('rejects unsigned Plivo webhooks', async () => {
    for (const path of ['/voice/plivo/answer', '/voice/plivo/dial', '/voice/plivo/hangup']) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'X-PH-To=%2B15551234567&CallUUID=abc'
      })
      assert.equal(res.status, 403, path)
    }
  })

  async function signedPost(path: string, params: Record<string, string>) {
    const nonce = `n${Date.now()}`
    const signature = plivoV3Signature(token, `${plivoWebhookBase(config)}${path}`, nonce, params)
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Plivo-Signature-V3': signature,
        'X-Plivo-Signature-V3-Nonce': nonce
      },
      body: new URLSearchParams(params).toString()
    })
  }

  it('accepts signed Plivo webhooks', async () => {
    const res = await signedPost('/voice/plivo/answer', { 'X-PH-To': '+15551234567', CallUUID: 'uuid-ok' })
    assert.equal(res.status, 200)
    assert.match(await res.text(), /<Number>\+15551234567<\/Number>/)
  })

  it("refuses to dial with another org's call from a different endpoint", async () => {
    store.db.calls.push({
      id: 'call_org_b',
      orgId: 'org_b',
      projectId: 'p',
      contactId: 'c',
      phase: 'dialing',
      mode: 'plivo',
      poolMemberId: 'voice_b',
      fromNumber: '+15550000002',
      startedAt: Date.now()
    })
    const res = await signedPost('/voice/plivo/answer', {
      'X-PH-To': '+15551234567',
      'X-PH-CallId': 'call_org_b',
      From: 'sip:endpointa@phone.plivo.com',
      CallUUID: 'uuid-cross'
    })
    const xml = await res.text()
    assert.match(xml, /<Hangup/)
    assert.equal(store.db.calls.find((c) => c.id === 'call_org_b')?.providerCallSid, undefined)
  })

  it('unsubscribes only on POST, never on a link prefetch', async () => {
    store.db.orgs.push({ id: 'org_u', name: 'U', slug: 'u', createdAt: 0, updatedAt: 0 })
    const token = unsubscribeUrl(config, 'org_u', 'pat@example.com').split('/u/')[1]
    const page = await fetch(`${baseUrl}/u/${token}`)
    assert.match(await page.text(), /<form method="post">/)
    assert.equal(store.db.suppressions.length, 0)
    const done = await fetch(`${baseUrl}/u/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click'
    })
    assert.equal(done.status, 200)
    assert.deepEqual(
      store.db.suppressions.map((s) => [s.orgId, s.value, s.reason]),
      [['org_u', 'pat@example.com', 'unsubscribed']]
    )
    const bad = await fetch(`${baseUrl}/u/garbage.token`, { method: 'POST' })
    assert.equal(bad.status, 400)
  })

  it('does not reflect the email-workspace payload query', async () => {
    const res = await fetch(`${baseUrl}/mcp/apps/email-workspace?payload=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E`)
    const html = await res.text()
    assert.equal(html.includes('alert(1)'), false)
  })
})
