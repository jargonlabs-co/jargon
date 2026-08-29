import { BOARD_PALETTE, type BoardNode, type LibraryGroup, type PaletteItem } from './board'
import { insertNodeAtStage, nodeStage, sortNodesByPipeline } from './pipelineLayout'

function stampNode(item: PaletteItem, index?: number): BoardNode {
  const suffix =
    index !== undefined
      ? `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`
      : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  return {
    id: `node_${suffix}`,
    kind: item.kind,
    label: item.label,
    paletteId: item.id,
    x: 0,
    y: 0
  }
}

/** Order nodes by pipeline stage (context → rep surfaces → actions). */
export function layoutFlowHorizontally(nodes: BoardNode[], canvasHeight = 480): BoardNode[] {
  void canvasHeight
  return sortNodesByPipeline(nodes)
}

/** @deprecated use layoutFlowHorizontally */
export function layoutFlowVertically(nodes: BoardNode[], canvasWidth = 640): BoardNode[] {
  void canvasWidth
  return layoutFlowHorizontally(nodes)
}

/** Sort by column order then reflow as pipeline. */
export function reflowByPosition(nodes: BoardNode[], canvasHeight = 480): BoardNode[] {
  void canvasHeight
  const sorted = [...nodes].sort((a, b) => a.x - b.x || a.y - b.y)
  return layoutFlowHorizontally(sorted)
}

/** Insert a palette block into the pipeline (optionally into a specific stage). */
export function insertIntoFlow(
  nodes: BoardNode[],
  item: PaletteItem,
  _dropX?: number,
  canvasHeight = 480,
  stage?: LibraryGroup
): BoardNode[] {
  void _dropX
  void canvasHeight
  const node = stampNode(item)
  const target = stage ?? nodeStage(node)
  return insertNodeAtStage(nodes, node, target)
}

export function appendNodes(nodes: BoardNode[], items: PaletteItem[]): BoardNode[] {
  let next = [...nodes]
  for (const [i, item] of items.entries()) {
    const node = stampNode(item, i)
    next = insertNodeAtStage(next, node, nodeStage(node))
  }
  return next
}

export function appendToFlow(
  nodes: BoardNode[],
  items: PaletteItem[],
  canvasHeight = 480,
  replace = false
): BoardNode[] {
  void canvasHeight
  const base = replace ? [] : sortNodesByPipeline(nodes)
  return appendNodes(base, items)
}

export interface PromptBoardPlan {
  summary: string
  items: PaletteItem[]
  replace?: boolean
}

function findById(id: string): PaletteItem | undefined {
  return BOARD_PALETTE.find((p) => p.id === id)
}

function pushUnique(list: PaletteItem[], id: string) {
  const item = findById(id)
  if (!item) return
  if (!list.some((x) => x.id === item.id)) list.push(item)
}

function chain(ids: string[]): PaletteItem[] {
  const items: PaletteItem[] = []
  for (const id of ids) pushUnique(items, id)
  return items
}

/** Guiding-light tool: outbound for accounts most likely to close soon. */
function closeLikelihoodOutboundTool(): PaletteItem[] {
  return chain([
    'crm_deals',
    'close_window',
    'likelihood',
    'rank_top',
    'dedupe_accounts',
    'primary_contact',
    'talk_track',
    'priority_queue',
    'account_workspace',
    'dial',
    'email_compose',
    'disposition',
    'log_activity',
    'update_deal'
  ])
}

/** Regional account sequencer: find contacts across assigned accounts and run outbound per rep. */
function regionalOutboundSequencerTool(): PaletteItem[] {
  return chain([
    'crm_accounts',
    'crm_contacts',
    'owner_territory',
    'owner_filter',
    'dedupe_accounts',
    'primary_contact',
    'enrich',
    'sequence',
    'talk_track',
    'priority_queue',
    'account_workspace',
    'dial',
    'email_compose',
    'disposition',
    'enroll_sequence',
    'log_activity',
    'notify'
  ])
}

function enrichmentReviewTool(): PaletteItem[] {
  return chain([
    'crm_contacts',
    'enrich',
    'field_map',
    'approve',
    'priority_queue',
    'log_activity'
  ])
}

function isBuildIntent(text: string): boolean {
  return /(?:create|build|make|scaffold|generate|set up|setup|compose|publish).{0,60}(?:tool|board|console|queue|surface|workflow|pipeline|outbound)/i.test(
    text
  )
}

function isCloseLikelihoodOutbound(lower: string): boolean {
  const hasCloseWindow =
    /(?:next\s+)?\d+\s*days?/.test(lower) ||
    /closing|close(?:\s+date)?|close[- ]window|likely to close|most likely/.test(lower)
  const hasOutboundOrReps =
    /outbound|reps?|sales(?:people| team)?|account(?:s)?|deals?|pipeline|renewal/.test(lower)
  const hasToolIntent =
    /tool|board|queue|console|workspace|build|create|compose|scaffold/.test(lower)
  return (hasCloseWindow && hasOutboundOrReps) || (hasCloseWindow && hasToolIntent)
}

function isRegionalOutboundSequencer(lower: string): boolean {
  const hasSequencer =
    /sequenc|cadence|outreach flow|outbound flow|outreach sequencer|outbound sequencer/.test(
      lower
    )
  const hasAccounts =
    /account|assigned|territory|region|book of business|every assigned/.test(lower)
  const hasContacts = /contact|people|prospect|buyer|right contact/.test(lower)
  const hasTeamScope = /team|region|territory|rep|mid[- ]market|atlanta|assigned/.test(lower)
  const hasBuildIntent = /build|create|scaffold|compose|set up|setup|find the right/.test(lower)
  return hasSequencer && hasAccounts && hasContacts && hasTeamScope && hasBuildIntent
}

/** Rule-based NL → palette blocks (no backend required). */
export function promptToBoardPlan(prompt: string): PromptBoardPlan {
  const text = prompt.trim()
  const lower = text.toLowerCase()

  const wantsReplace =
    isBuildIntent(text) ||
    isCloseLikelihoodOutbound(lower) ||
    isRegionalOutboundSequencer(lower) ||
    /start over|replace|clear board|from scratch|rebuild/.test(lower)

  // Regional account sequencer (e.g. mid-market Atlanta team)
  if (isRegionalOutboundSequencer(lower)) {
    const items = regionalOutboundSequencerTool()
    return {
      summary: `Scaffolded regional outbound sequencer: ${items.map((i) => i.label).join(' → ')}.`,
      items,
      replace: true
    }
  }

  // Primary guiding light
  if (isCloseLikelihoodOutbound(lower)) {
    const items = closeLikelihoodOutboundTool()
    return {
      summary: `Scaffolded close-likelihood outbound tool: ${items.map((i) => i.label).join(' → ')}.`,
      items,
      replace: true
    }
  }

  // Enrichment / approval style tools
  if (
    /crm\s+enrichment|enrichment\s+(?:workflow|pipeline|tool)|missing titles?|approval queue/.test(
      lower
    )
  ) {
    const items = enrichmentReviewTool()
    return {
      summary: `Scaffolded enrichment review tool: ${items.map((i) => i.label).join(' → ')}.`,
      items,
      replace: true
    }
  }

  const items: PaletteItem[] = []

  const wantsDeals = /deal|opportunit|pipeline|close date/.test(lower)
  const wantsAccounts = /account/.test(lower)
  const wantsContacts = /contact|people|leads?/.test(lower)
  const wantsOwner = /owner|territory|my book|my accounts/.test(lower)
  const wantsEngagement = /engagement|gong|last (?:call|email|meeting)/.test(lower)
  const wantsCsv = /csv|warehouse|spreadsheet|upload/.test(lower)

  const wantsCloseWindow = /(?:\d+\s*days?)|close[- ]window|closing (?:in|within)/.test(lower)
  const wantsLikelihood = /likelihood|likely|probability|most likely|priorit/.test(lower)
  const wantsRank = /rank|top\s+\d+|cap /.test(lower)
  const wantsDedupe = /dedup|one (?:row|account) per/.test(lower)
  const wantsApprove = /approv|human review|revops gate/.test(lower)

  const wantsPrimary = /primary contact|buyer|economic buyer/.test(lower)
  const wantsEnrich = /enrich|missing (?:phone|email|title)/.test(lower)
  const wantsTalk = /talk track|script|talking points/.test(lower)
  const wantsSequence = /sequence|cadence|drip/.test(lower)
  const wantsFieldMap = /field map|map fields|property map/.test(lower)

  const wantsQueue = /priority queue|queue|today/.test(lower)
  const wantsWorkspace = /account workspace|account prep|account board/.test(lower)
  const wantsDial = /dial|call console|softphone/.test(lower)
  const wantsEmail = /email compose|send email|gmail/.test(lower)
  const wantsDisposition = /disposition|notes|outcome/.test(lower)
  const wantsDashboard = /dashboard|coverage|manager/.test(lower)

  const wantsLog = /log activity|activity log/.test(lower)
  const wantsUpdateDeal = /update deal|stage|write.?back|writeback/.test(lower)
  const wantsEnroll = /enroll/.test(lower)
  const wantsNotify = /notify|slack|alert/.test(lower)

  if (wantsDeals) pushUnique(items, 'crm_deals')
  if (wantsAccounts) pushUnique(items, 'crm_accounts')
  if (wantsContacts) pushUnique(items, 'crm_contacts')
  if (wantsOwner) pushUnique(items, 'owner_territory')
  if (wantsEngagement) pushUnique(items, 'engagement')
  if (wantsCsv) pushUnique(items, 'csv')

  if (wantsCloseWindow) pushUnique(items, 'close_window')
  if (wantsLikelihood) pushUnique(items, 'likelihood')
  if (wantsRank) pushUnique(items, 'rank_top')
  if (wantsOwner && wantsCloseWindow) pushUnique(items, 'owner_filter')
  if (wantsDedupe || (wantsAccounts && wantsDeals)) pushUnique(items, 'dedupe_accounts')
  if (wantsApprove) pushUnique(items, 'approve')

  if (wantsPrimary) pushUnique(items, 'primary_contact')
  if (wantsEnrich) pushUnique(items, 'enrich')
  if (wantsTalk) pushUnique(items, 'talk_track')
  if (wantsSequence) pushUnique(items, 'sequence')
  if (wantsFieldMap) pushUnique(items, 'field_map')

  if (wantsQueue) pushUnique(items, 'priority_queue')
  if (wantsWorkspace) pushUnique(items, 'account_workspace')
  if (wantsDial) pushUnique(items, 'dial')
  if (wantsEmail) pushUnique(items, 'email_compose')
  if (wantsDisposition) pushUnique(items, 'disposition')
  if (wantsDashboard) pushUnique(items, 'dashboard')

  if (wantsLog) pushUnique(items, 'log_activity')
  if (wantsUpdateDeal) pushUnique(items, 'update_deal')
  if (wantsEnroll) pushUnique(items, 'enroll_sequence')
  if (wantsNotify) pushUnique(items, 'notify')

  if (items.length === 0) {
    if (isBuildIntent(text) || /tool|outbound|reps?|board|queue/.test(lower) || text.length > 12) {
      const starter = closeLikelihoodOutboundTool()
      return {
        summary: `Scaffolded close-likelihood outbound tool from “${truncate(text)}”.`,
        items: starter,
        replace: wantsReplace
      }
    }
    return {
      summary:
        'Try “Build an outbound tool for reps for the accounts most likely to close in the next 90 days”.',
      items: []
    }
  }

  const labels = items.map((i) => i.label).join(' → ')
  return {
    summary: wantsReplace ? `Built tool: ${labels}.` : `Added: ${labels}.`,
    items,
    replace: wantsReplace
  }
}

function truncate(value: string, max = 64): string {
  const t = value.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
