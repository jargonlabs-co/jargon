import type { ProjectBundle } from '../../../api/client'

interface Props {
  bundle: ProjectBundle
}

interface GraphNode {
  id: string
  label: string
  kind: string
}

function nodesFor(bundle: ProjectBundle): GraphNode[] {
  const kind = bundle.project.kind
  if (kind === 'today' || kind === 'list') {
    return [
      { id: 'src', label: 'Apollo / CRM list', kind: 'source' },
      { id: 'enrich', label: 'Enrich contacts', kind: 'enrich' },
      { id: 'map', label: 'Map fields', kind: 'map' },
      { id: 'queue', label: 'Review queue', kind: 'surface' }
    ]
  }
  if (kind === 'dialer') {
    return [
      { id: 'src', label: 'HubSpot segment', kind: 'source' },
      { id: 'enrich', label: 'Context enrich', kind: 'enrich' },
      { id: 'score', label: 'Priority score', kind: 'score' },
      { id: 'dial', label: 'Dial surface', kind: 'surface' }
    ]
  }
  if (kind === 'sequencer' || kind === 'cadence') {
    return [
      { id: 'src', label: 'Contact source', kind: 'source' },
      { id: 'filter', label: 'Filter / ICP', kind: 'filter' },
      { id: 'steps', label: 'Sequence steps', kind: 'action' },
      { id: 'tool', label: 'Sequencer UI', kind: 'surface' }
    ]
  }
  return [
    { id: 'src', label: 'CRM source', kind: 'source' },
    { id: 'enrich', label: 'Enrichment', kind: 'enrich' },
    { id: 'approve', label: 'Human approve', kind: 'approve' },
    { id: 'write', label: 'CRM writeback', kind: 'writeback' },
    { id: 'tool', label: 'Internal tool', kind: 'surface' }
  ]
}

export function WorkflowWorkspacePage({ bundle }: Props) {
  const nodes = nodesFor(bundle)

  return (
    <div className="ide-page workflow-page">
      <div className="ide-page-header">
        <div>
          <p className="ide-eyebrow">Workflow</p>
          <h2>Compose enrichment & automation</h2>
          <p className="ide-lede">
            Drag layers into a pipeline. Chat edits this graph — Sources → transform → actions →
            Tool.
          </p>
        </div>
      </div>

      <div className="ide-graph" role="img" aria-label="Workflow graph preview">
        {nodes.map((node, index) => (
          <div key={node.id} className="ide-graph-step">
            <div className={`ide-graph-node kind-${node.kind}`}>
              <span className="ide-graph-kind">{node.kind}</span>
              <strong>{node.label}</strong>
            </div>
            {index < nodes.length - 1 ? <div className="ide-graph-edge" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>

      <p className="ide-hint">
        Visual node editing lands next — for now this graph mirrors the project template. Describe
        changes in chat (e.g. “add Apollo enrich before writeback”).
      </p>
    </div>
  )
}
