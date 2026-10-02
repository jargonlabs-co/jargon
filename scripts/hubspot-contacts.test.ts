import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyHubSpotPull,
  hubspotEnrichmentWaitMessage,
  prioritizeHubSpotProperties,
  prospectFromHubSpotRow,
  RECENT_HUBSPOT_MS
} from '../src/server/providers/hubspot.ts'

describe('prospectFromHubSpotRow', () => {
  it('reads Lusha LinkedIn and work email from custom properties', () => {
    const prospect = prospectFromHubSpotRow({
      id: 'hs_1',
      properties: {
        firstname: 'Ada',
        lastname: 'Lopez',
        company: 'Acme',
        lusha_linkedin: 'https://www.linkedin.com/in/ada-lopez',
        work_email: 'ada@acme.com',
        lusha_phone: '+1 415 555 0142'
      }
    })
    assert.equal(prospect.email, 'ada@acme.com')
    assert.equal(prospect.phone, '+1 415 555 0142')
    assert.equal(prospect.linkedinUrl, 'https://www.linkedin.com/in/ada-lopez')
    assert.ok(prospect.context?.some((line) => /Ada Lopez|Acme|linkedin/i.test(line)))
    assert.equal(prospect.context?.some((line) => /Series [ABC]|Hiring SDRs/i.test(line)), false)
  })

  it('does not treat a numeric HubSpot LinkedIn id as a profile URL', () => {
    const prospect = prospectFromHubSpotRow({
      id: 'hs_2',
      properties: {
        firstname: 'Bo',
        lastname: 'Chen',
        hs_linkedinid: '12345678'
      }
    })
    assert.equal(prospect.linkedinUrl, undefined)
  })

  it('prefers hs_linkedin_url over other fields', () => {
    const prospect = prospectFromHubSpotRow({
      id: 'hs_3',
      properties: {
        firstname: 'Cora',
        lastname: 'Shah',
        hs_linkedin_url: 'linkedin.com/in/cora-shah',
        lusha_linkedin: 'https://www.linkedin.com/in/other'
      }
    })
    assert.equal(prospect.linkedinUrl, 'https://www.linkedin.com/in/cora-shah')
  })
})

describe('classifyHubSpotPull', () => {
  it('keeps recently added people without contact info as pending enrichment', () => {
    const now = Date.now()
    const pull = classifyHubSpotPull(
      [
        {
          externalId: '1',
          name: 'Ada Lopez',
          company: 'Acme',
          title: 'VP Sales',
          email: '',
          phone: '',
          city: '',
          accountName: 'Acme',
          lastModifiedAt: now - 60_000
        },
        {
          externalId: '2',
          name: 'Bo Chen',
          company: 'Orbit',
          title: 'CRO',
          email: 'bo@orbit.com',
          phone: '',
          city: '',
          accountName: 'Orbit',
          lastModifiedAt: now - 60_000
        }
      ],
      now
    )
    assert.equal(pull.reachable.length, 1)
    assert.equal(pull.pending.length, 1)
    assert.equal(pull.recentlyPending, 1)
    assert.match(hubspotEnrichmentWaitMessage(1), /list_crm_contacts/)
  })

  it('does not treat stale incomplete rows as in-flight enrichment', () => {
    const now = Date.now()
    const pull = classifyHubSpotPull(
      [
        {
          externalId: '1',
          name: 'Old Lead',
          company: 'Acme',
          title: '',
          email: '',
          phone: '',
          city: '',
          accountName: 'Acme',
          lastModifiedAt: now - RECENT_HUBSPOT_MS - 1
        }
      ],
      now
    )
    assert.equal(pull.recentlyPending, 0)
    assert.equal(pull.pending.length, 1)
  })
})

describe('prioritizeHubSpotProperties', () => {
  it('keeps Lusha and LinkedIn properties inside the fetch cap', () => {
    const names = [
      ...Array.from({ length: 90 }, (_, i) => `custom_${i}`),
      'lusha_linkedin',
      'lusha_email',
      'hs_linkedin_url'
    ]
    const picked = prioritizeHubSpotProperties(names)
    assert.ok(picked.includes('lusha_linkedin'))
    assert.ok(picked.includes('lusha_email'))
    assert.ok(picked.includes('email'))
    assert.ok(picked.length <= 80)
  })

  it('keeps Lusha intent and signal properties inside the fetch cap', () => {
    const names = [
      ...Array.from({ length: 90 }, (_, i) => `custom_${i}`),
      'intent_topics',
      'intent_topics_average_score',
      'lusha_latest_signal',
      'seniority'
    ]
    const picked = prioritizeHubSpotProperties(names)
    assert.ok(picked.includes('intent_topics'))
    assert.ok(picked.includes('lusha_latest_signal'))
    assert.ok(picked.includes('seniority'))
  })
})

describe('HubSpot context is Lusha facts, not invented enrichment', () => {
  it('passes through industry and size and does not invent a funding round', () => {
    const prospect = prospectFromHubSpotRow({
      id: 'hs_4',
      properties: {
        firstname: 'Dana',
        lastname: 'Kim',
        jobtitle: 'VP Sales',
        company: 'Northwind',
        industry: 'Logistics',
        numberofemployees: '200',
        email: 'dana@northwind.com'
      }
    })
    assert.ok(prospect.context?.includes('VP Sales at Northwind'))
    assert.ok(prospect.context?.includes('Logistics'))
    assert.ok(prospect.context?.includes('200 employees'))
    assert.equal(prospect.context?.some((line) => /Series [ABC]|Hiring SDRs|New in seat/i.test(line)), false)
  })

  it('maps Lusha intent and seniority into ranking attrs and context', () => {
    const prospect = prospectFromHubSpotRow({
      id: 'hs_5',
      properties: {
        firstname: 'Ada',
        lastname: 'Lopez',
        jobtitle: 'VP Sales',
        company: 'Acme',
        email: 'ada@acme.com',
        intent_topics: 'outbound dialers; sales engagement',
        intent_topics_average_score: '81',
        lusha_latest_signal: 'Spike in outbound tooling research',
        seniority: 'VP',
        lusha_funding_stage: 'Series B'
      }
    })
    const gtm = prospect.attrs?.gtm_initiative
    assert.ok(Array.isArray(gtm) && gtm.some((line) => /Intent: outbound dialers/i.test(String(line))))
    assert.equal(prospect.attrs?.intent_score, 81)
    assert.equal(prospect.attrs?.seniority, 'VP')
    assert.equal(prospect.attrs?.funding_stage, 'Series B')
    assert.ok(prospect.context?.some((line) => /Intent: outbound dialers/i.test(line)))
    assert.ok(prospect.context?.some((line) => /Spike in outbound tooling/i.test(line)))
    assert.equal(prospect.context?.some((line) => /Series A closed|Hiring SDRs this quarter/i.test(line)), false)
  })

  it('merges company-level Lusha intent onto the contact', () => {
    const prospect = prospectFromHubSpotRow(
      {
        id: 'hs_6',
        properties: {
          firstname: 'Bo',
          lastname: 'Chen',
          jobtitle: 'CRO',
          company: 'Orbit',
          email: 'bo@orbit.com',
          associatedcompanyid: 'comp_1'
        }
      },
      {
        name: 'Orbit',
        intent_topics: 'revenue ops',
        intent_topics_average_score: '64',
        lusha_funding_stage: 'Series A'
      }
    )
    assert.ok(Array.isArray(prospect.attrs?.gtm_initiative) && prospect.attrs.gtm_initiative.includes('Intent: revenue ops'))
    assert.equal(prospect.attrs?.intent_score, 64)
    assert.equal(prospect.attrs?.funding_stage, 'Series A')
    assert.ok(prospect.context?.some((line) => /Intent: revenue ops/i.test(line)))
  })
})
