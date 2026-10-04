import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createServer, type Server } from 'node:http'
import { createApi } from '../src/server/index.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
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

/** Just enough of Supabase GoTrue for sign-up with "Confirm email" on. */
function fakeSupabase() {
  const users = new Map<string, { id: string; email: string; password: string; confirmed: boolean; meta: Record<string, unknown> }>()
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const userJson = (u: { id: string; email: string; meta: Record<string, unknown>; confirmed: boolean }) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.confirmed ? new Date().toISOString() : null,
    user_metadata: u.meta,
    app_metadata: {},
    created_at: new Date().toISOString()
  })
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      requests.push({ path: `${req.method} ${url.pathname}${url.search}`, body })
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(json))
      }
      if (url.pathname === '/auth/v1/admin/users') return send(200, { users: [...users.values()].map(userJson), aud: 'authenticated' })
      if (url.pathname === '/auth/v1/signup') {
        const email = String(body.email)
        const u = { id: `sb_${users.size + 1}`, email, password: String(body.password), confirmed: false, meta: (body.data ?? {}) as Record<string, unknown> }
        users.set(email, u)
        return send(200, userJson(u))
      }
      if (url.pathname === '/auth/v1/token') {
        const u = users.get(String(body.email))
        if (!u || u.password !== body.password) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
        if (!u.confirmed) return send(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
        return send(200, { access_token: `at_${u.id}`, token_type: 'bearer', expires_in: 3600, refresh_token: 'rt', user: userJson(u) })
      }
      if (url.pathname === '/auth/v1/resend') return send(200, {})
      send(404, { msg: 'not found' })
    })
  })
  return { server, users, requests }
}

describe('email verification on sign-up', () => {
  const supabase = fakeSupabase()
  const store = memoryStore(migrateDatabase({}))
  let api: Server
  let base = ''

  before(async () => {
    await new Promise<void>((r) => supabase.server.listen(0, '127.0.0.1', () => r()))
    const sbAddr = supabase.server.address()
    const loaded = loadConfig()
    const config: ServerConfig = {
      ...loaded,
      appUrl: 'https://app.test',
      supabase: {
        url: `http://127.0.0.1:${typeof sbAddr === 'object' && sbAddr ? sbAddr.port : 0}`,
        anonKey: 'anon',
        serviceRoleKey: 'service',
        requireEmailVerification: true
      }
    }
    const app = await createApi(store, config)
    await new Promise<void>((r) => {
      api = app.listen(0, '127.0.0.1', () => r())
    })
    const addr = api.address()
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })

  after(() => {
    api?.close()
    supabase.server.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('sign-up sends a confirmation email and creates no session or workspace', async () => {
    const res = await post('/auth/register', { email: 'New@Acme.com', password: 'secret123', name: 'Nia', orgName: 'Acme' })
    assert.equal(res.status, 202)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(body.verificationRequired, true)
    assert.equal(body.token, undefined)
    assert.equal(store.db.users.length, 0)
    const signup = supabase.requests.find((r) => r.path.startsWith('POST /auth/v1/signup'))!
    assert.match(decodeURIComponent(signup.path), /redirect_to=https:\/\/app\.test\/login\?verified=1/)
  })

  it('sign-in is refused until the email is confirmed', async () => {
    const res = await post('/auth/login', { email: 'new@acme.com', password: 'secret123' })
    assert.equal(res.status, 403)
    const body = (await res.json()) as { code: string; error: string }
    assert.equal(body.code, 'email_not_confirmed')
    assert.match(body.error, /Confirm your email/)
  })

  it('resend never reveals whether the account exists', async () => {
    const res = await post('/auth/resend-verification', { email: 'nobody@else.com' })
    assert.equal(res.status, 200)
    assert.ok(supabase.requests.some((r) => r.path.startsWith('POST /auth/v1/resend')))
  })

  it('after confirming, the first sign-in creates the workspace with the sign-up name and org', async () => {
    supabase.users.get('new@acme.com')!.confirmed = true
    const res = await post('/auth/login', { email: 'new@acme.com', password: 'secret123' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { token: string; user: { name: string }; org: { name: string } }
    assert.equal(body.user.name, 'Nia')
    assert.equal(body.org.name, 'Acme')
    assert.equal(store.db.users.length, 1)
  })
})
