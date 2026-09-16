export const CONNECTOR_TAGLINE = 'Build queues, cadences, and dialers in Claude.'

export const CONNECTOR_DESCRIPTION =
  'Run outbound with Jargon inside Claude: turn a researched list into an outbound dialer, a multi-day cadence, or today’s tasks without leaving the conversation. Jargon stores the people and runs email, phone, and LinkedIn from the matching UI in chat. Ask things like “Build an outbound dialer for GTM Engineers in the US,” and Jargon stands it up so you can work the book from Claude.'

const SLIDES = [
  {
    prompt: 'Build an outbound dialer for GTM Engineers in the US',
    mock: 'queue' as const
  },
  {
    prompt: 'Write an 8-day cadence for these RevOps leaders',
    mock: 'sequence' as const
  },
  {
    prompt: 'What’s due today — let me work the tasks',
    mock: 'tasks' as const
  }
]

function QueueMock() {
  const rows = [
    { name: 'Maya Chen', meta: 'Lattice · VP Sales', next: 'Email' },
    { name: 'Jordan Blake', meta: 'Rippling · Director', next: 'Call' },
    { name: 'Priya Nair', meta: 'Notion · RevOps', next: 'LinkedIn' }
  ]
  return (
    <div className="cg-ui">
      <div className="cg-ui-head">
        <strong>GTM Engineers · US</strong>
        <span>3 contacts · Email · Call · LinkedIn</span>
      </div>
      <div className="cg-people">
        {rows.map((row, i) => (
          <div key={row.name} className={`cg-person ${i === 0 ? 'on' : ''}`}>
            <div>
              <div className="cg-name">{row.name}</div>
              <div className="cg-meta">{row.meta}</div>
            </div>
            <span className="cg-pill">{row.next}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SequenceMock() {
  const steps = [
    { kicker: 'Day 0 · Email', preview: 'Quick note on the RevOps motion' },
    { kicker: 'Wait 2 days', preview: '' },
    { kicker: 'Day 2 · Call', preview: 'Talk track from the queue' },
    { kicker: 'Day 5 · LinkedIn', preview: 'Short note after the call' }
  ]
  return (
    <div className="cg-ui">
      <div className="cg-ui-head">
        <strong>RevOps cadence</strong>
        <span>8 days · 3 steps</span>
      </div>
      <div className="cg-tabs">
        <span>Contacts</span>
        <span className="on">Sequence</span>
        <span>Tasks</span>
      </div>
      <div className="cg-flow">
        {steps.map((step, i) => (
          <div key={step.kicker}>
            {i > 0 ? <div className="cg-wire" /> : null}
            <div className={`cg-node ${step.preview ? '' : 'wait'}`}>
              <div className="cg-kicker">{step.kicker}</div>
              {step.preview ? <div className="cg-preview">{step.preview}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TasksMock() {
  const tasks = [
    { who: 'Maya Chen', step: 'Day 0 email', due: 'Now' },
    { who: 'Jordan Blake', step: 'Day 0 call', due: 'Today' },
    { who: 'Priya Nair', step: 'Day 2 LinkedIn', due: 'Upcoming' }
  ]
  return (
    <div className="cg-ui">
      <div className="cg-ui-head">
        <strong>Today’s tasks</strong>
        <span>2 due now · 1 upcoming</span>
      </div>
      <div className="cg-tabs">
        <span>Contacts</span>
        <span>Sequence</span>
        <span className="on">Tasks</span>
      </div>
      <div className="cg-people">
        {tasks.map((task, i) => (
          <div key={task.who} className={`cg-person ${i === 0 ? 'on' : ''}`}>
            <div>
              <div className="cg-name">{task.who}</div>
              <div className="cg-meta">{task.step}</div>
            </div>
            <span className="cg-pill">{task.due}</span>
          </div>
        ))}
      </div>
      <div className="cg-composer">
        <div className="cg-kicker">To Maya Chen</div>
        <div className="cg-preview">Subject: Lattice × GTM tooling</div>
        <div className="cg-preview">Maya — saw you’re hiring GTM Engineers…</div>
      </div>
    </div>
  )
}

function SlideMock({ kind }: { kind: (typeof SLIDES)[number]['mock'] }) {
  if (kind === 'queue') return <QueueMock />
  if (kind === 'sequence') return <SequenceMock />
  return <TasksMock />
}

export function ConnectorGallery({ className = '' }: { className?: string }) {
  return (
    <div className={`connector-gallery ${className}`.trim()}>
      {SLIDES.map((slide) => (
        <article key={slide.prompt} className="connector-slide">
          <p className="connector-prompt">{slide.prompt}</p>
          <div className="connector-shot">
            <SlideMock kind={slide.mock} />
          </div>
        </article>
      ))}
    </div>
  )
}
