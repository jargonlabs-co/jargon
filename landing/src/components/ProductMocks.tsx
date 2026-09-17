import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { ClaudeMark } from './ClaudeMark'
import { MockWindow } from './MockWindow'

const HERO_PROMPT =
  'Build me a dialer for the top 100 contacts I need to build pipeline with'

const HERO_CONTACTS = [
  {
    name: 'Alex Chen',
    meta: 'Head of GTM Eng · Northwind',
    next: 'Call',
    channels: ['Email', 'Call', 'LinkedIn'] as const,
    active: 'Call'
  },
  {
    name: 'Priya Shah',
    meta: 'VP RevOps · Harbor',
    next: 'Call',
    channels: ['Email', 'Call', 'LinkedIn'] as const,
    active: null
  },
  {
    name: 'Sam Ortiz',
    meta: 'GTM Engineer · Lumen',
    next: 'Email',
    channels: ['Email', 'Call', 'LinkedIn'] as const,
    active: null
  }
]

type HeroPhase = 'idle' | 'typing' | 'sent' | 'tool' | 'widget' | 'ready'

function wait(ms: number, timers: number[]) {
  return new Promise<void>((resolve) => {
    timers.push(window.setTimeout(resolve, ms))
  })
}

export function CliDeployMock() {
  return (
    <MockWindow className="mock-cli" wide>
      <div className="cli-layout">
        <div className="cli-body">
          <div className="cli-line cli-comment">
            # in Claude Code — no eng backlog, no ongoing maintenance
          </div>
          <div className="cli-line">
            <span className="cli-prompt">$</span>
            <span className="cli-cmd">jargon deploy &quot;Outbound dialer for my AE book&quot;</span>
          </div>
          <div className="cli-line cli-out">Deployed Outbound dialer for AE book</div>
          <div className="cli-line cli-out">Fully functional UI · CRM + context layer</div>
          <div className="cli-line cli-out">
            Open:{' '}
            <span className="cli-link">https://jargonlabs.co/tools/ae-dialer</span>
          </div>
          <div className="cli-line cli-cursor">
            <span className="cli-prompt">$</span>
            <span className="cli-blink" aria-hidden="true" />
          </div>
        </div>
        <div className="cli-aside">
          <div className="cli-aside-label">What sales opens</div>
          <div className="cli-aside-card">
            <div className="cli-aside-name">Outbound dialer · AE book</div>
            <div className="cli-aside-meta">Functional UI · call · email · LinkedIn</div>
            <ul>
              <li>Maya Chen · Lattice</li>
              <li>Jordan Blake · Rippling</li>
              <li>Priya Nair · Notion</li>
            </ul>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

export function DialerMock() {
  return (
    <MockWindow className="mock-dialer" wide>
      <div className="product-layout">
        <aside className="product-nav-mock">
          <div className="product-brand-row">
            <BrandMark size={26} />
            <div>
              <div className="product-name">Outbound dialer</div>
              <div className="product-kind">AE book · outbound</div>
            </div>
          </div>
          <nav>
            {['Dashboard', 'Today', 'Dialer', 'Sequences', 'Contacts'].map((item, i) => (
              <div key={item} className={`nav-item ${i === 2 ? 'active' : ''}`}>
                <span>{['▣', '⚑', '☎', '↻', '▤'][i]}</span>
                {item}
              </div>
            ))}
          </nav>
          <div className="product-user-row">
            <div className="avatar">A</div>
            <div>
              <div className="muted-xs">Signed in as</div>
              <div className="user-name">AE · West</div>
            </div>
          </div>
        </aside>

        <div className="dial-stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">Working UI</div>
              <h3>AE book dialer</h3>
            </div>
            <span className="live-pill">
              <span className="live-dot" /> Live · your data
            </span>
          </div>

          <div className="dial-grid">
            <div className="queue-panel">
              <div className="panel-label">Next up</div>
              {[
                { name: 'Maya Chen', meta: 'Lattice · VP Sales', status: 'active' },
                { name: 'Jordan Blake', meta: 'Rippling · Director', status: 'queued' },
                { name: 'Priya Nair', meta: 'Notion · Head of RevOps', status: 'queued' },
                { name: 'Sam Okonkwo', meta: 'Figma · AE Manager', status: 'queued' }
              ].map((c) => (
                <div key={c.name} className={`queue-item ${c.status}`}>
                  <div>
                    <div className="q-name">{c.name}</div>
                    <div className="q-meta">{c.meta}</div>
                  </div>
                  <span className="q-chip">{c.status}</span>
                </div>
              ))}
            </div>

            <div className="call-panel">
              <div className="panel-label">Active session</div>
              <div className="call-card">
                <div className="call-avatar">MC</div>
                <div className="call-name">Maya Chen</div>
                <div className="call-title">VP Sales · Lattice</div>
                <div className="call-phone">+1 (415) 555-0142</div>
                <p className="call-goal">Play: Mid-market outbound · Goal: Book discovery</p>
                <div className="call-timer">00:42</div>
                <div className="dispositions">
                  <button type="button" className="disp primary">
                    Meeting booked
                  </button>
                  <button type="button" className="disp">
                    Follow up
                  </button>
                  <button type="button" className="disp">
                    Not interested
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

export function HeroClaudeMock() {
  const [phase, setPhase] = useState<HeroPhase>('idle')
  const [typed, setTyped] = useState('')
  const [remaining, setRemaining] = useState(0)
  const [visiblePeople, setVisiblePeople] = useState(0)

  useEffect(() => {
    const timers: number[] = []
    let cancelled = false

    async function play() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTyped(HERO_PROMPT)
        setPhase('ready')
        setRemaining(100)
        setVisiblePeople(HERO_CONTACTS.length)
        return
      }

      while (!cancelled) {
        setPhase('idle')
        setTyped('')
        setRemaining(0)
        setVisiblePeople(0)
        await wait(1800, timers)
        if (cancelled) return

        setPhase('typing')
        for (let i = 1; i <= HERO_PROMPT.length; i += 1) {
          if (cancelled) return
          setTyped(HERO_PROMPT.slice(0, i))
          const char = HERO_PROMPT[i - 1]
          await wait(char === ' ' ? 140 : 72, timers)
        }

        await wait(1600, timers)
        if (cancelled) return
        setPhase('sent')

        await wait(1600, timers)
        if (cancelled) return
        setPhase('tool')

        await wait(2200, timers)
        if (cancelled) return
        setPhase('widget')

        for (let n = 0; n <= 100; n += 2) {
          if (cancelled) return
          setRemaining(n)
          await wait(48, timers)
        }
        setRemaining(100)

        for (let i = 1; i <= HERO_CONTACTS.length; i += 1) {
          if (cancelled) return
          setVisiblePeople(i)
          await wait(900, timers)
        }

        setPhase('ready')
        await wait(10000, timers)
      }
    }

    void play()
    return () => {
      cancelled = true
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const showThread = phase !== 'idle' && phase !== 'typing'
  const showCall = phase === 'ready'

  return (
    <MockWindow className="mock-hero-claude" wide>
      <div className="hc">
        <div className="hc-head">
          <span className="hc-brand">
            <ClaudeMark size={18} />
            Claude
          </span>
          <span className="hc-status">Jargon connected</span>
        </div>

        <div className="hc-thread">
          {showThread ? (
            <div className="hc-user">
              {HERO_PROMPT}
            </div>
          ) : null}

          {phase === 'tool' || phase === 'widget' || phase === 'ready' ? (
            <div className="hc-tools">
              <div className="claude-tool">
                <span className="claude-tool-name">Jargon</span>
                <span className="claude-tool-action">deploy_tool</span>
              </div>
              {phase !== 'tool' ? (
                <div className="hc-tool-note">HubSpot · top 100 contacts</div>
              ) : null}
            </div>
          ) : null}

          {phase === 'widget' || phase === 'ready' ? (
            <div className={`hc-app ${phase === 'ready' ? 'is-ready' : 'is-building'}`}>
              <header className="hc-app-head">
                <div>
                  <h3>Pipeline dialer · top 100</h3>
                  <p>
                    Email · Call · LinkedIn · {remaining} contacts remaining · HubSpot
                  </p>
                </div>
                <div className="hc-app-actions">
                  <span>Full screen</span>
                  <span>Open workspace</span>
                </div>
              </header>

              {phase === 'widget' && visiblePeople === 0 ? (
                <div className="hc-banner">Building dialer from your CRM…</div>
              ) : (
                <>
                  <div className="hc-tabs">
                    <span>Contacts</span>
                    <span className="on">Queue</span>
                    <span>Sequence</span>
                    <span>
                      Tasks <em>100</em>
                    </span>
                  </div>
                  <div className="hc-stats">
                    <div>
                      <strong>{remaining}</strong>
                      <span>remaining</span>
                    </div>
                    <div>
                      <strong>0</strong>
                      <span>emailed</span>
                    </div>
                    <div>
                      <strong>0</strong>
                      <span>called</span>
                    </div>
                    <div>
                      <strong>0</strong>
                      <span>LinkedIn</span>
                    </div>
                  </div>
                  {remaining === 100 ? (
                    <div className="hc-banner">Showing 3 of 100. Open workspace for the full list.</div>
                  ) : null}
                  <div className="hc-people">
                    {HERO_CONTACTS.slice(0, visiblePeople).map((person, i) => (
                      <div key={person.name} className={`hc-person ${i === 0 ? 'on' : ''}`}>
                        <div>
                          <div className="hc-name">{person.name}</div>
                          <div className="hc-meta">{person.meta}</div>
                        </div>
                        <div className="hc-side">
                          <span className="hc-pill">Next · {person.next}</span>
                          <div className="hc-chans">
                            {person.channels.map((channel) => (
                              <span
                                key={channel}
                                className={`hc-chan ${person.active === channel ? 'on' : ''} ${person.next === channel && person.active !== channel ? 'next' : ''}`}
                              >
                                {channel}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {showCall ? (
                <div className="hc-call">
                  <div className="hc-call-to">Alex Chen · +1 (415) 555-0142</div>
                  <div className="hc-track">
                    <label>Talk track</label>
                    <p>
                      Reference the intro email. Ask how Northwind runs outbound today and who owns
                      pipeline.
                    </p>
                  </div>
                  <div className="hc-call-row">
                    <span className="hc-btn primary">Start call</span>
                    <span className="hc-btn">Interested</span>
                    <span className="hc-btn">No answer</span>
                    <span className="hc-btn">Not interested</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={`hc-composer ${phase === 'typing' || phase === 'idle' ? 'is-live' : ''}`}>
          {phase === 'typing' || (phase === 'idle' && typed) ? (
            <span>
              {typed}
              <span className="hc-caret" />
            </span>
          ) : phase === 'idle' ? (
            <span className="hc-placeholder">
              Message Claude…
              <span className="hc-caret" />
            </span>
          ) : (
            <span className="hc-placeholder">Message Claude…</span>
          )}
          <span className={`hc-send ${phase === 'typing' && typed ? 'on' : ''}`} />
        </div>
      </div>
    </MockWindow>
  )
}

export function ContextMock() {
  return (
    <div className="context-graphic" aria-hidden="true">
      <div className="context-layer layer-data">
        <span className="layer-tag">Your data layer</span>
        <div className="layer-chips">
          <span>CRM</span>
          <span>Data warehouse</span>
          <span>Context layer</span>
          <span>Outcomes</span>
        </div>
      </div>
      <div className="context-arrow">↓</div>
      <div className="context-layer layer-jargon">
        <BrandMark size={22} />
        <span className="layer-title">Jargon</span>
        <span className="layer-sub">enterprise-ready custom software</span>
      </div>
      <div className="context-arrow">↓</div>
      <div className="context-tools">
        <div className="context-tool">
          <span>☎</span> Dialers
        </div>
        <div className="context-tool">
          <span>⚑</span> Outbound sequences
        </div>
        <div className="context-tool">
          <span>↻</span> Sequencers
        </div>
        <div className="context-tool">
          <span>◎</span> Account tools
        </div>
      </div>
    </div>
  )
}
