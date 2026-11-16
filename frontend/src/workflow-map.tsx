import { useId } from 'react';
import { createPortal } from 'react-dom';
import type { FlowStage } from './api';
import { dependencyIssue, nodeTypeLabels } from './workflow-model';
import { useWorkflowConnection } from './use-workflow-connection';
import { statusText } from './run-api';
import { workflowConnectionTone, workflowNodeTone, type WorkflowTone } from './workflow-progress';

type Props = { stages: FlowStage[]; selectedId?: string | null; select?: (id: string) => void; vertical?: boolean;
  onConnect?: (source: string, target: string) => void; execution?: { states: Record<string, string>; executing: boolean } };
type Position = { x: number; y: number };
const nodeWidth = 176;
const nodeHeight = 76;
const stageHeight = 156;

function connectionPath(source: Position, target: Position, offset = 32, vertical = false) {
  const startX = source.x + nodeWidth / 2;
  const endX = target.x + nodeWidth / 2;
  const startY = source.y + nodeHeight;
  if (vertical && (target.y - source.y > 170 || target.y < source.y)) {
    const side = source.x - offset;
    return `M ${startX} ${startY} C ${startX} ${startY + 26}, ${side} ${startY + 26}, ${side} ${startY + 44} L ${side} ${target.y - 32} Q ${side} ${target.y - 18}, ${endX - 18} ${target.y - 18} Q ${endX} ${target.y - 18}, ${endX} ${target.y}`;
  }
  if (source.y === target.y) return `M ${startX} ${startY} C ${startX} ${startY + offset}, ${endX} ${startY + offset}, ${endX} ${startY}`;
  if (source.y < target.y) return `M ${startX} ${startY} C ${startX} ${(startY + target.y) / 2}, ${endX} ${(startY + target.y) / 2}, ${endX} ${target.y}`;
  const side = Math.max(source.x, target.x) + nodeWidth + offset;
  return `M ${source.x + nodeWidth} ${source.y + nodeHeight / 2} C ${side} ${source.y + nodeHeight / 2}, ${side} ${target.y + nodeHeight / 2}, ${target.x + nodeWidth} ${target.y + nodeHeight / 2}`;
}

function Connection({ path, tone, marker, route, label }: { path: string; tone: WorkflowTone; marker: string; route?: string; label: string }) {
  return <g className={'map-cable tone-' + tone + (route ? ' route-' + route : '')}>
    <title>{label}</title><path d={path} className="cable-shadow" /><path d={path} className="cable-body" />
    <path d={path} className="cable-core" markerEnd={`url(#${marker})`} />
    {(tone === 'active' || tone === 'preview') && <path d={path} className="cable-packet" pathLength="100" aria-hidden="true" />}
  </g>;
}

export function WorkflowMap({ stages, selectedId, select, execution, vertical = false, onConnect }: Props) {
  const id = 'workflow-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const connection = useWorkflowConnection(stages, execution ? undefined : onConnect);
  const editable = Boolean(onConnect && !execution);
  let stageTop = 0;
  const stageBoxes = stages.map(stage => {
    const box = { top: stageTop, height: Math.max(1, stage.nodes.length) * 130 + 60 };
    stageTop += box.height;
    return box;
  });
  const width = vertical ? 320 : Math.max(720, ...stages.map(stage => 220 + stage.nodes.length * 246));
  const height = vertical ? Math.max(130, stageTop) : Math.max(100, stages.length * stageHeight + 36);
  const positions = new Map(stages.flatMap((stage, stageIndex) => stage.nodes.map((node, nodeIndex) =>
    [node.id, vertical ? { x: 76, y: stageBoxes[stageIndex].top + 64 + nodeIndex * 130 } : { x: 180 + nodeIndex * 246, y: 36 + stageIndex * stageHeight }] as const)));
  const nodes = stages.flatMap(stage => stage.nodes);
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const tone = (nodeId: string) => workflowNodeTone(execution ? execution.states[nodeId] ?? 'pending' : undefined, execution?.executing ?? false);
  const source = connection.sourceId ? positions.get(connection.sourceId) : null;
  return <section className={'flow-map spatial-workflow-map' + (vertical ? ' vertical-network' : '')} aria-label={execution ? 'Workflow execution map' : 'Process dependency graph'}>
    <div className="flow-map-heading"><div><span className="eyebrow">{execution ? 'LIVE EXECUTION / WORKFLOW' : 'WORKFLOW / SPATIAL VIEW'}</span><strong>{execution ? 'Execution network' : 'Workflow network'}</strong></div><span className="map-mode">{execution ? 'Recorded node states' : 'Design preview · not live progress'}</span></div>
    <div className="map-state-legend">{execution ? <><span className="active">● Running</span><span className="complete">✓ Completed</span><span className="attention">! Attention</span><span>○ Pending</span><span>— Skipped</span></> : <><span>→ Dependency</span><span className="complete">↗ Pass route</span><span className="attention">↗ Repair route</span></>}</div>
    {editable && <div className="network-connect-help"><p>Drag OUT → IN, or click each port.<br />Escape cancels a connection.</p><button type="button" aria-label="Cancel connection" disabled={!connection.sourceId} onClick={connection.cancel}>Cancel</button></div>}
    {connection.notice && createPortal(<div className={'workflow-connection-toast' + (connection.notice.error ? ' error' : '')} role="status"><span>{connection.notice.text}</span><button type="button" aria-label="Dismiss connection message" onClick={connection.dismiss}>×</button></div>, document.body)}
    {stages.length ? <div ref={connection.scroller} className="flow-map-scroll" tabIndex={0} aria-label="Scrollable workflow network">
      <svg ref={connection.svg} viewBox={`0 0 ${width} ${height}`} style={{ minWidth: vertical ? undefined : width }} role="group" aria-label={execution ? 'Node execution states and dependencies' : 'Stage and node dependency, node editing can be selected'}
        onPointerMove={connection.move} onPointerUp={connection.release} onPointerCancel={connection.cancel}>
        <defs>
          <linearGradient id={id + '-face'} x2=".9" y2="1"><stop stopColor="#315d70" /><stop offset=".48" stopColor="#1a384c" /><stop offset="1" stopColor="#102436" /></linearGradient>
          <linearGradient id={id + '-side'} x2="0" y2="1"><stop stopColor="#1d4659" /><stop offset="1" stopColor="#081421" /></linearGradient>
          <linearGradient id={id + '-shine'}><stop stopColor="#c8fff1" stopOpacity=".75" /><stop offset="1" stopColor="#8bd9e8" stopOpacity="0" /></linearGradient>
          <marker id={id + '-arrow'} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 1 L 8 5 L 0 9" fill="none" stroke="#a2dbda" strokeWidth="1.5" /></marker>
        </defs>
        {stages.map((stage, index) => <g key={stage.id} className="map-stage-platform"><rect x={vertical ? 12 : 160} y={vertical ? stageBoxes[index].top + 8 : index * stageHeight + 22} width={vertical ? 296 : width - 176} height={vertical ? stageBoxes[index].height - 20 : 112} rx="16" /><text x="24" y={vertical ? stageBoxes[index].top + 36 : index * stageHeight + 62} className="map-stage-number">{String(index + 1).padStart(2, '0')}</text><text x={vertical ? 58 : 20} y={vertical ? stageBoxes[index].top + 34 : index * stageHeight + 84} className="map-stage-name"><title>{stage.name}</title>{stage.name.length > 23 ? stage.name.slice(0, 22) + '…' : stage.name}</text>{vertical && !stage.nodes.length && <text x="58" y={stageBoxes[index].top + 98} className="map-stage-name">Add a node in stage settings</text>}</g>)}
        {nodes.flatMap(node => node.dependencies.flatMap(dependency => {
          const source = positions.get(dependency);
          return source ? <Connection key={dependency + ':' + node.id} path={connectionPath(source, positions.get(node.id)!, 24 + (nodes.findIndex(value => value.id === dependency) % 4) * 8, vertical)} tone={workflowConnectionTone(tone(dependency), tone(node.id))} marker={id + '-arrow'} label={(nodeById.get(dependency)?.name ?? dependency) + ' → ' + node.name} /> : [];
        }))}
        {nodes.flatMap(node => node.checkRoutes ? (['pass', 'repair'] as const).flatMap(outcome => {
          const targetId = outcome === 'pass' ? node.checkRoutes!.passNodeId : node.checkRoutes!.repairNodeId;
          const target = positions.get(targetId);
          return target ? <Connection key={node.id + outcome} path={connectionPath(positions.get(node.id)!, target, outcome === 'pass' ? 44 : 56, vertical)} tone={workflowConnectionTone(tone(node.id), tone(targetId))} route={outcome} marker={id + '-arrow'} label={node.name + ' · ' + outcome + ' route'} /> : [];
        }) : [])}
        {nodes.map(node => {
          const position = positions.get(node.id)!;
          const nodeTone = tone(node.id);
          const status = execution ? statusText(execution.states[node.id] ?? 'pending') : nodeTypeLabels[node.type];
          return <g key={node.id} transform={`translate(${position.x} ${position.y})`} role={select ? 'button' : 'group'} tabIndex={select ? 0 : undefined}
            aria-label={(select ? 'Edit in picture ' : '') + node.name + (execution ? ': ' + status : '')}
            className={'spatial-map-node tone-' + nodeTone + (selectedId === node.id ? ' selected' : '')}
            onClick={select ? () => select(node.id) : undefined} onKeyDown={select ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); } } : undefined}>
            <title>{node.name + ' · ' + status}</title>
            <rect className="node-ground-shadow" x="3" y="13" width={nodeWidth} height={nodeHeight} rx="11" />
            <rect className="node-thickness" x="0" y="8" width={nodeWidth} height={nodeHeight} rx="11" fill={`url(#${id}-side)`} />
            <rect className="node-face" width={nodeWidth} height={nodeHeight} rx="11" fill={`url(#${id}-face)`} />
            <path className="node-bevel" d="M 11 1 H 165 Q 175 1 175 11" stroke={`url(#${id}-shine)`} />
            <rect className="node-chip" x="12" y="13" width="24" height="24" rx="7" />
            <text className="node-glyph" x="24" y="30" textAnchor="middle">{nodeTone === 'complete' ? '✓' : nodeTone === 'attention' ? '!' : node.type === 'check' ? '◇' : node.type === 'end' ? '■' : '▣'}</text>
            <text x="45" y="28" className="map-node-name">{node.name.length > 17 ? node.name.slice(0, 16) + '…' : node.name}</text>
            <text x="13" y="54" className="map-node-kind">{status.length > 27 ? status.slice(0, 26) + '…' : status}</text>
            <path className="node-status-rail" d="M 14 66 H 162" />
            {(nodeTone === 'active' || nodeTone === 'preview') && <path className="node-status-light" d="M 14 66 H 162" pathLength="100" aria-hidden="true" />}
          </g>;
        })}
        {editable && nodes.map(node => {
          const position = positions.get(node.id)!;
          const issue = connection.sourceId ? dependencyIssue(stages, connection.sourceId, node.id) : null;
          return <g key={node.id + '-ports'}>
            <g transform={`translate(${position.x + nodeWidth / 2} ${position.y})`} className={'network-port input-port' + (connection.sourceId ? issue ? ' unavailable' : ' eligible' : '') + (connection.hoverId === node.id ? ' hovered' : '')}
              role="button" tabIndex={0} aria-label={'Connect to ' + node.name} data-input-node={node.id}
              onClick={() => connection.finish(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); connection.finish(node.id); } }}>
              <title>{issue ?? 'Input: connect a preceding node'}</title><circle className="port-hit" r="22" /><circle className="port-ring" r="8" /><circle className="port-core" r="3" /><text x="17" y="-9">IN</text>
            </g>
            {node.type !== 'end' && <g transform={`translate(${position.x + nodeWidth / 2} ${position.y + nodeHeight})`} className={'network-port output-port' + (connection.sourceId === node.id ? ' armed' : '')}
              role="button" tabIndex={0} aria-label={'Start connection from ' + node.name} aria-pressed={connection.sourceId === node.id}
              onPointerDown={event => connection.startDrag(event, node.id)} onClick={() => connection.chooseOutput(node.id)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); connection.chooseOutput(node.id); } }}>
              <title>Output: drag or click to connect</title><circle className="port-hit" r="22" /><circle className="port-ring" r="8" /><circle className="port-core" r="3" /><text x="17" y="22">OUT</text>
            </g>}
          </g>;
        })}
        {source && connection.point && <path className="connection-draft" d={`M ${source.x + nodeWidth / 2} ${source.y + nodeHeight} C ${source.x + nodeWidth / 2} ${source.y + nodeHeight + 45}, ${connection.point.x} ${connection.point.y - 45}, ${connection.point.x} ${connection.point.y}`} />}
      </svg>
    </div> : <p className="subtle">Add a stage to build your workflow network.</p>}
  </section>;
}
