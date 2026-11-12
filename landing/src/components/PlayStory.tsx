import { BrandMark } from './BrandMark'

const FIRST_PARTY = [
  {
    label: 'CRM',
    chips: [
      { name: 'Salesforce', color: '#00a1e0' },
      { name: 'HubSpot', color: '#ff7a59' },
      { name: 'Attio', color: '#5b4bff' }
    ]
  },
  {
    label: 'Calls',
    chips: [
      { name: 'Gong', color: '#7c4dff' },
      { name: 'Granola', color: '#e0a106' },
      { name: 'Attention', color: '#111111' },
      { name: 'Zoom', color: '#2d8cff' }
    ]
  },
  {
    label: 'Email & chat',
    chips: [
      { name: 'Gmail', color: '#ea4335' },
      { name: 'Outlook', color: '#0a66c2' },
      { name: 'Slack', color: '#611f69' }
    ]
  }
]

const SEQUENCERS = [
  { name: 'Outreach', color: '#5951ff' },
  { name: 'Salesloft', color: '#0f8a5f' },
  { name: 'Gong Engage', color: '#7c4dff' },
  { name: 'HubSpot', color: '#ff7a59' }
]

const PLAY_SENTENCE =
  'Build a play for stage-2 deals with no activity in 30 days. Open with the objection from their last call, and schedule calls for when each office is quietest, based on their Google Business Profile.'

const ACCOUNTS = [
  {
    name: 'Ada Morales',
    role: 'Office manager · Pine Street Veterinary',
    open: 'Already locked into a records system through next year.',
    when: '8:00–9:30am CT'
  },
  {
    name: 'Owen Briggs',
    role: 'Practice owner · Summit Veterinary',
    open: 'Budget is frozen until the new hospital wing opens.',
    when: '7:30–9:00am MT'
  },
  {
    name: 'Noah Patel',
    role: 'Medical director · Cascade Veterinary',
    open: 'Too many vendors already calling the front desk.',
    when: '8:00–9:30am PT'
  }
]

function Chip({ name, color }: { name: string; color: string }) {
  return (
    <span className="play-chip">
      <i style={{ background: color }} />
      {name}
    </span>
  )
}

function Arrow() {
  return (
    <span className="play-arrow" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function PlayDiagram() {
  return (
    <div className="play-flow">
      <div className="play-sources">
        <article className="play-card">
          <p className="play-kicker">Your first-party data</p>
          {FIRST_PARTY.map((group) => (
            <div key={group.label} className="play-row">
              <span className="play-row-label">{group.label}</span>
              <div className="play-chips">
                {group.chips.map((chip) => (
                  <Chip key={chip.name} {...chip} />
                ))}
              </div>
            </div>
          ))}
          <p className="play-note">Including every custom field you’ve already enriched in your CRM.</p>
        </article>
        <article className="play-card public">
          <p className="play-kicker">Anything public</p>
          <p className="play-public-line">
            <strong>Google Business Profile</strong>
            <span>Foot traffic, hours</span>
          </p>
          <p className="play-public-line">
            <strong>The Web</strong>
            <span>Job posts, funding news, SEC filings, G2 reviews, LinkedIn activity</span>
          </p>
        </article>
      </div>

      <Arrow />

      <article className="play-card jargon">
        <div className="play-brand">
          <BrandMark size={22} plain />
          <span>Jargon</span>
        </div>
        <p className="play-sentence-label">One sentence in Claude</p>
        <blockquote>{PLAY_SENTENCE}</blockquote>
      </article>

      <Arrow />

      <article className="play-card sequencer">
        <p className="play-kicker">Your sequencer</p>
        <h3>A personalized play, assigned to reps</h3>
        <div className="play-chips">
          {SEQUENCERS.map((chip) => (
            <Chip key={chip.name} {...chip} />
          ))}
        </div>
      </article>
    </div>
  )
}

export function PlaySequence() {
  return (
    <div className="play-seq-mock">
      <div className="play-seq-bar">
        <span>Stage-2 deals, 30 days quiet</span>
        <span className="play-seq-count">2 steps</span>
      </div>
      <div className="play-seq-body">
        <p className="play-seq-kicker">Preview for</p>
        <p className="play-seq-who">Ada Morales</p>
        <p className="play-seq-role">Office manager · Pine Street Veterinary</p>

        <div className="play-seq-sources">
          <p className="play-seq-kicker">Sources</p>
          <div className="play-seq-source">
            <span>Last call objection</span>
            <span>HubSpot calls</span>
          </div>
          <div className="play-seq-source">
            <span>Quiet hours</span>
            <span>Google Business Profile</span>
          </div>
        </div>

        <div className="play-seq-step">
          <p className="play-seq-step-title">Day 0 · Open on the last objection</p>
          <p>
            Open with their last objection: Already locked into a records system through next year.
          </p>
          <p>Call during 8:00–9:30am CT, when the office is quietest.</p>
        </div>
        <p className="play-seq-wait">Wait 2 days</p>
        <div className="play-seq-step">
          <p className="play-seq-step-title">Day 2 · Follow up</p>
          <p>Hi Ada,</p>
          <p>You raised this on our last call: Already locked into a records system through next year.</p>
          <p>I can talk during 8:00–9:30am CT, when the office is quiet.</p>
        </div>

        <div className="play-seq-assign">
          <div>
            <p className="play-seq-kicker">Assign</p>
            <p>AM BDRs</p>
          </div>
          <span className="play-seq-push">Push to sequencer</span>
        </div>
      </div>
    </div>
  )
}

export function PlayAccounts() {
  return (
    <div>
      <div className="play-seq-dest">
        {SEQUENCERS.map((chip) => (
          <Chip key={chip.name} {...chip} />
        ))}
      </div>
      <ul className="play-accounts">
      {ACCOUNTS.map((account) => (
        <li key={account.name}>
          <div className="play-account-top">
            <div>
              <p className="play-account-name">{account.name}</p>
              <p className="play-account-role">{account.role}</p>
            </div>
            <span className="play-account-when">{account.when}</span>
          </div>
          <p className="play-account-open">{account.open}</p>
        </li>
      ))}
      </ul>
    </div>
  )
}
