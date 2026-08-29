import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { api, type PreviewCommentPublic } from '../api/client'
import { readShareTokenFromHash, sharedPayloadToBundle } from '../lib/sharedPreview'
import {
  commentInitials,
  groupCommentThreads,
  normalizePin,
  orphanComments,
  type CommentThread
} from '../lib/shareComments'
import { ToolWorkspacePage } from '../components/workspace/pages/ToolWorkspacePage'

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

interface DraftPin {
  pinX: number
  pinY: number
}

export function SharePreviewApp() {
  const token = useMemo(() => readShareTokenFromHash(), [])
  const canvasRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState<PreviewCommentPublic[]>([])
  const [shareLabel, setShareLabel] = useState('Shared preview')
  const [bundle, setBundle] = useState<ReturnType<typeof sharedPayloadToBundle> | null>(null)
  const [authorName, setAuthorName] = useState(() => localStorage.getItem('jargon.share.name') ?? '')
  const [authorEmail, setAuthorEmail] = useState(() => localStorage.getItem('jargon.share.email') ?? '')
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [commentMode, setCommentMode] = useState(false)
  const [draftPin, setDraftPin] = useState<DraftPin | null>(null)
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [localPins, setLocalPins] = useState<Record<string, DraftPin>>({})

  const commentsWithPins = useMemo(
    () =>
      comments.map((comment) => {
        if (comment.parentId || (comment.pinX != null && comment.pinY != null)) return comment
        const fallback = localPins[comment.id]
        if (!fallback) return comment
        return { ...comment, pinX: fallback.pinX, pinY: fallback.pinY }
      }),
    [comments, localPins]
  )
  const threads = useMemo(() => groupCommentThreads(commentsWithPins), [commentsWithPins])
  const legacyComments = useMemo(() => orphanComments(commentsWithPins), [commentsWithPins])

  useEffect(() => {
    if (!token) {
      setError('Missing share link token.')
      setLoading(false)
      return
    }
    void api
      .getSharedPreview(token)
      .then((payload) => {
        setBundle(sharedPayloadToBundle(payload))
        setComments(payload.comments)
        setLocalPins(
          Object.fromEntries(
            payload.comments
              .filter((c) => !c.parentId && c.pinX != null && c.pinY != null)
              .map((c) => [c.id, { pinX: c.pinX!, pinY: c.pinY! }])
          )
        )
        setShareLabel(payload.share.label)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load preview')
      })
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  function toggleThread(threadId: string) {
    setExpandedThreadId((current) => (current === threadId ? null : threadId))
    setDraftPin(null)
    setCommentMode(false)
    setBody('')
  }

  function closeExpanded() {
    setExpandedThreadId(null)
    setBody('')
  }

  function onCanvasClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('.comment-pin-stack, .comment-compose-popover')) return

    if (commentMode && !posting) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      setDraftPin(normalizePin(e.clientX, e.clientY, rect))
      setExpandedThreadId(null)
      setBody('')
      return
    }

    closeExpanded()
    setDraftPin(null)
  }

  async function submitComment(e: FormEvent, opts?: { parentId?: string; pin?: DraftPin }) {
    e.preventDefault()
    if (!token || posting) return
    setPosting(true)
    try {
      localStorage.setItem('jargon.share.name', authorName.trim())
      localStorage.setItem('jargon.share.email', authorEmail.trim())
      const comment = await api.postShareComment(token, {
        authorName,
        authorEmail: authorEmail.trim() || undefined,
        body,
        parentId: opts?.parentId,
        pinX: opts?.pin?.pinX,
        pinY: opts?.pin?.pinY
      })
      const saved: PreviewCommentPublic = {
        ...comment,
        pinX: comment.pinX ?? opts?.pin?.pinX,
        pinY: comment.pinY ?? opts?.pin?.pinY
      }
      if (!opts?.parentId && saved.pinX != null && saved.pinY != null) {
        setLocalPins((prev) => ({
          ...prev,
          [saved.id]: { pinX: saved.pinX!, pinY: saved.pinY! }
        }))
      }
      setComments((prev) => [...prev, saved])
      setBody('')
      setDraftPin(null)
      setCommentMode(false)
      setExpandedThreadId(opts?.parentId ?? null)
      setToast('Comment posted')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not post comment')
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <div className="share-preview-shell">
        <div className="share-preview-loading">Loading preview…</div>
      </div>
    )
  }

  if (error || !bundle) {
    return (
      <div className="share-preview-shell">
        <div className="share-preview-error">
          <h1>Preview unavailable</h1>
          <p>{error ?? 'This link may have expired or been revoked.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="share-preview-shell">
      <header className="share-preview-header">
        <div>
          <p className="share-preview-kicker">Jargon · rep preview</p>
          <h1>{bundle.project.name}</h1>
          <p>{shareLabel}</p>
        </div>
        <button
          type="button"
          className={commentMode ? 'comment-mode-toggle active' : 'comment-mode-toggle'}
          onClick={() => {
            setCommentMode((v) => !v)
            setDraftPin(null)
            closeExpanded()
          }}
        >
          {commentMode ? 'Click anywhere to comment' : 'Add comment'}
        </button>
      </header>

      <div className="share-preview-layout share-preview-layout-comments">
        <main className="share-preview-main board-alt-view">
          <div
            ref={canvasRef}
            className={`share-comment-canvas ${commentMode ? 'comment-mode' : ''}`}
            onClick={onCanvasClick}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement
              if (target.closest('.comment-pin-stack, .comment-compose-popover')) {
                e.stopPropagation()
              }
            }}
          >
            <ToolWorkspacePage bundle={bundle} readOnly />

            {threads.map((thread) => (
              <CommentPinStack
                key={thread.root.id}
                thread={thread}
                expanded={expandedThreadId === thread.root.id}
                authorName={authorName}
                authorEmail={authorEmail}
                body={body}
                posting={posting}
                onToggle={() => toggleThread(thread.root.id)}
                onClose={closeExpanded}
                onAuthorNameChange={setAuthorName}
                onAuthorEmailChange={setAuthorEmail}
                onBodyChange={setBody}
                onSubmitReply={(e) => void submitComment(e, { parentId: thread.root.id })}
              />
            ))}

            {draftPin ? (
              <CommentComposePopover
                pin={draftPin}
                authorName={authorName}
                authorEmail={authorEmail}
                body={body}
                posting={posting}
                onAuthorNameChange={setAuthorName}
                onAuthorEmailChange={setAuthorEmail}
                onBodyChange={setBody}
                onCancel={() => setDraftPin(null)}
                onSubmit={(e) => void submitComment(e, { pin: draftPin })}
              />
            ) : null}
          </div>
        </main>

        <aside className="share-feedback-panel share-comment-sidebar">
          <div className="share-feedback-title">Comments</div>
          <p className="share-feedback-lede">
            {threads.length > 0
              ? `${threads.length} pinned on the preview — click a dot to open.`
              : 'No comments yet. Add comment, then click the preview.'}
          </p>

          <div className="share-comment-thread-list">
            {threads.map((thread) => {
              const count = thread.replies.length + 1
              return (
                <button
                  key={thread.root.id}
                  type="button"
                  className={
                    expandedThreadId === thread.root.id
                      ? 'share-comment-thread-card active'
                      : 'share-comment-thread-card'
                  }
                  onClick={() => toggleThread(thread.root.id)}
                >
                  <span className="comment-marker comment-marker-list" aria-hidden="true" />
                  <div>
                    <strong>{thread.root.authorName}</strong>
                    <span className="share-comment-thread-meta">
                      {count} message{count === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>
              )
            })}
            {legacyComments.map((c) => (
              <article key={c.id} className="share-feedback-item legacy">
                <header>
                  <strong>{c.authorName}</strong>
                  <span>{formatWhen(c.createdAt)}</span>
                </header>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>

      {toast ? <div className="share-preview-toast">{toast}</div> : null}
    </div>
  )
}

function CommentPinStack({
  thread,
  expanded,
  authorName,
  authorEmail,
  body,
  posting,
  onToggle,
  onClose,
  onAuthorNameChange,
  onAuthorEmailChange,
  onBodyChange,
  onSubmitReply
}: {
  thread: CommentThread
  expanded: boolean
  authorName: string
  authorEmail: string
  body: string
  posting: boolean
  onToggle: () => void
  onClose: () => void
  onAuthorNameChange: (v: string) => void
  onAuthorEmailChange: (v: string) => void
  onBodyChange: (v: string) => void
  onSubmitReply: (e: FormEvent) => void
}) {
  const messages = [thread.root, ...thread.replies]
  const replyCount = thread.replies.length

  return (
    <div
      className={`comment-pin-stack ${expanded ? 'expanded' : ''}`}
      style={{ left: `${thread.pinX * 100}%`, top: `${thread.pinY * 100}%` }}
    >
      <button
        type="button"
        className="comment-marker"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        aria-label={`Comment by ${thread.root.authorName}${replyCount ? `, ${replyCount + 1} messages` : ''}`}
        aria-expanded={expanded}
      >
        <span className="comment-marker-dot" />
        {replyCount > 0 ? <span className="comment-marker-badge">{replyCount + 1}</span> : null}
      </button>

      {expanded ? (
        <div
          className="comment-thread-popover"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="comment-thread-popover-header">
            <span className="comment-thread-popover-initials">{commentInitials(thread.root.authorName)}</span>
            <div>
              <strong>{thread.root.authorName}</strong>
              <span>{formatWhen(thread.root.createdAt)}</span>
            </div>
            <button type="button" className="comment-thread-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="comment-thread-popover-messages">
            {messages.map((msg) => (
              <article key={msg.id} className="comment-thread-popover-message">
                <header>
                  <strong>{msg.authorName}</strong>
                  <span>{formatWhen(msg.createdAt)}</span>
                </header>
                <p>{msg.body}</p>
              </article>
            ))}
          </div>

          <form className="comment-thread-reply-form" onSubmit={onSubmitReply}>
            <textarea
              rows={2}
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Reply…"
              required
            />
            <div className="comment-thread-reply-actions">
              <input
                value={authorName}
                onChange={(e) => onAuthorNameChange(e.target.value)}
                placeholder="Your name"
                required
              />
              <button type="submit" className="prod-btn primary compact" disabled={posting}>
                {posting ? '…' : 'Reply'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

function CommentComposePopover({
  pin,
  authorName,
  authorEmail,
  body,
  posting,
  onAuthorNameChange,
  onAuthorEmailChange,
  onBodyChange,
  onCancel,
  onSubmit
}: {
  pin: DraftPin
  authorName: string
  authorEmail: string
  body: string
  posting: boolean
  onAuthorNameChange: (v: string) => void
  onAuthorEmailChange: (v: string) => void
  onBodyChange: (v: string) => void
  onCancel: () => void
  onSubmit: (e: FormEvent) => void
}) {
  return (
    <div
      className="comment-pin-stack draft expanded"
      style={{ left: `${pin.pinX * 100}%`, top: `${pin.pinY * 100}%` }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="comment-marker comment-marker-draft" aria-hidden="true">
        <span className="comment-marker-dot" />
      </span>
      <div className="comment-compose-popover comment-thread-popover">
        <div className="comment-thread-popover-header">
          <strong>New comment</strong>
          <button type="button" className="comment-thread-close" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="comment-popover-form" onSubmit={onSubmit}>
          <textarea
            rows={3}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="Leave a comment…"
            required
            autoFocus
          />
          <input
            value={authorName}
            onChange={(e) => onAuthorNameChange(e.target.value)}
            placeholder="Your name"
            required
          />
          <input
            type="email"
            value={authorEmail}
            onChange={(e) => onAuthorEmailChange(e.target.value)}
            placeholder="Email (optional)"
          />
          <div className="comment-popover-actions">
            <button type="button" className="ghost-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="prod-btn primary compact" disabled={posting}>
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
