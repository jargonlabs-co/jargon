import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import { createApi } from '../src/server/index.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
import { provisionWorkspace } from '../src/server/auth.ts'
import { registerJargonTools } from '../src/server/mcpTools.ts'
import { createBillingService } from '../src/server/billing/index.ts'
import { plivoV3Signature, plivoWebhookBase } from '../src/server/providers/plivo.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import { encryptJson } from '../src/server/crypto.ts'
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

const base = loadConfig()
const config: ServerConfig = {
  ...base,
  plivo: { ...base.plivo, authId: 'MAFAKEAUTHID', authToken: 'fake_plivo_token' },
  outboundPools: {
    ...base.outboundPools,
    voiceEndpoints: [{ id: 'did_1', fromNumber: '+15550000001', endpointUsername: 'ep1' }]
  }
}

/** A timezone where it is mid-day right now, so the calling-hours check passes whenever this runs. */
function businessHoursZone(): string {
  for (const zone of ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney', 'Asia/Kolkata', 'Europe/Berlin', 'Pacific/Honolulu', 'America/Los_Angeles', 'Asia/Dubai']) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: zone }).format(new Date()))
    if (hour >= 10 && hour <= 18) return zone
  }
  throw new Error('no business-hours zone found')
}

type Tool = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>

function parse(result: Awaited<ReturnType<Tool>>): any {
  const text = result.content[0]?.text ?? ''
  if (result.isError) return { error: text }
  return JSON.parse(text)
}

describe('in-chat calls and email (MCP end to end)', () => {
  const store = memoryStore(migrateDatabase({}))
  const tools = new Map<string, Tool>()
  let server: Server
  let baseUrl = ''
  let orgId = ''
  let projectId = ''
  let ada = ''
  let ben = ''
  let callId = ''
  const zone = businessHoursZone()

  const realFetch = globalThis.fetch
  const outbound: Array<{ url: string; body: string }> = []

  before(async () => {
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
      outbound.push({ url, body: init.body == null ? '' : String(init.body) })
      if (/api\.plivo\.com\/.*\/JWT\/Token/.test(url)) return Response.json({ token: 'plivo.jwt.token' })
      if (/gmail\.googleapis\.com\/.*messages\/send/.test(url)) return Response.json({ id: 'gm_1', threadId: 'th_1' })
      return new Response(`unexpected outbound request ${url}`, { status: 599 })
    }) as typeof fetch
    const ws = provisionWorkspace(store, { email: 'rep@acmecorp.com', name: 'Rep', orgName: 'Acme', supabaseUserId: 'sb_rep' })
    orgId = ws.org.id
    store.update((db) => {
      db.connections.push({
        id: 'conn_gmail',
        orgId,
        provider: 'gmail',
        status: 'connected',
        accountLabel: 'rep@acmecorp.com',
        secretsCipher: encryptJson({ accessToken: 'gmail-token', refreshToken: 'r', expiresAt: Date.now() + 3600_000 }),
        meta: { email: 'rep@acmecorp.com' },
        createdAt: 0,
        updatedAt: 0
      })
    })
    registerJargonTools(
      { registerTool: (name: string, _def: unknown, handler: Tool) => tools.set(name, handler) } as unknown as Parameters<typeof registerJargonTools>[0],
      store,
      config,
      { userId: ws.user.id, orgId, environment: 'live', via: 'oauth' },
      await createBillingService(store, config)
    )
    const app = await createApi(store, config)
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })

  after(() => {
    globalThis.fetch = realFetch
    server?.close()
  })

  it('deploys a workspace from a pasted list', async () => {
    const body = parse(
      await tools.get('deploy_tool')!({
        summary: 'Set up calls and emails for Ada and Ben.',
        workspace: [
          'Build a 3-step outbound sequence with a call and emails for these people:',
          '| Name | Company | Title | Email | Phone | Timezone |',
          '|---|---|---|---|---|---|',
          `| Ada Lopez | Acme | VP RevOps | ada@acmecorp.com | +14155550101 | ${zone} |`,
          `| Ben Okafor | Beta | Head of Sales | ben@betaworks.io | +14155550102 | ${zone} |`
        ].join('\n')
      })
    )
    assert.ok(!body.error, body.error)
    projectId = body.projectId
    assert.equal(body.contactCount, 2)
    const contacts = store.db.contacts.filter((c) => c.projectId === projectId)
    ada = contacts.find((c) => c.name === 'Ada Lopez')!.id
    ben = contacts.find((c) => c.name === 'Ben Okafor')!.id
    assert.equal(store.db.contacts.find((c) => c.id === ada)!.attrs?.timezone, zone)
  })

  it('saves researched copy, enrolls, and opens the workspace', async () => {
    const steps = store.db.steps.filter((s) => s.projectId === projectId)
    assert.ok(steps.length >= 2, 'sequence has steps')
    const research = [ada, ben].flatMap((contactId) =>
      steps.map((step) => ({
        contactId,
        stepId: step.id,
        channel: step.channel,
        subject: step.channel === 'email' ? 'Quick question' : undefined,
        body: step.channel === 'call' ? 'Ask about their RevOps stack.' : 'Hi — saw Acme is growing the RevOps team.'
      }))
    )
    const saved = parse(await tools.get('save_research')!({ summary: 'Save copy.', projectId, research: JSON.stringify(research) }))
    assert.ok(!saved.error, saved.error)
    const ws = parse(await tools.get('load_email_workspace')!({ projectId }))
    assert.ok(!ws.error, ws.error)
    assert.equal(ws.contacts.length, 2)
    assert.equal(typeof store.db.contacts.find((c) => c.id === ada)!.attrs?._enrolledAt, 'number')
  })

  it('sends an email from chat', async () => {
    const sent = parse(
      await tools.get('send_message')!({
        summary: 'Email Ada.',
        contactId: ada,
        channel: 'email',
        status: 'sent',
        subject: 'Quick question',
        body: 'Hi Ada — worth a chat?'
      })
    )
    assert.ok(!sent.error, sent.error)
    assert.equal(sent.message.status, 'sent')
    const stored = store.db.messages.find((m) => m.id === sent.message.id)!
    assert.equal(stored.status, 'sent')
    assert.equal(stored.senderConnectionId, 'conn_gmail', 'sent from the org mailbox')
    const gmail = outbound.find((o) => o.url.includes('messages/send'))
    assert.ok(gmail, 'Gmail send API was called')
    const mime = Buffer.from(JSON.parse(gmail.body).raw, 'base64url').toString('utf8')
    assert.match(mime, /To: .*ada@acmecorp\.com/i)
    assert.match(mime, /List-Unsubscribe/i, 'compliance headers are added')
  })

  it('issues softphone credentials and starts a call to an override number', async () => {
    const token = parse(await tools.get('run_voice_token')!({}))
    assert.ok(!token.error, token.error)
    assert.equal(token.mode, 'plivo')
    assert.ok(token.accessToken)
    const started = parse(await tools.get('run_start_call')!({ contactId: ada, to: '(415) 555-0199' }))
    assert.ok(!started.error, started.error)
    callId = started.call.id
    const call = store.db.calls.find((c) => c.id === callId)!
    assert.equal(call.mode, 'plivo')
    assert.equal(call.to, '+14155550199')
    assert.equal(call.fromNumber, '+15550000001')
  })

  it('Plivo dials the number the rep chose, from the org caller ID', async () => {
    const params = { 'X-PH-CallId': callId, 'X-PH-To': '+14155550199', CallUUID: 'uuid-ada' }
    const nonce = 'nonce-1'
    const res = await fetch(`${baseUrl}/voice/plivo/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Plivo-Signature-V3-Nonce': nonce,
        'X-Plivo-Signature-V3': plivoV3Signature(config.plivo.authToken, `${plivoWebhookBase(config)}/voice/plivo/answer`, nonce, params)
      },
      body: new URLSearchParams(params).toString()
    })
    assert.equal(res.status, 200)
    const xml = await res.text()
    assert.match(xml, /<Number>\+14155550199<\/Number>/)
    assert.match(xml, /callerId="\+15550000001"/)
  })

  it('tracks progress and logs the outcome', async () => {
    const connected = parse(await tools.get('run_report_call_progress')!({ callId, phase: 'connected' }))
    assert.equal(connected.call.phase, 'connected')
    const done = parse(await tools.get('run_complete_call')!({ callId, disposition: 'interested' }))
    assert.ok(!done.error, done.error)
    assert.equal(store.db.calls.find((c) => c.id === callId)!.phase, 'completed')
    assert.equal(store.db.contacts.find((c) => c.id === ada)!.status, 'interested')
  })

  it('blocks a call to a suppressed number even when it is typed into the dialer', async () => {
    store.update((db) => {
      db.suppressions.push({ id: 'sup_1', orgId, kind: 'phone', value: '+14155550177', reason: 'do_not_call', createdAt: Date.now() } as never)
    })
    const blocked = parse(await tools.get('run_start_call')!({ contactId: ben, to: '+1 415 555 0177' }))
    assert.match(blocked.error ?? '', /do-not-call/i)
    const fine = parse(await tools.get('run_start_call')!({ contactId: ben }))
    assert.ok(!fine.error, fine.error)
    assert.equal(store.db.calls.find((c) => c.id === fine.call.id)!.to, '+14155550102')
  })
})
