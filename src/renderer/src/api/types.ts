export type ProjectKind = 'dialer' | 'sequencer' | 'cadence' | 'list' | 'today' | 'generic'
export type CampaignState = 'ACTIVE' | 'PAUSED' | 'DRAFT'
export type ContactStatus =
  | 'queued'
  | 'active'
  | 'completed'
  | 'replied'
  | 'no_answer'
  | 'interested'
  | 'not_interested'
export type CallPhase = 'dialing' | 'ringing' | 'connected' | 'completed' | 'failed'
export type MessageStatus = 'draft' | 'queued' | 'sent' | 'failed'
export type Channel = 'email' | 'call' | 'linkedin'
export type ConnectionProvider = 'hubspot' | 'gmail' | 'twilio' | 'heyreach' | 'postgres' | 'railway'
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'pending'

export interface Org {
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}

export interface PublicUser {
  id: string
  email: string
  name: string
}

export interface AuthPayload {
  token: string
  user: PublicUser
  org: Org
}

export interface ConnectionPublic {
  id: string
  provider: ConnectionProvider
  status: ConnectionStatus
  accountLabel?: string
  meta: Record<string, string>
  lastSyncAt?: number
  error?: string
  updatedAt: number
}

export interface Project {
  id: string
  orgId: string
  name: string
  kind: ProjectKind
  prompt: string
  segment: string
  team: string
  description: string
  answers: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface Campaign {
  id: string
  orgId: string
  projectId: string
  name: string
  state: CampaignState
  type: string
  done: number
  total: number
  ringRatio: number
  answerRatio: number
  createdAt: number
  updatedAt: number
}

export interface Sequence {
  id: string
  orgId: string
  projectId: string
  name: string
  goal: string
  createdAt: number
  updatedAt: number
}

export interface SequenceStep {
  id: string
  orgId: string
  sequenceId: string
  projectId: string
  day: number
  channel: Channel
  label: string
  subject?: string
  body?: string
  order: number
}

export interface Contact {
  id: string
  orgId: string
  projectId: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  status: ContactStatus
  stepIndex: number
  notes: string
  externalId?: string
  source?: 'seed' | 'manual' | 'hubspot' | 'heyreach'
  accountName?: string
  channelsDone?: Channel[]
  linkedinUrl?: string
  companyDomain?: string
  companyIndustry?: string
  companySize?: string
  companyRevenue?: string
  /** Short talk-track snippets for dialer / queue (e.g. tenure, funding). */
  context?: string[]
  enrichedAt?: number
  createdAt: number
  updatedAt: number
}

export interface CallSession {
  id: string
  orgId: string
  projectId: string
  contactId: string
  phase: CallPhase
  disposition?: ContactStatus
  providerCallSid?: string
  mode: 'demo' | 'twilio'
  startedAt: number
  connectedAt?: number
  endedAt?: number
}

export interface Message {
  id: string
  orgId: string
  projectId: string
  contactId: string
  subject: string
  body: string
  status: MessageStatus
  channel: 'email' | 'linkedin'
  providerMessageId?: string
  mode: 'demo' | 'gmail' | 'heyreach'
  createdAt: number
  updatedAt: number
  sentAt?: number
  error?: string
}

export interface Activity {
  id: string
  orgId: string
  projectId: string
  contactId?: string
  kind: 'call' | 'email' | 'draft' | 'linkedin' | 'note' | 'campaign' | 'system' | 'sync'
  summary: string
  createdAt: number
}

export interface AnalyticsSummary {
  enrolled: number
  contacted: number
  replied: number
  booked: number
  calls: number
  emailsSent: number
  openRate: number
  answerRate: number
}

export interface ProjectBundle {
  project: Project
  campaigns: Campaign[]
  sequences: Sequence[]
  steps: SequenceStep[]
  contacts: Contact[]
  calls: CallSession[]
  messages: Message[]
  activities: Activity[]
  analytics: AnalyticsSummary
}
