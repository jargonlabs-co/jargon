import type { Channel, WorkspaceSpec } from '../server/types'
import { isPhoneHeavySequence } from './callWindow'

const PLACEHOLDER_AUDIENCES = new Set([
  'hubspot contacts',
  'target accounts',
  'general',
  'provided list',
  'contacts',
  'my contacts',
  'these contacts',
  'this list',
  'the list'
])

const GENERIC_GOALS = new Set([
  'book a meeting',
  'dial accounts',
  'run a cadence',
  'work the outbound sequence',
  'start a linkedin conversation',
  'book a conversation with the practice'
])

/** Company-name dumps from a pasted list, not an audience. */
export function isCompanyListLabel(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (/\+\d+\s*$/.test(text)) return true
  if (/\band\b/i.test(text)) return false
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length >= 2 && parts.every((part) => part.split(/\s+/).length <= 4)
}

/** Short title that describes the motion and who it is for. */
export function sequenceTitle(prompt: string, spec: WorkspaceSpec): string {
  const motion = motionPhrase(prompt, spec)
  const audience = audiencePhrase(spec.segment)
  const goal = goalPhrase(spec.goal)
  const titled = audience ? `${motion} for ${audience}` : motion
  return goal ? `${titled} to ${goal}` : titled
}

function motionPhrase(prompt: string, spec: WorkspaceSpec): string {
  const steps = spec.steps ?? []
  const channels = spec.channels?.length ? spec.channels : channelsFrom(steps)
  const callCount = steps.filter((step) => step.channel === 'call').length
  const emailCount = steps.filter((step) => step.channel === 'email').length
  const linkedinCount = steps.filter((step) => step.channel === 'linkedin').length
  const maxDay = steps.reduce((max, step) => Math.max(max, step.day), 0)

  if (
    linkedinCount === 0 &&
    callCount >= 1 &&
    emailCount >= 1 &&
    (isPhoneHeavySequence(prompt) || (steps[0]?.channel === 'call' && callCount >= emailCount))
  ) {
    return callCount > 1 ? 'Calls with an email follow-up' : 'A call with an email follow-up'
  }

  if (channels.length === 1) {
    if (channels[0] === 'call') return 'Outbound calls'
    if (channels[0] === 'linkedin') return 'LinkedIn outreach'
    const count = Math.max(emailCount, steps.length, 1)
    if (count > 2 && maxDay >= 7) return `${count}-email sequence over ${maxDay} days`
    return count > 2 ? `${count}-email sequence` : 'Email sequence'
  }

  const phrase = joinChannels(channels)
  if (steps.length >= 4 && maxDay >= 7) {
    return `${steps.length}-touch ${phrase} cadence over ${maxDay} days`
  }
  return `${capitalize(phrase)} cadence`
}

function audiencePhrase(segment: string | undefined): string | undefined {
  const raw = segment?.trim() ?? ''
  if (!raw || PLACEHOLDER_AUDIENCES.has(raw.toLowerCase()) || isCompanyListLabel(raw)) return undefined
  const words = withArticles(raw.split(/\s+/).filter(Boolean).map(softenWord))
  if (!words.length) return undefined
  words[0] = capitalize(words[0])
  return words.join(' ')
}

function goalPhrase(goal: string | undefined): string | undefined {
  const cleaned = goal?.trim().replace(/[.!]+$/, '') ?? ''
  if (!cleaned || GENERIC_GOALS.has(cleaned.toLowerCase())) return undefined
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
}

function channelsFrom(steps: Array<{ channel: Channel }>): Channel[] {
  const out: Channel[] = []
  for (const step of steps) {
    if (!out.includes(step.channel)) out.push(step.channel)
  }
  return out.length ? out : ['email']
}

function joinChannels(channels: Channel[]): string {
  const words = channels.map(channelWord)
  if (words.length <= 1) return words[0] ?? 'email'
  if (words.length === 2) return `${words[0]} and ${words[1]}`
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`
}

function channelWord(channel: Channel): string {
  if (channel === 'linkedin') return 'LinkedIn'
  if (channel === 'call') return 'call'
  return 'email'
}

function withArticles(words: string[]): string[] {
  const out: string[] = []
  for (const word of words) {
    const prev = out[out.length - 1]
    if (prev?.toLowerCase() === 'in' && /^(US|UK|EU)$/.test(word)) out.push('the')
    out.push(word)
  }
  return out
}

function softenWord(word: string): string {
  if (/^[A-Z0-9]{2,}$/.test(word)) return word
  if (/^[A-Z]$/.test(word)) return word
  if (/^(vp|ae|sdr|bdr|cro|cmo|ceo|cto|cfo|coo|crm|abm|gtm|us|uk|eu|apac|emea)$/i.test(word)) {
    return word.toUpperCase()
  }
  return word.toLowerCase()
}

function capitalize(value: string): string {
  if (!value) return value
  if (/^[A-Z0-9]{2,}/.test(value)) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
