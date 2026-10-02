export type ChatDestination = 'claude' | 'chatgpt'

export const STARTER_PROMPT =
  'Before you start, ask me two things: the kind of company I sell to, and the role I want to reach. Then use Jargon to find matching people, build an outbound dialer or cadence, show me the queue, and let me work today’s tasks from this chat.'

export const HOME_PLACEHOLDER = 'Build an outbound dialer for GTM Engineers in the US'

export function firstNameOf(name?: string | null, email?: string | null): string {
  const fromName = name?.trim().split(/\s+/)[0]
  if (fromName) return fromName
  const local = email?.split('@')[0]?.trim()
  if (local) return local
  return 'there'
}

export function timeGreeting(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function claudeChatUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`
}

export function chatgptChatUrl(prompt: string): string {
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
}

export function getChatGptConnectorUrl(): string {
  return 'https://chatgpt.com/#settings/Connectors'
}

export function chatUrlFor(destination: ChatDestination, prompt: string): string {
  return destination === 'chatgpt' ? chatgptChatUrl(prompt) : claudeChatUrl(prompt)
}

export function launchChat(destination: ChatDestination, prompt: string): void {
  const text = prompt.trim()
  if (!text) return
  window.open(chatUrlFor(destination, text), '_blank', 'noopener,noreferrer')
}

export function detectChatHost(redirectUri?: string | null): ChatDestination {
  return /chatgpt|openai\.com/i.test(redirectUri ?? '') ? 'chatgpt' : 'claude'
}

export function hostLabel(destination: ChatDestination): string {
  return destination === 'chatgpt' ? 'chatgpt.com' : 'claude.ai'
}
