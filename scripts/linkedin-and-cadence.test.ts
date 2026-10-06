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
    assert.deepEqual(
      spec.steps.map((s) => s.channel),
      ['email', 'call', 'linkedin']
    )
  })

  it('puts phone into a generic sequence even when the prompt does not name call', () => {
    const spec = compileWorkspaceSpec('Create a 7-step sequence over 10 days for AEs')
    assert.ok(spec.steps.some((s) => s.channel === 'call'), 'expected a call step in the ladder')
    assert.ok(spec.channels.includes('call'))
  })

  it('builds a sequence from touchpoints over days', () => {
    const spec = compileWorkspaceSpec(
      'Build a sequence with 5 touchpoints over 14 days for the retail brand'
    )
    assert.equal(spec.primarySurface, 'sequence')
    assert.match(spec.segment, /retail brand/i)
    assert.deepEqual(
      spec.steps.map((step) => [step.day, step.channel]),
      [
        [0, 'email'],
        [4, 'call'],
        [7, 'linkedin'],
        [11, 'email'],
        [14, 'call']
      ]
    )
  })

  it('spaces a per-channel mix across weeks for another brand', () => {
    const spec = compileWorkspaceSpec(
      'Build a sequence with 4 emails and 1 call over 3 weeks for the wholesale brand'
    )
    assert.match(spec.segment, /wholesale brand/i)
    assert.deepEqual(
      spec.steps.map((step) => step.channel),
      ['email', 'email', 'call', 'email', 'email']
    )
    assert.equal(spec.steps[0].day, 0)
    assert.equal(spec.steps.at(-1)?.day, 21)
    assert.deepEqual(spec.channels, ['email', 'call'])
  })

  it('accepts touches, touch points, weeks, and reversed order', () => {
    const touches = compileWorkspaceSpec('six touches across two weeks for franchise owners')
    assert.equal(touches.steps.length, 6)
    assert.equal(touches.steps[0].day, 0)
    assert.equal(touches.steps.at(-1)?.day, 14)

    const points = compileWorkspaceSpec('Build a sequence with 5 touch points over 10 days')
    assert.equal(points.steps.length, 5)
    assert.equal(points.steps.at(-1)?.day, 10)

    const reversed = compileWorkspaceSpec('over 10 days with 4 touchpoints for field marketers')
    assert.equal(reversed.steps.length, 4)
    assert.equal(reversed.steps[0].day, 0)
    assert.equal(reversed.steps.at(-1)?.day, 10)
  })

  it('spreads a counted email, call, and LinkedIn mix', () => {
    const spec = compileWorkspaceSpec(
      'Build a sequence with 3 emails, 2 calls, and 1 LinkedIn over 14 days for the flagship brand'
    )
    assert.deepEqual(
      spec.steps.map((step) => [step.day, step.channel]),
      [
        [0, 'email'],
        [3, 'call'],
        [6, 'linkedin'],
        [8, 'email'],
        [11, 'call'],
        [14, 'email']
      ]
    )
  })

  it('caps a long ask at 8 steps and 30 days', () => {
    const spec = compileWorkspaceSpec('Build a sequence with 12 touchpoints over 40 days')
    assert.equal(spec.steps.length, 8)
    assert.equal(spec.steps.at(-1)?.day, 30)
  })
})
