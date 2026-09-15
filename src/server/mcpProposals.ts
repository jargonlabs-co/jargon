import { uid } from './crypto'

export type ConfirmFact = { label: string; value: string }

export type McpProposal = {
  id: string
  orgId: string
  userId: string
  tool: string
  title: string
  summary: string
  facts: ConfirmFact[]
  confirmLabel: string
  args: Record<string, unknown>
  createdAt: number
  expiresAt: number
}

const TTL_MS = 30 * 60 * 1000
const proposals = new Map<string, McpProposal>()

function prune(now = Date.now()): void {
  for (const [id, proposal] of proposals) {
    if (proposal.expiresAt <= now) proposals.delete(id)
  }
}

export function createProposal(
  input: Omit<McpProposal, 'id' | 'createdAt' | 'expiresAt'>
): McpProposal {
  prune()
  const now = Date.now()
  const proposal: McpProposal = {
    ...input,
    id: uid('prop'),
    createdAt: now,
    expiresAt: now + TTL_MS
  }
  proposals.set(proposal.id, proposal)
  return proposal
}

export function getProposal(orgId: string, id: string): McpProposal | null {
  prune()
  const proposal = proposals.get(id)
  if (!proposal || proposal.orgId !== orgId) return null
  return proposal
}

export function deleteProposal(id: string): void {
  proposals.delete(id)
}

export function namesList(
  contacts: Array<{ name?: string }> | undefined,
  limit = 6
): string {
  const names = (contacts ?? []).map((c) => c.name?.trim()).filter(Boolean) as string[]
  if (!names.length) return ''
  const shown = names.slice(0, limit)
  const extra = names.length - shown.length
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ')
}

export function fallbackSummary(action: string, names: string, count: number): string {
  if (names && count === 1) return `${action} ${names}`
  if (names && count > 1) return `${action} ${count} people (${names})`
  if (count === 1) return `${action} 1 person`
  if (count > 1) return `${action} ${count} people`
  return action
}
