import { randomUUID } from 'node:crypto'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import * as Sentry from '@sentry/node'
import { isProduction } from './env'

type Level = 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

let sentryOn = false

/** Call once at boot. No-op without SENTRY_DSN. */
export function initErrorReporting(): void {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn || sentryOn) return
  Sentry.init({
    dsn,
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    sendDefaultPii: false
  })
  sentryOn = true
}

/** One JSON line in production (Railway parses it); readable text locally. */
export function log(level: Level, msg: string, fields: Fields = {}): void {
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (isProduction()) {
    write(JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields }))
    return
  }
  const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''
  write(`[jargon] ${msg}${extra}`)
}

export function reportError(err: unknown, fields: Fields = {}): void {
  const e = err instanceof Error ? err : new Error(String(err))
  log('error', e.message, { ...fields, stack: e.stack })
  if (!sentryOn) return
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'orgId' && typeof v === 'string') scope.setUser({ id: v })
      scope.setTag(k, String(v))
    }
    Sentry.captureException(e)
  })
}

export async function flushErrorReporting(): Promise<void> {
  if (sentryOn) await Sentry.flush(2000).catch(() => undefined)
}

const QUIET_PATHS = new Set(['/health', '/favicon.ico'])

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const started = Date.now()
    const incoming = req.header('x-request-id')
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    res.locals.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    res.on('finish', () => {
      const status = res.statusCode
      if (QUIET_PATHS.has(req.path) || (status < 500 && !isProduction())) return
      log(status >= 500 ? 'error' : 'info', 'request', {
        requestId,
        method: req.method,
        route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
        status,
        ms: Date.now() - started,
        orgId: req.auth?.org.id
      })
    })
    next()
  }
}

/** Last middleware: logs and reports, never sends a stack trace to the client. */
export function errorHandler(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500
    if (status >= 500) {
      reportError(err, {
        requestId: res.locals.requestId,
        method: req.method,
        route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
        orgId: req.auth?.org.id
      })
    }
    if (res.headersSent) return
    const expose = status < 500 && err instanceof Error && err.message
    res.status(status).json({
      error: expose ? err.message : 'Something went wrong. Try again, or contact support with this request id.',
      requestId: res.locals.requestId
    })
  }
}
