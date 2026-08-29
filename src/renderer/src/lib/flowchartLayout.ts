import type { BoardNode } from './board'

export const FLOW_NODE_WIDTH = 220
export const FLOW_NODE_HEIGHT = 72
export const FLOW_GAP = 28
export const FLOW_START = 40

export type FlowShape = 'rect' | 'diamond'

export interface FlowchartNode extends BoardNode {
  shape: FlowShape
  col: number
  row: number
}

export interface FlowchartSkip {
  id: string
  x: number
  y: number
  label: string
  parentId: string
}

export type FlowEdgeVariant = 'straight' | 'branch-yes' | 'branch-no' | 'merge'

export interface FlowchartEdge {
  id: string
  from: string
  to: string
  label?: string
  variant: FlowEdgeVariant
}

export interface FlowchartLayout {
  nodes: FlowchartNode[]
  skips: FlowchartSkip[]
  edges: FlowchartEdge[]
  width: number
  height: number
}

const COL_W = FLOW_NODE_WIDTH + FLOW_GAP + 48
const ROW_H = FLOW_NODE_HEIGHT + 36
const TRUNK_Y = 148
const DIAMOND = 108

export function isConditionalNode(node: BoardNode): boolean {
  return node.kind === 'filter' || node.kind === 'score' || node.kind === 'approve'
}

export function branchLabels(node: BoardNode): { yes: string; no: string } {
  if (node.kind === 'approve') return { yes: 'Approved', no: 'Rejected' }
  if (node.kind === 'score') return { yes: 'Above threshold', no: 'Below threshold' }
  return { yes: 'Match', no: 'No match' }
}

function nodeSize(shape: FlowShape): { w: number; h: number } {
  return shape === 'diamond' ? { w: DIAMOND, h: DIAMOND } : { w: FLOW_NODE_WIDTH, h: FLOW_NODE_HEIGHT }
}

export function nodeAnchor(
  node: FlowchartNode | FlowchartSkip,
  shape: FlowShape = 'rect'
): {
  left: number
  top: number
  w: number
  h: number
  cx: number
  cy: number
  right: number
  bottom: number
} {
  const isSkip = 'parentId' in node
  const w = isSkip ? 120 : nodeSize(shape).w
  const h = isSkip ? 36 : nodeSize(shape).h
  return {
    left: node.x,
    top: node.y,
    w,
    h,
    cx: node.x + w / 2,
    cy: node.y + h / 2,
    right: node.x + w,
    bottom: node.y + h
  }
}

/** Assign lanes + columns, then compute pixel positions and flow edges. */
export function layoutFlowchart(ordered: BoardNode[]): FlowchartLayout {
  if (!ordered.length) {
    return { nodes: [], skips: [], edges: [], width: 960, height: 420 }
  }

  const nodes: FlowchartNode[] = []
  const skips: FlowchartSkip[] = []
  const edges: FlowchartEdge[] = []
  const consumed = new Set<number>()

  let col = 0
  let pendingMerge: { yesId: string; skipId: string; mergeCol: number } | null = null

  for (let i = 0; i < ordered.length; i++) {
    if (consumed.has(i)) continue
    const node = ordered[i]

    if (pendingMerge && col >= pendingMerge.mergeCol) {
      edges.push({
        id: `merge_yes_${pendingMerge.yesId}_${node.id}`,
        from: pendingMerge.yesId,
        to: node.id,
        variant: 'merge'
      })
      edges.push({
        id: `merge_skip_${pendingMerge.skipId}_${node.id}`,
        from: pendingMerge.skipId,
        to: node.id,
        variant: 'merge'
      })
      pendingMerge = null
    }

    if (isConditionalNode(node)) {
      const labels = branchLabels(node)
      const yesIdx = i + 1
      const hasYes = yesIdx < ordered.length && !consumed.has(yesIdx)

      nodes.push({
        ...node,
        x: 0,
        y: 0,
        col,
        row: 0,
        shape: 'diamond'
      })

      if (i > 0 && !consumed.has(i - 1)) {
        const prev = ordered[i - 1]
        edges.push({
          id: `${prev.id}_${node.id}`,
          from: prev.id,
          to: node.id,
          variant: 'straight'
        })
      }

      const skipId = `skip_${node.id}`
      skips.push({
        id: skipId,
        x: 0,
        y: 0,
        label: labels.no,
        parentId: node.id
      })

      edges.push({
        id: `${node.id}_${skipId}`,
        from: node.id,
        to: skipId,
        label: labels.no,
        variant: 'branch-no'
      })

      if (hasYes) {
        consumed.add(yesIdx)
        const yesNode = ordered[yesIdx]
        nodes.push({
          ...yesNode,
          x: 0,
          y: 0,
          col: col + 1,
          row: -1,
          shape: isConditionalNode(yesNode) ? 'diamond' : 'rect'
        })
        edges.push({
          id: `${node.id}_${yesNode.id}`,
          from: node.id,
          to: yesNode.id,
          label: labels.yes,
          variant: 'branch-yes'
        })
        pendingMerge = { yesId: yesNode.id, skipId, mergeCol: col + 2 }
        col += 2
      } else {
        col += 1
      }
      continue
    }

    nodes.push({
      ...node,
      x: 0,
      y: 0,
      col,
      row: 0,
      shape: 'rect'
    })

    if (i > 0 && !consumed.has(i - 1)) {
      const prev = ordered[i - 1]
      if (!isConditionalNode(prev)) {
        edges.push({
          id: `${prev.id}_${node.id}`,
          from: prev.id,
          to: node.id,
          variant: 'straight'
        })
      }
    }

    col += 1
  }

  for (const n of nodes) {
    n.x = FLOW_START + n.col * COL_W + (n.shape === 'diamond' ? (FLOW_NODE_WIDTH - DIAMOND) / 2 : 0)
    n.y = TRUNK_Y + n.row * ROW_H + (n.shape === 'diamond' ? (FLOW_NODE_HEIGHT - DIAMOND) / 2 : 0)
  }

  for (const skip of skips) {
    const parent = nodes.find((n) => n.id === skip.parentId)
    if (!parent) continue
    skip.x = FLOW_START + (parent.col + 1) * COL_W + 24
    skip.y = TRUNK_Y + ROW_H - 8
  }

  const maxCol = Math.max(
    0,
    ...nodes.map((n) => n.col),
    ...skips.map((s) => {
      const parent = nodes.find((n) => n.id === s.parentId)
      return parent ? parent.col + 1 : 0
    })
  )

  return {
    nodes,
    skips,
    edges,
    width: FLOW_START + (maxCol + 2) * COL_W + 80,
    height: TRUNK_Y + ROW_H * 2 + FLOW_NODE_HEIGHT + 80
  }
}

export function applyFlowchartLayout(ordered: BoardNode[]): BoardNode[] {
  const layout = layoutFlowchart(ordered)
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  return ordered.map((n) => {
    const placed = byId.get(n.id)
    return placed ? { ...n, x: placed.x, y: placed.y } : n
  })
}

/** Simple left-to-right row used while blocks are still animating in. */
export function layoutFlowLinear(ordered: BoardNode[]): FlowchartLayout {
  if (!ordered.length) {
    return { nodes: [], skips: [], edges: [], width: 960, height: 420 }
  }

  const nodes: FlowchartNode[] = ordered.map((node, index) => ({
    ...node,
    x: FLOW_START + index * (FLOW_NODE_WIDTH + FLOW_GAP),
    y: TRUNK_Y,
    col: index,
    row: 0,
    shape: isConditionalNode(node) ? 'diamond' : 'rect'
  }))

  const edges: FlowchartEdge[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `${nodes[i].id}_${nodes[i + 1].id}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
      variant: 'straight'
    })
  }

  return {
    nodes,
    skips: [],
    edges,
    width: FLOW_START + nodes.length * (FLOW_NODE_WIDTH + FLOW_GAP) + 80,
    height: TRUNK_Y + FLOW_NODE_HEIGHT + 120
  }
}

export function edgePath(
  layout: FlowchartLayout,
  edge: FlowchartEdge
): { d: string; labelX: number; labelY: number } | null {
  const fromNode = layout.nodes.find((n) => n.id === edge.from)
  const toNode =
    layout.nodes.find((n) => n.id === edge.to) ?? layout.skips.find((s) => s.id === edge.to)
  if (!fromNode || !toNode) return null

  const fromShape = fromNode.shape
  const toShape = 'parentId' in toNode ? 'rect' : (toNode as FlowchartNode).shape
  const a = nodeAnchor(fromNode, fromShape)
  const b = nodeAnchor(toNode as FlowchartNode | FlowchartSkip, toShape)

  if (edge.variant === 'straight') {
    const y = a.cy
    const d = `M ${a.right} ${y} H ${b.left}`
    return { d, labelX: (a.right + b.left) / 2, labelY: y - 10 }
  }

  if (edge.variant === 'branch-yes') {
    const midX = a.right + 28
    const d = `M ${a.right} ${a.cy} H ${midX} V ${b.cy} H ${b.left}`
    return { d, labelX: midX + 6, labelY: (a.cy + b.cy) / 2 - 8 }
  }

  if (edge.variant === 'branch-no') {
    const midX = a.right + 28
    const d = `M ${a.right} ${a.cy} H ${midX} V ${b.cy} H ${b.left}`
    return { d, labelX: midX + 6, labelY: (a.cy + b.cy) / 2 + 14 }
  }

  const mergeX = b.left - 36
  const d = `M ${a.right} ${a.cy} H ${mergeX} V ${b.cy} H ${b.left}`
  return { d, labelX: mergeX - 4, labelY: (a.cy + b.cy) / 2 }
}
