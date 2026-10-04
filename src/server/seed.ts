import type {
  Campaign,
  Contact,
  Database,
  Project,
  ProjectKind,
  Sequence,
  SequenceStep,
  WorkspaceSpec
} from './types'
import { uid } from './crypto'
import { formatChannels, specToAnswers, workspaceKindLabel } from '../shared/workspaceSpec'
import { setProjectCatalog } from './fieldCatalogSync'

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function seedProject(
  db: Database,
  input: {
    orgId: string
    prompt: string
    kind: ProjectKind
    answers: Record<string, string>
    contacts?: Contact[]
    spec: WorkspaceSpec
  }
): Project {
  const spec = input.spec
  const kind = spec.kind
  const segment = titleCase(spec.segment || input.answers.segment || 'Target accounts')
  const team = titleCase(input.answers.team ?? 'Sales')
  const label = workspaceKindLabel(spec)
  const prospectCount = input.answers.prospect_count ?? '100'
  const name =
    kind === 'today'
      ? segment !== 'HubSpot contacts' && segment !== 'Target accounts'
        ? `${segment} · ${label}`
        : label
      : segment !== 'General' && segment !== 'Target accounts' && segment !== 'HubSpot contacts'
        ? `${segment} ${label}`
        : `${team} ${label}`
  const now = Date.now()
  const orgId = input.orgId

  const project: Project = {
    id: uid('proj'),
    orgId,
    name,
    kind,
    prompt: input.prompt,
    segment,
    team,
    description: `${label} for ${segment} — ${formatChannels(spec.channels)}.`,
    answers: {
      ...specToAnswers(spec),
      ...input.answers,
      segment,
      channels: formatChannels(spec.channels),
      goal: spec.goal,
      primary_surface: spec.primarySurface
    },
    spec,
    createdAt: now,
    updatedAt: now
  }

  db.projects.unshift(project)

  if (input.contacts?.length) {
    db.contacts.push(...input.contacts.map((c) => ({ ...c, projectId: project.id, orgId })))
  }
  setProjectCatalog(db, project.id)

  const contactCount = db.contacts.filter((c) => c.projectId === project.id).length

  if (spec.channels.includes('call') || spec.primarySurface === 'queue' || spec.primarySurface === 'dial') {
    db.campaigns.push(...buildCampaigns(project, contactCount))
  }

  const { sequence, steps } = buildSequenceFromSpec(project, spec)
  db.sequences.push(sequence)
  db.steps.push(...steps)

  db.activities.unshift({
    id: uid('act'),
    orgId,
    projectId: project.id,
    kind: 'system',
    summary:
      contactCount > 0
        ? `Created ${project.name} with ${contactCount} contacts`
        : `Created ${project.name}. Connect HubSpot to load your contacts.`,
    createdAt: now
  })

  return project
}

function buildCampaigns(project: Project, contactCount: number): Campaign[] {
  const now = Date.now()
  const mode = project.answers.dial_mode ?? 'Click-to-call'
  const type = /parallel/i.test(mode)
    ? 'PARALLEL'
    : /click/i.test(mode)
      ? 'CLICK-TO-CALL'
      : 'BROADCAST'
  const goal = project.answers.goal ?? 'Book a meeting'

  return [
    {
      id: uid('camp'),
      orgId: project.orgId,
      projectId: project.id,
      name: project.kind === 'today' ? `Outbound sequence · ${contactCount} prospects` : `${project.segment} ${goal}`,
      state: 'ACTIVE',
      type,
      done: 0,
      total: contactCount,
      ringRatio: 100,
      answerRatio: 0,
      createdAt: now,
      updatedAt: now
    }
  ]
}

function buildSequenceFromSpec(
  project: Project,
  spec: WorkspaceSpec
): { sequence: Sequence; steps: SequenceStep[] } {
  const now = Date.now()
  const sequence: Sequence = {
    id: uid('seq'),
    orgId: project.orgId,
    projectId: project.id,
    name: `${formatChannels(spec.channels)} · ${spec.goal}`,
    goal: spec.goal,
    createdAt: now,
    updatedAt: now
  }
  const steps: SequenceStep[] = spec.steps.map((step, order) => ({
    id: uid('step'),
    orgId: project.orgId,
    sequenceId: sequence.id,
    projectId: project.id,
    day: step.day,
    channel: step.channel,
    label: step.label,
    subject: step.subject,
    body: step.body,
    mode: step.channel === 'email' && step.mode === 'auto' ? 'auto' : step.mode === 'manual' ? 'manual' : undefined,
    order
  }))
  return { sequence, steps }
}
