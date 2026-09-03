import type { DataStore } from './store'
import type { Project } from './types'

export interface PortalBuild {
  project: Project
  contactCount: number
}

export function listPortalBuilds(store: DataStore, orgId: string): PortalBuild[] {
  const projects = store.db.projects
    .filter((p) => p.orgId === orgId)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return projects.map((project) => {
    const contactCount = store.db.contacts.filter(
      (c) => c.orgId === orgId && c.projectId === project.id
    ).length
    return { project, contactCount }
  })
}
