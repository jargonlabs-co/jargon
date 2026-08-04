import type {
  CallSession,
  Campaign,
  Contact,
  ContactStatus,
  Message,
  Project,
  ProjectBundle,
  ProjectKind
} from './types'

export type {
  Activity,
  AnalyticsSummary,
  CallSession,
  Campaign,
  Contact,
  ContactStatus,
  Message,
  Project,
  ProjectBundle,
  ProjectKind,
  Sequence,
  SequenceStep
} from './types'

function baseUrl(): string {
  return window.jargon?.apiBaseUrl ?? 'http://127.0.0.1:8787'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  createProject: (body: {
    prompt: string
    kind: ProjectKind
    answers: Record<string, string>
  }) =>
    request<ProjectBundle>('/projects', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  getProject: (id: string) => request<ProjectBundle>(`/projects/${id}`),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  pauseCampaign: (id: string) =>
    request<Campaign>(`/campaigns/${id}/pause`, { method: 'POST' }),
  runCampaign: (id: string) => request<Campaign>(`/campaigns/${id}/run`, { method: 'POST' }),
  startCall: (contactId: string) =>
    request<CallSession>(`/contacts/${contactId}/calls`, {
      method: 'POST',
      body: '{}'
    }),
  getCall: (callId: string) => request<CallSession>(`/calls/${callId}`),
  completeCall: (callId: string, disposition: ContactStatus) =>
    request<{ call: CallSession; bundle: ProjectBundle }>(`/calls/${callId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ disposition })
    }),
  sendMessage: (
    contactId: string,
    body: {
      subject?: string
      body?: string
      status?: 'draft' | 'queued' | 'sent'
      channel?: 'email' | 'linkedin'
    }
  ) =>
    request<{ message: Message; bundle: ProjectBundle }>(`/contacts/${contactId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  addNote: (contactId: string, note: string) =>
    request<Contact>(`/contacts/${contactId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note })
    }),
  patchContact: (contactId: string, patch: Partial<Contact>) =>
    request<Contact>(`/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    })
}
