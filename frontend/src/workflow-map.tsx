import { useId } from 'react';
import type { FlowStage } from './api';
import { nodeTypeLabels } from './workflow-model';

type Props = { stages: FlowStage[]; selectedId: string | null; select: (id: string) => void };

export function WorkflowMap({ stages, selectedId, select }: Props) {
  const marker = useId().replace(/:/g, '');
  const width = Math.max(700, ...stages.map(stage => 190 + stage.nodes.length * 190));
  const height = Math.max(90, stages.length * 110 + 30);
  const positions = new Map(stages.flatMap((stage, stageIndex) => stage.nodes.map((node, nodeIndex) =>
    [node.id, { x: 180 + nodeIndex * 190, y: 30 + stageIndex * 110 }] as const)));
  const nodes = stages.flatMap(stage => stage.nodes);

  return <section className="flow-map" aria-label="流程依赖图">
    <div className="flow-map-heading"><span>流程全景</span><div className="flow-legend"><span>实线 · 前置依赖</span><span className="pass">虚线 · 通过</span><span className="repair">虚线 · 需修复</span></div></div>
    {stages.length ? <div className="flow-map-scroll" tabIndex={0} aria-label="可横向滚动的流程图">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="group" aria-label="阶段与节点依赖关系，可选择节点编辑">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#648ba6" /></marker></defs>
        {stages.map((stage, index) => <g key={stage.id}><line x1="14" x2={width - 12} y1={index * 110 + 102} y2={index * 110 + 102} className="map-stage-line" /><text x="20" y={index * 110 + 48} className="map-stage-number">{String(index + 1).padStart(2, '0')}</text><text x="20" y={index * 110 + 70} className="map-stage-name">{stage.name.length > 10 ? stage.name.slice(0, 10) + '…' : stage.name}</text></g>)}
        {nodes.flatMap(node => {
          const target = positions.get(node.id)!;
          return node.dependencies.flatMap(id => {
            const source = positions.get(id);
            if (!source) return [];
            return <path key={id + node.id} d={`M ${source.x + 75} ${source.y + 48} C ${source.x + 75} ${source.y + 80}, ${target.x + 75} ${target.y - 22}, ${target.x + 75} ${target.y}`} className="map-dependency" markerEnd={`url(#${marker})`} />;
          });
        })}
        {nodes.flatMap(node => {
          const source = positions.get(node.id)!;
          return node.checkRoutes ? (['pass', 'repair'] as const).flatMap(outcome => {
            const target = positions.get(outcome === 'pass' ? node.checkRoutes!.passNodeId : node.checkRoutes!.repairNodeId);
            if (!target) return [];
            return <path key={node.id + outcome} d={`M ${source.x + 150} ${source.y + 24} C ${source.x + 185} ${source.y + 24}, ${target.x + 185} ${target.y + 24}, ${target.x + 150} ${target.y + 24}`} className={'map-route ' + outcome} />;
          }) : [];
        })}
        {nodes.map(node => {
          const position = positions.get(node.id)!;
          return <g key={node.id} role="button" tabIndex={0} aria-label={'在图中编辑 ' + node.name} className={'map-node ' + (selectedId === node.id ? 'selected' : '')}
            onClick={() => select(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); } }}>
            <title>{node.name} · {nodeTypeLabels[node.type]}</title><rect x={position.x} y={position.y} width="150" height="48" rx="7" />
            <circle cx={position.x + 13} cy={position.y + 14} r="3" className={node.type === 'end' ? 'end' : ''} />
            <text x={position.x + 24} y={position.y + 18} className="map-node-name">{node.name.length > 11 ? node.name.slice(0, 11) + '…' : node.name}</text>
            <text x={position.x + 13} y={position.y + 36} className="map-node-kind">{nodeTypeLabels[node.type]}{node.type !== 'end' ? ` · ${1 + (node.agentIds?.length ?? 0)} Agent` : ''}</text>
          </g>;
        })}
      </svg>
    </div> : <p className="subtle">添加阶段后，阶段顺序和节点依赖将在这里显示。</p>}
  </section>;
}
