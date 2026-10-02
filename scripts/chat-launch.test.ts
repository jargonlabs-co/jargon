import assert from 'node:assert/strict'
import {
  chatgptChatUrl,
  claudeChatUrl,
  detectChatHost,
  firstNameOf,
  hostLabel,
  timeGreeting
} from '../landing/src/lib/chatLaunch.ts'

assert.equal(firstNameOf('Tara Debek', 'tara@jargonlabs.co'), 'Tara')
assert.equal(firstNameOf('', 'tara@jargonlabs.co'), 'tara')
assert.equal(firstNameOf(null, null), 'there')

assert.equal(timeGreeting(new Date('2026-10-02T08:00:00')), 'Good morning')
assert.equal(timeGreeting(new Date('2026-10-02T14:00:00')), 'Good afternoon')
assert.equal(timeGreeting(new Date('2026-10-02T19:00:00')), 'Good evening')

assert.equal(
  claudeChatUrl('Build an outbound dialer'),
  'https://claude.ai/new?q=Build%20an%20outbound%20dialer'
)
assert.equal(
  chatgptChatUrl('Build an outbound dialer'),
  'https://chatgpt.com/?q=Build%20an%20outbound%20dialer'
)

assert.equal(detectChatHost('https://claude.ai/api/mcp/auth/callback'), 'claude')
assert.equal(detectChatHost('https://chatgpt.com/connector/oauth'), 'chatgpt')
assert.equal(hostLabel('chatgpt'), 'chatgpt.com')

console.log('chat-launch.test.ts: ok')
