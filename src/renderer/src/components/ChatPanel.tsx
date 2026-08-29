import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../types'

interface Props {
  messages: ChatMessage[]
  isGenerating: boolean
  generatingLabel?: string
  suggestions: string[]
  showActionHints?: boolean
  onSuggest: (prompt: string) => void
  onOpenTool: (id: string) => void
  onSelectOption?: (questionId: string, option: string) => void
}

export function ChatPanel({
  messages,
  isGenerating,
  generatingLabel = 'Thinking…',
  suggestions,
  showActionHints = false,
  onSuggest,
  onOpenTool,
  onSelectOption
}: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating])

  return (
    <section className="chat-panel">
      <div className="panel-header">
        <span className="panel-title">Assistant</span>
      </div>

      {showActionHints ? (
        <div className="chat-action-hint">
          <span className="chat-action-pill">＋ Add source</span>
          <span className="chat-action-pill">↝ Edit workflow</span>
          <span className="chat-action-pill">▣ Reshape tool UI</span>
          <span className="chat-action-pill">▷ Run enrichment</span>
        </div>
      ) : null}

      <div className="chat-scroll">
        {messages.map((msg) => (
          <article key={msg.id} className={`chat-msg role-${msg.role}`}>
            <div className="chat-role">{msg.role === 'user' ? 'You' : 'Jargon'}</div>
            <div className="chat-body">
              {renderContent(msg.content)}
              {msg.options && msg.questionId && onSelectOption ? (
                <div className="option-grid">
                  {msg.options.map((option) => (
                    <button
                      key={option}
                      className="option-chip"
                      onClick={() => onSelectOption(msg.questionId!, option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
              {msg.toolId ? (
                <button className="open-tool-btn" onClick={() => onOpenTool(msg.toolId!)}>
                  Open in canvas →
                </button>
              ) : null}
            </div>
          </article>
        ))}

        {isGenerating ? (
          <article className="chat-msg role-assistant">
            <div className="chat-role">Jargon</div>
            <div className="chat-body thinking">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              {generatingLabel}
            </div>
          </article>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} className="suggestion" onClick={() => onSuggest(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
    </section>
  )
}

function renderContent(content: string) {
  return content.split('\n').map((line, i) => {
    if (!line) return <br key={i} />
    const parts = line.split(/(\*\*.+?\*\*)/g)
    return (
      <p key={i}>
        {parts.map((part, j) => {
          const bold = part.match(/^\*\*(.+)\*\*$/)
          return bold ? <strong key={j}>{bold[1]}</strong> : <span key={j}>{part}</span>
        })}
      </p>
    )
  })
}
