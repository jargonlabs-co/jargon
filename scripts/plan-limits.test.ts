import assert from 'node:assert/strict'
import { assertCanCreateTool, countOrgTools, orgSkipsToolLimit, PlanLimitError } from '../src/server/planLimits.ts'
import type { BillingService } from '../src/server/billing/types.ts'
import { PLANS } from '../src/server/billing/catalog.ts'
import type { DataStore } from '../src/server/store.ts'
import type { Database } from '../src/server/types.ts'

function emptyDb(): Database {
  return {
    users: [],
    orgs: [],
    memberships: [],
    sessions: [],
    apiKeys: [],
    subscriptions: [],
    orgBilling: [],
    creditWallets: [],
    creditLots: [],
    creditLedger: [],
    usageDaily: [],
    connections: [],
    oauthStates: [],
    projects: [],
    campaigns: [],
    sequences: [],
    steps: [],
    contacts: [],
    calls: [],
    messages: [],
    activities: [],
    shareLinks: [],
    previewComments: [],
    idempotencyRecords: [],
    rateWindows: [],
    mcpOAuthClients: [],
    mcpAuthCodes: [],
    mcpAccessTokens: []
  }
}

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

const orgId = 'org_1'
const db = emptyDb()
db.projects.push(
  {
    id: 'p1',
    orgId,
    name: 'One',
    kind: 'dialer',
    prompt: 'x',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1
  } as Database['projects'][number],
  {
    id: 'p2',
    orgId,
    name: 'Two',
    kind: 'dialer',
    prompt: 'y',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1
  } as Database['projects'][number]
)

const store = memoryStore(db)
assert.equal(countOrgTools(store, orgId), 2)
assert.equal(PLANS.free.maxTools, 2)
assert.ok(new PlanLimitError('cap').code === 'plan_limit')

const freeBilling = {
  async getCredits() {
    return { plan: 'free' }
  }
} as unknown as BillingService

async function main() {
  await assert.rejects(() => assertCanCreateTool(freeBilling, store, orgId), PlanLimitError)

  db.users.push({
    id: 'user_tara',
    email: 'tara@jargonlabs.co',
    name: 'Tara',
    createdAt: 1,
    updatedAt: 1
  })
  db.memberships.push({
    id: 'mem_tara',
    orgId,
    userId: 'user_tara',
    role: 'owner',
    createdAt: 1
  })
  assert.equal(orgSkipsToolLimit(store, orgId), true)
  await assertCanCreateTool(freeBilling, store, orgId)
  console.log('plan-limits.test.ts ok')
}

main()
