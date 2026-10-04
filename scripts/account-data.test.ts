import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import { createApi } from '../src/server/index.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
import { createSession, provisionWorkspace } from '../src/server/auth.ts'
import { createApiKey } from '../src/server/apiKeys.ts'
import { encryptJson } from '../src/server/crypto.ts'
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

describe('account export and deletion', () => {
  let server: Server
  let baseUrl = ''
  const store = memoryStore(migrateDatabase({}))
  const loaded = loadConfig()
  const config: ServerConfig = { ...loaded, supabase: { ...loaded.supabase, url: '', anonKey: '', serviceRoleKey: '' } }
  let sessionA = ''
  let keyA = ''
  let sessionB = ''
  let orgA = ''
  let orgB = ''

  before(async () => {
    const a = provisionWorkspace(store, { email: 'a@orga.test', name: 'A', orgName: 'Acme Outbound', supabaseUserId: 'sb_a' })
    const b = provisionWorkspace(store, { email: 'b@orgb.test', name: 'B', orgName: 'Other Co', supabaseUserId: 'sb_b' })
    orgA = a.org.id
    orgB = b.org.id
    sessionA = createSession(store, a.user.id, orgA).token
    sessionB = createSession(store, b.user.id, orgB).token
    keyA = createApiKey(store, { orgId: orgA, userId: a.user.id, name: 'cli' }).token
    const now = Date.now()
    store.update((db) => {
      for (const [orgId, email] of [
        [orgA, 'prospect@a-customer.test'],
        [orgB, 'prospect@b-customer.test']
      ]) {
        db.contacts.push({
          id: `ct_${orgId}`,
          orgId,
          projectId: `p_${orgId}`,
          name: 'Pat',
          company: 'Co',
          title: '',
          email,
          phone: '',
          city: '',
          status: 'new',
          stepIndex: 0,
          notes: '',
          createdAt: now,
          updatedAt: now
        })
      }
      db.connections.push({
        id: 'conn_a',
        orgId: orgA,
        provider: 'hubspot',
        status: 'connected',
        secretsCipher: encryptJson({ accessToken: 'super-secret-token' }),
        meta: {},
        createdAt: now,
        updatedAt: now
      })
    })
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

  const req = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  it('exports only the caller org, without credentials', async () => {
    const res = await req('GET', '/account/export', sessionA)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="jargon-/)
    const text = await res.text()
    assert.match(text, /prospect@a-customer\.test/)
    assert.doesNotMatch(text, /prospect@b-customer\.test/)
    assert.doesNotMatch(text, /secretsCipher|tokenHash|super-secret-token/)
    const body = JSON.parse(text) as { org: { id: string }; connections: unknown[]; apiKeys: unknown[] }
    assert.equal(body.org.id, orgA)
    assert.equal(body.connections.length, 1)
    assert.equal(body.apiKeys.length, 1)
  })

  it('refuses deletion with an API key or without the workspace name', async () => {
    assert.equal((await req('DELETE', '/account', keyA, { confirm: 'Acme Outbound' })).status, 403)
    assert.equal((await req('DELETE', '/account', sessionA, { confirm: 'acme' })).status, 400)
    assert.equal((await req('DELETE', '/account', sessionA)).status, 400)
    assert.ok(store.db.orgs.some((o) => o.id === orgA))
  })

  it('deletes the org, its members, and every record, leaving other orgs alone', async () => {
    const res = await req('DELETE', '/account', sessionA, { confirm: 'Acme Outbound' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { deletedUsers: number }
    assert.equal(body.deletedUsers, 1)

    const leftovers = Object.entries(store.db).flatMap(([name, rows]) =>
      Array.isArray(rows)
        ? rows
            .filter((r) => JSON.stringify(r).includes(orgA) || JSON.stringify(r).includes('a@orga.test'))
            .map(() => name)
        : []
    )
    assert.deepEqual(leftovers, [])
    assert.equal((await req('GET', '/account/export', sessionA)).status, 401)
    assert.equal((await req('GET', '/v1/me', keyA)).status, 401)

    const other = await req('GET', '/account/export', sessionB)
    assert.equal(other.status, 200)
    assert.match(await other.text(), /prospect@b-customer\.test/)
  })
})
