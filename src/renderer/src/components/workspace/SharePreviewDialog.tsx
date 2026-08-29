import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { normalizeSharePreviewUrl } from '../../lib/sharePreviewUrl'

interface Props {
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function isPreviewUrl(value: string): boolean {
  return /^https?:\/\/.+\/preview\.html/i.test(value)
}

export function SharePreviewDialog({ projectId, projectName, open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setUrl(null)
      setError(null)
      setCopied(false)
      return
    }

    setLoading(true)
    setError(null)
    setUrl(null)

    void (async () => {
      try {
        const health = await fetch(`${window.jargon?.apiBaseUrl ?? 'http://127.0.0.1:8787'}/health`)
        if (health.ok) {
          const body = (await health.json()) as { features?: { sharePreview?: boolean } }
          if (body.features?.sharePreview === false) {
            throw new Error('Share preview is not enabled on this API.')
          }
        }

        const created = await api.createShareLink(projectId, { label: `${projectName} preview` })
        const normalized = normalizeSharePreviewUrl(created.url)
        if (!isPreviewUrl(normalized)) {
          throw new Error('The API returned an invalid preview link. Restart npm run dev and try again.')
        }
        setUrl(normalized)
        await copyText(normalized)
        setCopied(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create share link')
      } finally {
        setLoading(false)
      }
    })()
  }, [open, projectId, projectName])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2400)
    return () => window.clearTimeout(id)
  }, [copied])

  if (!open) return null

  async function onCopy() {
    if (!url) return
    const ok = await copyText(url)
    setCopied(ok)
    if (!ok) inputRef.current?.select()
  }

  return (
    <div className="share-dialog-backdrop" onClick={onClose}>
      <div
        className="share-dialog share-dialog-simple"
        role="dialog"
        aria-labelledby="share-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="share-dialog-header">
          <div>
            <p className="share-dialog-kicker">Share preview</p>
            <h2 id="share-dialog-title">Copy preview link</h2>
            <p className="share-dialog-lede">
              Paste this in your browser to open the rep-facing preview with a feedback panel.
            </p>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="share-dialog-body">
          {loading ? <p className="share-dialog-status">Creating link…</p> : null}
          {error ? <p className="share-dialog-error">{error}</p> : null}

          {url ? (
            <>
              <label className="board-field">
                <span>Preview link</span>
                <div className="share-link-row">
                  <input
                    ref={inputRef}
                    className="share-link-input"
                    value={url}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                  <button type="button" className="prod-btn primary share-copy-btn" onClick={() => void onCopy()}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </label>
              <p className="share-dialog-hint muted">
                Paste in Chrome or Safari — same rep preview for every project, with pinned comments
                (click Add comment, then click the preview). Local dev:{' '}
                <strong>http://127.0.0.1:5173/preview.html</strong>
              </p>
              <div className="share-dialog-actions">
                <button type="button" className="ghost-btn" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
