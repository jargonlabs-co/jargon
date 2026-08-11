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
            <span>◎</span> Retention risk queue
          </div>
          <div className="builder-project">
            <span>▤</span> Account prep
          </div>
          <div className="builder-project">
            <span>☎</span> Mid-market dialer
          </div>
          <div className="builder-project">
            <span>↻</span> Post-call admin
          </div>
        </aside>

        <section className="builder-chat">
          <div className="builder-chat-header">Composer</div>
          <div className="builder-msgs">
            <div className="builder-msg user">
              <div className="builder-role">You</div>
              <p>
                Build a retention workspace for CSMs — surface accounts with declining health,
                prep save-play talking points from our CRM notes, and log outcomes back to the
                data layer.
              </p>
            </div>
            <div className="builder-msg assistant">
              <div className="builder-role">Jargon</div>
              <p>
                Got it. I&apos;ll wire the queue to your health scores, generate prep briefs from
                account context, and ship dispositions with CRM write-back so the whole team can
                run the same motion.
              </p>
              <div className="builder-chips">
                <span>Health scores</span>
                <span>Save plays</span>
                <span>CRM write-back</span>
              </div>
              <button className="builder-open" type="button">
                Open in canvas →
              </button>
            </div>
          </div>
          <div className="builder-composer">
            <span>Describe the revenue tool you want to build…</span>
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
              <div className="product-name">Retention risk queue</div>
              <div className="product-kind">Save motion</div>
            </div>
          </div>
          <nav>
            {['Dashboard', 'Risk queue', 'Save console', 'Accounts', 'Analytics'].map((item, i) => (
              <div key={item} className={`nav-item ${i === 2 ? 'active' : ''}`}>
                <span>{['▣', '⚑', '◎', '▤', '◈'][i]}</span>
                {item}
              </div>
            ))}
          </nav>
          <div className="product-user-row">
            <div className="avatar">R</div>
            <div>
              <div className="muted-xs">Signed in as</div>
              <div className="user-name">Rev Ops</div>
            </div>
          </div>
        </aside>

        <div className="dial-stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">Save console</div>
              <h3>At-risk queue</h3>
            </div>
            <span className="live-pill">
              <span className="live-dot" /> Live · shared
            </span>
          </div>

          <div className="dial-grid">
            <div className="queue-panel">
              <div className="panel-label">Next up</div>
              {[
                { name: 'Maya Chen', meta: 'Lattice · Health 42', status: 'active' },
                { name: 'Jordan Blake', meta: 'Rippling · Health 51', status: 'queued' },
                { name: 'Priya Nair', meta: 'Notion · Health 38', status: 'queued' },
                { name: 'Sam Okonkwo', meta: 'Figma · Health 47', status: 'queued' }
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
                <div className="call-phone">Renewal in 34 days</div>
                <p className="call-goal">Play: Usage drop · Goal: Confirm exec sponsor</p>
                <div className="call-timer">00:42</div>
                <div className="dispositions">
                  <button type="button" className="disp primary">
                    Sponsor confirmed
                  </button>
                  <button type="button" className="disp">
                    Follow up
                  </button>
                  <button type="button" className="disp">
                    Escalate
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
              <div className="product-name">Org tool library</div>
              <div className="product-kind">Shared · governed</div>
            </div>
          </div>
          <nav>
            {['Library', 'Published', 'Teams', 'Usage', 'Analytics'].map((item, i) => (
              <div key={item} className={`nav-item ${i === 0 ? 'active' : ''}`}>
                <span>{['▣', '⚑', '▤', '↻', '◎'][i]}</span>
                {item}
              </div>
            ))}
          </nav>
        </aside>

        <div className="dash-stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">Leadership view</div>
              <h3>Tools across the revenue org</h3>
            </div>
            <button type="button" className="mock-primary">
              Publish update
            </button>
          </div>

          <div className="metric-row">
            {[
              ['Published tools', '24'],
              ['Active teams', '8'],
              ['Weekly runs', '3,412'],
              ['Shared playbooks', '11'],
              ['Adoption', '86%']
            ].map(([label, value]) => (
              <div key={label} className="metric">
                <div className="metric-value">{value}</div>
                <div className="metric-label">{label}</div>
              </div>
            ))}
          </div>

          <div className="activity-panel">
            <div className="panel-label">Recently standardized</div>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Team</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>2h ago</td>
                  <td>
                    <span className="type-badge">CS</span>
                  </td>
                  <td>Retention risk queue · published org-wide</td>
                </tr>
                <tr>
                  <td>Yesterday</td>
                  <td>
                    <span className="type-badge reply">AM</span>
                  </td>
                  <td>Account prep briefs · shared with AE pod</td>
                </tr>
                <tr>
                  <td>2d ago</td>
                  <td>
                    <span className="type-badge call">Sales</span>
                  </td>
                  <td>Mid-market dialer · CRM write-back enabled</td>
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
          <span>Warehouse</span>
          <span>Health scores</span>
          <span>Call outcomes</span>
        </div>
      </div>
      <div className="context-arrow">↓</div>
      <div className="context-layer layer-jargon">
        <BrandMark size={22} />
        <span className="layer-title">Jargon</span>
        <span className="layer-sub">builds shareable tools on it</span>
      </div>
      <div className="context-arrow">↓</div>
      <div className="context-tools">
        <div className="context-tool">
          <span>◎</span> Retention
        </div>
        <div className="context-tool">
          <span>▤</span> Account prep
        </div>
        <div className="context-tool">
          <span>☎</span> Outbound
        </div>
        <div className="context-tool">
          <span>↻</span> Post-call
        </div>
      </div>
    </div>
  )
}
