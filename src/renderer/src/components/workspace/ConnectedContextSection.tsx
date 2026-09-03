export function ConnectedContextSection() {
  return (
    <section className="connected-context" aria-label="Data and outbound">
      <div className="connected-context-header">
        <div>
          <div className="prod-eyebrow">How this tool runs</div>
          <h3>Your HubSpot · outbound via Jargon</h3>
          <p>
            The queue is your CRM. Email, calls, and LinkedIn send through Jargon.
          </p>
        </div>
      </div>
      <div className="connected-context-row">
        <div className="connected-context-item">
          <article className="connected-context-card">
            <div className="connected-context-card-top">
              <span className="connected-pill">Your data</span>
            </div>
            <strong>HubSpot</strong>
            <span>Contacts in this tool</span>
          </article>
        </div>
        <div className="connected-link" aria-hidden="true">
          <span />
        </div>
        <div className="connected-context-item">
          <article className="connected-context-card">
            <div className="connected-context-card-top">
              <span className="connected-pill">Jargon</span>
            </div>
            <strong>Email, voice, LinkedIn</strong>
            <span>Sent by Jargon on your behalf</span>
          </article>
        </div>
      </div>
    </section>
  )
}
