import type { Lead, LeadStatus, SalesTool } from '../types'

export function updateLead(
  tool: SalesTool,
  leadId: string,
  patch: Partial<Lead>
): SalesTool {
  const leads = tool.leads.map((l) => (l.id === leadId ? { ...l, ...patch } : l))
  return recalculateStats({ ...tool, leads })
}

export function setActiveLead(tool: SalesTool, leadId: string): SalesTool {
  return recalculateStats({
    ...tool,
    activeLeadId: leadId,
    leads: tool.leads.map((l) => {
      if (l.id === leadId) return { ...l, status: l.status === 'queued' ? 'active' : l.status }
      if (l.status === 'active' && l.id !== leadId) return { ...l, status: 'queued' }
      return l
    }),
    status: 'running'
  })
}

export function advanceLead(tool: SalesTool, leadId: string): SalesTool {
  const lead = tool.leads.find((l) => l.id === leadId)
  if (!lead) return tool

  const lastIndex = Math.max(tool.steps.length - 1, 0)
  if (lead.stepIndex >= lastIndex) {
    return updateLead(tool, leadId, { status: 'completed' })
  }

  return updateLead(tool, leadId, {
    stepIndex: lead.stepIndex + 1,
    status: 'active'
  })
}

export function disposeLead(tool: SalesTool, leadId: string, status: LeadStatus): SalesTool {
  let next = updateLead(tool, leadId, { status })

  const currentIndex = next.leads.findIndex((l) => l.id === leadId)
  const upcoming =
    next.leads.find((l, i) => i > currentIndex && l.status === 'queued') ??
    next.leads.find((l) => l.status === 'queued')

  if (upcoming) {
    next = setActiveLead(next, upcoming.id)
  }

  return next
}

export function logNote(tool: SalesTool, leadId: string, note: string): SalesTool {
  const lead = tool.leads.find((l) => l.id === leadId)
  if (!lead) return tool
  const stamped = `${new Date().toLocaleString()}: ${note}`
  return updateLead(tool, leadId, {
    notes: lead.notes ? `${lead.notes}\n${stamped}` : stamped,
    status: lead.status === 'queued' ? 'active' : lead.status
  })
}

export function toggleStep(tool: SalesTool, stepId: string): SalesTool {
  return {
    ...tool,
    steps: tool.steps.map((s) => (s.id === stepId ? { ...s, completed: !s.completed } : s))
  }
}

function recalculateStats(tool: SalesTool): SalesTool {
  const contacted = tool.leads.filter((l) => l.status !== 'queued').length
  const replied = tool.leads.filter((l) => l.status === 'replied' || l.status === 'interested').length
  const booked = tool.leads.filter((l) => l.status === 'interested').length
  return {
    ...tool,
    stats: {
      enrolled: tool.leads.length,
      contacted,
      replied,
      booked
    }
  }
}
