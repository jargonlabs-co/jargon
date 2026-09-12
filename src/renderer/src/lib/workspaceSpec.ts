import type { Project } from '../api/types'
import type { NavItem } from '../components/workspace/ProductShell'
import {
  channelLabel,
  formatChannels,
  hasChannel,
  motionComplete,
  nextChannel,
  specFromProject,
  workspaceKindLabel,
  type WorkspaceSpec
} from '../../../shared/workspaceSpec'
import { interpolateTemplate } from '../../../shared/fieldCatalog'

export {
  channelLabel,
  formatChannels,
  hasChannel,
  interpolateTemplate,
  motionComplete,
  nextChannel,
  specFromProject,
  workspaceKindLabel
}
export type { WorkspaceSpec }

export function specOf(project: Project): WorkspaceSpec {
  return specFromProject(project)
}

export function defaultPage(spec: WorkspaceSpec): string {
  switch (spec.primarySurface) {
    case 'dial':
      return 'context'
    case 'sequence':
      return 'sequences'
    case 'inbox':
      return 'inbox'
    case 'linkedin':
    case 'queue':
    default:
      return spec.kind === 'sequencer' ? 'sequences' : 'context'
  }
}

export function continuePage(spec: WorkspaceSpec): string {
  switch (spec.primarySurface) {
    case 'dial':
      return 'dial'
    case 'inbox':
      return 'inbox'
    case 'linkedin':
      return 'today'
    case 'sequence':
      return hasChannel(spec, 'email') || hasChannel(spec, 'linkedin') ? 'inbox' : 'today'
    default:
      return spec.channels.length === 1 && spec.channels[0] === 'call' ? 'dial' : 'today'
  }
}

export function inboxLabel(spec: WorkspaceSpec): string {
  if (hasChannel(spec, 'linkedin') && !hasChannel(spec, 'email')) return 'LinkedIn'
  return 'Inbox'
}

export function queueLabel(spec: WorkspaceSpec): string {
  if (spec.primarySurface === 'linkedin' || (spec.channels.length === 1 && spec.channels[0] === 'linkedin')) {
    return 'LinkedIn queue'
  }
  return 'Daily tasks'
}

export function navForSpec(spec: WorkspaceSpec): NavItem[] {
  const sharedTail: NavItem[] = [
    { id: 'connections', label: 'Connections', section: 'system' },
    { id: 'settings', label: 'Settings', section: 'system' },
    { id: 'help', label: 'Help', section: 'system' }
  ]
  const items: NavItem[] = [{ id: 'context', label: 'Context' }]
  const showDashboard = spec.primarySurface === 'dial' || spec.kind === 'generic'
  const showCampaigns = hasChannel(spec, 'call') && spec.primarySurface === 'dial'
  const showSequence = spec.steps.length > 0
  const showQueue =
    spec.primarySurface === 'queue' ||
    spec.primarySurface === 'linkedin' ||
    spec.kind === 'today' ||
    spec.channels.length > 1
  const showDial = hasChannel(spec, 'call')
  const showInbox = hasChannel(spec, 'email') || hasChannel(spec, 'linkedin')

  if (showDashboard) items.push({ id: 'dashboard', label: 'Dashboard' })
  if (showCampaigns) items.push({ id: 'campaigns', label: 'Campaigns' })
  if (showSequence) items.push({ id: 'sequences', label: 'Sequence' })
  if (showQueue) items.push({ id: 'today', label: queueLabel(spec) })
  if (showDial) items.push({ id: 'dial', label: 'Dial console' })
  if (showInbox) items.push({ id: 'inbox', label: inboxLabel(spec) })
  items.push({ id: 'contacts', label: 'Contacts' })
  items.push({ id: 'analytics', label: 'Analytics' })
  return [...items, ...sharedTail]
}

export function primaryAction(spec: WorkspaceSpec): { page: string; label: string } {
  if (spec.primarySurface === 'dial' || (spec.channels.length === 1 && spec.channels[0] === 'call')) {
    return { page: 'dial', label: 'Open dial console' }
  }
  if (spec.channels.length === 1 && spec.channels[0] === 'linkedin') {
    return { page: 'today', label: 'Open LinkedIn queue' }
  }
  if (spec.primarySurface === 'sequence') return { page: 'sequences', label: 'Open sequence' }
  if (hasChannel(spec, 'email')) return { page: 'inbox', label: 'Open inbox' }
  if (hasChannel(spec, 'linkedin')) return { page: 'inbox', label: 'Open LinkedIn' }
  return { page: 'today', label: 'Open queue' }
}
