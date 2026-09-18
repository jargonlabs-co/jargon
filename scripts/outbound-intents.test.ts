import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchOutboundIntent } from '../src/shared/outboundIntents'
import { compileWorkspaceSpec, workspaceKindLabel } from '../src/shared/workspaceSpec'

describe('matchOutboundIntent channel tools', () => {
  it('compiles LinkedIn-only requests to a LinkedIn queue', () => {
    const spec = compileWorkspaceSpec('Build a LinkedIn outreach tool for SDRs in fintech')
    assert.deepEqual(spec.channels, ['linkedin'])
    assert.equal(spec.primarySurface, 'linkedin')
    assert.equal(workspaceKindLabel(spec), 'LinkedIn queue')
  })

  it('compiles dialer requests to phone-only without auto-adding email', () => {
    const spec = compileWorkspaceSpec('Build an outbound dialer for GTM Engineers in the US')
    assert.deepEqual(spec.channels, ['call'])
    assert.equal(spec.primarySurface, 'dial')
    assert.equal(spec.kind, 'dialer')
    assert.equal(workspaceKindLabel(spec), 'Outbound dialer')
  })

  it('adds email to a dialer only when the prompt asks for email follow-ups', () => {
    const match = matchOutboundIntent('Power dialer with email follow-ups for AEs')
    assert.deepEqual(match.channels, ['call', 'email'])
    assert.equal(match.primarySurface, 'dial')
  })

  it('compiles email sequencer requests to email-only', () => {
    const spec = compileWorkspaceSpec('Create an email sequence for Series B founders')
    assert.deepEqual(spec.channels, ['email'])
    assert.equal(spec.primarySurface, 'sequence')
    assert.equal(spec.kind, 'sequencer')
    assert.equal(workspaceKindLabel(spec), 'Email sequencer')
  })

  it('keeps multi-channel cadences multi-channel', () => {
    const spec = compileWorkspaceSpec('Build an outbound cadence for VP Sales')
    assert.deepEqual(spec.channels, ['email', 'call', 'linkedin'])
    assert.equal(workspaceKindLabel(spec), 'Multi-channel cadence')
  })

  it('honors exclusive single-channel phrasing', () => {
    assert.deepEqual(matchOutboundIntent('Only LinkedIn for my ABM list').channels, ['linkedin'])
    assert.deepEqual(matchOutboundIntent('Just phone outreach for churn risks').channels, ['call'])
    assert.deepEqual(matchOutboundIntent('Exclusively email drip for webinar attendees').channels, [
      'email'
    ])
  })

  it('orders named multi-channel prompts by mention', () => {
    const match = matchOutboundIntent('LinkedIn then email then call for CSMs')
    assert.deepEqual(match.channels, ['linkedin', 'email', 'call'])
  })

  it('extracts segment for channel tools', () => {
    const spec = compileWorkspaceSpec('Dialer for GTM Engineers in the US')
    assert.match(spec.segment, /GTM Engineers/i)
  })
})
