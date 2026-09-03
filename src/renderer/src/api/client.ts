import type {
  AuthPayload,
  CallSession,
  Campaign,
  ConnectionPublic,
  ConnectionProvider,
  Contact,
  ContactStatus,
  Message,
  Org,
  Project,
  ProjectBundle,
  ProjectKind,
  PublicUser
} from './types'

export type {
  Activity,
  AnalyticsSummary,
  AuthPayload,
  CallSession,
  Campaign,
  ConnectionPublic,
  ConnectionProvider,
  Contact,
  ContactStatus,
  Message,
  Org,
  Project,
  ProjectBundle,
  ProjectKind,
  PublicUser,
  Sequence,
  SequenceStep
} from './types'

let authToken: string | null = null

export function setClientAuthToken(token: string | null): void {
  authToken = token
}

export function getClientAuthToken(): string | null {
  return authToken
}

function baseUrl(): string {
  const env = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL
  return (env ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
}

function parseApiError(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as { error?: string }
    if (json.error) return json.error
  } catch {
    /* plain text */
  }
  return text.length > 240 ? `Request failed (${status})` : text || `Request failed (${status})`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`

  const url = `${baseUrl()}${path}`
  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new Error(`Cannot reach the Jargon API at ${baseUrl()}. Check your connection.`)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(parseApiError(text, res.status))
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthPayload>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),
  register: (body: { email: string; password: string; name?: string; orgName?: string }) =>
    request<AuthPayload>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  me: () => request<{ user: PublicUser; org: Org; demoMode: boolean }>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  listConnections: () => request<ConnectionPublic[]>('/connections'),
  startConnection: (provider: ConnectionProvider, body: Record<string, string> = {}) =>
    request<{ url?: string; connection?: ConnectionPublic }>(`/connections/${provider}/start`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  testGmail: (to: string) =>
    request<{ id: string; mode: 'demo' | 'gmail' }>('/connections/gmail/test', {
      method: 'POST',
      body: JSON.stringify({ to })
    }),
  voiceToken: () =>
    request<{ token: string; mode: 'demo' | 'twilio'; identity: string }>('/voice/token'),

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
