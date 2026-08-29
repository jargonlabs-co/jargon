export type BoardNodeKind =
  | 'source'
  | 'enrich'
  | 'map'
  | 'filter'
  | 'score'
  | 'approve'
  | 'writeback'
  | 'action'
  | 'surface'

export type LibraryGroup =
  | 'Context'
  | 'Select & rank'
  | 'People & play'
  | 'Rep surfaces'
  | 'Actions'

export interface BoardNode {
  id: string
  kind: BoardNodeKind
  label: string
  paletteId?: string
  x: number
  y: number
}

export interface PaletteItem {
  id: string
  kind: BoardNodeKind
  label: string
  group: LibraryGroup
  detail: string
}

export const LIBRARY_GROUPS: LibraryGroup[] = [
  'Context',
  'Select & rank',
  'People & play',
  'Rep surfaces',
  'Actions'
]

/** Drag-and-drop catalog for the RevOps studio palette */
export const BOARD_PALETTE: PaletteItem[] = [
  // —— Context ——
  {
    id: 'crm_deals',
    kind: 'source',
    label: 'CRM deals',
    group: 'Context',
    detail: 'Open opportunities: close date, amount, stage, probability'
  },
  {
    id: 'crm_accounts',
    kind: 'source',
    label: 'CRM accounts',
    group: 'Context',
    detail: 'Account objects reps work — company + ownership'
  },
  {
    id: 'crm_contacts',
    kind: 'source',
    label: 'CRM contacts',
    group: 'Context',
    detail: 'People at those accounts with titles and channels'
  },
  {
    id: 'owner_territory',
    kind: 'source',
    label: 'Owner / territory',
    group: 'Context',
    detail: 'Scope the book to a rep, pod, or region'
  },
  {
    id: 'engagement',
    kind: 'source',
    label: 'Engagement history',
    group: 'Context',
    detail: 'Last meeting, email, call — likelihood signals'
  },
  {
    id: 'csv',
    kind: 'source',
    label: 'CSV / warehouse',
    group: 'Context',
    detail: 'Static list or BI extract when CRM isn’t enough'
  },

  // —— Select & rank ——
  {
    id: 'close_window',
    kind: 'filter',
    label: 'Close-window filter',
    group: 'Select & rank',
    detail: 'Keep deals closing within a window (e.g. next 90 days)'
  },
  {
    id: 'likelihood',
    kind: 'score',
    label: 'Likelihood score',
    group: 'Select & rank',
    detail: 'Weight stage, amount, probability, and engagement'
  },
  {
    id: 'rank_top',
    kind: 'score',
    label: 'Rank / top N',
    group: 'Select & rank',
    detail: 'Sort by score and cap the book of business'
  },
  {
    id: 'owner_filter',
    kind: 'filter',
    label: 'Owner filter',
    group: 'Select & rank',
    detail: 'My accounts vs team pool'
  },
  {
    id: 'dedupe_accounts',
    kind: 'filter',
    label: 'Deduplicate accounts',
    group: 'Select & rank',
    detail: 'One row per account even with many deals'
  },
  {
    id: 'approve',
    kind: 'approve',
    label: 'Human review',
    group: 'Select & rank',
    detail: 'RevOps gate before publishing to reps'
  },

  // —— People & play ——
  {
    id: 'primary_contact',
    kind: 'map',
    label: 'Primary contact pick',
    group: 'People & play',
    detail: 'Buyer, economic buyer, or last-engaged contact'
  },
  {
    id: 'enrich',
    kind: 'enrich',
    label: 'Enrich phone / email',
    group: 'People & play',
    detail: 'Fill missing channels after the list is selected'
  },
  {
    id: 'talk_track',
    kind: 'enrich',
    label: 'Talk track / script',
    group: 'People & play',
    detail: 'Deal-aware script and talking points for the rep'
  },
  {
    id: 'sequence',
    kind: 'action',
    label: 'Sequence / cadence',
    group: 'People & play',
    detail: 'Email + call steps for the outbound motion'
  },
  {
    id: 'field_map',
    kind: 'map',
    label: 'Field map',
    group: 'People & play',
    detail: 'Bind provider fields to CRM properties'
  },

  // —— Rep surfaces ——
  {
    id: 'priority_queue',
    kind: 'surface',
    label: 'Priority queue',
    group: 'Rep surfaces',
    detail: 'Ordered account/deal list — the rep home screen'
  },
  {
    id: 'account_workspace',
    kind: 'surface',
    label: 'Account workspace',
    group: 'Rep surfaces',
    detail: 'Deal, stakeholders, and next action in one place'
  },
  {
    id: 'dial',
    kind: 'surface',
    label: 'Dial console',
    group: 'Rep surfaces',
    detail: 'Call from the queue with script beside the line'
  },
  {
    id: 'email_compose',
    kind: 'surface',
    label: 'Email compose',
    group: 'Rep surfaces',
    detail: 'Send from the same tool without leaving the queue'
  },
  {
    id: 'disposition',
    kind: 'surface',
    label: 'Disposition / notes',
    group: 'Rep surfaces',
    detail: 'Capture outcome and next step mid-motion'
  },
  {
    id: 'dashboard',
    kind: 'surface',
    label: 'Team dashboard',
    group: 'Rep surfaces',
    detail: 'Coverage and progress for managers'
  },

  // —— Actions ——
  {
    id: 'log_activity',
    kind: 'writeback',
    label: 'Log activity',
    group: 'Actions',
    detail: 'Write call/email activity back to the CRM'
  },
  {
    id: 'update_deal',
    kind: 'writeback',
    label: 'Update deal fields',
    group: 'Actions',
    detail: 'Stage, next step, close date from the tool'
  },
  {
    id: 'enroll_sequence',
    kind: 'action',
    label: 'Enroll in sequence',
    group: 'Actions',
    detail: 'Kick off the cadence for selected contacts'
  },
  {
    id: 'notify',
    kind: 'action',
    label: 'Notify',
    group: 'Actions',
    detail: 'Slack or email when a high-score account needs attention'
  }
]

export function defaultBoardForKind(kind: string): BoardNode[] {
  const base = (items: Array<Omit<BoardNode, 'id' | 'x' | 'y'>>): BoardNode[] =>
    items.map((item, i) => ({
      ...item,
      id: `node_${kind}_${i}_${item.kind}`,
      x: 48 + (i % 3) * 200,
      y: 48 + Math.floor(i / 3) * 120
    }))

  if (kind === 'today' || kind === 'list') {
    return base([
      { kind: 'source', label: 'CRM deals' },
      { kind: 'filter', label: 'Close-window filter' },
      { kind: 'score', label: 'Likelihood score' },
      { kind: 'surface', label: 'Priority queue' }
    ])
  }
  if (kind === 'dialer') {
    return base([
      { kind: 'source', label: 'CRM accounts' },
      { kind: 'score', label: 'Likelihood score' },
      { kind: 'map', label: 'Primary contact pick' },
      { kind: 'surface', label: 'Dial console' }
    ])
  }
  if (kind === 'sequencer' || kind === 'cadence') {
    return base([
      { kind: 'source', label: 'CRM contacts' },
      { kind: 'filter', label: 'Owner filter' },
      { kind: 'action', label: 'Sequence / cadence' },
      { kind: 'surface', label: 'Priority queue' }
    ])
  }
  return []
}

const storageKey = (projectId: string) => `jargon.board.${projectId}`

export function loadBoard(projectId: string, kind: string): BoardNode[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (raw) {
      const parsed = JSON.parse(raw) as BoardNode[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    /* ignore */
  }
  return defaultBoardForKind(kind)
}

export function saveBoard(projectId: string, nodes: BoardNode[]): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(nodes))
  } catch {
    /* ignore */
  }
}

export const PALETTE_MIME = 'application/jargon-palette'
export const NODE_MIME = 'application/jargon-node'
