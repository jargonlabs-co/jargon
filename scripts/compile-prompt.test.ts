import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergeDeploySpec,
  promptForCompile,
  skipLlmCompile
} from '../src/server/compilePrompt'
import { extractJsonObject } from '../src/server/providers/llm'
import { compileWorkspaceSpec } from '../src/shared/workspaceSpec'

describe('skipLlmCompile', () => {
  it('skips when channels and steps are already set', () => {
    assert.equal(
      skipLlmCompile({
        channels: ['email'],
        steps: [{ day: 0, channel: 'email', label: 'Intro' }]
      }),
      true
    )
  })

  it('runs when only channels are set', () => {
    assert.equal(skipLlmCompile({ channels: ['call'] }), false)
  })
})

describe('mergeDeploySpec', () => {
  it('prefers caller override fields', () => {
    const merged = mergeDeploySpec(
      { goal: 'Caller goal', channels: ['call'] },
      {
        goal: 'LLM goal',
        channels: ['email', 'linkedin'],
        segment: 'CFOs',
        primarySurface: 'sequence',
        steps: [{ day: 0, channel: 'email', label: 'Intro' }]
      }
    )
    assert.deepEqual(merged, {
      goal: 'Caller goal',
      segment: 'CFOs',
      primarySurface: 'sequence',
      channels: ['call'],
      steps: [{ day: 0, channel: 'email', label: 'Intro' }],
      kind: undefined
    })
  })
})

describe('promptForCompile', () => {
  it('strips fenced contact lists and emails', () => {
    const out = promptForCompile(
      'Build a dialer for VP Sales\n```\nAda, Acme, ada@acme.com\n```\nDay 0 call'
    )
    assert.match(out, /dialer for VP Sales/)
    assert.match(out, /contact list omitted/)
    assert.doesNotMatch(out, /ada@acme\.com/)
  })
})

describe('extractJsonObject', () => {
  it('unwraps fenced JSON', () => {
    assert.equal(extractJsonObject('```json\n{"goal":"x"}\n```'), '{"goal":"x"}')
  })
})

describe('compileWorkspaceSpec with LLM-shaped override', () => {
  it('honors custom day ladder from override', () => {
    const spec = compileWorkspaceSpec(
      'vague freeform ask about reaching fintech CFOs somehow',
      {
        goal: 'Book a CFO intro',
        segment: 'Series B fintech CFOs',
        channels: ['linkedin', 'email', 'call'],
        primarySurface: 'queue',
        kind: 'cadence',
        steps: [
          { day: 0, channel: 'linkedin', label: 'Connect', body: 'Hi {{first_name}}' },
          { day: 3, channel: 'email', label: 'Intro', subject: 'Quick note', body: 'Hi {{first_name}}' },
          { day: 7, channel: 'call', label: 'Dial' }
        ]
      }
    )
    assert.equal(spec.segment, 'Series B fintech CFOs')
    assert.deepEqual(
      spec.steps.map((s) => [s.day, s.channel]),
      [
        [0, 'linkedin'],
        [3, 'email'],
        [7, 'call']
      ]
    )
    assert.equal(spec.primarySurface, 'queue')
  })
})

describe('compileWorkspaceSpec freeform step span', () => {
  it('builds 7 steps over 10 days from the prompt alone', () => {
    const spec = compileWorkspaceSpec('create a 7-step sequence over 10 days for email call and linkedin')
    assert.equal(spec.steps.length, 7)
    assert.equal(spec.steps[0].day, 0)
    assert.equal(spec.steps.at(-1)?.day, 10)
  })
})
