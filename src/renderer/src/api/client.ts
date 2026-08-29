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
  PreviewCommentPublic,
  PreviewCommentSection,
  Project,
  ProjectBundle,
  ProjectFeedbackComment,
  ProjectKind,
  PublicUser,
  ShareLinkCreated,
  ShareLinkPublic,
  SharedPreviewPayload
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
  PreviewCommentPublic,
  PreviewCommentSection,
  Project,
  ProjectBundle,
  ProjectFeedbackComment,
  ProjectKind,
  PublicUser,
  Sequence,
  SequenceStep,
  ShareLinkCreated,
  ShareLinkPublic,
  SharedPreviewPayload
} from './types'

let authToken: string | null = null

export function setClientAuthToken(token: string | null): void {
  authToken = token
}

export function getClientAuthToken(): string | null {
  return authToken
}

function baseUrl(): string {
  return window.jargon?.apiBaseUrl ?? 'http://127.0.0.1:8787'
}

function parseApiError(text: string, status: number): string {
  const pre = text.match(/<pre>([\s\S]*?)<\/pre>/i)?.[1]?.trim()
  if (pre) {
    if (pre.includes('Cannot POST') && pre.includes('/share')) {
      return 'Share preview is not available on this API. Quit the app and run npm run dev again so the local API starts with share support.'
    }
    return pre
  }
  try {
    const json = JSON.parse(text) as { error?: string }
    if (json.error) return json.error
  } catch {
    /* plain text or html */
  }
  if (text.includes('<!DOCTYPE') || text.includes('<html')) {
    return `Request failed (${status}). The API may be out of date — restart npm run dev.`
  }
  return text.length > 240 ? `Request failed (${status})` : text || `Request failed (${status})`
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
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

/** Unauthenticated requests for public share preview pages. */
export function getShareApiBase(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('api')
  if (fromQuery) return fromQuery.replace(/\/$/, '')
  return baseUrl()
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  const url = `${getShareApiBase()}${path}`
  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new Error(`Cannot reach the Jargon API at ${getShareApiBase()}.`)
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
  connectApollo: (apiKey?: string) =>
    request<{ connection: ConnectionPublic }>('/connections/apollo/start', {
      method: 'POST',
      body: JSON.stringify(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
    }),
  connectCrustdata: (apiKey?: string) =>
    request<{ connection: ConnectionPublic }>('/connections/crustdata/start', {
      method: 'POST',
      body: JSON.stringify(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
    }),
  connectSupabase: (body: { projectUrl?: string; apiKey?: string; table?: string }) =>
    request<{ connection: ConnectionPublic }>('/connections/supabase/start', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  testGmail: (to: string) =>
    request<{ id: string; mode: 'demo' | 'gmail' }>('/connections/gmail/test', {
      method: 'POST',
      body: JSON.stringify({ to })
    }),
  syncHubSpot: (body: { projectId?: string; limit?: number }) =>
    request<ProjectBundle | { prospects: unknown[]; count: number }>(
      '/connections/hubspot/sync',
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    ),
  syncApollo: (body: { projectId?: string; limit?: number }) =>
    request<
      | ProjectBundle
      | { prospects: unknown[]; count: number; mode: 'live' | 'demo' }
    >('/connections/apollo/sync', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  syncSupabase: (body: { projectId?: string; limit?: number }) =>
    request<ProjectBundle | { prospects: unknown[]; count: number; mode: 'live' }>(
      '/connections/supabase/sync',
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    ),
  syncCrustdata: (body: { projectId?: string; limit?: number; prompt?: string }) =>
    request<
      | ProjectBundle
      | { prospects: unknown[]; count: number; mode: 'live' | 'demo' }
    >('/connections/crustdata/sync', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  enrichContact: (contactId: string) =>
    request<{
      contact: Contact
      enrichment: { mode: 'live' | 'demo'; matchedPerson: boolean; matchedOrganization: boolean }
      bundle: ProjectBundle
    }>(`/contacts/${contactId}/enrich`, {
      method: 'POST',
      body: '{}'
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
    }),

  createShareLink: (projectId: string, body?: { label?: string }) =>
    request<ShareLinkCreated>(`/projects/${projectId}/share`, {
      method: 'POST',
      body: JSON.stringify(body ?? {})
    }),
  listShareLinks: (projectId: string) =>
    request<ShareLinkPublic[]>(`/projects/${projectId}/shares`),
  revokeShareLink: (shareId: string) =>
    request<void>(`/shares/${shareId}`, { method: 'DELETE' }),
  getProjectFeedback: (projectId: string) =>
    request<ProjectFeedbackComment[]>(`/projects/${projectId}/feedback`),

  getSharedPreview: (token: string) =>
    publicRequest<SharedPreviewPayload>(`/share/${token}`),
  postShareComment: (
    token: string,
    body: {
      authorName: string
      authorEmail?: string
      body: string
      contactId?: string
      section?: PreviewCommentSection
      pinX?: number
      pinY?: number
      parentId?: string
    }
  ) =>
    publicRequest<PreviewCommentPublic>(`/share/${token}/comments`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
}
