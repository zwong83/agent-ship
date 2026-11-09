import type { FlowNode, FlowStage } from './api';

export const nodeTypeLabels: Record<FlowNode['type'], string> = {
  work: '工作节点', check: '检查节点', publish: '发布节点', end: '结束节点',
};

export const nodePurposeLabels: Record<NonNullable<FlowNode['purpose']>, string> = {
  requirement: '需求', product: '产品设计', frontend: '前端开发', backend: '后端开发',
  test: '测试', repair: '修复', other: '其他',
};

export function newNode(type: FlowNode['type'] = 'work'): FlowNode {
  const base = { id: crypto.randomUUID(), name: type === 'end' ? '流程结束' : '新节点', type, dependencies: [] };
  return type === 'end' ? base : { ...base, purpose: 'other', coordinatorId: '', agentIds: [], agentOrder: 'parallel' };
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
  if (!stages.length) issues.push('请添加至少一个阶段。');
  if (ends.length !== 1) issues.push('流程必须有且只有一个结束节点。');
  if (ends.length === 1 && nodes.at(-1)?.id !== ends[0].id) issues.push('结束节点必须位于最后一个阶段的最后。');
  for (const [index, stage] of stages.entries()) {
    if (!stage.name.trim()) issues.push(`阶段 ${index + 1} 需要名称。`);
    if (!stage.nodes.length) issues.push(`阶段「${stage.name || index + 1}」需要至少一个节点。`);
    for (const node of stage.nodes) {
      const name = node.name.trim() || '未命名节点';
      if (!node.name.trim()) issues.push(`阶段「${stage.name}」中有节点尚未命名。`);
      if (node.type !== 'end' && !node.coordinatorId) issues.push(`「${name}」需要选择协调 Agent。`);
      if (node.type === 'publish' || node.publication) issues.push(`「${name}」使用了尚未开放的正式发布配置。`);
      if (node.agentIds?.includes(node.coordinatorId ?? '')) issues.push(`「${name}」的协调 Agent 不能同时作为子 Agent。`);
      for (const dependency of node.dependencies) {
        if (!byId.has(dependency)) issues.push(`「${name}」引用了已不存在的前置节点。`);
        else if (byId.get(dependency)?.type === 'end') issues.push(`「${name}」不能依赖结束节点。`);
        else if ((stageIndex.get(dependency) ?? -1) > index) issues.push(`「${name}」不能依赖更晚阶段的节点。`);
      }
      if (node.type === 'check') {
        if (!node.checkRoutes?.passNodeId || !node.checkRoutes?.repairNodeId) issues.push(`「${name}」需要配置通过和需修复两条路线。`);
        else if (node.checkRoutes.passNodeId === node.checkRoutes.repairNodeId) issues.push(`「${name}」的两条路线需要不同的入口。`);
        if (!Number.isInteger(node.checkRoutes?.automaticRepairLimit) || (node.checkRoutes?.automaticRepairLimit ?? -1) < 0) issues.push(`「${name}」的自动修复上限需要填写零或正整数。`);
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
  if (nodes.some(node => cyclic(node.id))) issues.push('有循环依赖，请调整节点之间的前置关系。');
  return issues;
}
