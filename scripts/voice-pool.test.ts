import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { allocateVoiceEndpoint, PoolBudgetError } from '../src/server/outboundPools.ts'
import { loadConfig, type ServerConfig } from '../src/server/config.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { CallSession, Database } from '../src/server/types.ts'

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
  outboundPools: {
    ...base.outboundPools,
    voiceEndpoints: [
      { id: 'did_1', fromNumber: '+15550000001', endpointUsername: 'ep1' },
      { id: 'did_2', fromNumber: '+15550000002', endpointUsername: 'ep2' }
    ]
  }
}
const DAY = 24 * 60 * 60 * 1000

function call(orgId: string, startedAt: number, phase: CallSession['phase'] = 'ended'): CallSession {
  return { id: `call_${orgId}_${startedAt}`, orgId, projectId: 'p', contactId: 'c', phase, mode: 'plivo', startedAt } as CallSession
}

describe('voice DID pool', () => {
  it('gives each org its own number and keeps it', () => {
    const store = memoryStore(migrateDatabase({}))
    const a = allocateVoiceEndpoint(store, config, 'org_a')
    const b = allocateVoiceEndpoint(store, config, 'org_b')
    assert.notEqual(a.id, b.id)
    assert.equal(allocateVoiceEndpoint(store, config, 'org_a').id, a.id)
  })

  it('reclaims the number of the org idle longest, and never one on a live call', () => {
    const now = Date.now()
    const store = memoryStore(
      migrateDatabase({
        poolAssignments: [
          { id: 'pa1', orgId: 'org_old', channel: 'voice', memberId: 'did_1', createdAt: now - 90 * DAY },
          { id: 'pa2', orgId: 'org_live', channel: 'voice', memberId: 'did_2', createdAt: now - 90 * DAY }
        ],
        calls: [call('org_old', now - 45 * DAY), { ...call('org_live', now - 60_000, 'connected'), poolMemberId: 'did_2' }]
      } as Partial<Database>)
    )
    const got = allocateVoiceEndpoint(store, config, 'org_new')
    assert.equal(got.id, 'did_1')
    assert.deepEqual(
      store.db.poolAssignments.map((a) => `${a.orgId}:${a.memberId}`).sort(),
      ['org_live:did_2', 'org_new:did_1']
    )
  })

  it('tells the customer calling is at capacity without leaking ops details', () => {
    const now = Date.now()
    const store = memoryStore(
      migrateDatabase({
        poolAssignments: [
          { id: 'pa1', orgId: 'org_a', channel: 'voice', memberId: 'did_1', createdAt: now },
          { id: 'pa2', orgId: 'org_b', channel: 'voice', memberId: 'did_2', createdAt: now }
        ]
      } as Partial<Database>)
    )
    assert.throws(
      () => allocateVoiceEndpoint(store, config, 'org_c'),
      (err: unknown) =>
        err instanceof PoolBudgetError && /at capacity/.test(err.message) && !/PLIVO_POOL_JSON/.test(err.message)
    )
  })
})
