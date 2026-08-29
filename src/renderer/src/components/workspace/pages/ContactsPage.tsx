import { useState } from 'react'
import type { ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onRefresh: () => Promise<ProjectBundle>
  onCall: (contactId: string) => void
  onEmail: (contactId: string) => void
}

export function ContactsPage({ bundle, onRefresh, onCall, onEmail }: Props) {
  const [selectedId, setSelectedId] = useState(
    bundle.contacts.find((c) => c.status === 'active')?.id ?? bundle.contacts[0]?.id ?? null
  )
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = bundle.contacts.find((c) => c.id === selectedId) ?? bundle.contacts[0]
  const filtered = bundle.contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.company.toLowerCase().includes(query.toLowerCase())
  )

  async function activate(id: string) {
    await api.patchContact(id, { status: 'active' })
    setSelectedId(id)
    await onRefresh()
  }

  async function enrich() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.enrichContact(selected.id)
      setSelectedId(result.contact.id)
      await onRefresh()
      const bits = [
        result.enrichment.matchedPerson ? 'person' : null,
        result.enrichment.matchedOrganization ? 'company' : null
      ].filter(Boolean)
      setToast(`Enriched via Apollo · ${bits.join(' + ') || 'no match'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-split">
      <div className="prod-view">
        <div className="prod-view-header">
          <div>
            <div className="prod-eyebrow">Contacts</div>
            <h2>{bundle.project.segment} contacts</h2>
          </div>
          <div className="prod-search">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
            />
            <span>⌕</span>
          </div>
        </div>

        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Title</th>
                <th>Status</th>
                <th>Step</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={c.id === selected?.id ? 'selected' : undefined}
                  onClick={() => void activate(c.id)}
                >
                  <td>
                    <strong>{c.name}</strong>
                    <div className="muted">{c.email}</div>
                  </td>
                  <td>{c.company}</td>
                  <td>{c.title}</td>
                  <td>
                    <span className={`ws-chip status-${c.status}`}>{c.status.replace('_', ' ')}</span>
                  </td>
                  <td className="mono">{c.stepIndex + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <aside className="page-detail">
          <div className="detail-header">
            <div className="prod-eyebrow">Contact</div>
            <h3>{selected.name}</h3>
            <div className="muted">
              {selected.title} · {selected.company}
            </div>
          </div>
          <div className="detail-body">
            {error ? <p className="auth-error">{error}</p> : null}
            {toast ? <div className="toast">{toast}</div> : null}
            <div className="detail-actions">
              <button className="prod-btn primary compact" onClick={() => onCall(selected.id)}>
                Call
              </button>
              <button
                className="prod-btn ghost compact"
                onClick={() => selected && onEmail(selected.id)}
              >
                Email
              </button>
              <button
                className="prod-btn ghost compact"
                onClick={() => void enrich()}
                disabled={busy}
              >
                {busy ? 'Enriching…' : 'Enrich with Apollo'}
              </button>
            </div>
            <div className="detail-block">
              <div className="detail-kv">
                <span>Phone</span>
                <strong>{selected.phone}</strong>
              </div>
              <div className="detail-kv">
                <span>Email</span>
                <strong>{selected.email}</strong>
              </div>
              <div className="detail-kv">
                <span>City</span>
                <strong>{selected.city}</strong>
              </div>
              <div className="detail-kv">
                <span>Status</span>
                <span className={`ws-chip status-${selected.status}`}>
                  {selected.status.replace('_', ' ')}
                </span>
              </div>
              {selected.linkedinUrl ? (
                <div className="detail-kv">
                  <span>LinkedIn</span>
                  <strong>{selected.linkedinUrl}</strong>
                </div>
              ) : null}
              {selected.companyIndustry || selected.companySize || selected.companyRevenue ? (
                <>
                  {selected.companyIndustry ? (
                    <div className="detail-kv">
                      <span>Industry</span>
                      <strong>{selected.companyIndustry}</strong>
                    </div>
                  ) : null}
                  {selected.companySize ? (
                    <div className="detail-kv">
                      <span>Company size</span>
                      <strong>{selected.companySize}</strong>
                    </div>
                  ) : null}
                  {selected.companyRevenue ? (
                    <div className="detail-kv">
                      <span>Revenue</span>
                      <strong>{selected.companyRevenue}</strong>
                    </div>
                  ) : null}
                  {selected.companyDomain ? (
                    <div className="detail-kv">
                      <span>Domain</span>
                      <strong>{selected.companyDomain}</strong>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="detail-block-title" style={{ marginTop: 12 }}>
                Notes
              </div>
              <pre className="email-body compact">{selected.notes || 'No notes yet.'}</pre>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
