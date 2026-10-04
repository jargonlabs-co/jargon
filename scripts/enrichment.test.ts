import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/server/config.ts'
import { extractRecordsFromText } from '../src/server/deployContacts.ts'
import { upsertEnrichment } from '../src/server/enrichment.ts'
import { enrollPublicSequence } from '../src/server/publicApi.ts'
import { migrateDatabase, type DataStore } from '../src/server/store.ts'
import type { Contact, Database, Project } from '../src/server/types.ts'
import { missingRequestedFields, parseRequestedFields } from '../src/shared/requestedFields.ts'

const config = loadConfig()

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

function person(id: string, extra: Partial<Contact> = {}): Contact {
  return {
    id,
    orgId: 'org_a',
    projectId: 'p1',
    name: `Person ${id}`,
    company: 'Acme',
    title: 'VP Sales',
    email: `${id}@acme.test`,
    phone: '+15551230000',
    city: '',
    status: 'queued',
    stepIndex: 0,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...extra
  }
}

function fixture(requestedFields?: string[]) {
  const project = {
    id: 'p1',
    orgId: 'org_a',
    name: 'Dialer',
    kind: 'dialer',
    prompt: '',
    segment: '',
    team: '',
    description: '',
    answers: {},
    requestedFields,
    createdAt: 0,
    updatedAt: 0
  } as unknown as Project
  return memoryStore(
    migrateDatabase({
      projects: [project],
      contacts: [
        person('a', { attrs: { intent_topics: ['CRM'] } }),
        person('b', { linkedinUrl: 'https://www.linkedin.com/in/bee', externalId: 'hs_22' }),
        person('c', { orgId: 'org_b' })
      ],
      steps: [{ id: 's1', orgId: 'org_a', sequenceId: 'seq', projectId: 'p1', day: 0, channel: 'call', label: 'Call', order: 0 }]
    })
  )
}

describe('requested fields', () => {
  it('reads placeholders and personalization clauses, not audience filters', () => {
    assert.deepEqual(
      parseRequestedFields('Build a dialer for VPs. Personalize with their funding stage and tech stack. Open with {{attrs.g2_category}} and {{first_name}}.'),
      ['g2_category', 'funding_stage', 'technologies']
    )
    assert.deepEqual(parseRequestedFields('Build an outbound dialer for companies that raised a Series B in the US'), [])
    assert.deepEqual(parseRequestedFields('Build an outbound dialer for GTM Engineers in the US'), [])
    assert.deepEqual(parseRequestedFields('Email sequence referencing their intent topics'), ['intent_topics'])
  })

  it('recognizes vendor aliases as the canonical field', () => {
    assert.deepEqual(missingRequestedFields({ name: 'x', attrs: { bombora_topics: 'CRM' } }, ['intent_topics']), [])
    assert.deepEqual(missingRequestedFields({ name: 'x' }, ['intent_topics', 'companyIndustry']), ['intent_topics', 'companyIndustry'])
  })

  it('holds people missing a requested field out of enrollment', async () => {
    const store = fixture(['intent_topics'])
    const result = await enrollPublicSequence(store, config, 'org_a', 'p1')
    assert.ok(result.ok)
    assert.equal(result.contacts, 1)
    assert.ok(result.skipped.some((s) => s.contactId === 'b' && /intent_topics/.test(s.reason)))
    assert.equal(store.db.contacts.find((c) => c.id === 'b')!.status, 'queued')
    assert.equal(store.db.contacts.find((c) => c.id === 'b')!.attrs?._enrolledAt, undefined)
  })
})

describe('upsert_enrichment', () => {
  it('parses key-only tables without a name column', () => {
    const rows = extractRecordsFromText('| Email | Intent topics |\n|---|---|\n| b@acme.test | Data warehouse |')
    assert.deepEqual(rows, [{ email: 'b@acme.test', intent_topics: 'Data warehouse' }])
  })

  it('matches by email, LinkedIn, or CRM id within the org and merges without clobbering identity', async () => {
    const store = fixture()
    const result = await upsertEnrichment(store, config, 'org_a', [
      { email: 'A@ACME.TEST', funding_stage: 'Series B', title: 'CEO', context: 'Raised $20M in May' },
      { linkedin: 'linkedin.com/in/bee/', technologies: ['Snowflake', 'dbt'] },
      { crm_id: 'hs_22', industry: 'Software' },
      { email: 'c@acme.test', funding_stage: 'Seed' },
      { email: 'nobody@else.test', funding_stage: 'Seed' }
    ])
    assert.equal(result.matched, 3)
    assert.deepEqual(result.unmatched.map((u) => u.key), ['c@acme.test', 'nobody@else.test'], 'other orgs are not matched')
    const a = store.db.contacts.find((c) => c.id === 'a')!
    assert.equal(a.title, 'VP Sales', 'existing identity is kept')
    assert.equal(a.attrs?.funding_stage, 'Series B')
    assert.deepEqual(a.attrs?.intent_topics, ['CRM'], 'existing attrs are kept')
    assert.deepEqual(a.context, ['Raised $20M in May'])
    assert.ok(a.enrichedAt)
    const b = store.db.contacts.find((c) => c.id === 'b')!
    assert.deepEqual(b.attrs?.technologies, ['Snowflake', 'dbt'])
    assert.equal(b.companyIndustry, 'Software')
    assert.equal(store.db.contacts.find((c) => c.id === 'c')!.attrs?.funding_stage, undefined)
  })

  it('enrolls held people once enrichment fills the requested fields', async () => {
    const store = fixture(['intent_topics'])
    await enrollPublicSequence(store, config, 'org_a', 'p1')
    const result = await upsertEnrichment(store, config, 'org_a', [{ email: 'b@acme.test', intent_topics: 'ETL' }], {
      projectId: 'p1'
    })
    assert.equal(result.enrolled, 1)
    const b = store.db.contacts.find((c) => c.id === 'b')!
    assert.equal(typeof b.attrs?._enrolledAt, 'number')
  })
})
