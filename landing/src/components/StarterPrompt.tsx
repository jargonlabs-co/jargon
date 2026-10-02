import { useState } from 'react'
import { STARTER_PROMPT } from '../lib/chatLaunch'

export function StarterPrompt({
  prompt = STARTER_PROMPT,
  compact = false
}: {
  prompt?: string
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={`starter-prompt${compact ? ' compact' : ''}`}>
      <p>{prompt}</p>
      <button type="button" className="starter-prompt-copy" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy prompt'}
      </button>
    </div>
  )
}
