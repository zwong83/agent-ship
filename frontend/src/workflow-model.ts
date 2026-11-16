import type { FlowNode, FlowStage } from './api';

export const nodeTypeLabels: Record<FlowNode['type'], string> = {
  work: 'Work node', check: 'Check node', publish: 'Publish node', end: 'End node',
};

export function newNode(type: FlowNode['type'] = 'work'): FlowNode {
  const base = { id: crypto.randomUUID(), name: type === 'end' ? 'End of workflow' : 'New node', type, dependencies: [] };
  return type === 'end' ? base : { ...base, collectRequirements: false, coordinatorId: '', agentIds: [], agentOrder: 'parallel' };
}

export function moveItem<T>(items: T[], index: number, direction: number) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const moved = [...items];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}

export function replaceNode(stages: FlowStage[], node: FlowNode) {
  return stages.map(stage => ({ ...stage, nodes: stage.nodes.map(current => current.id === node.id ? node : current) }));
}

/** Validate a source → dependent connection before changing the draft. */
export function dependencyIssue(stages: FlowStage[], sourceId: string, targetId: string): string | null {
  const nodes = new Map(stages.flatMap(stage => stage.nodes.map(node => [node.id, node] as const)));
  const source = nodes.get(sourceId);
  const target = nodes.get(targetId);
  if (!source || !target) return 'Select two nodes that exist in this workflow.';
  if (sourceId === targetId) return 'A node cannot depend on itself.';
  if (source.type === 'end') return 'The end node cannot start a dependency.';
  if (target.dependencies.includes(sourceId)) return 'These nodes are already connected.';
  const stageOf = (id: string) => stages.findIndex(stage => stage.nodes.some(node => node.id === id));
  if (stageOf(sourceId) > stageOf(targetId)) return 'Connect to a node in the same stage or a later stage.';
  const visited = new Set<string>();
  function reachesTarget(id: string): boolean {
    if (id === targetId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return nodes.get(id)?.dependencies.some(reachesTarget) ?? false;
  }
  if (reachesTarget(sourceId)) return 'This connection would create a circular dependency.';
  return null;
}

export function removeNodes(stages: FlowStage[], removed: Set<string>) {
  return stages.map(stage => ({
    ...stage,
    nodes: stage.nodes.filter(node => !removed.has(node.id)).map(node => {
      const next = { ...node, dependencies: node.dependencies.filter(id => !removed.has(id)) };
      if (next.route && removed.has(next.route.checkNodeId)) delete next.route;
      if (next.checkRoutes) next.checkRoutes = {
        ...next.checkRoutes,
        passNodeId: removed.has(next.checkRoutes.passNodeId) ? '' : next.checkRoutes.passNodeId,
        repairNodeId: removed.has(next.checkRoutes.repairNodeId) ? '' : next.checkRoutes.repairNodeId,
      };
      return next;
    }),
  }));
}

export function workflowIssues(stages: FlowStage[]) {
  const issues: string[] = [];
  const nodes = stages.flatMap(stage => stage.nodes);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const stageIndex = new Map(stages.flatMap((stage, index) => stage.nodes.map(node => [node.id, index] as const)));
  const ends = nodes.filter(node => node.type === 'end');
  if (!stages.length) issues.push('Please add at least one stage.');
  if (ends.length !== 1) issues.push('A process must have one and only one end node.');
  if (ends.length === 1 && nodes.at(-1)?.id !== ends[0].id) issues.push('The end node must be at the end of the last stage.');
  for (const [index, stage] of stages.entries()) {
    if (!stage.name.trim()) issues.push(`Stage ${index + 1} needs a name.`);
    if (!stage.nodes.length) issues.push(`Stage "${stage.name || index + 1}" needs at least one node.`);
    for (const node of stage.nodes) {
      const name = node.name.trim() || 'Unnamed node';
      if (!node.name.trim()) issues.push(`Stage "${stage.name}" contains an Unnamed node.`);
      if (node.type !== 'end' && !node.coordinatorId) issues.push(`Select a coordinator for "${name}".`);
      if (node.type === 'publish' || node.publication) issues.push(`Production publishing is not yet available for "${name}".`);
      if (node.agentIds?.includes(node.coordinatorId ?? '')) issues.push(`The coordinator for "${name}" cannot also be a sub-agent.`);
      for (const dependency of node.dependencies) {
        if (!byId.has(dependency)) issues.push(`"${name}" references a dependency that no longer exists.`);
        else if (byId.get(dependency)?.type === 'end') issues.push(`"${name}" cannot depend on the end node.`);
        else if ((stageIndex.get(dependency) ?? -1) > index) issues.push(`"${name}" cannot depend on a later stage.`);
      }
      if (node.type === 'check') {
        if (!node.checkRoutes?.passNodeId || !node.checkRoutes?.repairNodeId) issues.push(`Configure both pass and repair routes for "${name}".`);
        else if (node.checkRoutes.passNodeId === node.checkRoutes.repairNodeId) issues.push(`The routes for "${name}" must have different entry nodes.`);
        if (!Number.isInteger(node.checkRoutes?.automaticRepairLimit) || (node.checkRoutes?.automaticRepairLimit ?? -1) < 0) issues.push(`The repair limit for "${name}" must be a nonnegative integer.`);
      }
    }
  }
  const visiting = new Set<string>();
  const complete = new Set<string>();
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true;
    if (complete.has(id)) return false;
    visiting.add(id);
    if (byId.get(id)?.dependencies.some(cyclic)) return true;
    visiting.delete(id);
    complete.add(id);
    return false;
  }
  if (nodes.some(node => cyclic(node.id))) issues.push('Circular dependencies detected. Update the node dependencies.');
  return issues;
}
