import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import {
  PLIVO_SDP_FIX_JS,
  applyEmailWorkspaceHtml,
  plivoBrowserCallTarget,
  stripPlivoOfferSdp
} from '../src/shared/plivoSdp.ts'

function loadFix(): { stripPlivoOfferSdp: (sdp: string) => string; plivoBrowserCallTarget: (to: string) => string } {
  const context: Record<string, unknown> = { window: {} }
  vm.createContext(context)
  vm.runInContext(`${PLIVO_SDP_FIX_JS}\nthis.stripPlivoOfferSdp = stripPlivoOfferSdp;\nthis.plivoBrowserCallTarget = plivoBrowserCallTarget;`, context)
  return context as { stripPlivoOfferSdp: (sdp: string) => string; plivoBrowserCallTarget: (to: string) => string }
}

const chromeOffer = [
  'v=0',
  'o=- 1 2 IN IP6 ::',
  's=-',
  'a=extmap-allow-mixed',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 0',
  'c=IN IP6 2607:f8b0:4004:80a::200e',
  'a=rtcp:9 IN IP6 ::',
  'a=rtpmap:111 opus/48000/2',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=candidate:1 1 udp 1 192.168.1.5 50000 typ host',
  'a=candidate:2 1 udp 2 2607:f8b0:4004:80a::200e 50001 typ srflx',
  'a=candidate:3 1 udp 3 203.0.113.5 50002 typ srflx'
].join('\r\n')

function assertSanitized(out: string) {
  assert.equal(out.includes('extmap-allow-mixed'), false)
  assert.equal(out.includes('2607:'), false)
  assert.equal(out.includes('IN IP6'), false)
  assert.equal(out.includes('red/48000'), false)
  assert.equal(out.includes('a=fmtp:63'), false)
  assert.equal(out.includes('192.168.1.5'), true)
  assert.equal(out.includes('203.0.113.5'), true)
  assert.match(out, /m=audio 9 UDP\/TLS\/RTP\/SAVPF 111 0/)
  assert.match(out, /c=IN IP4 0\.0\.0\.0/)
  assert.match(out, /IN IP4 127\.0\.0\.1/)
}

describe('plivo browser sdp', () => {
  const fix = loadFix()

  it('drops IPv6 candidates, IP6 lines, extmap-allow-mixed, and RED', () => {
    assertSanitized(fix.stripPlivoOfferSdp(chromeOffer))
    assertSanitized(stripPlivoOfferSdp(chromeOffer))
  })

  it('dials the digits, not a sip:+ user', () => {
    assert.equal(fix.plivoBrowserCallTarget('+15125550100'), '15125550100')
    assert.equal(fix.plivoBrowserCallTarget('sip:agent@phone.plivo.com'), 'sip:agent@phone.plivo.com')
    assert.equal(plivoBrowserCallTarget('+15125550100'), '15125550100')
  })

  it('injects the fix into the dialer html', () => {
    const html = applyEmailWorkspaceHtml('/*__EXT_APPS_BUNDLE__*/\n/*__PLIVO_SDP_FIX__*/', 'EXT')
    assert.equal(html.includes('EXT'), true)
    assert.equal(html.includes('function stripPlivoOfferSdp'), true)
    assert.equal(html.includes('currentLocalDescription'), true)
    assert.equal(html.includes('createAnswer'), true)
    assert.equal(html.includes('/*__PLIVO_SDP_FIX__*/'), false)
  })
})
