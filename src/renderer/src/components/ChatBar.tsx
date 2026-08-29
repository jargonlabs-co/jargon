import { useState, type FormEvent, type KeyboardEvent } from 'react'

interface Props {
  disabled?: boolean
  status?: string | null
  placeholder?: string
  hints?: string[]
  onSubmit: (prompt: string) => void
}

export function ChatBar({
  disabled,
  status,
  placeholder = 'Build an outbound tool for reps for accounts most likely to close in 90 days…',
  hints,
  onSubmit
}: Props) {
  const [value, setValue] = useState('')

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    const next = value.trim()
    if (!next || disabled) return
    onSubmit(next)
    setValue('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <form className="chat-bar studio-chat" onSubmit={handleSubmit}>
      {hints && hints.length > 0 ? (
        <div className="chat-bar-hints" aria-label="Example prompts">
          {hints.map((hint) => (
            <button
              key={hint}
              type="button"
              className="chat-bar-hint"
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                onSubmit(hint)
              }}
            >
              {hint}
            </button>
          ))}
        </div>
      ) : null}
      <div className="chat-bar-shell">
        <span className="chat-bar-glyph" aria-hidden="true">
          ✦
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Describe the rep tool to build"
        />
        <button type="submit" className="chat-bar-send" disabled={disabled || !value.trim()}>
          Build
        </button>
      </div>
      {status ? <div className="chat-bar-status">{status}</div> : null}
      <div className="chat-bar-caption">
        Describe who to contact — Jargon searches Crustdata and opens the rep queue
      </div>
    </form>
  )
}
