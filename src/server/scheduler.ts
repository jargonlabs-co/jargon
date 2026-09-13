import type { BillingService } from './billing/types'
import { chargeIfLive, refundCredits } from './billing'
import type { ServerConfig } from './config'
import { deliverPublicMessage } from './publicApi'
import type { DataStore } from './store'

export async function runOutboundSchedulerTick(
  store: DataStore,
  config: ServerConfig,
  billing: BillingService
): Promise<number> {
  const due = store.db.messages.filter(
    (m) => m.status === 'queued' && (m.sendAt ?? 0) <= Date.now()
  )
  let sent = 0
  for (const message of due) {
    if (!message.sandbox) {
      const charge = await chargeIfLive(billing, {
        orgId: message.orgId,
        sandbox: false,
        reason: message.channel === 'linkedin' ? 'linkedin' : 'email',
        projectId: message.projectId
      })
      if (!charge.ok) continue
      const result = await deliverPublicMessage(
        store,
        config,
        message.orgId,
        message.id,
        false
      )
      if (!result.ok && charge.creditsUsed > 0) {
        await refundCredits(billing, message.orgId, charge.creditsUsed, 'refund')
      }
      if (result.ok) sent += 1
    } else {
      const result = await deliverPublicMessage(store, config, message.orgId, message.id, true)
      if (result.ok) sent += 1
    }
  }
  return sent
}

export function startOutboundScheduler(
  store: DataStore,
  config: ServerConfig,
  billing: BillingService,
  intervalMs = 30_000
): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runOutboundSchedulerTick(store, config, billing)
    } catch (err) {
      console.warn(
        '[jargon] Scheduler tick failed:',
        err instanceof Error ? err.message : err
      )
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}
