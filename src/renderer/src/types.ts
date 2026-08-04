export type ToolKind = 'dialer' | 'sequencer' | 'cadence' | 'list' | 'generic'

export type SessionPhase = 'idle' | 'clarifying' | 'building' | 'ready'

export type LeadStatus =
  | 'queued'
  | 'active'
  | 'completed'
  | 'replied'
  | 'no_answer'
  | 'interested'
  | 'not_interested'

export type Channel = 'email' | 'call' | 'linkedin'

export interface ClarifyQuestion {
  id: string
  prompt: string
  options: string[]
}

export interface ClarifySession {
  id: string
  originalPrompt: string
  kind: ToolKind
  inferred: {
    segment?: string
    team?: string
  }
  questions: ClarifyQuestion[]
  answers: Record<string, string>
  currentIndex: number
}

export interface Lead {
  id: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  status: LeadStatus
  stepIndex: number
  notes: string
}

export interface SequenceStep {
  id: string
  day: number
  channel: Channel
  label: string
  subject?: string
  body?: string
  completed: boolean
}

export interface ToolStats {
  enrolled: number
  contacted: number
  replied: number
  booked: number
}

export interface SalesTool {
  id: string
  name: string
  kind: ToolKind
  prompt: string
  segment: string
  team: string
  description: string
  createdAt: number
  updatedAt: number
  status: 'building' | 'ready' | 'running'
  answers: Record<string, string>
  config: Record<string, string | number | boolean>
  leads: Lead[]
  steps: SequenceStep[]
  stats: ToolStats
  activeLeadId: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolId?: string
  questionId?: string
  options?: string[]
  createdAt: number
}
