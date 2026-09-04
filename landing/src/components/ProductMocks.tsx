import { BrandMark } from './BrandMark'
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
            <span className="cli-cmd">jargon deploy &quot;Today queue for my AE book&quot;</span>
          </div>
          <div className="cli-line cli-out">Deployed Today queue for AE book</div>
          <div className="cli-line cli-out">Fully functional UI · CRM + context layer</div>
          <div className="cli-line cli-out">
            Open:{' '}
            <span className="cli-link">https://jargonlabs.co/tools/ae-today</span>
          </div>
          <div className="cli-line cli-cursor">
            <span className="cli-prompt">$</span>
            <span className="cli-blink" aria-hidden="true" />
          </div>
        </div>
        <div className="cli-aside">
          <div className="cli-aside-label">What sales opens</div>
          <div className="cli-aside-card">
            <div className="cli-aside-name">Today queue · AE book</div>
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
              <div className="product-name">Today queue</div>
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

export function TeamToolsMock() {
  return (
    <MockWindow className="mock-dashboard" wide>
      <div className="product-layout">
        <aside className="product-nav-mock compact">
          <div className="product-brand-row">
            <BrandMark size={26} />
            <div>
              <div className="product-name">Your tools</div>
              <div className="product-kind">Deployed · browser</div>
            </div>
          </div>
          <nav>
            {['Tools', 'Connections', 'API keys', 'Team'].map((item, i) => (
              <div key={item} className={`nav-item ${i === 0 ? 'active' : ''}`}>
                <span>{['▣', '⚑', '▤', '↻'][i]}</span>
                {item}
              </div>
            ))}
          </nav>
        </aside>

        <div className="dash-stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">What reps open</div>
              <h3>Custom UIs on your data</h3>
            </div>
            <button type="button" className="mock-primary">
              Open tool →
            </button>
          </div>

          <div className="metric-row">
            {[
              ['Deployed tools', '6'],
              ['Reps running', '28'],
              ['Contacts loaded', '1,240'],
              ['Channels', 'Call · Email · LI']
            ].map(([label, value]) => (
              <div key={label} className="metric">
                <div className="metric-value">{value}</div>
                <div className="metric-label">{label}</div>
              </div>
            ))}
          </div>

          <div className="activity-panel">
            <div className="panel-label">Recently deployed</div>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Builder</th>
                  <th>Tool</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>2h ago</td>
                  <td>
                    <span className="type-badge call">GTM Eng</span>
                  </td>
                  <td>Today queue for AE book · CLI deploy</td>
                </tr>
                <tr>
                  <td>Yesterday</td>
                  <td>
                    <span className="type-badge">GTM Eng</span>
                  </td>
                  <td>Mid-market dialer · CRM + context</td>
                </tr>
                <tr>
                  <td>2d ago</td>
                  <td>
                    <span className="type-badge reply">GTM Eng</span>
                  </td>
                  <td>Outbound sequencer · warehouse segment</td>
                </tr>
              </tbody>
            </table>
          </div>
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
          <span>⚑</span> Today queues
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
