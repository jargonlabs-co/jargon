import { BrandMark } from './BrandMark'
import { MockWindow } from './MockWindow'

export function BuilderMock() {
  return (
    <MockWindow className="mock-builder">
      <div className="builder-layout">
        <aside className="builder-sidebar">
          <button className="builder-new" type="button">
            + New project
          </button>
          <div className="builder-folder">jargon</div>
          <div className="builder-project active">
            <span>☎</span> Enterprise dialer
          </div>
          <div className="builder-project">
            <span>✉</span> AE sequencer
          </div>
          <div className="builder-project">
            <span>↻</span> Multi-channel cadence
          </div>
        </aside>

        <section className="builder-chat">
          <div className="builder-chat-header">Composer</div>
          <div className="builder-msgs">
            <div className="builder-msg user">
              <div className="builder-role">You</div>
              <p>
                Build a dialer for our Series B pipeline — prioritize VP Sales at mid-market SaaS,
                pull from our CRM segments, and log outcomes back to the data layer.
              </p>
            </div>
            <div className="builder-msg assistant">
              <div className="builder-role">Jargon</div>
              <p>
                Got it. I&apos;ll wire the queue to your CRM context, set dispositions for meeting
                booked / follow-up, and ship a live dial console with campaign analytics.
              </p>
              <div className="builder-chips">
                <span>CRM segments</span>
                <span>VP Sales</span>
                <span>Meeting booked</span>
              </div>
              <button className="builder-open" type="button">
                Open in canvas →
              </button>
            </div>
          </div>
          <div className="builder-composer">
            <span>Describe the outbound tool you want to build…</span>
            <button type="button">Send</button>
          </div>
        </section>
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
              <div className="product-name">Enterprise dialer</div>
              <div className="product-kind">Outbound Dialer</div>
            </div>
          </div>
          <nav>
            {['Dashboard', 'Campaigns', 'Dial console', 'Contacts', 'Analytics'].map((item, i) => (
              <div key={item} className={`nav-item ${i === 2 ? 'active' : ''}`}>
                <span>{['▣', '⚑', '☎', '▤', '◎'][i]}</span>
                {item}
              </div>
            ))}
          </nav>
          <div className="product-user-row">
            <div className="avatar">S</div>
            <div>
              <div className="muted-xs">Signed in as</div>
              <div className="user-name">Sales Ops</div>
            </div>
          </div>
        </aside>

        <div className="dial-stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">Dial console</div>
              <h3>Live queue</h3>
            </div>
            <span className="live-pill">
              <span className="live-dot" /> Simulated · live
            </span>
          </div>

          <div className="dial-grid">
            <div className="queue-panel">
              <div className="panel-label">Next up</div>
              {[
                { name: 'Maya Chen', meta: 'Lattice · SF', status: 'active' },
                { name: 'Jordan Blake', meta: 'Rippling · NYC', status: 'queued' },
                { name: 'Priya Nair', meta: 'Notion · Remote', status: 'queued' },
                { name: 'Sam Okonkwo', meta: 'Figma · LA', status: 'queued' }
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
                <p className="call-goal">Step: Discovery dial · Goal: Book a meeting</p>
                <div className="call-timer">00:42</div>
                <div className="dispositions">
                  <button type="button" className="disp primary">
                    Interested
                  </button>
                  <button type="button" className="disp">
                    No answer
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

export function DashboardMock() {
  return (
    <MockWindow className="mock-dashboard" wide>
      <div className="product-layout">
        <aside className="product-nav-mock compact">
          <div className="product-brand-row">
            <BrandMark size={26} />
            <div>
              <div className="product-name">AE sequencer</div>
              <div className="product-kind">Email Sequencer</div>
            </div>
          </div>
          <nav>
            {['Dashboard', 'Sequences', 'Inbox', 'Contacts', 'Analytics'].map((item, i) => (
              <div key={item} className={`nav-item ${i === 0 ? 'active' : ''}`}>
                <span>{['▣', '↻', '✉', '▤', '◎'][i]}</span>
                {item}
              </div>
            ))}
          </nav>
        </aside>

        <div className="dash-stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">Dashboard</div>
              <h3>AE sequencer</h3>
            </div>
            <button type="button" className="mock-primary">
              Open inbox
            </button>
          </div>

          <div className="metric-row">
            {[
              ['Enrolled', '1,248'],
              ['Contacted', '892'],
              ['Replied', '186'],
              ['Booked', '47'],
              ['Answer rate', '21.4%']
            ].map(([label, value]) => (
              <div key={label} className="metric">
                <div className="metric-value">{value}</div>
                <div className="metric-label">{label}</div>
              </div>
            ))}
          </div>

          <div className="activity-panel">
            <div className="panel-label">Recent activity</div>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>2m ago</td>
                  <td>
                    <span className="type-badge">EMAIL</span>
                  </td>
                  <td>Step 2 sent to Jordan Blake</td>
                </tr>
                <tr>
                  <td>14m ago</td>
                  <td>
                    <span className="type-badge reply">REPLY</span>
                  </td>
                  <td>Priya Nair replied — interested</td>
                </tr>
                <tr>
                  <td>31m ago</td>
                  <td>
                    <span className="type-badge call">CALL</span>
                  </td>
                  <td>Logged meeting booked · Maya Chen</td>
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
          <span>CRM segments</span>
          <span>Enrichment</span>
          <span>Intent signals</span>
          <span>Call outcomes</span>
        </div>
      </div>
      <div className="context-arrow">↓</div>
      <div className="context-layer layer-jargon">
        <BrandMark size={22} />
        <span className="layer-title">Jargon</span>
        <span className="layer-sub">builds the tool around it</span>
      </div>
      <div className="context-arrow">↓</div>
      <div className="context-tools">
        <div className="context-tool">
          <span>☎</span> Dialer
        </div>
        <div className="context-tool">
          <span>✉</span> Sequencer
        </div>
        <div className="context-tool">
          <span>↻</span> Cadence
        </div>
        <div className="context-tool">
          <span>▤</span> Lists
        </div>
      </div>
    </div>
  )
}
