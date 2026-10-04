export type AdminWindow = '7d' | '30d' | '90d'

export interface RepMetrics {
  id: string
  name: string
  title: string
  emails: number
  calls: number
  connects: number
  replies: number
  meetings: number
  /** Meetings vs. the previous window, as a fraction (0.12 = +12%). */
  trend: number
}

export interface SequenceMetrics {
  id: string
  name: string
  owner: string
  channels: Array<'Email' | 'Calls' | 'LinkedIn'>
  steps: number
  enrolled: number
  replyRate: number
  meetingRate: number
  meetings: number
}

export type RecommendationCategory = 'Sequence' | 'Rep coaching' | 'Guardrail' | 'Context'

export interface Recommendation {
  id: string
  category: RecommendationCategory
  title: string
  evidence: string
  impact: string
  /** Guardrail or context change applied when an admin accepts. */
  effect?: { kind: 'guardrail'; patch: Partial<Guardrails> } | { kind: 'context'; field: ContextFieldId; append: string }
}

export interface Guardrails {
  requireApproval: boolean
  dailyEmailCap: number
  dailyCallCap: number
  maxSteps: number
  callStart: string
  callEnd: string
  channels: { Email: boolean; Calls: boolean; LinkedIn: boolean }
  blockedPhrases: string[]
}

export interface PendingSequence {
  id: string
  name: string
  rep: string
  steps: number
  channels: string
  submitted: string
  flags: string[]
}

export type ContextFieldId = 'company' | 'icp' | 'valueProps' | 'tone' | 'proof' | 'avoid'

export interface ContextField {
  id: ContextFieldId
  label: string
  hint: string
  value: string
  locked: boolean
  updatedBy: string
  updatedAt: string
}

/** 30-day baseline; other windows scale from it. */
const REPS_30D: RepMetrics[] = [
  { id: 'r1', name: 'Maya Chen', title: 'Senior AE', emails: 1240, calls: 412, connects: 96, replies: 138, meetings: 31, trend: 0.18 },
  { id: 'r2', name: 'Jordan Ellis', title: 'SDR', emails: 1610, calls: 538, connects: 104, replies: 121, meetings: 24, trend: 0.06 },
  { id: 'r3', name: 'Priya Raman', title: 'SDR', emails: 1385, calls: 466, connects: 88, replies: 117, meetings: 22, trend: 0.11 },
  { id: 'r4', name: 'Sam Okafor', title: 'AE', emails: 920, calls: 301, connects: 61, replies: 74, meetings: 15, trend: -0.09 },
  { id: 'r5', name: 'Lena Fischer', title: 'SDR', emails: 1490, calls: 255, connects: 39, replies: 82, meetings: 11, trend: -0.14 },
  { id: 'r6', name: 'Diego Morales', title: 'SDR (ramping)', emails: 640, calls: 198, connects: 33, replies: 41, meetings: 7, trend: 0.4 }
]

const WINDOW_SCALE: Record<AdminWindow, number> = { '7d': 0.24, '30d': 1, '90d': 2.85 }

export function repsFor(window: AdminWindow): RepMetrics[] {
  const scale = WINDOW_SCALE[window]
  return REPS_30D.map((rep) => ({
    ...rep,
    emails: Math.round(rep.emails * scale),
    calls: Math.round(rep.calls * scale),
    connects: Math.round(rep.connects * scale),
    replies: Math.round(rep.replies * scale),
    meetings: Math.max(1, Math.round(rep.meetings * scale))
  }))
}

export const TOP_SEQUENCES: SequenceMetrics[] = [
  { id: 's1', name: 'RevOps leaders · Series B–D', owner: 'Maya Chen', channels: ['Email', 'Calls', 'LinkedIn'], steps: 7, enrolled: 412, replyRate: 0.142, meetingRate: 0.061, meetings: 25 },
  { id: 's2', name: 'Post-funding trigger', owner: 'Priya Raman', channels: ['Email', 'Calls'], steps: 5, enrolled: 286, replyRate: 0.128, meetingRate: 0.052, meetings: 15 },
  { id: 's3', name: 'GTM Engineers · US', owner: 'Jordan Ellis', channels: ['Email', 'LinkedIn'], steps: 6, enrolled: 530, replyRate: 0.097, meetingRate: 0.038, meetings: 20 },
  { id: 's4', name: 'Closed-lost re-engage', owner: 'Sam Okafor', channels: ['Email', 'Calls'], steps: 4, enrolled: 198, replyRate: 0.111, meetingRate: 0.035, meetings: 7 },
  { id: 's5', name: 'Webinar follow-up', owner: 'Lena Fischer', channels: ['Email'], steps: 3, enrolled: 640, replyRate: 0.064, meetingRate: 0.017, meetings: 11 }
]

export const RECOMMENDATIONS: Recommendation[] = [
  {
    id: 'rec1',
    category: 'Sequence',
    title: 'Add a call step on day 2 of “Webinar follow-up”',
    evidence: 'Email-only sequences book meetings at 1.7%. The same audience with a day-2 call converts at 4.4% in “Post-funding trigger”.',
    impact: '+9 meetings / month (est.)'
  },
  {
    id: 'rec2',
    category: 'Guardrail',
    title: 'Stop calls before 9:00 AM recipient time',
    evidence: 'Connect rate is 3.1% before 9 AM vs. 11.8% from 10–11 AM. 22% of early calls were marked “bad time”.',
    impact: 'Higher connect rate, fewer complaints',
    effect: { kind: 'guardrail', patch: { callStart: '09:00' } }
  },
  {
    id: 'rec3',
    category: 'Rep coaching',
    title: 'Pair Lena with Maya for call reviews',
    evidence: 'Lena sends the second-most emails but has the lowest connect rate on the team (15% vs. 19%) and books the fewest meetings per call.',
    impact: 'Lift Lena’s meetings toward team median'
  },
  {
    id: 'rec4',
    category: 'Context',
    title: 'Add the Northwind case study to proof points',
    evidence: 'Replies that mention “who else uses this” rose 40% this month. Sequences citing a named customer convert 1.6× better.',
    impact: 'Stronger social proof in every draft',
    effect: {
      kind: 'context',
      field: 'proof',
      append: 'Northwind cut ramp time for new SDRs from 90 to 45 days.'
    }
  },
  {
    id: 'rec5',
    category: 'Guardrail',
    title: 'Block “guaranteed” and “risk-free” in rep sequences',
    evidence: 'Both phrases appear in 3 rep-built sequences and correlate with a 2.3× higher spam-report rate.',
    impact: 'Protect sender reputation',
    effect: { kind: 'guardrail', patch: { blockedPhrases: ['guaranteed', 'risk-free'] } }
  },
  {
    id: 'rec6',
    category: 'Sequence',
    title: 'Shorten “GTM Engineers · US” from 6 to 4 steps',
    evidence: '92% of meetings from this sequence come from the first 4 steps; steps 5–6 drive most unsubscribes.',
    impact: '−35% unsubscribes, same meetings'
  }
]

export const DEFAULT_GUARDRAILS: Guardrails = {
  requireApproval: true,
  dailyEmailCap: 150,
  dailyCallCap: 60,
  maxSteps: 8,
  callStart: '08:00',
  callEnd: '18:00',
  channels: { Email: true, Calls: true, LinkedIn: true },
  blockedPhrases: ['act now', 'last chance']
}

export const PENDING_SEQUENCES: PendingSequence[] = [
  {
    id: 'p1',
    name: 'Q4 budget blitz',
    rep: 'Sam Okafor',
    steps: 9,
    channels: 'Email · Calls',
    submitted: '2 hours ago',
    flags: ['9 steps exceeds the 8-step limit', 'Step 3 uses the blocked phrase “last chance”']
  },
  {
    id: 'p2',
    name: 'Healthcare RevOps · Midwest',
    rep: 'Diego Morales',
    steps: 5,
    channels: 'Email · LinkedIn',
    submitted: 'Yesterday',
    flags: []
  },
  {
    id: 'p3',
    name: 'Competitor displacement',
    rep: 'Jordan Ellis',
    steps: 6,
    channels: 'Email · Calls · LinkedIn',
    submitted: 'Yesterday',
    flags: ['Mentions a competitor by name; org context says to avoid direct comparisons']
  }
]

export const DEFAULT_CONTEXT: ContextField[] = [
  {
    id: 'company',
    label: 'Company overview',
    hint: 'One paragraph on what you sell and who it’s for.',
    value: 'Jargon helps revenue teams build and run outbound sequences from Claude or ChatGPT, with live email, calling, and LinkedIn in one place.',
    locked: true,
    updatedBy: 'Tara',
    updatedAt: 'Sep 28'
  },
  {
    id: 'icp',
    label: 'Ideal customer profile',
    hint: 'Industries, company size, titles, and buying triggers.',
    value: 'B2B SaaS, 50–1,000 employees, Series A–D. Titles: VP Sales, Head of RevOps, GTM Engineer. Triggers: new funding, new sales leader, hiring SDRs.',
    locked: true,
    updatedBy: 'Tara',
    updatedAt: 'Sep 28'
  },
  {
    id: 'valueProps',
    label: 'Value propositions',
    hint: 'The 2–4 outcomes reps should lead with.',
    value: '1. Launch a working sequence in minutes, not weeks.\n2. One place for email, calls, and LinkedIn.\n3. Admin guardrails keep every rep on-brand and compliant.',
    locked: false,
    updatedBy: 'Maya Chen',
    updatedAt: 'Oct 1'
  },
  {
    id: 'tone',
    label: 'Tone and voice',
    hint: 'How messages should sound.',
    value: 'Plain, direct, and specific. Short sentences. No hype, no exclamation points. Write like a peer, not a vendor.',
    locked: true,
    updatedBy: 'Tara',
    updatedAt: 'Sep 30'
  },
  {
    id: 'proof',
    label: 'Proof points',
    hint: 'Customer results reps can cite.',
    value: 'Acme booked 3× more meetings in its first month.',
    locked: false,
    updatedBy: 'Priya Raman',
    updatedAt: 'Oct 2'
  },
  {
    id: 'avoid',
    label: 'Claims to avoid',
    hint: 'Things no sequence should say.',
    value: 'No pricing in cold outreach. No direct competitor comparisons. No promises of specific revenue results.',
    locked: true,
    updatedBy: 'Tara',
    updatedAt: 'Sep 30'
  }
]
