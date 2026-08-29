import { useState, type FormEvent, type KeyboardEvent } from 'react'

interface Props {
  disabled?: boolean
  placeholder?: string
  submitLabel?: string
  onSubmit: (prompt: string) => void
}

export function Composer({
  disabled,
  placeholder = 'Describe a workflow or internal tool…',
  submitLabel = 'Send',
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

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-shell">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={disabled}
        />
        <div className="composer-footer">
          <span className="composer-hint">Enter to send · Shift+Enter for newline</span>
          <button type="submit" className="send-btn" disabled={disabled || !value.trim()}>
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
