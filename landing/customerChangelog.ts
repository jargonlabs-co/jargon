/** Infra vendors and the plumbing around them. Never show these on the changelog. */
const FORBIDDEN =
  /\b(plivo|twilio|railway|supabase|stripe|vercel|heyreach|postgres|postgresql|sdp|sip)\b/i

const RULES: Array<[RegExp, string]> = [
  [
    /typed number|computer keyboard/i,
    'Dial any number you type, straight from the keyboard.'
  ],
  [
    /keypad number/i,
    'Call the number on the keypad, even when the contact’s number is different or missing.'
  ],
  [
    /flows and to-dos/i,
    'Work enrolled sequences as Flows and To-dos, one task at a time.'
  ],
  [
    /plivo|twilio|sdp|sip|voice webhook|browser token|call offer/i,
    'Place and connect calls from chat.'
  ],
  [/shared pools|plan limits/i, 'Keep calls in chat, within your plan.'],
  [/linkedin, phone, and email/i, 'Deploy a sequence across LinkedIn, phone, and email.'],
  [/personalizes before the ui opens/i, 'Claude writes the sequence before the workspace opens.'],
  [
    /talk tracks|sequence contacts on deploy/i,
    'Each contact joins the sequence with a researched talk track.'
  ],
  [
    /one-off or inbox/i,
    'One-off and inbox work stays out of the sequence until you enroll someone.'
  ],
  [/placeholders|researched sequence copy/i, 'Keep the sequence copy Claude wrote.'],
  [/allow card/i, 'Confirm a change in Claude, then it runs.'],
  [/claude connector can do|mcp writes/i, 'See what Claude can do, and confirm changes in chat.'],
  [/sign-in flow|connector screen/i, 'Sign in to Claude from one screen.'],
  [
    /heyreach|linkedin through/i,
    'Send LinkedIn from the sequence, and hold steps as drafts until you are ready.'
  ],
  [/dialer from the call step/i, 'Open the dialer from a call step in the sequence.'],
  [/day's sequence tasks|day’s sequence tasks/i, 'Work the day’s sequence tasks in Claude.'],
  [/email sequence|gmail/i, 'Run the email sequence and send from chat.'],
  [/hubspot/i, 'Pull people from your CRM into the sequence.']
]

function safeFallback(raw: string): string {
  const s = raw.toLowerCase()
  if (/call|dial|phone|voice/.test(s)) return 'Calling from chat is more reliable.'
  if (/linkedin/.test(s)) return 'LinkedIn steps send from the sequence.'
  if (/email|gmail|inbox/.test(s)) return 'Email steps stay ready to send from the sequence.'
  if (/plan|billing|credit/.test(s)) return 'Plans stay aligned with how the team works.'
  if (/crm|warehouse|contact|prospect/.test(s)) return 'Tools stay grounded in your data.'
  if (/claude|chatgpt|connector|chat/.test(s)) return 'The workspace in chat is easier to run.'
  return 'A smoother way to run outbound from chat.'
}

/** Website work and one-off changes to a personal account stay off the public changelog. */
export function isCustomerChange(subject: string): boolean {
  return !/\S+@\S+|\b(landing|homepage|hero|marketing)\b|\bwww\.|api host|opens the site/i.test(
    subject
  )
}

export interface ChangelogCommit {
  date: string
  subject: string
}

export interface ChangelogRelease {
  version: string
  titles: string[]
}

function versionName(indexFromOldest: number): string {
  if (indexFromOldest === 0) return 'V1'
  return `V1.${indexFromOldest + 1}`
}

/** Calendar day in the company timezone, so a push lands on the day it shipped. */
export function commitDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso))
}

/** Last three days of customer-facing launches, newest first, named V1.3, V1.2, V1. */
export function toReleases(commits: ChangelogCommit[]): ChangelogRelease[] {
  const byDate: { date: string; titles: string[] }[] = []
  for (const commit of commits) {
    if (!commit.date || !commit.subject || !isCustomerChange(commit.subject)) continue
    const title = toCustomerTitle(commit.subject)
    const group = byDate.find((item) => item.date === commit.date)
    if (!group) {
      if (byDate.length === 3) break
      byDate.push({ date: commit.date, titles: [title] })
    } else if (!group.titles.includes(title)) {
      group.titles.push(title)
    }
  }

  return byDate.slice(0, 3).map((release, index, releases) => ({
    titles: release.titles,
    version: versionName(releases.length - 1 - index)
  }))
}

export function toCustomerTitle(raw: string): string {
  const subject = raw.trim()
  for (const [pattern, title] of RULES) {
    if (pattern.test(subject) && !FORBIDDEN.test(title)) return title
  }

  const cleaned = subject
    .replace(/\S+@\S+/g, '')
    .replace(FORBIDDEN, '')
    .replace(/\b(webhook|webhooks|endpoint|endpoints|browser tokens?|api host|mcp)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim()

  if (cleaned.length < 24 || FORBIDDEN.test(cleaned)) return safeFallback(subject)

  const sentence = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`
  const titled = sentence.charAt(0).toUpperCase() + sentence.slice(1)
  return FORBIDDEN.test(titled) ? safeFallback(subject) : titled
}
