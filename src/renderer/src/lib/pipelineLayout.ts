import { BOARD_PALETTE, LIBRARY_GROUPS, type BoardNode, type LibraryGroup } from './board'

export interface PipelineStageMeta {
  id: LibraryGroup
  title: string
  lede: string
}

export interface PipelineSection {
  stage: LibraryGroup
  meta: PipelineStageMeta
  nodes: BoardNode[]
}

export const PIPELINE_STAGES: PipelineStageMeta[] = [
  {
    id: 'Context',
    title: 'Context',
    lede: 'CRM objects and signals feeding the tool'
  },
  {
    id: 'Select & rank',
    title: 'Select & rank',
    lede: 'Filters, scores, and the prioritized book'
  },
  {
    id: 'People & play',
    title: 'People & play',
    lede: 'Enrichment, contacts, and talk tracks'
  },
  {
    id: 'Rep surfaces',
    title: 'Rep surfaces',
    lede: 'Screens and workflows reps actually use'
  },
  {
    id: 'Actions',
    title: 'Actions',
    lede: 'Writebacks, sequences, and notifications'
  }
]

const stageIndex = new Map(LIBRARY_GROUPS.map((g, i) => [g, i]))

export function nodeStage(node: BoardNode): LibraryGroup {
  if (node.paletteId) {
    const item = BOARD_PALETTE.find((p) => p.id === node.paletteId)
    if (item) return item.group
  }
  switch (node.kind) {
    case 'source':
      return 'Context'
    case 'filter':
    case 'score':
    case 'approve':
      return 'Select & rank'
    case 'enrich':
    case 'map':
      return 'People & play'
    case 'surface':
      return 'Rep surfaces'
    default:
      return 'Actions'
  }
}

/** Keep nodes grouped by pipeline stage; preserve order within each stage. */
export function sortNodesByPipeline(nodes: BoardNode[]): BoardNode[] {
  const tagged = nodes.map((n, index) => ({ n, index }))
  tagged.sort((a, b) => {
    const sa = stageIndex.get(nodeStage(a.n)) ?? 99
    const sb = stageIndex.get(nodeStage(b.n)) ?? 99
    if (sa !== sb) return sa - sb
    return a.index - b.index
  })
  return tagged.map((t) => t.n)
}

export function groupNodesByPipeline(nodes: BoardNode[]): PipelineSection[] {
  const sorted = sortNodesByPipeline(nodes)
  const byStage = new Map<LibraryGroup, BoardNode[]>()
  for (const stage of LIBRARY_GROUPS) byStage.set(stage, [])
  for (const node of sorted) {
    byStage.get(nodeStage(node))!.push(node)
  }
  return PIPELINE_STAGES.map((meta) => ({
    stage: meta.id,
    meta,
    nodes: byStage.get(meta.id) ?? []
  }))
}

export function insertNodeAtStage(
  nodes: BoardNode[],
  node: BoardNode,
  stage: LibraryGroup
): BoardNode[] {
  const before: BoardNode[] = []
  const inStage: BoardNode[] = []
  const after: BoardNode[] = []
  const targetIdx = stageIndex.get(stage) ?? 99

  for (const n of nodes) {
    const idx = stageIndex.get(nodeStage(n)) ?? 99
    if (idx < targetIdx) before.push(n)
    else if (idx === targetIdx) inStage.push(n)
    else after.push(n)
  }

  return [...before, ...inStage, node, ...after]
}
