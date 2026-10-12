import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bookPublicMeeting, googleCalendarEvent, outlookCalendarEvent, parseMeetingWindow } from '../src/server/calendar.ts'
import { loadConfig } from '../src/server/config.ts'
import { encryptJson } from '../src/server/crypto.ts'
import { mergeTemplate, promoteToRep, saveWorkspaceBrief } from '../src/server/publicApi.ts'
import { nextQueueContact } from '../src/server/queries.ts'
import { hubspotSearchFilters } from '../src/server/providers/hubspot.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Contact, Database, Project } from '../src/server/types.ts'
import { agentIntervalMs, runDueUnattendedAgents } from '../src/server/unattended.ts'
import { buildWorkspaceTasks } from '../src/server/workspaceTasks.ts'

const base = loadConfig()

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

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'ct_1',
    orgId: 'org_a',
    projectId: 'p1',
    name: 'Ada Lopez',
    company: 'Acme',
    title: 'VP Sales',
    email: 'ada@acme.test',
    phone: '+15551230000',
    city: '',
    status: 'queued',
    stepIndex: 0,
    notes: '',
    source: 'hubspot',
    externalId: '901',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    orgId: 'org_a',
    name: 'DQ lane',
    prompt: 'Work disqualified leads',
    kind: 'cadence',
    answers: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  } as Project
}

describe('CRM segment filters', () => {
  it('keeps the open search when no segment is saved', () => {
    assert.deepEqual(hubspotSearchFilters(), [
      { propertyName: 'lastmodifieddate', operator: 'GTE', value: '0' }
    ])
  })

  it('filters HubSpot by lead status and list membership', () => {
    const filters = hubspotSearchFilters({ leadStatus: ' Disqualified ' }, ['11', '12'])
    assert.deepEqual(filters, [
      { propertyName: 'lastmodifieddate', operator: 'GTE', value: '0' },
      { propertyName: 'hs_lead_status', operator: 'EQ', value: 'Disqualified' },
      { propertyName: 'hs_object_id', operator: 'IN', values: ['11', '12'] }
    ])
  })
})

describe('agent lane and rep queue', () => {
  it('hides agent-lane contacts until they are promoted', () => {
    const agent = contact({ id: 'ct_agent', lane: 'agent', updatedAt: 1 })
    const rep = contact({ id: 'ct_rep', updatedAt: 2 })
    const db = migrateDatabase({ contacts: [agent, rep] })
    const next = nextQueueContact(db, 'p1')
    assert.equal(next?.contact.id, 'ct_rep')
    assert.equal(next?.remaining, 1)

    const store = memoryStore(db)
    const promoted = promoteToRep(store, 'org_a', ['ct_agent'])
    assert.equal(promoted.ok, true)
    const after = nextQueueContact(store.db, 'p1')
    assert.equal(after?.remaining, 2)
    assert.equal(store.db.contacts.find((c) => c.id === 'ct_agent')?.lane, 'rep')
  })

  it('leaves agent-lane steps out of the rep task list', () => {
    const tasks = buildWorkspaceTasks({
      contacts: [
        {
          ...contact({ id: 'ct_agent', lane: 'agent', status: 'active', attrs: { _enrolledAt: 1 } }),
          projectId: 'p1'
        },
        {
          ...contact({ id: 'ct_rep', status: 'active', attrs: { _enrolledAt: 1 } }),
          projectId: 'p1'
        }
      ],
      steps: [{ id: 's1', day: 0, channel: 'call', label: 'Call', order: 0, mode: 'manual' }],
      messages: [],
      calls: [],
      now: 10
    })
    assert.deepEqual(tasks.map((task) => task.contactId), ['ct_rep'])
  })

  it('fills agent copy from the contact and stores the unattended grant', () => {
    assert.equal(mergeTemplate('Hi {{first_name}} at {{company}}', contact()), 'Hi Ada at Acme')
    assert.equal(agentIntervalMs('every day at 9am'), 86_400_000)
    assert.equal(agentIntervalMs('every Sunday at 6pm'), 7 * 86_400_000)

    const store = memoryStore(migrateDatabase({ projects: [project()] }))
    const brief = saveWorkspaceBrief(store, 'org_a', 'p1', {
      scheduleChoice: 'accepted',
      unattended: 'accepted',
      cadence: 'every Sunday at 6pm',
      segment: { leadStatus: 'Disqualified' },
      nextAgentRunAt: 50
    })
    assert.equal(brief?.unattended, 'accepted')
    assert.equal(brief?.segment?.leadStatus, 'Disqualified')
    assert.equal(brief?.nextAgentRunAt, 50)
  })
})

describe('calendar invite', () => {
  it('builds a Google event that emails the contact', () => {
    const event = googleCalendarEvent({
      title: 'Intro',
      start: '2026-10-14T18:00:00.000Z',
      end: '2026-10-14T18:30:00.000Z',
      attendees: ['ada@acme.test'],
      note: 'Talk track'
    })
    assert.equal((event.attendees as Array<{ email: string }>)[0].email, 'ada@acme.test')
    assert.equal((event.start as { dateTime: string }).dateTime, '2026-10-14T18:00:00.000Z')
    const outlook = outlookCalendarEvent({
      title: 'Intro',
      start: '2026-10-14T18:00:00.000Z',
      end: '2026-10-14T18:30:00.000Z',
      attendees: ['ada@acme.test']
    })
    assert.equal((outlook.start as { timeZone: string }).timeZone, 'UTC')
    assert.equal(parseMeetingWindow('not-a-date'), null)
  })

  it('sends the invite, stops the sequence, and queues a HubSpot meeting', async () => {
    const store = memoryStore(
      migrateDatabase({
        contacts: [contact({ status: 'active' })],
        messages: [
          {
            id: 'msg_1',
            orgId: 'org_a',
            projectId: 'p1',
            contactId: 'ct_1',
            subject: 'Follow up',
            body: 'Later',
            status: 'queued',
            channel: 'email',
            stepId: 's1',
            createdAt: 1,
            updatedAt: 1
          }
        ],
        connections: [
          {
            id: 'conn_gmail',
            orgId: 'org_a',
            provider: 'gmail',
            status: 'connected',
            accountLabel: 'rep@acme.com',
            secretsCipher: encryptJson({ accessToken: 'fresh', expiresAt: Date.now() + 3600_000 }),
            meta: { email: 'rep@acme.com' },
            createdAt: 0,
            updatedAt: 2
          },
          {
            id: 'conn_hs',
            orgId: 'org_a',
            provider: 'hubspot',
            status: 'connected',
            secretsCipher: encryptJson({ accessToken: 'hs', expiresAt: Date.now() + 3600_000 }),
            meta: {},
            createdAt: 0,
            updatedAt: 1
          }
        ]
      })
    )
    const calls: string[] = []
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url))
      const body = JSON.parse(String(init?.body))
      assert.equal(body.attendees[0].email, 'ada@acme.test')
      return new Response(JSON.stringify({ id: 'evt_1', htmlLink: 'https://calendar.google.com/event?eid=1' }), {
        status: 200
      })
    }) as typeof fetch
    const result = await bookPublicMeeting(
      store,
      { ...base, google: { ...base.google, clientId: 'g', clientSecret: 's', refreshToken: '' } },
      store.db.contacts[0],
      { start: '2026-10-14T18:00:00Z', durationMinutes: 30, title: 'Intro' },
      fetcher
    )
    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.match(calls[0], /calendar\/v3/)
    const row = store.db.contacts[0]
    assert.equal(row.status, 'meeting_booked')
    assert.equal(row.meeting?.eventId, 'evt_1')
    assert.equal(store.db.messages[0].status, 'cancelled')
    assert.equal(store.db.hubspotOutbox.some((item) => item.kind === 'meeting'), true)
    const meeting = store.db.hubspotOutbox.find((item) => item.kind === 'meeting')
    assert.equal(meeting?.properties.hs_meeting_title, 'Intro')
    assert.match(meeting?.properties.hs_meeting_external_url ?? '', /calendar\.google\.com/)
  })
})

describe('unattended agent run', () => {
  it('promotes a replied agent contact and schedules the next run', async () => {
    const store = memoryStore(
      migrateDatabase({
        projects: [
          project({
            brief: {
              goal: 'Book meetings',
              warmthRule: 'Enroll everyone.',
              summary: 'DQ',
              unattended: 'accepted',
              cadence: 'every Sunday at 6pm',
              segment: { leadStatus: 'Disqualified' },
              nextAgentRunAt: 1
            }
          })
        ],
        contacts: [contact({ lane: 'agent', status: 'replied' })]
      })
    )
    const ran = await runDueUnattendedAgents(store, base, 10_000)
    assert.equal(ran, 1)
    assert.equal(store.db.contacts[0].lane, 'rep')
    assert.equal(store.db.contacts[0].status, 'queued')
    assert.ok((store.db.projects[0].brief?.nextAgentRunAt ?? 0) > 10_000)
  })
})
