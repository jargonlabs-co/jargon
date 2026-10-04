import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Server } from 'node:http'
import express from 'express'
import { errorHandler, requestLogger } from '../src/server/observability.ts'

describe('error handler and request ids', () => {
  let server: Server
  let baseUrl = ''
  const lines: string[] = []
  const original = { log: console.log, error: console.error, warn: console.warn }

  before(async () => {
    const app = express()
    app.use(requestLogger())
    app.get('/boom', () => {
      throw new Error('db password=hunter2 exploded')
    })
    app.get('/teapot', () => {
      throw Object.assign(new Error('Pick a smaller list.'), { status: 413 })
    })
    app.get('/ok', (_req, res) => {
      res.json({ ok: true })
    })
    app.use(errorHandler())
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
    const capture = (...args: unknown[]) => lines.push(args.map(String).join(' '))
    console.log = capture
    console.error = capture
    console.warn = capture
  })

  after(() => {
    Object.assign(console, original)
    server?.close()
  })

  it('returns JSON with a request id and no internals on a 500', async () => {
    const res = await fetch(`${baseUrl}/boom`)
    assert.equal(res.status, 500)
    const body = (await res.json()) as { error: string; requestId: string }
    assert.ok(body.requestId)
    assert.equal(res.headers.get('x-request-id'), body.requestId)
    assert.doesNotMatch(JSON.stringify(body), /hunter2|at .*\.ts/)
    assert.ok(lines.some((l) => l.includes('hunter2') && l.includes(body.requestId)), 'the server log keeps the detail')
  })

  it('passes through 4xx messages', async () => {
    const res = await fetch(`${baseUrl}/teapot`)
    assert.equal(res.status, 413)
    assert.equal(((await res.json()) as { error: string }).error, 'Pick a smaller list.')
  })

  it('reuses a sane incoming request id and ignores junk', async () => {
    const good = await fetch(`${baseUrl}/ok`, { headers: { 'X-Request-Id': 'abc12345-trace' } })
    assert.equal(good.headers.get('x-request-id'), 'abc12345-trace')
    const bad = await fetch(`${baseUrl}/ok`, { headers: { 'X-Request-Id': '<script>' } })
    assert.notEqual(bad.headers.get('x-request-id'), '<script>')
  })
})
