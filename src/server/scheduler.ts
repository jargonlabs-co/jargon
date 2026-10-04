import type { BillingService } from './billing/types'
import { chargeIfLive, refundCredits } from './billing'
import type { ServerConfig } from './config'
import { deliverPublicMessage } from './publicApi'
import { findSuppression } from './compliance'
import { pollGmailBounces } from './bounces'
import { pollMailboxReplies } from './mailboxes'
import { sweepExpired } from './housekeeping'
import { isProduction } from './env'
import type { DataStore } from './store'
import { log, reportError } from './observability'
import { flushHubSpotOutbox } from './hubspotWriteback'

const BOUNCE_POLL_MS = 10 * 60 * 1000
const REPLY_POLL_MS = 3 * 60 * 1000
const SWEEP_MS = 60 * 60 * 1000

function bouncePollEnabled(): boolean {
  return isProduction() || process.env.JARGON_BOUNCE_POLL === '1'
}

function replyPollEnabled(): boolean {
  return isProduction() || process.env.JARGON_REPLY_POLL === '1'
}

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
    // A replaced process must not send: its writes are discarded, so the new owner would send again.
    if (store.isWriter && !(await store.isWriter())) break
    // Earlier sends in this tick yield, so a reply, unenroll, or manual send may have changed it.
    if (store.db.messages.find((m) => m.id === message.id)?.status !== 'queued') continue
    const contact = store.db.contacts.find(
      (c) => c.id === message.contactId && c.orgId === message.orgId
    )
    if (!message.sandbox && contact && findSuppression(store.db, message.orgId, message.channel, contact)) {
      // Cancels the message without charging.
      await deliverPublicMessage(store, config, message.orgId, message.id, false)
      continue
    }
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
      if (!result.ok) {
        log('warn', 'scheduled send failed', {
          orgId: message.orgId,
          messageId: message.id,
          channel: message.channel,
          error: result.body.error
        })
        if (charge.creditsUsed > 0) await refundCredits(billing, message.orgId, charge.creditsUsed, 'refund')
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
  let lastBouncePoll = 0
  let lastReplyPoll = 0
  let lastSweep = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      if (store.isWriter && !(await store.isWriter())) return
      if (Date.now() - lastSweep >= SWEEP_MS) {
        lastSweep = Date.now()
        const removed = sweepExpired(store)
        if (removed) console.log(`[jargon] Housekeeping removed ${removed} expired record(s)`)
      }
      // Replies and bounces first so this tick doesn't send to someone who just replied or bounced.
      if (replyPollEnabled() && Date.now() - lastReplyPoll >= REPLY_POLL_MS) {
        lastReplyPoll = Date.now()
        try {
          const r = await pollMailboxReplies(store, config)
          if (r.replies || r.bounces) {
            console.log(`[jargon] Mailbox poll: ${r.replies} reply(ies), ${r.bounces} bounce(s)`)
          }
        } catch (err) {
          reportError(err, { source: 'reply-poll' })
        }
      }
      if (bouncePollEnabled() && Date.now() - lastBouncePoll >= BOUNCE_POLL_MS) {
        lastBouncePoll = Date.now()
        try {
          const bounced = await pollGmailBounces(store, config)
          if (bounced) console.log(`[jargon] Suppressed ${bounced} hard-bounced address(es)`)
        } catch (err) {
          reportError(err, { source: 'bounce-poll' })
        }
      }
      await runOutboundSchedulerTick(store, config, billing)
      if (store.db.hubspotOutbox.length) {
        try {
          await flushHubSpotOutbox(store, config)
        } catch (err) {
          reportError(err, { source: 'hubspot-writeback' })
        }
      }
    } catch (err) {
      reportError(err, { source: 'scheduler' })
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
