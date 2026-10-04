import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createApi } from '../src/server/index.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
import { createSession, provisionWorkspace } from '../src/server/auth.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Database } from '../src/server/types.ts'

const run = promisify(execFile)

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

describe('jargon deploy', () => {
  let server: Server
  let baseUrl = ''
  const store = memoryStore(migrateDatabase({}))
  const loaded = loadConfig()
  const config: ServerConfig = { ...loaded, supabase: { ...loaded.supabase, url: '', anonKey: '', serviceRoleKey: '' } }
  const home = mkdtempSync(join(tmpdir(), 'jargon-cli-'))
  const configPath = join(home, '.jargon', 'config.json')

  before(async () => {
    const { user, org } = provisionWorkspace(store, { email: 'cli@co.test', name: 'Cli', orgName: 'Cli Co', supabaseUserId: 'sb_cli' })
    const session = createSession(store, user.id, org.id).token
    const app = await createApi(store, config)
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
    mkdirSync(join(home, '.jargon'), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ apiUrl: baseUrl, token: session, email: 'cli@co.test' }))
  })

  after(() => {
    server?.close()
  })

  it('swaps a login session for an API key and deploys through /v1', async () => {
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'cli/src/index.ts', 'deploy', 'Build an email sequence for these: | Name | Email |\n|---|---|\n| Ana Ruiz | ana@acme.test |', '--json'],
      { env: { ...process.env, HOME: home, JARGON_APP_URL: 'https://app.test' } }
    )
    const result = JSON.parse(stdout) as { projectId: string; contactCount: number; nextAction?: string }
    assert.ok(result.projectId)
    assert.equal(result.contactCount, 1, 'the /v1 route extracts contacts from the prompt')

    const saved = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string }
    assert.match(saved.token, /^jarg_/)
    assert.equal(store.db.apiKeys.length, 1)
    assert.equal(store.db.apiKeys[0].name, 'Jargon CLI')

    await run(process.execPath, ['--import', 'tsx', 'cli/src/index.ts', 'deploy', 'Build a dialer for VPs of Sales', '--json'], {
      env: { ...process.env, HOME: home }
    })
    assert.equal(store.db.apiKeys.length, 1, 'reuses the saved key')
  })
})
