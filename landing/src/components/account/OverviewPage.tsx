import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { type AccountSnapshot, type PortalBuild } from '../../api'
import { ChatGptMark } from '../ChatGptMark'
import { ClaudeMark } from '../ClaudeMark'
import {
  HOME_PLACEHOLDER,
  firstNameOf,
  launchChat,
  timeGreeting,
  type ChatDestination
} from '../../lib/chatLaunch'
import { formatWhen } from './nav'

export function OverviewPage({
  snapshot,
  builds,
  userName,
  userEmail,
  onNavigate,
  onOpenTool
}: {
  snapshot: AccountSnapshot
  connections?: unknown
  builds: PortalBuild[]
  userName?: string
  userEmail?: string
  onNavigate: (path: string) => void
  onOpenTool: (id: string) => void
}) {
  const claudeConnected = Boolean(snapshot.claude?.connected)
  const [prompt, setPrompt] = useState('')
  const [destination, setDestination] = useState<ChatDestination>('claude')

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text) return
    launchChat(destination, text)
  }

  return (
    <section className="home-dash">
      <header className="home-hero">
        <h1>
          {timeGreeting()}, {firstNameOf(userName, userEmail)}
        </h1>
        <form className="home-composer" onSubmit={submit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder={HOME_PLACEHOLDER}
            rows={3}
            aria-label="Prompt for Claude or ChatGPT"
          />
          <div className="home-composer-bar">
            <div className="home-destinations" role="tablist" aria-label="Open in">
              <button
                type="button"
                role="tab"
                aria-selected={destination === 'claude'}
                className={destination === 'claude' ? 'is-on' : ''}
                onClick={() => setDestination('claude')}
              >
                <ClaudeMark size={16} />
                Claude
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={destination === 'chatgpt'}
                className={destination === 'chatgpt' ? 'is-on' : ''}
                onClick={() => setDestination('chatgpt')}
              >
                <ChatGptMark size={16} />
                ChatGPT
              </button>
            </div>
            <button
              type="submit"
              className="home-send"
              disabled={!prompt.trim()}
              aria-label={`Open in ${destination === 'chatgpt' ? 'ChatGPT' : 'Claude'}`}
            >
              <SendIcon />
            </button>
          </div>
        </form>
        <p className="home-or">Or start from</p>
        <div className="home-starts">
          <button type="button" className="home-start" onClick={() => onNavigate('/claude')}>
            <ClaudeMark size={14} />
            Connect Claude
          </button>
          <button type="button" className="home-start" onClick={() => onNavigate('/claude')}>
            <ChatGptMark size={14} />
            Connect ChatGPT
          </button>
          <button type="button" className="home-start" onClick={() => onNavigate('/data')}>
            Import from CRM
          </button>
        </div>
      </header>

      <div className="home-recent">
        <div className="home-recent-head">
          <h2>Recent tools</h2>
          <button type="button" className="btn primary btn-sm" onClick={() => onNavigate('/tools')}>
            All tools
          </button>
        </div>
        {builds.length === 0 ? (
          <button type="button" className="home-empty-row" onClick={() => onNavigate('/claude')}>
            + New tool — {claudeConnected ? 'type a prompt above to open Claude or ChatGPT' : 'connect Claude or ChatGPT to deploy one'}
          </button>
        ) : (
          <div className="home-table">
            <div className="home-table-head">
              <span>Name</span>
              <span>Contacts</span>
              <span>Last modified</span>
            </div>
            {builds.slice(0, 6).map((build) => (
              <button
                key={build.project.id}
                type="button"
                className="home-table-row"
                onClick={() => onOpenTool(build.project.id)}
              >
                <strong>{build.project.name}</strong>
                <span>{build.contactCount}</span>
                <span>{formatWhen(build.project.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5V3.5M8 3.5L3.5 8M8 3.5L12.5 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
