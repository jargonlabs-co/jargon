import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeLinkedInUrl } from '../src/shared/linkedinUrl'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec'
import { extractContactsFromPrompt } from '../src/server/deployContacts'

describe('normalizeLinkedInUrl', () => {
  it('keeps vanity profile URLs', () => {
    assert.equal(
      normalizeLinkedInUrl('https://www.linkedin.com/in/jane-doe'),
      'https://www.linkedin.com/in/jane-doe'
    )
  })

  it('accepts scheme-less member URN paths from Salesforce-style exports', () => {
    assert.equal(
      normalizeLinkedInUrl('linkedin.com/in/ACoAABcdEFgHijk'),
      'https://www.linkedin.com/in/ACoAABcdEFgHijk'
    )
  })

  it('accepts bare ACo member ids', () => {
    assert.equal(
      normalizeLinkedInUrl('ACoAABcdEFgHijk'),
      'https://www.linkedin.com/in/ACoAABcdEFgHijk'
    )
  })

  it('does not double-prefix scheme-less full paths (HubSpot-style)', () => {
    assert.equal(
      normalizeLinkedInUrl('linkedin.com/in/ada-lopez'),
      'https://www.linkedin.com/in/ada-lopez'
    )
  })

  it('returns undefined for empty or non-LinkedIn values', () => {
    assert.equal(normalizeLinkedInUrl(''), undefined)
    assert.equal(normalizeLinkedInUrl('https://example.com/in/x'), undefined)
  })
})

describe('extractContactsFromPrompt LinkedIn cells', () => {
  it('keeps scheme-less LinkedIn URLs from markdown tables', () => {
    const prompt = `| Name | Company | LinkedIn |
| --- | --- | --- |
| Ada Lopez | Acme | linkedin.com/in/ACoAABadaLopez |`
    const contacts = extractContactsFromPrompt(prompt)
    assert.ok(contacts)
    assert.equal(contacts![0].linkedinUrl, 'https://www.linkedin.com/in/ACoAABadaLopez')
  })
})

describe('compileWorkspaceSpec step spans', () => {
  it('expands N steps over D days instead of one-per-channel', () => {
    const spec = compileWorkspaceSpec(
      'Create a 7-step outbound sequence over 10 days with email, call, and LinkedIn'
    )
    assert.equal(spec.steps.length, 7)
    assert.equal(spec.steps[0].day, 0)
    assert.equal(spec.steps[6].day, 10)
    assert.deepEqual(
      new Set(spec.steps.map((s) => s.channel)),
      new Set(['email', 'call', 'linkedin'])
    )
  })

  it('honors an explicit day ladder in the prompt', () => {
    const spec = compileWorkspaceSpec(
      'Build a cadence: day 0 call, day 0 email, day 2 linkedin, day 5 email, day 10 call'
    )
    assert.deepEqual(
      spec.steps.map((s) => [s.day, s.channel]),
      [
        [0, 'call'],
        [0, 'email'],
        [2, 'linkedin'],
        [5, 'email'],
        [10, 'call']
      ]
    )
  })

  it('keeps the default compact ladder when no span is specified', () => {
    const spec = compileWorkspaceSpec('Build an outbound cadence for VP Sales')
    assert.equal(spec.steps.length, 3)
    assert.deepEqual(
      spec.steps.map((s) => s.day),
      [0, 0, 2]
    )
  })
})
