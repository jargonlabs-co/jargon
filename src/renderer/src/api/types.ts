export type ProjectKind = 'dialer' | 'sequencer' | 'cadence' | 'list' | 'generic'
export type CampaignState = 'ACTIVE' | 'PAUSED' | 'DRAFT'
export type ContactStatus =
  | 'queued'
  | 'active'
  | 'completed'
  | 'replied'
  | 'no_answer'
  | 'interested'
  | 'not_interested'
export type CallPhase = 'dialing' | 'connected' | 'completed'
export type MessageStatus = 'draft' | 'queued' | 'sent'
export type Channel = 'email' | 'call' | 'linkedin'

export interface Project {
  id: string
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
  projectId: string
  name: string
  goal: string
  createdAt: number
  updatedAt: number
}

export interface SequenceStep {
  id: string
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
  createdAt: number
  updatedAt: number
}

export interface CallSession {
  id: string
  projectId: string
  contactId: string
  phase: CallPhase
  disposition?: ContactStatus
  startedAt: number
  connectedAt?: number
  endedAt?: number
}

export interface Message {
  id: string
  projectId: string
  contactId: string
  subject: string
  body: string
  status: MessageStatus
  channel: 'email' | 'linkedin'
  createdAt: number
  updatedAt: number
  sentAt?: number
}

export interface Activity {
  id: string
  projectId: string
  contactId?: string
  kind: 'call' | 'email' | 'draft' | 'linkedin' | 'note' | 'campaign' | 'system'
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
