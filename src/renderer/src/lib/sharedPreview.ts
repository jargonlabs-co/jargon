import type { ProjectBundle, SharedPreviewPayload } from '../api/types'

export function sharedPayloadToBundle(payload: SharedPreviewPayload): ProjectBundle {
  const ts = payload.share.createdAt
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
      createdAt: ts,
      updatedAt: ts
    },
    campaigns: [],
    sequences: payload.sequences.map((s) => ({
      ...s,
      orgId: '',
      projectId: payload.project.id,
      createdAt: ts,
      updatedAt: ts
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
      createdAt: ts,
      updatedAt: ts
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

export function readShareTokenFromHash(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return hash.trim() || null
}
