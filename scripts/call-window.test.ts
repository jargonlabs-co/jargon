import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/server/config.ts'
import { JARGON_MCP_INSTRUCTIONS } from '../src/server/emailWorkspace.ts'
import { savePublicResearch } from '../src/server/publicApi.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Contact, Project } from '../src/server/types.ts'
import { buildWorkspaceTasks } from '../src/server/workspaceTasks.ts'
import {
  ATTR_CALL_WINDOW,
  callWindowClause,
  formatCallWindow,
  parseClock,
  takeCallWindow,
  wantsCallWindows,
  type CallWindow
} from '../src/shared/callWindow.ts'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec.ts'

function memoryStore(db: ReturnType<typeof migrateDatabase>): DataStore {
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

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'a',
    orgId: 'org_1',
    projectId: 'proj_1',
    name: 'A',
    company: 'Mike\'s Auto',
    title: 'Owner',
    email: 'a@mikes.test',
    phone: '+15551230001',
    city: 'Chicago',
    status: 'active',
    stepIndex: 0,
    notes: '',
    companyIndustry: 'Automotive',
    attrs: { _enrolledAt: 1_000, hs_timezone: 'America/Chicago' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('best time to call', () => {
  it('recognizes the ask and still compiles a dialer', () => {
    const prompt = 'take this list of accounts from hubspot and build a dialer for the best times of day to call them'
    assert.equal(wantsCallWindows(prompt), true)
    assert.equal(wantsCallWindows('least busy time of day to call automotive shops'), true)
    assert.equal(wantsCallWindows('Build an outbound dialer for GTM Engineers in the US'), false)
    const spec = compileWorkspaceSpec(prompt)
    assert.equal(spec.kind, 'dialer')
    assert.ok(spec.channels.includes('call'))
    assert.match(callWindowClause(), /callWindow/)
    assert.match(JARGON_MCP_INSTRUCTIONS, /callWindow/)
    assert.match(readFileSync('src/server/apps/emailWorkspace.html', 'utf8'), /task\.callWindowLabel/)
  })

  it('parses clock times and labels an unknown zone as the rep\'s clock', () => {
    assert.equal(parseClock('7:30am'), '07:30')
    assert.equal(parseClock('9:00'), '09:00')
    assert.equal(parseClock('noon'), null)
    const bad = takeCallWindow({ startLocal: 'noon', endLocal: '1pm' })
    assert.equal(bad.ok, false)
    const window: CallWindow = {
      startLocal: '07:30',
      endLocal: '09:00',
      clock: 'rep',
      businessType: 'Automotive',
      reason: 'Before the bays fill',
      inferred: true
    }
    assert.equal(formatCallWindow(window), '7:30–9:00am your time')
    assert.match(
      formatCallWindow({ ...window, clock: 'account', timezone: 'America/Chicago' }),
      /^7:30–9:00am /
    )
  })

  it('stores one window per industry and timezone and orders the to-do list by it', async () => {
    const db = migrateDatabase({})
    db.projects.push({
      id: 'proj_1',
      orgId: 'org_1',
      name: 'Dialer',
      kind: 'dialer',
      prompt: 'build a dialer for the best times of day to call them',
      segment: 'HubSpot accounts',
      team: '',
      description: '',
      answers: {},
      createdAt: 1,
      updatedAt: 1
    } satisfies Project)
    const early = contact({ id: 'early', name: 'Zoe Early' })
    const same = contact({ id: 'same', name: 'Sam Same', email: 'sam@mikes.test', phone: '+15551230002' })
    const other = contact({
      id: 'other',
      name: 'Pat Soft',
      email: 'pat@soft.test',
      company: 'Soft Co',
      companyIndustry: 'Software',
      phone: '+15551230003'
    })
    const west = contact({
      id: 'west',
      name: 'Wes West',
      email: 'wes@mikes.test',
      phone: '+15551230004',
      attrs: { _enrolledAt: 1_000, hs_timezone: 'America/Los_Angeles' }
    })
    db.contacts.push(early, same, other, west)
    const store = memoryStore(db)
    const saved = await savePublicResearch(store, loadConfig(), 'org_1', 'proj_1', [
      {
        contactId: 'early',
        channel: 'call',
        body: 'Ask who runs the shop.',
        callWindow: {
          startLocal: '7:30am',
          endLocal: '9:00',
          timezone: 'America/Chicago',
          businessType: 'Automotive',
          reason: 'Before the bays fill'
        }
      },
      { contactId: 'same', channel: 'call', body: 'Ask who runs the shop.' },
      { contactId: 'other', channel: 'call', body: 'Ask who owns outbound.' },
      {
        contactId: 'west',
        channel: 'call',
        body: 'Ask who runs the shop.',
        callWindow: {
          startLocal: '2:00pm',
          endLocal: '4:00pm',
          timezone: 'America/Los_Angeles',
          businessType: 'Automotive',
          reason: 'After the morning rush'
        }
      }
    ], { enroll: false })
    assert.equal(saved.ok, true)
    const byId = new Map(db.contacts.map((row) => [row.id, row]))
    const earlyWindow = byId.get('early')?.attrs?.[ATTR_CALL_WINDOW] as CallWindow
    const sameWindow = byId.get('same')?.attrs?.[ATTR_CALL_WINDOW] as CallWindow
    assert.equal(earlyWindow.startLocal, '07:30')
    assert.equal(sameWindow.startLocal, '07:30')
    assert.equal(sameWindow.reason, 'Before the bays fill')
    assert.equal(byId.get('other')?.attrs?.[ATTR_CALL_WINDOW], undefined)
    assert.equal((byId.get('west')?.attrs?.[ATTR_CALL_WINDOW] as CallWindow).startLocal, '14:00')

    const tasks = buildWorkspaceTasks({
      contacts: db.contacts.map((row) => ({ ...row })),
      steps: [{ id: 'call', day: 0, channel: 'call', label: 'Call', order: 0 }],
      messages: [],
      calls: [],
      now: 2_000
    })
    const calls = tasks.filter((task) => task.channel === 'call').map((task) => task.contactName)
    assert.deepEqual(calls, ['Sam Same', 'Zoe Early', 'Wes West', 'Pat Soft'])
    assert.match(tasks.find((task) => task.contactId === 'early')?.callWindowLabel || '', /7:30–9:00am/)
    assert.equal(tasks.find((task) => task.contactId === 'early')?.callWindowReason, 'Before the bays fill')
    assert.equal(tasks.find((task) => task.contactId === 'other')?.callWindowLabel, undefined)
  })
})
