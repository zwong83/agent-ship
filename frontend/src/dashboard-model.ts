import type { ConfigSummary } from './api';
import type { RunDetail } from './run-api';

export const fleetLabels = { active: 'In progress', attention: 'Needs attention', completed: 'Completed', stopped: 'Stopped', idle: 'Awaiting launch' };
export type FleetState = keyof typeof fleetLabels;
const liveStates = new Set(['queued', 'preparing', 'running', 'waiting', 'needs_attention']);
const resolvedStates = new Set(['complete', 'completed', 'succeeded', 'skipped']);

/** Running scope includes actionable waits, but never historical/terminal runs. */
export const operationalRuns = (runs: RunDetail[]) => runs.filter(run => liveStates.has(run.state));
export const runBlocked = (run: RunDetail) => liveStates.has(run.state) && (
  ['waiting', 'needs_attention'].includes(run.state) || run.deviceStatus.connectivity === 'offline'
  || run.stages.some(stage => stage.nodes.some(node => ['waiting_reply', 'needs_attention', 'failed'].includes(node.state))));
export const canOpenChat = (run: RunDetail) => run.allowedActions.includes('open_repair_control');

export function liveFleetRows(requirements: ConfigSummary[], runs: RunDetail[]) {
  return fleetRows(requirements, operationalRuns(runs)).filter(row => row.runs.length > 0).map(row => {
    const blocked = row.runs.filter(runBlocked);
    return { ...row, state: (blocked.length ? 'attention' : 'active') as FleetState,
      alertRun: blocked.find(canOpenChat) ?? blocked[0] };
  });
}
export type LiveFleetRow = ReturnType<typeof liveFleetRows>[number];

/** Show active nodes in every concurrent stage; fall back to the first unresolved stage. */
export function executionRows(runs: RunDetail[]) {
  return operationalRuns(runs).flatMap(run => {
    const located = run.stages.flatMap(stage => stage.nodes.map(node => ({ stage, node })));
    let current = located.filter(({ node }) => ['running', 'ready', 'waiting_reply', 'needs_attention', 'failed'].includes(node.state));
    if (!current.length && !['queued', 'preparing'].includes(run.state)) {
      const nextStage = run.stages.find(stage => stage.nodes.some(node => !resolvedStates.has(node.state)));
      current = located.filter(({ stage, node }) => stage.id === nextStage?.id && !resolvedStates.has(node.state));
    }
    if (!current.length) return [{ key: run.id, run, stage: 'Preparation', node: run.state === 'queued' ? 'Waiting to start' : 'Repository preparation',
      state: run.state, coordinator: '', agents: [] as string[] }];
    return current.map(({ stage, node }) => {
      const roles = node.selectedRoles ?? [];
      const coordinator = roles.find(role => role.kind === 'coordinator')?.displayName
        ?? node.tasks.find(task => task.kind === 'coordinator')?.roleDisplayName ?? '';
      const agents = [...new Set(roles.length ? roles.filter(role => role.kind === 'agent').map(role => role.displayName)
        : node.tasks.filter(task => task.kind === 'agent').map(task => task.roleDisplayName ?? task.roleId ?? 'Assigned agent'))];
      return { key: run.id + ':' + node.nodeId + ':' + node.wave, run, stage: stage.name, node: node.name, state: node.state, coordinator, agents };
    });
  });
}

export function fleetRows(requirements: ConfigSummary[], runs: RunDetail[]) {
  return requirements.map(requirement => {
    const related = runs.filter(run => run.requirementId === requirement.id);
    const nodes = related.flatMap(run => run.stages.flatMap(stage => stage.nodes));
    const resolved = nodes.filter(node => resolvedStates.has(node.state)).length;
    const state: FleetState = related.some(run => ['failed', 'needs_attention', 'waiting'].includes(run.state)) ? 'attention'
      : related.some(run => liveStates.has(run.state)) ? 'active'
      : related.length && related.every(run => run.state === 'completed') ? 'completed' : related.length ? 'stopped' : 'idle';
    const online = related.some(run => liveStates.has(run.state) && run.deviceStatus.connectivity === 'online');
    return { requirement, runs: related, state, online, total: nodes.length, resolved, progress: nodes.length ? Math.round(resolved / nodes.length * 100) : null };
  }).sort((a, b) => a.requirement.name.localeCompare(b.requirement.name) || a.requirement.id.localeCompare(b.requirement.id));
}
export type FleetRow = ReturnType<typeof fleetRows>[number];

export function fleetMetrics(runs: RunDetail[]) {
  const nodes = runs.flatMap(run => run.stages.flatMap(stage => stage.nodes));
  const tasks = [...new Map(nodes.flatMap(node => node.tasks).filter(task => ['agent', 'coordinator'].includes(task.kind)).map(task => [task.taskId, task])).values()];
  const working = new Set(runs.filter(run => liveStates.has(run.state) && run.deviceStatus.connectivity === 'online')
    .flatMap(run => run.stages.flatMap(stage => stage.nodes.flatMap(node => node.tasks)))
    .filter(task => ['agent', 'coordinator'].includes(task.kind) && ['running', 'leased'].includes(task.state)).map(task => task.taskId));
  const artifacts = new Set(nodes.flatMap(node => node.artifactIds));
  const resolved = nodes.filter(node => resolvedStates.has(node.state)).length;
  return { total: nodes.length, resolved, progress: nodes.length ? Math.round(resolved / nodes.length * 100) : null,
    working: working.size, tasks: tasks.length, taskComplete: tasks.filter(task => task.state === 'succeeded').length,
    waiting: tasks.filter(task => task.state === 'waiting_reply').length,
    artifacts: artifacts.size, repairs: nodes.reduce((sum, node) => sum + (node.check?.automaticRepairCount ?? 0) + (node.check?.manualRepairCount ?? 0), 0),
    completed: runs.filter(run => run.state === 'completed').length,
    attention: runs.filter(runBlocked),
    devices: [...new Map(runs.map(run => [run.deviceStatus.id, run.deviceStatus])).values()],
  };
}
