interface Source {
  id: 'gmail' | 'twilio' | 'heyreach'
  name: string
  feeds: string
}

export function ConnectedContextSection() {
  const sources: Source[] = [
    { id: 'gmail', name: 'Gmail', feeds: 'Outbound email from this tool' },
    { id: 'twilio', name: 'Twilio', feeds: 'Live dialing from the console' },
    { id: 'heyreach', name: 'HeyReach', feeds: 'LinkedIn messages in sequences' }
  ]

  return (
    <section className="connected-context" aria-label="Connected outbound">
      <div className="connected-context-header">
        <div>
          <div className="prod-eyebrow">Outbound stack</div>
          <h3>Gmail, Twilio, and HeyReach</h3>
          <p>This tool sends through the connections on your Jargon workspace.</p>
        </div>
      </div>
      <div className="connected-context-row">
        {sources.map((source, i) => (
          <div key={source.id} className="connected-context-item">
            <article className="connected-context-card">
              <div className="connected-context-card-top">
                <span className={`connected-mark mark-${source.id}`} aria-hidden="true">
                  {source.id === 'gmail' ? '✉' : source.id === 'twilio' ? '☎' : 'in'}
                </span>
                <span className="connected-pill">Ready</span>
              </div>
              <strong>{source.name}</strong>
              <span>{source.feeds}</span>
            </article>
            {i < sources.length - 1 ? (
              <div className="connected-link" aria-hidden="true">
                <span />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
