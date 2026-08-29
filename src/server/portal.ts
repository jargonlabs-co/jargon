import type { DataStore } from './store'
import type { Project } from './types'

export interface PortalBuildShare {
  id: string
  label: string
  createdAt: number
  expiresAt: number
  revoked: boolean
  commentCount: number
}

export interface PortalBuild {
  project: Project
  contactCount: number
  shares: PortalBuildShare[]
}

export function listPortalBuilds(store: DataStore, orgId: string): PortalBuild[] {
  const projects = store.db.projects
    .filter((p) => p.orgId === orgId)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return projects.map((project) => {
    const contactCount = store.db.contacts.filter(
      (c) => c.orgId === orgId && c.projectId === project.id
    ).length
    const shares = store.db.shareLinks
      .filter((s) => s.orgId === orgId && s.projectId === project.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        id: s.id,
        label: s.label,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revoked: Boolean(s.revokedAt),
        commentCount: store.db.previewComments.filter((c) => c.shareLinkId === s.id).length
      }))
    return { project, contactCount, shares }
  })
}
