import { useMemo, useState } from 'react'
import type { Lead, SalesTool } from '../../types'
import { ProductShell } from './ProductShell'

interface Campaign {
  id: number
  name: string
  state: 'ACTIVE' | 'PAUSED' | 'DRAFT'
  type: string
  created: string
  modified: string
  done: number
  total: number
  ringRatio: number
  answerRatio: number
}

interface Props {
  tool: SalesTool
  onSelectLead: (leadId: string) => void
  onDispose: (leadId: string, status: Lead['status']) => void
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'lists', label: 'Contact Lists' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'scripts', label: 'Call Scripts' },
  { id: 'agents', label: 'Agents' },
  { id: 'settings', label: 'Settings', section: 'system' as const },
  { id: 'help', label: 'Help', section: 'system' as const }
]

export function DialerWorkspace({ tool, onSelectLead, onDispose }: Props) {
  const [nav, setNav] = useState('campaigns')
  const [selectedId, setSelectedId] = useState(2)
  const [tab, setTab] = useState<'progress' | 'analytics'>('analytics')
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => buildCampaigns(tool))
  const [query, setQuery] = useState('')

  const selected = campaigns.find((c) => c.id === selectedId) ?? campaigns[0]
  const filtered = campaigns.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
  const activeLead = tool.leads.find((l) => l.id === tool.activeLeadId) ?? tool.leads[0]

  const productName = useMemo(
    () => `${tool.segment.replace(/\s+/g, '')} Dialer`,
    [tool.segment]
  )

  function toggleState(id: number) {
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, state: c.state === 'ACTIVE' ? 'PAUSED' : 'ACTIVE', modified: 'just now' }
          : c
      )
    )
  }

  return (
    <ProductShell
      productName={productName}
      productKind="Outbound dialer"
      navItems={NAV}
      activeNav={nav}
      onNavChange={setNav}
      userLabel={tool.team}
      detail={
        selected && nav === 'campaigns' ? (
          <CampaignDetail
            campaign={selected}
            tab={tab}
            onTab={setTab}
            onToggle={() => toggleState(selected.id)}
            leads={tool.leads}
            activeLead={activeLead}
            goal={String(tool.config.goal)}
            onSelectLead={onSelectLead}
            onDispose={onDispose}
          />
        ) : null
      }
    >
      {nav === 'campaigns' ? (
        <div className="prod-view">
          <div className="prod-view-header">
            <div>
              <div className="prod-eyebrow">Campaigns</div>
              <h2>Campaigns</h2>
            </div>
            <div className="prod-view-actions">
              <button className="prod-btn primary">+ Create Campaign</button>
              <div className="prod-search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search campaigns"
                />
                <span>⌕</span>
              </div>
            </div>
          </div>

          <div className="prod-table-wrap">
            <div className="prod-table-meta">
              <span>
                1–{filtered.length} of {filtered.length}
              </span>
              <span>10 / page</span>
            </div>
            <table className="prod-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>State</th>
                  <th>Type</th>
                  <th>Created</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className={c.id === selected?.id ? 'selected' : undefined}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <td className="mono">{c.id}</td>
                    <td>
                      <div className="prod-name-cell">
                        <strong>{c.name}</strong>
                        <div className="mini-progress">
                          <div
                            className="mini-progress-bar"
                            style={{ width: `${(c.done / c.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`state-badge state-${c.state.toLowerCase()}`}>{c.state}</span>
                    </td>
                    <td>
                      <span className="type-badge">{c.type}</span>
                    </td>
                    <td className="muted">{c.created}</td>
                    <td className="muted">{c.modified}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          title={c.state === 'ACTIVE' ? 'Pause' : 'Run'}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleState(c.id)
                          }}
                        >
                          {c.state === 'ACTIVE' ? '⏸' : '▶'}
                        </button>
                        <button title="Edit" onClick={(e) => e.stopPropagation()}>
                          ✎
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : nav === 'contacts' ? (
        <ContactsView tool={tool} onSelectLead={onSelectLead} />
      ) : nav === 'dashboard' ? (
        <DashboardView tool={tool} campaigns={campaigns} />
      ) : (
        <PlaceholderView label={NAV.find((n) => n.id === nav)?.label ?? nav} tool={tool} />
      )}
    </ProductShell>
  )
}

function CampaignDetail({
  campaign,
  tab,
  onTab,
  onToggle,
  leads,
  activeLead,
  goal,
  onSelectLead,
  onDispose
}: {
  campaign: Campaign
  tab: 'progress' | 'analytics'
  onTab: (t: 'progress' | 'analytics') => void
  onToggle: () => void
  leads: Lead[]
  activeLead?: Lead
  goal: string
  onSelectLead: (id: string) => void
  onDispose: (id: string, status: Lead['status']) => void
}) {
  const pct = ((campaign.done / campaign.total) * 100).toFixed(2)

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="prod-eyebrow">Campaign #{campaign.id}</div>
        <h3>{campaign.name}</h3>
      </div>

      <div className="detail-actions">
        <button className="prod-btn primary compact">Edit</button>
        <button className="prod-btn ghost compact">Delete</button>
        <button className="prod-btn primary compact" onClick={onToggle}>
          {campaign.state === 'ACTIVE' ? 'Pause' : 'Run'}
        </button>
        <button className="prod-btn primary compact">Abort</button>
        <button className="prod-btn primary compact">Restart</button>
      </div>

      <div className="detail-tabs">
        <button className={tab === 'progress' ? 'active' : ''} onClick={() => onTab('progress')}>
          Call Progress
        </button>
        <button className={tab === 'analytics' ? 'active' : ''} onClick={() => onTab('analytics')}>
          Analytics
        </button>
      </div>

      {tab === 'analytics' ? (
        <div className="detail-body">
          <div className="ratio-toggle">
            <button className="active">Conversion Ratios</button>
            <button>Conversion Flow</button>
          </div>
          <div className="donut-row">
            <Donut label="Ring Ratio" value={campaign.ringRatio} color="var(--star-blue)" />
            <Donut label="Answer Ratio" value={campaign.answerRatio} color="var(--success)" />
          </div>
          <div className="scale-toggle">
            <button className="active">Absolute Scale</button>
            <button>Relative Scale</button>
          </div>
          <div className="detail-block">
            <div className="detail-block-title">Details</div>
            <div className="detail-kv">
              <span>Progress</span>
              <strong>
                {campaign.done} / {campaign.total} ({pct}%)
              </strong>
            </div>
            <div className="mini-progress large">
              <div className="mini-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="detail-kv">
              <span>State</span>
              <span className={`state-badge state-${campaign.state.toLowerCase()}`}>
                {campaign.state}
              </span>
            </div>
            <div className="detail-kv">
              <span>Type</span>
              <span className="type-badge">{campaign.type}</span>
            </div>
            <div className="detail-kv">
              <span>Goal</span>
              <strong>{goal}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="detail-body">
          <div className="detail-block">
            <div className="detail-block-title">Live queue</div>
            <div className="detail-lead-list">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  className={lead.id === activeLead?.id ? 'detail-lead active' : 'detail-lead'}
                  onClick={() => onSelectLead(lead.id)}
                >
                  <div>
                    <strong>{lead.name}</strong>
                    <div className="muted">{lead.company}</div>
                  </div>
                  <span className={`ws-chip status-${lead.status}`}>
                    {lead.status.replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {activeLead ? (
            <div className="detail-block live-call">
              <div className="detail-block-title">Active call</div>
              <div className="live-call-name">{activeLead.name}</div>
              <div className="muted">
                {activeLead.phone} · {activeLead.city}
              </div>
              <div className="call-timer small">00:42</div>
              <div className="disposition-grid">
                <button className="prod-btn primary compact" onClick={() => onDispose(activeLead.id, 'interested')}>
                  Interested
                </button>
                <button className="prod-btn ghost compact" onClick={() => onDispose(activeLead.id, 'no_answer')}>
                  No answer
                </button>
                <button
                  className="prod-btn ghost compact"
                  onClick={() => onDispose(activeLead.id, 'not_interested')}
                >
                  Not interested
                </button>
                <button className="prod-btn ghost compact" onClick={() => onDispose(activeLead.id, 'completed')}>
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Donut({ label, value, color }: { label: string; value: number; color: string }) {
  const deg = Math.max(0, Math.min(100, value)) * 3.6
  return (
    <div className="donut-card">
      <div
        className="donut"
        style={{
          background: `conic-gradient(${color} ${deg}deg, #e6ddd0 0deg)`
        }}
      >
        <div className="donut-hole">
          <strong>{value.toFixed(1)}%</strong>
        </div>
      </div>
      <div className="donut-label">{label}</div>
    </div>
  )
}

function ContactsView({
  tool,
  onSelectLead
}: {
  tool: SalesTool
  onSelectLead: (id: string) => void
}) {
  return (
    <div className="prod-view">
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Contacts</div>
          <h2>{tool.segment} contacts</h2>
        </div>
        <button className="prod-btn primary">+ Import contacts</button>
      </div>
      <div className="prod-table-wrap">
        <table className="prod-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Title</th>
              <th>Phone</th>
              <th>City</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tool.leads.map((lead) => (
              <tr key={lead.id} onClick={() => onSelectLead(lead.id)}>
                <td>
                  <strong>{lead.name}</strong>
                </td>
                <td>{lead.company}</td>
                <td>{lead.title}</td>
                <td className="mono">{lead.phone}</td>
                <td>{lead.city}</td>
                <td>
                  <span className={`ws-chip status-${lead.status}`}>
                    {lead.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DashboardView({ tool, campaigns }: { tool: SalesTool; campaigns: Campaign[] }) {
  const active = campaigns.filter((c) => c.state === 'ACTIVE').length
  return (
    <div className="prod-view">
      <div className="prod-view-header">
        <div>
          <div className="prod-eyebrow">Dashboard</div>
          <h2>{tool.name}</h2>
        </div>
      </div>
      <div className="dash-grid">
        <DashCard label="Active campaigns" value={String(active)} />
        <DashCard label="Contacts enrolled" value={String(tool.stats.enrolled)} />
        <DashCard label="Contacted" value={String(tool.stats.contacted)} />
        <DashCard label="Meetings booked" value={String(tool.stats.booked)} />
      </div>
      <div className="prod-table-wrap">
        <div className="detail-block-title" style={{ padding: '12px 14px 0' }}>
          Campaign health
        </div>
        <table className="prod-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>State</th>
              <th>Progress</th>
              <th>Answer %</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td>
                  <span className={`state-badge state-${c.state.toLowerCase()}`}>{c.state}</span>
                </td>
                <td>
                  {c.done}/{c.total}
                </td>
                <td>{c.answerRatio.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DashCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="dash-card">
      <div className="dash-value">{value}</div>
      <div className="dash-label">{label}</div>
    </div>
  )
}

function PlaceholderView({ label, tool }: { label: string; tool: SalesTool }) {
  return (
    <div className="prod-view placeholder-view">
      <div className="prod-eyebrow">{label}</div>
      <h2>{label}</h2>
      <p>
        Configured for <strong>{tool.segment}</strong> · owned by <strong>{tool.team}</strong>.
        This module is scaffolded as part of your custom dialer build.
      </p>
    </div>
  )
}

function buildCampaigns(tool: SalesTool): Campaign[] {
  const mode = String(tool.answers.dial_mode ?? 'Power dial')
  const type = /parallel/i.test(mode) ? 'PARALLEL' : /click/i.test(mode) ? 'CLICK-TO-CALL' : 'BROADCAST'
  return [
    {
      id: 2,
      name: `${tool.segment} ${String(tool.config.goal ?? 'Outreach')}`,
      state: 'ACTIVE',
      type,
      created: '2 days ago',
      modified: '12 min ago',
      done: Math.max(1, tool.stats.contacted),
      total: tool.leads.length * 8,
      ringRatio: 100,
      answerRatio: 33.3
    },
    {
      id: 1,
      name: `${tool.team} follow-up wave`,
      state: 'PAUSED',
      type: 'PRESS-ONE',
      created: '1 week ago',
      modified: '3 days ago',
      done: 12,
      total: 40,
      ringRatio: 92.5,
      answerRatio: 21.4
    },
    {
      id: 3,
      name: `${tool.segment} reactivation`,
      state: 'DRAFT',
      type: type,
      created: 'today',
      modified: 'today',
      done: 0,
      total: 25,
      ringRatio: 0,
      answerRatio: 0
    }
  ]
}
