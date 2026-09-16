import { BrandMark } from './BrandMark'
import { ChatGptMark } from './ChatGptMark'
import { ClaudeMark } from './ClaudeMark'
import { MockWindow } from './MockWindow'

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

export function HeroSequenceMock() {
  return (
    <MockWindow className="mock-hero-sequence" wide>
      <div className="hero-seq">
        <div className="hero-seq-chat">
          <div className="hero-seq-chat-head">
            <div className="hero-seq-apps" aria-hidden="true">
              <span className="hero-seq-app on">
                <ClaudeMark size={14} />
                Claude
              </span>
              <span className="hero-seq-app">
                <ChatGptMark size={14} />
                ChatGPT
              </span>
            </div>
            <span className="hero-seq-status">Jargon · HubSpot connected</span>
          </div>

          <div className="hero-seq-thread">
            <div className="claude-msg user">
              Build an outbound sequence for my AE book — HubSpot, VP Sales and above, West.
            </div>
            <div className="hero-seq-tools">
              <div className="claude-tool">
                <span className="claude-tool-name">Jargon</span>
                <span className="claude-tool-action">read_crm</span>
              </div>
              <div className="hero-seq-tool-note">HubSpot · AE book · 24 contacts</div>
              <div className="claude-tool">
                <span className="claude-tool-name">Jargon</span>
                <span className="claude-tool-action">create_sequence</span>
              </div>
            </div>
            <div className="claude-msg assistant">
              Built <strong>West AE outbound</strong> on your HubSpot book. Day 0 email, day 2 call,
              day 5 LinkedIn — 24 contacts, ready to run from here.
            </div>
          </div>

          <div className="hero-seq-composer" aria-hidden="true">
            Message Claude or ChatGPT…
          </div>
        </div>

        <aside className="hero-seq-artifact">
          <div className="hero-seq-crm">
            <span className="hero-seq-crm-label">Your CRM</span>
            <span className="hero-seq-crm-pill">
              <span className="live-dot" />
              HubSpot · connected
            </span>
          </div>

          <div className="hero-seq-card">
            <div className="hero-seq-card-head">
              <BrandMark size={22} />
              <div>
                <div className="hero-seq-card-name">West AE outbound</div>
                <div className="hero-seq-card-meta">24 contacts from HubSpot · AE book</div>
              </div>
            </div>

            <div className="hero-seq-steps">
              {[
                { day: 'Day 0', channel: 'Email', preview: 'Note on the AE motion' },
                { day: 'Day 2', channel: 'Call', preview: 'Talk track from the book' },
                { day: 'Day 5', channel: 'LinkedIn', preview: 'Short note after the call' }
              ].map((step) => (
                <div key={step.day} className="hero-seq-step">
                  <span className="hero-seq-step-day">{step.day}</span>
                  <span className="hero-seq-step-channel">{step.channel}</span>
                  <span className="hero-seq-step-preview">{step.preview}</span>
                </div>
              ))}
            </div>

            <ul className="hero-seq-people">
              {[
                { name: 'Maya Chen', meta: 'Lattice · VP Sales' },
                { name: 'Jordan Blake', meta: 'Rippling · Director' },
                { name: 'Priya Nair', meta: 'Notion · Head of RevOps' }
              ].map((person) => (
                <li key={person.name}>
                  <span className="hero-seq-person-name">{person.name}</span>
                  <span className="hero-seq-person-meta">{person.meta}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
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
