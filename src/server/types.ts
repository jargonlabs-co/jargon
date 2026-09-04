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
export type ConnectionProvider = 'hubspot' | 'gmail' | 'twilio' | 'heyreach' | 'postgres'
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'pending'

export interface User {
  id: string
  email: string
  name: string
  /** Present only for legacy rows; login never uses Railway passwords. */
  passwordHash?: string
  passwordSalt?: string
  /** Supabase Auth user id — required for product login */
  supabaseUserId?: string
  createdAt: number
  updatedAt: number
}

export interface Org {
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}

export interface Membership {
  id: string
  orgId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  createdAt: number
}

export interface Session {
  id: string
  userId: string
  orgId: string
  tokenHash: string
  createdAt: number
  expiresAt: number
}

export interface ApiKey {
  id: string
  orgId: string
  userId: string
  name: string
  /** First 8 chars of key for display, e.g. jarg_a1b2 */
  prefix: string
  tokenHash: string
  createdAt: number
  lastUsedAt?: number
  revokedAt?: number
}

export interface ApiKeyPublic {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt?: number
  revokedAt?: number
}

export interface Connection {
  id: string
  orgId: string
  provider: ConnectionProvider
  status: ConnectionStatus
  accountLabel?: string
  /** AES-GCM encrypted JSON blob of provider tokens/credentials */
  secretsCipher: string
  meta: Record<string, string>
  lastSyncAt?: number
  error?: string
  createdAt: number
  updatedAt: number
}

export interface OAuthState {
  id: string
  orgId: string
  userId: string
  provider: ConnectionProvider
  codeVerifier?: string
  createdAt: number
  expiresAt: number
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
  source?: 'seed' | 'manual' | 'hubspot' | 'heyreach' | 'postgres'
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

export interface ShareLink {
  id: string
  orgId: string
  projectId: string
  tokenHash: string
  createdBy: string
  label: string
  expiresAt: number
  revokedAt?: number
  createdAt: number
}

export type PreviewCommentSection = 'queue' | 'talk_track' | 'email' | 'general'

export interface PreviewComment {
  id: string
  orgId: string
  projectId: string
  shareLinkId: string
  authorName: string
  authorEmail?: string
  body: string
  contactId?: string
  section?: PreviewCommentSection
  /** Normalized 0–1 position on the preview canvas (root comments only). */
  pinX?: number
  pinY?: number
  /** Reply to a root pinned comment. */
  parentId?: string
  createdAt: number
}

export interface SharedContact {
  id: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  status: ContactStatus
  stepIndex: number
  accountName?: string
  channelsDone?: Channel[]
  context?: string[]
  companyDomain?: string
  companyIndustry?: string
  companySize?: string
}

export interface SharedPreviewPayload {
  project: {
    id: string
    name: string
    kind: ProjectKind
    segment: string
    description: string
  }
  contacts: SharedContact[]
  sequences: Array<{ id: string; name: string; goal: string }>
  steps: Array<{
    id: string
    day: number
    channel: Channel
    label: string
    subject?: string
    body?: string
    order: number
  }>
  share: {
    id: string
    label: string
    createdAt: number
    commentCount: number
  }
  comments: Array<{
    id: string
    authorName: string
    authorEmail?: string
    body: string
    contactId?: string
    section?: PreviewCommentSection
    pinX?: number
    pinY?: number
    parentId?: string
    createdAt: number
  }>
}

export type PlanId = 'free' | 'pro'
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none'

export interface Subscription {
  id: string
  orgId: string
  plan: PlanId
  status: SubscriptionStatus
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  currentPeriodEnd?: number
  createdAt: number
  updatedAt: number
}

export interface Database {
  users: User[]
  orgs: Org[]
  memberships: Membership[]
  sessions: Session[]
  apiKeys: ApiKey[]
  subscriptions: Subscription[]
  connections: Connection[]
  oauthStates: OAuthState[]
  projects: Project[]
  campaigns: Campaign[]
  sequences: Sequence[]
  steps: SequenceStep[]
  contacts: Contact[]
  calls: CallSession[]
  messages: Message[]
  activities: Activity[]
  shareLinks: ShareLink[]
  previewComments: PreviewComment[]
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
