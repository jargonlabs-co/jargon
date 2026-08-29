import { useEffect, useState } from 'react'
import type { ConnectionPublic, ProjectBundle } from '../../../api/client'
import { api } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
  onOpenConnections?: () => void
}

const SOURCE_CATALOG = [
  {
    id: 'hubspot',
    label: 'HubSpot',
    role: 'CRM source & writeback',
    detail: 'Pull contacts/companies and write enrichment fields back.'
  },
  {
    id: 'apollo',
    label: 'Apollo',
    role: 'Enrichment layer',
    detail: 'Title, firmographics, and contact data for missing CRM fields.'
  },
  {
    id: 'gmail',
    label: 'Gmail',
    role: 'Context / actions',
    detail: 'Prior threads and outbound actions from the tool surface.'
  },
  {
    id: 'manual',
    label: 'Project contacts',
    role: 'Local dataset',
    detail: 'Records already in this workspace (seeded or synced).'
  }
] as const

export function SourcesWorkspacePage({ bundle, onOpenConnections }: Props) {
  const [connections, setConnections] = useState<ConnectionPublic[]>([])

  useEffect(() => {
    void api.listConnections().then(setConnections).catch(() => setConnections([]))
  }, [])

  const statusFor = (id: string) => {
    if (id === 'manual') {
      return { label: `${bundle.contacts.length} records`, ok: bundle.contacts.length > 0 }
    }
    const conn = connections.find((c) => c.provider === id)
    if (!conn) return { label: 'Not connected', ok: false }
    if (conn.status === 'connected') {
      return { label: conn.accountLabel ?? 'Connected', ok: true }
    }
    return { label: conn.status, ok: false }
  }

  return (
    <div className="ide-page">
      <div className="ide-page-header">
        <div>
          <p className="ide-eyebrow">Sources</p>
          <h2>Data layers for this project</h2>
          <p className="ide-lede">
            Bind CRM, enrichment, and local datasets. Chat can add layers; connect credentials under
            Connections.
          </p>
        </div>
        {onOpenConnections ? (
          <button type="button" className="ghost-btn" onClick={onOpenConnections}>
            Manage connections
          </button>
        ) : null}
      </div>

      <div className="ide-source-grid">
        {SOURCE_CATALOG.map((source) => {
          const status = statusFor(source.id)
          return (
            <article key={source.id} className={`ide-source-card ${status.ok ? 'ready' : ''}`}>
              <div className="ide-source-top">
                <h3>{source.label}</h3>
                <span className={status.ok ? 'ide-pill ok' : 'ide-pill'}>{status.label}</span>
              </div>
              <p className="ide-source-role">{source.role}</p>
              <p className="muted">{source.detail}</p>
            </article>
          )
        })}
      </div>
    </div>
  )
}
