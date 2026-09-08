import type { AccountSnapshot, ConnectionPublic, PortalBuild } from '../../api'

export const ACCOUNT_NAV = [
  { id: 'overview', path: '/', label: 'Overview' },
  { id: 'usage', path: '/usage', label: 'Usage' },
  { id: 'billing', path: '/billing', label: 'Billing' },
  { id: 'data', path: '/data', label: 'Data' },
  { id: 'claude', path: '/claude', label: 'Claude connector' },
  { id: 'keys', path: '/keys', label: 'API keys' },
  { id: 'tools', path: '/tools', label: 'Tools' },
  { id: 'settings', path: '/settings', label: 'Settings' }
] as const

export type AccountPageId = (typeof ACCOUNT_NAV)[number]['id']

export function accountPageFromPath(pathname: string): AccountPageId {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/usage') return 'usage'
  if (path === '/billing') return 'billing'
  if (path === '/data') return 'data'
  if (path === '/claude') return 'claude'
  if (path === '/keys') return 'keys'
  if (path === '/tools') return 'tools'
  if (path === '/settings') return 'settings'
  return 'overview'
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}

export function formatWhen(value: string | number | null | undefined): string {
  if (value == null) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function statusLabel(conn: ConnectionPublic | undefined): string {
  if (!conn) return 'Not connected'
  if (conn.status === 'connected') return conn.accountLabel ?? 'Connected'
  return conn.status
}

export function previewSnapshot(): AccountSnapshot {
  return {
    credits: {
      orgId: 'org_demo',
      plan: 'free',
      planName: 'Free',
      status: 'active',
      credits: 82,
      included: 100,
      periodStart: new Date(Date.now() - 10 * 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 20 * 86400000).toISOString(),
      billingUrl: '/billing',
      payments: { provider: 'pending', ready: false },
      wallets: [
        { type: 'recurring', credits: 82, nextRefreshAt: new Date(Date.now() + 20 * 86400000).toISOString(), expiresAt: null },
        { type: 'topup', credits: 0, nextRefreshAt: null, expiresAt: null }
      ],
      creditTopups: []
    },
    usage: {
      periodStart: new Date(Date.now() - 10 * 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 20 * 86400000).toISOString(),
      totals: { credits: 18, emails: 8, calls: 2, linkedin: 0 },
      daily: [
        { day: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), credits: 10, emails: 5, calls: 1, linkedin: 0 },
        { day: new Date(Date.now() - 86400000).toISOString().slice(0, 10), credits: 8, emails: 3, calls: 1, linkedin: 0 }
      ],
      byProject: [
        { projectId: 'proj_demo', projectName: 'Outbound sequencer', credits: 18, emails: 8, calls: 2, linkedin: 0 }
      ]
    },
    catalog: {
      plans: [
        { id: 'free', name: 'Free', monthlyCredits: 100, amountCents: 0, description: 'Connect Claude and ship a couple of tools.' },
        { id: 'team', name: 'Team', monthlyCredits: 2000, amountCents: 4900, description: 'Monthly credits, live outbound, and top-ups.' },
        { id: 'scale', name: 'Scale', monthlyCredits: 20000, amountCents: 0, description: 'Custom grant and invoicing.' }
      ],
      packs: [
        { id: 'credits_500', credits: 500, amountCents: 2000, label: '500 credits' },
        { id: 'credits_2000', credits: 2000, amountCents: 6000, label: '2,000 credits' },
        { id: 'credits_10000', credits: 10000, amountCents: 25000, label: '10,000 credits' }
      ],
      costs: { email: 1, call: 5, linkedin: 2 }
    },
    claude: {
      connected: false,
      connectedAt: null,
      mcpUrl: 'https://jargon-api-production.up.railway.app/mcp',
      connectorUrl:
        'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Jargon&connectorUrl=https%3A%2F%2Fjargon-api-production.up.railway.app%2Fmcp'
    }
  }
}

export function fallbackSnapshot(): AccountSnapshot {
  const preview = previewSnapshot()
  return {
    ...preview,
    credits: {
      ...preview.credits,
      orgId: '',
      credits: 0,
      wallets: [
        { type: 'recurring', credits: 0, nextRefreshAt: preview.credits.periodEnd, expiresAt: null },
        { type: 'topup', credits: 0, nextRefreshAt: null, expiresAt: null }
      ],
      creditTopups: []
    },
    usage: {
      ...preview.usage,
      totals: { credits: 0, emails: 0, calls: 0, linkedin: 0 },
      daily: [],
      byProject: []
    }
  }
}
  {
    project: {
      id: 'proj_demo',
      name: 'Outbound sequencer',
      kind: 'today',
      prompt: 'Create an outbound sequencer',
      updatedAt: Date.now() - 86400000
    },
    contactCount: 24
  }
]
