import type { DataStore } from './store'
import type {
  Contact,
  PreviewComment,
  ProjectBundle,
  ShareLink,
  SharedContact,
  SharedPreviewPayload
} from './types'
import { hashToken, randomToken, uid } from './crypto'
import { bundleProject } from './queries'

const SHARE_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email || '—'
  const [user, domain] = email.split('@')
  const masked = user.length <= 1 ? '*' : `${user[0]}${'*'.repeat(Math.min(user.length - 1, 4))}`
  return `${masked}@${domain}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '—'
  return `•••-•••-${digits.slice(-4)}`
}

export function sanitizeContact(contact: Contact): SharedContact {
  return {
    id: contact.id,
    name: contact.name,
    company: contact.company,
    title: contact.title,
    email: maskEmail(contact.email),
    phone: maskPhone(contact.phone),
    city: contact.city,
    status: contact.status,
    stepIndex: contact.stepIndex,
    accountName: contact.accountName,
    channelsDone: contact.channelsDone,
    context: contact.context,
    companyDomain: contact.companyDomain,
    companyIndustry: contact.companyIndustry,
    companySize: contact.companySize
  }
}

function sharePreviewUrl(previewBase: string, token: string, apiBase?: string): string {
  const base = previewBase.replace(/\/$/, '')
  const api = apiBase?.replace(/\/$/, '')
  const qs = api ? `?api=${encodeURIComponent(api)}` : ''
  return `${base}/preview.html${qs}#/${token}`
}

export function createShareLink(
  store: DataStore,
  input: {
    orgId: string
    userId: string
    projectId: string
    label?: string
    previewBaseUrl: string
    apiBaseUrl?: string
  }
): { share: ShareLink; token: string; url: string } {
  const project = store.db.projects.find(
    (p) => p.id === input.projectId && p.orgId === input.orgId
  )
  if (!project) throw new Error('Project not found')

  const token = randomToken(24)
  const now = Date.now()
  const share: ShareLink = {
    id: uid('share'),
    orgId: input.orgId,
    projectId: input.projectId,
    tokenHash: hashToken(token),
    createdBy: input.userId,
    label: input.label?.trim() || `${project.name} preview`,
    expiresAt: now + SHARE_TTL_MS,
    createdAt: now
  }

  store.update((db) => {
    db.shareLinks.push(share)
  })

  return {
    share,
    token,
    url: sharePreviewUrl(input.previewBaseUrl, token, input.apiBaseUrl)
  }
}

export function resolveShareLink(store: DataStore, token: string): ShareLink | null {
  const tokenHash = hashToken(token)
  const share = store.db.shareLinks.find((s) => s.tokenHash === tokenHash)
  if (!share) return null
  if (share.expiresAt && share.expiresAt < Date.now()) return null
  if (share.revokedAt) return null
  return share
}

export function buildSharedPreview(
  store: DataStore,
  share: ShareLink
): SharedPreviewPayload | null {
  const bundle = bundleProject(store.db, share.projectId)
  if (!bundle || bundle.project.orgId !== share.orgId) return null

  const comments = store.db.previewComments
    .filter((c) => c.shareLinkId === share.id)
    .sort((a, b) => a.createdAt - b.createdAt)

  return {
    project: {
      id: bundle.project.id,
      name: bundle.project.name,
      kind: bundle.project.kind,
      segment: bundle.project.segment,
      description: bundle.project.description
    },
    contacts: bundle.contacts.map(sanitizeContact),
    sequences: bundle.sequences.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal
    })),
    steps: bundle.steps.map((s) => ({
      id: s.id,
      day: s.day,
      channel: s.channel,
      label: s.label,
      subject: s.subject,
      body: s.body,
      order: s.order
    })),
    share: {
      id: share.id,
      label: share.label,
      createdAt: share.createdAt,
      commentCount: comments.length
    },
    comments: comments.map(toPublicComment)
  }
}

export function toPublicComment(comment: PreviewComment) {
  return {
    id: comment.id,
    authorName: comment.authorName,
    authorEmail: comment.authorEmail,
    body: comment.body,
    contactId: comment.contactId,
    section: comment.section,
    pinX: comment.pinX,
    pinY: comment.pinY,
    parentId: comment.parentId,
    createdAt: comment.createdAt
  }
}

export function addPreviewComment(
  store: DataStore,
  share: ShareLink,
  input: {
    authorName: string
    authorEmail?: string
    body: string
    contactId?: string
    section?: PreviewComment['section']
    pinX?: number
    pinY?: number
    parentId?: string
  }
): PreviewComment {
  const body = input.body.trim()
  const authorName = input.authorName.trim()
  if (!body) throw new Error('Comment cannot be empty')
  if (!authorName) throw new Error('Name is required')

  let pinX = input.pinX
  let pinY = input.pinY
  const parentId = input.parentId

  if (parentId) {
    const parent = store.db.previewComments.find(
      (c) => c.id === parentId && c.shareLinkId === share.id && !c.parentId
    )
    if (!parent) throw new Error('Comment thread not found')
    pinX = parent.pinX
    pinY = parent.pinY
  } else {
    if (pinX === undefined || pinY === undefined) {
      throw new Error('Click the preview to place a comment pin')
    }
    if (pinX < 0 || pinX > 1 || pinY < 0 || pinY > 1) {
      throw new Error('Invalid pin position')
    }
  }

  const comment: PreviewComment = {
    id: uid('comment'),
    shareLinkId: share.id,
    projectId: share.projectId,
    orgId: share.orgId,
    authorName,
    authorEmail: input.authorEmail?.trim() || undefined,
    body,
    contactId: input.contactId,
    section: input.section,
    pinX: parentId ? undefined : pinX,
    pinY: parentId ? undefined : pinY,
    parentId,
    createdAt: Date.now()
  }

  store.update((db) => {
    db.previewComments.push(comment)
  })

  return comment
}

export function revokeShareLink(store: DataStore, shareId: string, orgId: string): boolean {
  let revoked = false
  store.update((db) => {
    const share = db.shareLinks.find((s) => s.id === shareId && s.orgId === orgId)
    if (!share || share.revokedAt) return
    share.revokedAt = Date.now()
    revoked = true
  })
  return revoked
}

/** Build a ProjectBundle-shaped object for read-only preview rendering. */
export function sharedPayloadToBundle(payload: SharedPreviewPayload): ProjectBundle {
  return {
    project: {
      id: payload.project.id,
      orgId: '',
      name: payload.project.name,
      kind: payload.project.kind,
      prompt: '',
      segment: payload.project.segment,
      team: '',
      description: payload.project.description,
      answers: {},
      createdAt: payload.share.createdAt,
      updatedAt: payload.share.createdAt
    },
    campaigns: [],
    sequences: payload.sequences.map((s) => ({
      ...s,
      orgId: '',
      projectId: payload.project.id,
      createdAt: payload.share.createdAt,
      updatedAt: payload.share.createdAt
    })),
    steps: payload.steps.map((s) => ({
      ...s,
      orgId: '',
      sequenceId: '',
      projectId: payload.project.id
    })),
    contacts: payload.contacts.map((c) => ({
      ...c,
      orgId: '',
      projectId: payload.project.id,
      notes: '',
      createdAt: payload.share.createdAt,
      updatedAt: payload.share.createdAt
    })),
    calls: [],
    messages: [],
    activities: [],
    analytics: {
      enrolled: payload.contacts.length,
      contacted: 0,
      replied: 0,
      booked: 0,
      calls: 0,
      emailsSent: 0,
      openRate: 0,
      answerRate: 0
    }
  }
}
