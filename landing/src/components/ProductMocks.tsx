import { useEffect, useRef, useState } from 'react'
import { BrandMark } from './BrandMark'
import { ClaudeMark } from './ClaudeMark'
import { MockWindow } from './MockWindow'

const HERO_PROMPT =
  'Build a play for stage-2 deals with no activity in 30 days. Open with the objection from their last call, and schedule calls for when each office is quietest, based on their Google Business Profile.'

const PLAY_SOURCES = [
  {
    group: 'CRM',
    detail: 'Stage-2 deals with no activity in 30 days',
    from: 'Salesforce · HubSpot · Attio'
  },
  {
    group: 'Calls',
    detail: 'The objection from the last call',
    from: 'Gong · Granola · Attention · Zoom'
  },
  {
    group: 'Email & chat',
    detail: 'The thread already on the account',
    from: 'Gmail · Outlook · Slack'
  },
  {
    group: 'Google Business Profile',
    detail: 'The hour each office is quietest',
    from: 'Hours'
  },
  {
    group: 'The Web',
    detail: 'What’s public on the account',
    from: 'Jobs · funding · reviews'
  }
]

type HeroPhase = 'idle' | 'typing' | 'sent' | 'tool' | 'sources' | 'building' | 'pushed'

const GRAPHIC_PACE = 1 / 0.7

function wait(ms: number, timers: number[]) {
  return new Promise<void>((resolve) => {
    timers.push(window.setTimeout(resolve, Math.round(ms * GRAPHIC_PACE)))
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
  const [visibleSources, setVisibleSources] = useState(0)
  const [detail, setDetail] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchor = el.querySelector('.hc-assistant')
    if (!(anchor instanceof HTMLElement)) {
      el.scrollTo({ top: 0 })
      return
    }
    const place = () => {
      if (phase === 'building' || phase === 'pushed') {
        el.scrollTo({ top: el.scrollHeight })
        return
      }
      const delta = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top
      el.scrollTo({ top: Math.max(0, el.scrollTop + delta - 14) })
    }
    place()
    requestAnimationFrame(place)
  }, [phase, visibleSources, detail])

  useEffect(() => {
    const timers: number[] = []
    let cancelled = false

    async function play() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTyped(HERO_PROMPT)
        setVisibleSources(PLAY_SOURCES.length)
        setDetail(3)
        setPhase('pushed')
        return
      }

      while (!cancelled) {
        setPhase('idle')
        setTyped('')
        setVisibleSources(0)
        setDetail(0)
        await wait(700, timers)
        if (cancelled) return

        setPhase('typing')
        for (let i = 1; i <= HERO_PROMPT.length; i += 1) {
          if (cancelled) return
          setTyped(HERO_PROMPT.slice(0, i))
          const char = HERO_PROMPT[i - 1]
          await wait(char === ' ' ? 42 : 16, timers)
        }

        await wait(420, timers)
        if (cancelled) return
        setPhase('sent')

        await wait(700, timers)
        if (cancelled) return
        setPhase('tool')

        await wait(900, timers)
        if (cancelled) return
        setPhase('sources')

        for (let i = 1; i <= PLAY_SOURCES.length; i += 1) {
          if (cancelled) return
          setVisibleSources(i)
          await wait(420, timers)
        }

        await wait(900, timers)
        if (cancelled) return
        setPhase('building')

        for (let i = 1; i <= 3; i += 1) {
          if (cancelled) return
          setDetail(i)
          await wait(640, timers)
        }

        await wait(700, timers)
        if (cancelled) return
        setPhase('pushed')
        await wait(5200, timers)
      }
    }

    void play()
    return () => {
      cancelled = true
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const showThread = phase !== 'idle' && phase !== 'typing'
  const showWork = phase === 'tool' || phase === 'sources' || phase === 'building' || phase === 'pushed'
  const showApp = phase === 'sources' || phase === 'building' || phase === 'pushed'
  const building = phase === 'building' || phase === 'pushed'
  const shown = PLAY_SOURCES.slice(0, visibleSources)
  const assistant =
    phase === 'pushed'
      ? 'Pushed to the sequencer.'
      : building
        ? 'Building the sequence from those sources.'
        : 'Pulling every source that sentence names.'
  const tool =
    phase === 'pushed'
      ? 'pushed to the sequencer'
      : building
        ? 'building the sequence'
        : 'gathering CRM, calls, email, and the public web'

  return (
    <div className="hc-shell" aria-hidden="true">
      <aside className="hc-side">
        <div className="hc-side-brand">
          <ClaudeMark size={22} />
          Claude
        </div>
        <div className="hc-new">
          <span>+</span> New chat
        </div>
        <div className="hc-side-label">Recents</div>
        <div className="hc-recent on">Stage-2 quiet deals</div>
        <div className="hc-recent">Open upsell opportunities</div>
        <div className="hc-recent">Vet office call times</div>
        <div className="hc-recent">Q3 pipeline review</div>
        <div className="hc-side-foot">
          <div className="hc-you">Y</div>
          <div>
            <div className="hc-who">You</div>
            <div className="hc-plan">Pro plan</div>
          </div>
        </div>
      </aside>

      <section className="hc-main">
        <div className="hc-top">
          <span>Share</span>
        </div>
        <div className="hc-scroll" ref={scrollRef}>
          <div className="hc-col">
            {showThread ? <div className="hc-user">{HERO_PROMPT}</div> : null}

            {showWork ? <p className="hc-assistant">{assistant}</p> : null}

            {showWork ? (
              <div className="hc-tool">
                <span className="hc-tool-ico" aria-hidden="true" />
                <span>
                  <strong>Jargon</strong> · {tool}
                </span>
              </div>
            ) : null}

            {showApp ? (
              <div className="hc-mcp">
                <div className="hc-mcp-bar">
                  <div className="hc-mcp-brand">
                    <BrandMark size={16} />
                    Jargon <span>· Sequence</span>
                  </div>
                  <span className="hc-full">Full screen</span>
                </div>
                <div className="hc-wrap">
                  <header className="hc-engage-head">
                    <div className="hc-eyebrow">{building ? 'Sequence' : 'Sources'}</div>
                    <h3>{phase === 'pushed' ? 'Pushed' : building ? 'Stage-2 deals' : 'From the sentence'}</h3>
                    <p>
                      {building
                        ? 'Open on the last call. Call when the office is quietest.'
                        : `${shown.length} of ${PLAY_SOURCES.length} sources`}
                    </p>
                  </header>

                  <div className="hc-play">
                    <div className="hc-play-sources">
                      <div className="hc-kicker">Sources</div>
                      {shown.map((source) => (
                        <div key={source.group} className="hc-play-source">
                          <strong>{source.group}</strong>
                          <em>{source.detail}</em>
                          <span>{source.from}</span>
                        </div>
                      ))}
                    </div>
                    {detail >= 1 ? (
                      <div className="hc-play-step">
                        <div className="hc-kicker">Day 0 · Call</div>
                        <p>Open with the objection from their last call.</p>
                        <p>Schedule it for when each office is quietest.</p>
                      </div>
                    ) : null}
                    {detail >= 2 ? (
                      <div className="hc-play-step">
                        <div className="hc-kicker">Day 2 · Email</div>
                        <p>Follow up on that objection.</p>
                      </div>
                    ) : null}
                    {detail >= 3 ? (
                      <div className={`hc-play-assign ${phase === 'pushed' ? 'is-pushed' : ''}`}>
                        <div>
                          <div className="hc-kicker">Sequencer</div>
                          <div className="hc-name">Outreach · Salesloft · Gong · HubSpot</div>
                        </div>
                        <span className="hc-play-push">{phase === 'pushed' ? 'Pushed' : 'Push'}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="hc-composer-wrap">
          <div className={`hc-composer ${phase === 'typing' ? 'is-live' : ''}`}>
            <div className="hc-hint">
              {phase === 'typing' ? (
                <span>
                  {typed}
                  <span className="hc-caret" />
                </span>
              ) : (
                <span className="hc-placeholder">
                  Reply to Claude…
                  {phase === 'idle' ? <span className="hc-caret" /> : null}
                </span>
              )}
            </div>
            <div className="hc-composer-bar">
              <span className="hc-model">+ &nbsp; Sonnet 4.6</span>
              <span className={`hc-send ${phase === 'typing' && typed ? 'on' : ''}`} />
            </div>
          </div>
        </div>
      </section>
    </div>
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
