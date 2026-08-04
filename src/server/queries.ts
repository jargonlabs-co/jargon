import type { AnalyticsSummary, Database } from './types'

export function analyticsFor(db: Database, projectId: string): AnalyticsSummary {
  const contacts = db.contacts.filter((c) => c.projectId === projectId)
  const calls = db.calls.filter((c) => c.projectId === projectId)
  const messages = db.messages.filter((m) => m.projectId === projectId)
  const enrolled = contacts.length
  const contacted = contacts.filter((c) => c.status !== 'queued').length
  const replied = contacts.filter((c) => c.status === 'replied' || c.status === 'interested').length
  const booked = contacts.filter((c) => c.status === 'interested').length
  const emailsSent = messages.filter((m) => m.status === 'sent').length
  const completedCalls = calls.filter((c) => c.phase === 'completed')
  const answered = completedCalls.filter(
    (c) => c.disposition && !['no_answer', 'queued'].includes(c.disposition)
  ).length

  return {
    enrolled,
    contacted,
    replied,
    booked,
    calls: completedCalls.length,
    emailsSent,
    openRate: emailsSent ? Math.min(95, 48 + emailsSent * 3) : 0,
    answerRate: completedCalls.length ? (answered / completedCalls.length) * 100 : 0
  }
}

export function bundleProject(db: Database, projectId: string) {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return null
  return {
    project,
    campaigns: db.campaigns.filter((c) => c.projectId === projectId),
    sequences: db.sequences.filter((s) => s.projectId === projectId),
    steps: db.steps.filter((s) => s.projectId === projectId),
    contacts: db.contacts.filter((c) => c.projectId === projectId),
    calls: db.calls.filter((c) => c.projectId === projectId),
    messages: db.messages.filter((m) => m.projectId === projectId),
    activities: db.activities
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50),
    analytics: analyticsFor(db, projectId)
  }
}
