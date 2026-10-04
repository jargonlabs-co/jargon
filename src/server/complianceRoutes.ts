import type { IRouter, RequestHandler } from 'express'
import type { DataStore } from './store'
import { addSuppressions, normalizeSuppressionValue, removeSuppression } from './compliance'
import type { SuppressionKind, SuppressionReason } from './types'

const KINDS: SuppressionKind[] = ['email', 'domain', 'phone', 'linkedin']
const MANUAL_REASONS: SuppressionReason[] = ['unsubscribed', 'do_not_call', 'manual']
const MAX_BULK = 5000

/** Org-managed do-not-contact list and sender footer. Mounted for API keys and sessions. */
export function mountComplianceRoutes(
  router: IRouter,
  store: DataStore,
  auth: RequestHandler,
  paths: { suppressions: string; compliance: string }
): void {
  router.get(paths.suppressions, auth, (req, res) => {
    const orgId = req.auth!.org.id
    res.json({
      suppressions: store.db.suppressions
        .filter((s) => s.orgId === orgId)
        .sort((a, b) => b.createdAt - a.createdAt)
    })
  })

  router.post(paths.suppressions, auth, (req, res) => {
    const orgId = req.auth!.org.id
    const body = (req.body ?? {}) as {
      kind?: string
      value?: string
      values?: string[]
      reason?: string
    }
    const kind = body.kind as SuppressionKind
    if (!KINDS.includes(kind)) {
      res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` })
      return
    }
    const reason = (body.reason ?? (kind === 'phone' ? 'do_not_call' : 'manual')) as SuppressionReason
    if (!MANUAL_REASONS.includes(reason)) {
      res.status(400).json({ error: `reason must be one of ${MANUAL_REASONS.join(', ')}` })
      return
    }
    const values = [...(body.values ?? []), ...(body.value ? [body.value] : [])]
    if (!values.length || values.length > MAX_BULK) {
      res.status(400).json({ error: `Provide 1 to ${MAX_BULK} values` })
      return
    }
    const invalid = values.filter((v) => !normalizeSuppressionValue(kind, String(v))).map(String)
    const added = addSuppressions(
      store,
      values.map((value) => ({ orgId, kind, value: String(value), reason, source: 'api' }))
    )
    res.status(201).json({ added, invalid })
  })

  router.delete(`${paths.suppressions}/:id`, auth, (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (!removeSuppression(store, req.auth!.org.id, id)) {
      res.status(404).json({ error: 'Suppression not found' })
      return
    }
    res.status(204).end()
  })

  router.get(paths.compliance, auth, (req, res) => {
    const org = store.db.orgs.find((o) => o.id === req.auth!.org.id)
    res.json({ postalAddress: org?.postalAddress ?? null })
  })

  router.patch(paths.compliance, auth, (req, res) => {
    const raw = (req.body ?? {}).postalAddress
    if (raw != null && typeof raw !== 'string') {
      res.status(400).json({ error: 'postalAddress must be a string' })
      return
    }
    const postalAddress = typeof raw === 'string' ? raw.trim().slice(0, 300) : ''
    store.update((db) => {
      const org = db.orgs.find((o) => o.id === req.auth!.org.id)
      if (!org) return
      org.postalAddress = postalAddress || undefined
      org.updatedAt = Date.now()
    })
    res.json({ postalAddress: postalAddress || null })
  })
}
