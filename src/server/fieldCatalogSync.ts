import { catalogFromContacts } from '../shared/fieldCatalog'
import type { Database } from './types'

export function setProjectCatalog(db: Database, projectId: string): void {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return
  project.fieldCatalog = catalogFromContacts(db.contacts.filter((c) => c.projectId === projectId))
}
