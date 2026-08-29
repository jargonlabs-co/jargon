import type { PreviewCommentPublic } from '../api/client'

export interface CommentThread {
  root: PreviewCommentPublic
  replies: PreviewCommentPublic[]
  pinX: number
  pinY: number
}

export function commentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || '?'
}

export function groupCommentThreads(comments: PreviewCommentPublic[]): CommentThread[] {
  const roots = comments.filter(
    (c) => !c.parentId && typeof c.pinX === 'number' && typeof c.pinY === 'number'
  )
  const byParent = new Map<string, PreviewCommentPublic[]>()

  for (const c of comments) {
    if (!c.parentId) continue
    const list = byParent.get(c.parentId) ?? []
    list.push(c)
    byParent.set(c.parentId, list)
  }

  return roots
    .map((root) => ({
      root,
      replies: (byParent.get(root.id) ?? []).sort((a, b) => a.createdAt - b.createdAt),
      pinX: root.pinX!,
      pinY: root.pinY!
    }))
    .sort((a, b) => a.root.createdAt - b.root.createdAt)
}

export function orphanComments(comments: PreviewCommentPublic[]): PreviewCommentPublic[] {
  return comments.filter((c) => !c.parentId && (c.pinX == null || c.pinY == null))
}

export function normalizePin(clientX: number, clientY: number, rect: DOMRect): { pinX: number; pinY: number } {
  const pinX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  const pinY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  return { pinX, pinY }
}
