import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import { createApi } from '../src/server/index.ts'
import { loadConfig } from '../src/server/config.ts'
import { createSession, provisionWorkspace } from '../src/server/auth.ts'
import { createApiKey } from '../src/server/apiKeys.ts'
import { uid } from '../src/server/crypto.ts'
import { seedProject } from '../src/server/seed.ts'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import { registerJargonTools } from '../src/server/mcpTools.ts'
import { createBillingService } from '../src/server/billing/index.ts'
import type { Contact, Database } from '../src/server/types.ts'

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

const SECRET_EMAIL = 'victim-secret@orgb.test'
const SECRET_NAME = 'Zebulon Victimsworth'
const SECRET_PROJECT_PROMPT = 'Build an outbound dialer for OrgB Secret Segment'

/** Routes that never touch org data or are authenticated by something other than a user token. */
const PUBLIC_PREFIXES = [
  '/oauth/',
  '/auth/',
  '/voice/plivo/',
  '/webhooks/',
  '/.well-known/',
  '/mcp',
  // Unsubscribe page (signed token) and the public tool link that redirects to the app.
  '/u/',
  '/tools/:id'
]

type RouteDef = { method: string; path: string }

function listRoutes(app: unknown): RouteDef[] {
  const out: RouteDef[] = []
  const walk = (stack: unknown[], prefix: string) => {
    for (const layer of stack as Array<Record<string, any>>) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
        for (const p of paths) {
          if (typeof p !== 'string') continue
          for (const [method, on] of Object.entries(layer.route.methods ?? {})) {
            if (on && method !== '_all') out.push({ method: method.toUpperCase(), path: prefix + p })
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + '/v1')
      }
    }
  }
  walk((app as { router: { stack: unknown[] } }).router.stack, '')
  return out
}

function orgRecords(db: Database, orgId: string): string {
  const owned: Record<string, unknown[]> = {}
  for (const [name, rows] of Object.entries(db)) {
    if (!Array.isArray(rows) || name === 'apiKeys' || name === 'sessions') continue
    const mine = rows.filter((r) => r && typeof r === 'object' && (r as { orgId?: string }).orgId === orgId)
    if (mine.length) owned[name] = mine
  }
  return JSON.stringify(owned)
}

describe('tenant isolation', () => {
  let server: Server
  let baseUrl = ''
  const store = memoryStore(migrateDatabase({}))
  const config = loadConfig()
  let app: Awaited<ReturnType<typeof createApi>>
  let sessionA = ''
  let keyA = ''
  let keyB = ''
  const idsB: string[] = []
  let orgB = ''

  before(async () => {
    const a = provisionWorkspace(store, { email: 'attacker@orga.test', name: 'Attacker', orgName: 'Org A', supabaseUserId: 'sb_a' })
    const b = provisionWorkspace(store, { email: 'owner@orgb.test', name: 'Owner', orgName: 'Org B', supabaseUserId: 'sb_b' })
    orgB = b.org.id
    sessionA = createSession(store, a.user.id, a.org.id).token
    keyA = createApiKey(store, { orgId: a.org.id, userId: a.user.id, name: 'a' }).token
    keyB = createApiKey(store, { orgId: b.org.id, userId: b.user.id, name: 'b' }).token

    const now = Date.now()
    const contact: Contact = {
      id: uid('ct'),
      orgId: orgB,
      projectId: '',
      name: SECRET_NAME,
      company: 'Victim Co',
      title: 'VP Sales',
      email: SECRET_EMAIL,
      phone: '+15557654321',
      city: 'Boston',
      status: 'new',
      stepIndex: 0,
      notes: 'secret note',
      createdAt: now,
      updatedAt: now
    }
    store.update((db) => {
      const project = seedProject(db, {
        orgId: orgB,
        prompt: SECRET_PROJECT_PROMPT,
        kind: 'dialer',
        answers: {},
        contacts: [contact],
        spec: compileWorkspaceSpec(SECRET_PROJECT_PROMPT)
      })
      const call = {
        id: uid('call'),
        orgId: orgB,
        projectId: project.id,
        contactId: contact.id,
        phase: 'connected' as const,
        mode: 'demo' as const,
        startedAt: now
      }
      db.calls.unshift(call)
      const message = {
        id: uid('msg'),
        orgId: orgB,
        projectId: project.id,
        contactId: contact.id,
        subject: 'secret subject',
        body: 'secret body',
        status: 'draft' as const,
        channel: 'email' as const,
        mode: 'demo' as const,
        createdAt: now,
        updatedAt: now
      }
      db.messages.unshift(message)
      const sequence = db.sequences.find((s) => s.projectId === project.id)
      const step = db.steps.find((s) => s.projectId === project.id)
      const campaign = db.campaigns.find((c) => c.projectId === project.id)
      idsB.push(project.id, contact.id, call.id, message.id)
      for (const extra of [sequence?.id, step?.id, campaign?.id]) if (extra) idsB.push(extra)
    })

    app = await createApi(store, config)
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })

  after(() => {
    server?.close()
  })

  async function call(method: string, path: string, token: string) {
    const hasBody = method !== 'GET' && method !== 'DELETE' && method !== 'HEAD'
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': uid('idem'),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {})
      },
      body: hasBody
        ? JSON.stringify({
            subject: 'x',
            body: 'x',
            note: 'x',
            text: 'x',
            status: 'meeting_booked',
            disposition: 'meeting_booked',
            outcome: 'meeting_booked',
            phase: 'ended',
            channel: 'email',
            steps: [],
            contacts: [{ name: 'X', email: 'x@x.test' }]
          })
        : undefined,
      redirect: 'manual'
    })
    return { status: res.status, text: await res.text() }
  }

  it("can't read or change another org's records through any id route", async () => {
    const routes = listRoutes(app).filter(
      (r) => r.path.includes('/:') && !PUBLIC_PREFIXES.some((p) => r.path.startsWith(p))
    )
    assert.ok(routes.length > 30, `expected many id routes, found ${routes.length}`)
    const before = orgRecords(store.db, orgB)
    const failures: string[] = []
    for (const route of routes) {
      const token = route.path.startsWith('/v1/') ? keyA : sessionA
      for (const id of idsB) {
        const path = route.path.replace(/:[A-Za-z_]+/g, id)
        const res = await call(route.method, path, token)
        if (res.status < 400 || res.status >= 500) failures.push(`${route.method} ${route.path} → ${res.status}`)
        if (res.text.includes(SECRET_EMAIL) || res.text.includes(SECRET_NAME) || res.text.includes('secret note')) {
          failures.push(`${route.method} ${route.path} leaked org B data`)
        }
      }
    }
    assert.deepEqual([...new Set(failures)], [])
    assert.equal(orgRecords(store.db, orgB), before, "org B's records changed")
  })

  it("list routes never include another org's data", async () => {
    const routes = listRoutes(app).filter(
      (r) => r.method === 'GET' && !r.path.includes('/:') && !PUBLIC_PREFIXES.some((p) => r.path.startsWith(p))
    )
    for (const route of routes) {
      const token = route.path.startsWith('/v1/') ? keyA : sessionA
      const res = await call('GET', route.path, token)
      assert.ok(!res.text.includes(SECRET_EMAIL) && !res.text.includes(SECRET_NAME), `${route.path} leaked org B data`)
    }
  })

  it('the owner can still read its own records (the fixture is valid)', async () => {
    const res = await call('GET', `/v1/prospects/${idsB[1]}`, keyB)
    assert.equal(res.status, 200)
    assert.match(res.text, new RegExp(SECRET_EMAIL))
  })

  it("MCP tools can't read or change another org's records", async () => {
    const tools = new Map<string, { schema: unknown; handler: (args: Record<string, unknown>) => unknown }>()
    const fakeServer = {
      registerTool(name: string, def: { inputSchema?: unknown }, handler: (args: Record<string, unknown>) => unknown) {
        tools.set(name, { schema: def.inputSchema, handler })
      }
    }
    const attacker = store.db.users.find((u) => u.email === 'attacker@orga.test')!
    const attackerOrg = store.db.memberships.find((m) => m.userId === attacker.id)!.orgId
    registerJargonTools(
      fakeServer as unknown as Parameters<typeof registerJargonTools>[0],
      store,
      config,
      { userId: attacker.id, orgId: attackerOrg, environment: 'live', via: 'oauth' },
      await createBillingService(store, config)
    )
    assert.ok(tools.size > 30, `expected many MCP tools, found ${tools.size}`)

    const before = orgRecords(store.db, orgB)
    const leaks: string[] = []
    let probed = 0
    for (const [name, tool] of tools) {
      const shape = (tool.schema as { shape?: Record<string, unknown> } | undefined)?.shape ?? {}
      const idKeys = Object.keys(shape).filter((k) => /(^id$|Id$|Ids$)/.test(k))
      if (!idKeys.length) continue
      probed++
      for (const id of idsB) {
        const args: Record<string, unknown> = { summary: 'x', subject: 'x', body: 'x', note: 'x' }
        for (const k of idKeys) args[k] = k.endsWith('Ids') ? [id] : id
        let text = ''
        try {
          text = JSON.stringify(await tool.handler(args))
        } catch (err) {
          text = String(err)
        }
        if (text.includes(SECRET_EMAIL) || text.includes(SECRET_NAME) || text.includes('secret note')) {
          leaks.push(name)
        }
      }
    }
    assert.ok(probed > 15, `expected many id-taking tools, probed ${probed}`)

    const ownerTools = new Map<string, (args: Record<string, unknown>) => unknown>()
    const owner = store.db.users.find((u) => u.email === 'owner@orgb.test')!
    registerJargonTools(
      { registerTool: (n: string, _d: unknown, h: (args: Record<string, unknown>) => unknown) => ownerTools.set(n, h) } as unknown as Parameters<typeof registerJargonTools>[0],
      store,
      config,
      { userId: owner.id, orgId: orgB, environment: 'live', via: 'oauth' },
      await createBillingService(store, config)
    )
    assert.match(JSON.stringify(await ownerTools.get('get_prospect')!({ id: idsB[1] })), new RegExp(SECRET_EMAIL))
    assert.deepEqual([...new Set(leaks)], [])
    assert.equal(orgRecords(store.db, orgB), before, "org B's records changed")
  })

  it("rejects another org's ids for querystring filters too", async () => {
    const res = await call('GET', `/v1/prospects?projectId=${idsB[0]}`, keyA)
    assert.equal(res.status, 404)
  })
})
