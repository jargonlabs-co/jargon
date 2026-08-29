interface Source {
  id: 'crm' | 'clay' | 'gong'
  name: string
  feeds: string
}

interface Props {
  crmName?: string
}

export function ConnectedContextSection({ crmName = 'CRM' }: Props) {
  const sources: Source[] = [
    {
      id: 'crm',
      name: crmName,
      feeds: 'Accounts, owners, and last activity'
    },
    {
      id: 'clay',
      name: 'Clay',
      feeds: 'Firmographics, intent, and buying signals'
    },
    {
      id: 'gong',
      name: 'Gong',
      feeds: 'Past calls, talk tracks, and next steps'
    }
  ]

  return (
    <section className="connected-context" aria-label="Connected context">
      <div className="connected-context-header">
        <div>
          <div className="prod-eyebrow">Connected context</div>
          <h3>CRM, Clay, and Gong</h3>
          <p>This dialer is grounded in the stack you already run — records, enrichment, and call intelligence.</p>
        </div>
      </div>
      <div className="connected-context-row">
        {sources.map((source, i) => (
          <div key={source.id} className="connected-context-item">
            <article className="connected-context-card">
              <div className="connected-context-card-top">
                <span className={`connected-mark mark-${source.id}`} aria-hidden="true">
                  {source.id === 'crm' ? '◆' : source.id === 'clay' ? '▣' : '◎'}
                </span>
                <span className="connected-pill">Connected</span>
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
