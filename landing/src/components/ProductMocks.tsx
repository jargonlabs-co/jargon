import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { ClaudeMark } from './ClaudeMark'
import { MockWindow } from './MockWindow'

const HERO_PROMPT =
  'Pull my Salesforce contacts and build a dialer ranked by warmth. Call the hottest one from here.'

const HERO_CONTACTS = [
  {
    name: 'Maya Chen',
    title: 'VP Sales',
    company: 'Lattice',
    city: 'San Francisco',
    phone: '+1 (415) 555-0142',
    warmth: 'hot' as const
  },
  {
    name: 'Jordan Blake',
    title: 'Director of Sales',
    company: 'Rippling',
    city: 'San Francisco',
    phone: '+1 (415) 555-0148',
    warmth: 'hot' as const
  },
  {
    name: 'Priya Nair',
    title: 'Head of RevOps',
    company: 'Notion',
    city: 'New York',
    phone: '+1 (917) 555-0162',
    warmth: 'warm' as const
  },
  {
    name: 'Sam Okonkwo',
    title: 'AE Manager',
    company: 'Figma',
    city: 'London',
    phone: '+44 20 7946 0958',
    warmth: 'warm' as const
  },
  {
    name: 'Elena Vasquez',
    title: 'VP Sales',
    company: 'Linear',
    city: 'Austin',
    phone: '+1 (512) 555-0190',
    warmth: 'cold' as const
  }
]

const WARMTH_GROUPS = [
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' }
] as const

const KEYPAD = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', '']
] as const

type HeroPhase = 'idle' | 'typing' | 'sent' | 'tool' | 'list' | 'dialing' | 'live'

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

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function HeroClaudeMock() {
  const [phase, setPhase] = useState<HeroPhase>('idle')
  const [typed, setTyped] = useState('')
  const [visiblePeople, setVisiblePeople] = useState(0)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (phase !== 'live') return
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    const timers: number[] = []
    let cancelled = false

    async function play() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTyped(HERO_PROMPT)
        setVisiblePeople(HERO_CONTACTS.length)
        setSeconds(42)
        setPhase('live')
        return
      }

      while (!cancelled) {
        setPhase('idle')
        setTyped('')
        setVisiblePeople(0)
        setSeconds(0)
        await wait(700, timers)
        if (cancelled) return

        setPhase('typing')
        for (let i = 1; i <= HERO_PROMPT.length; i += 1) {
          if (cancelled) return
          setTyped(HERO_PROMPT.slice(0, i))
          const char = HERO_PROMPT[i - 1]
          await wait(char === ' ' ? 55 : 28, timers)
        }

        await wait(420, timers)
        if (cancelled) return
        setPhase('sent')

        await wait(700, timers)
        if (cancelled) return
        setPhase('tool')

        await wait(900, timers)
        if (cancelled) return
        setPhase('list')

        for (let i = 1; i <= HERO_CONTACTS.length; i += 1) {
          if (cancelled) return
          setVisiblePeople(i)
          await wait(280, timers)
        }

        await wait(2200, timers)
        if (cancelled) return
        setPhase('dialing')

        await wait(1400, timers)
        if (cancelled) return
        setSeconds(0)
        setPhase('live')
        await wait(7200, timers)
      }
    }

    void play()
    return () => {
      cancelled = true
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const showThread = phase !== 'idle' && phase !== 'typing'
  const showWork = phase === 'tool' || phase === 'list' || phase === 'dialing' || phase === 'live'
  const showApp = phase === 'list' || phase === 'dialing' || phase === 'live'
  const onCall = phase === 'dialing' || phase === 'live'
  const shown = HERO_CONTACTS.slice(0, visiblePeople)
  const lead = HERO_CONTACTS[0]

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
        <div className="hc-recent on">Salesforce warmth dialer</div>
        <div className="hc-recent">AE book follow-ups</div>
        <div className="hc-recent">Rippling demo prep</div>
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
        <div className="hc-scroll">
          <div className="hc-col">
            {showThread ? <div className="hc-user">{HERO_PROMPT}</div> : null}

            {showWork ? (
              <p className="hc-assistant">
                Pulled 24 Salesforce contacts and ranked them by warmth. Opening Maya Chen.
              </p>
            ) : null}

            {showWork ? (
              <div className="hc-tool">
                <span className="hc-tool-ico" aria-hidden="true" />
                <span>
                  <strong>Jargon</strong> · ranked Salesforce contacts by warmth
                </span>
              </div>
            ) : null}

            {showApp ? (
              <div className="hc-mcp">
                <div className="hc-mcp-bar">
                  <div className="hc-mcp-brand">
                    <BrandMark size={16} />
                    Jargon <span>· Engage</span>
                  </div>
                  <span className="hc-full">Full screen</span>
                </div>
                <div className="hc-wrap">
                  <header className="hc-engage-head">
                    <div className="hc-eyebrow">Engage</div>
                    <h3>{onCall ? 'Call' : 'Dialer'}</h3>
                    <p>Outbound dialer · Salesforce · 8 hot · 11 warm · 5 cold</p>
                  </header>

                  {onCall ? (
                    <div className="hc-call-layout">
                      <div className="hc-book">
                        {WARMTH_GROUPS.map((group) => {
                          const people = HERO_CONTACTS.filter((person) => person.warmth === group.key)
                          return (
                            <div key={group.key}>
                              <div className={`hc-group-label ${group.key}`}>{group.label}</div>
                              <div className="hc-people">
                                {people.map((person) => (
                                  <div
                                    key={person.name}
                                    className={`hc-person ${person.name === lead.name ? 'on' : ''}`}
                                  >
                                    <div className="hc-name">{person.name}</div>
                                    <span className={`hc-warmth ${person.warmth}`}>{person.warmth}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="hc-dial-card">
                        <div className="hc-dial-h">
                          <div>
                            <div className="hc-kicker">Outbound call</div>
                            <div className="hc-dial-status">
                              {phase === 'dialing' ? 'Calling…' : 'On the line'}
                            </div>
                          </div>
                          <span className="hc-work-who">1 of 24</span>
                        </div>
                        <div className="hc-dial-who">{lead.name}</div>
                        <div className="hc-dial-num">{lead.phone}</div>
                        <div className="hc-dial-timer">{phase === 'live' ? clock(seconds) : 'Connecting…'}</div>
                        <div className="hc-facts">
                          <span>Lattice</span>
                          <span>San Francisco</span>
                          <span className="hot">Hot</span>
                        </div>
                        <div className="hc-dial-actions">
                          {phase === 'live' ? (
                            <>
                              <span className="hc-mini">Mute</span>
                              <span className="hc-mini end">End call</span>
                            </>
                          ) : (
                            <span className="hc-mini call">Call</span>
                          )}
                        </div>
                        <div className="hc-track">
                          <label>Talk track</label>
                          <p>Maya replied last week. Confirm the evaluation, then ask who owns outbound.</p>
                        </div>
                        <div className="hc-keypad">
                          {KEYPAD.map(([key, sub]) => (
                            <span key={key} className="hc-key">
                              <b>{key}</b>
                              <em>{sub}</em>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="hc-banner">
                        Showing {shown.length} of 24, ranked hottest first.
                      </div>
                      {WARMTH_GROUPS.map((group) => {
                        const people = shown.filter((person) => person.warmth === group.key)
                        if (!people.length) return null
                        return (
                          <div key={group.key} className="hc-group">
                            <div className={`hc-group-label ${group.key}`}>{group.label}</div>
                            <div className="hc-people">
                              {people.map((person) => (
                                <div
                                  key={person.name}
                                  className={`hc-person ${person.name === lead.name ? 'on' : ''}`}
                                >
                                  <div>
                                    <div className="hc-name">{person.name}</div>
                                    <div className="hc-meta">
                                      {person.title} · {person.company}
                                    </div>
                                  </div>
                                  <span className={`hc-warmth ${person.warmth}`}>{person.warmth}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
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
