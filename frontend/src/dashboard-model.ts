import type { ConfigSummary } from './api';
import type { RunDetail, RunNode } from './run-api';

export const fleetLabels = { active: 'In progress', attention: 'Needs attention', completed: 'Completed', stopped: 'Stopped', idle: 'Awaiting launch' };
export type FleetState = keyof typeof fleetLabels;
const liveStates = new Set(['queued', 'preparing', 'running', 'waiting', 'needs_attention']);
const resolvedStates = new Set(['complete', 'completed', 'succeeded', 'skipped']);

function currentNodeLocations(run: RunDetail) {
  const latest = new Map<string, { stage: RunDetail['stages'][number]; node: RunNode }>();
  run.stages.forEach((stage, stageIndex) => stage.nodes.forEach((node, nodeIndex) => {
    const key = node.nodeId ?? `${stageIndex}:${nodeIndex}`;
    const previous = latest.get(key);
    if (!previous || (node.wave ?? 0) > (previous.node.wave ?? 0)) latest.set(key, { stage, node });
  }));
  return [...latest.values()];
}

/** Repair history remains available, but only the latest wave describes current work. */
export const currentNodes = (run: RunDetail) => currentNodeLocations(run).map(({ node }) => node);

/** Running scope includes actionable waits, but never historical/terminal runs. */
export const operationalRuns = (runs: RunDetail[]) => runs.filter(run => liveStates.has(run.state));
export const runBlocked = (run: RunDetail) => liveStates.has(run.state) && (
  ['waiting', 'needs_attention'].includes(run.state) || run.deviceStatus.connectivity === 'offline'
  || currentNodes(run).some(node => ['waiting_reply', 'needs_attention', 'failed'].includes(node.state)));
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
    const located = currentNodeLocations(run);
    let current = located.filter(({ node }) => ['running', 'ready', 'waiting_reply', 'needs_attention', 'failed'].includes(node.state));
    if (!current.length && !['queued', 'preparing'].includes(run.state)) {
      const nextStage = located.find(({ node }) => !resolvedStates.has(node.state))?.stage;
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
    const nodes = related.flatMap(currentNodes);
    const resolved = nodes.filter(node => resolvedStates.has(node.state)).length;
    const state: FleetState = related.some(run => ['failed', 'needs_attention', 'waiting'].includes(run.state)) ? 'attention'
      : related.some(run => liveStates.has(run.state)) ? 'active'
      : related.length && related.every(run => run.state === 'completed') ? 'completed' : related.length ? 'stopped' : 'idle';
    const online = related.some(run => liveStates.has(run.state) && run.deviceStatus.connectivity === 'online');
    return { requirement, runs: related, state, online, total: nodes.length, resolved, progress: nodes.length ? Math.round(resolved / nodes.length * 100) : null };
  }).sort((a, b) => a.requirement.name.localeCompare(b.requirement.name) || a.requirement.id.localeCompare(b.requirement.id));
}
export type FleetRow = ReturnType<typeof fleetRows>[number];

export type CatalogStatus = 'running' | 'blocked' | 'queued' | 'not_started' | 'completed' | 'failed' | 'stopped' | 'history';
export type CatalogFilter = 'all' | 'running' | 'blocked' | 'queued';
export const catalogStatusLabels: Record<CatalogStatus, string> = {
  running: 'Running', blocked: 'Blocked', queued: 'Queued', not_started: 'Not started',
  completed: 'Completed', failed: 'Failed', stopped: 'Stopped', history: 'Recorded history',
};
export type CatalogAgent = {
  key: string; name: string; kind: 'agent' | 'coordinator'; runId: string; taskId: string;
  roleId?: string; stage: string; node: string;
};
export type CatalogExecution = {
  key: string; runId: string; stage: string; node: string; state: string;
  activeAgents: CatalogAgent[]; waitingAgents: CatalogAgent[];
};
export type CatalogRow = {
  requirement: ConfigSummary; runs: RunDetail[]; historyRuns: RunDetail[];
  status: CatalogStatus; progressScope: 'live' | 'history' | 'none';
  progress: number | null; total: number; resolved: number;
  activeAgents: CatalogAgent[]; waitingAgents: CatalogAgent[]; execution: CatalogExecution[];
  alertRun?: RunDetail;
};

function uniqueAgents(agents: CatalogAgent[]): CatalogAgent[] {
  return [...new Map(agents.map(agent => [agent.key, agent])).values()];
}

function nodeAgents(run: RunDetail, stage: string, node: RunNode, state: 'active' | 'waiting'): CatalogAgent[] {
  if (resolvedStates.has(node.state) || (state === 'active' && run.deviceStatus.connectivity !== 'online')) return [];
  return uniqueAgents(node.tasks.flatMap(task => {
    if (task.kind !== 'agent' && task.kind !== 'coordinator') return [];
    if (state === 'active' ? !['running', 'leased'].includes(task.state) : task.state !== 'waiting_reply') return [];
    return [{ key: run.id + ':' + task.taskId, name: task.roleDisplayName?.trim() || (task.kind === 'coordinator' ? 'Coordinator' : 'Agent'),
      kind: task.kind, runId: run.id, taskId: task.taskId, roleId: task.roleId, stage, node: node.name }];
  }));
}

function catalogExecution(runs: RunDetail[]): CatalogExecution[] {
  return runs.flatMap(run => {
    const unresolved = currentNodeLocations(run).filter(({ node }) => !resolvedStates.has(node.state));
    let current = unresolved.filter(({ stage, node }) => ['running', 'ready', 'waiting_reply', 'needs_attention', 'failed'].includes(node.state)
      || nodeAgents(run, stage.name, node, 'active').length > 0 || nodeAgents(run, stage.name, node, 'waiting').length > 0);
    if (!current.length && !['queued', 'preparing'].includes(run.state)) {
      current = unresolved.filter(({ stage }) => stage.id === unresolved[0]?.stage.id);
    }
    if (!current.length) return [{ key: run.id, runId: run.id, stage: 'Preparation',
      node: run.state === 'queued' ? 'Waiting to start' : 'Repository preparation', state: run.state, activeAgents: [], waitingAgents: [] }];
    return current.map(({ stage, node }) => ({ key: `${run.id}:${node.nodeId}:${node.wave}`, runId: run.id,
      stage: stage.name, node: node.name, state: node.state,
      activeAgents: nodeAgents(run, stage.name, node, 'active'), waitingAgents: nodeAgents(run, stage.name, node, 'waiting') }));
  });
}

function catalogStatus(current: RunDetail[], history: RunDetail[], blocked: RunDetail[]): CatalogStatus {
  if (blocked.length) return 'blocked';
  if (current.length) return current.every(run => ['queued', 'preparing'].includes(run.state)) ? 'queued' : 'running';
  if (!history.length) return 'not_started';
  if (new Set(history.map(run => run.state)).size > 1) return 'history';
  return history[0].state as 'completed' | 'failed' | 'stopped';
}

/** The accessible catalog remains independent from the subset of operational ships. */
export function catalogRows(requirements: ConfigSummary[], runs: RunDetail[]): CatalogRow[] {
  return [...new Map(requirements.map(requirement => [requirement.id, requirement])).values()].map(requirement => {
    const related = runs.filter(run => run.requirementId === requirement.id);
    const current = operationalRuns(related);
    const historyRuns = related.filter(run => !liveStates.has(run.state));
    const blocked = current.filter(runBlocked);
    const status = catalogStatus(current, historyRuns, blocked);
    const progressRuns = current.length ? current : historyRuns;
    const nodes = progressRuns.flatMap(currentNodes);
    const resolved = nodes.filter(node => resolvedStates.has(node.state)).length;
    const execution = catalogExecution(current);
    return { requirement, runs: current, historyRuns, status,
      progressScope: current.length ? 'live' as const : historyRuns.length ? 'history' as const : 'none' as const,
      total: nodes.length, resolved, progress: nodes.length ? Math.round(resolved / nodes.length * 100) : null,
      activeAgents: uniqueAgents(execution.flatMap(entry => entry.activeAgents)),
      waitingAgents: uniqueAgents(execution.flatMap(entry => entry.waitingAgents)), execution,
      alertRun: blocked.find(canOpenChat) ?? blocked[0] };
  }).sort((a, b) => a.requirement.name.localeCompare(b.requirement.name) || a.requirement.id.localeCompare(b.requirement.id));
}

export function filterCatalogRows(rows: CatalogRow[], filter: CatalogFilter, query: string): CatalogRow[] {
  const search = query.trim().toLowerCase();
  return rows.filter(row => (filter === 'all' || row.status === filter) && row.requirement.name.toLowerCase().includes(search));
}

export function fleetMetrics(runs: RunDetail[]) {
  const nodes = runs.flatMap(currentNodes);
  const taskEntries = runs.flatMap(run => currentNodes(run).flatMap(node => node.tasks
    .filter(task => ['agent', 'coordinator'].includes(task.kind))
    .map(task => ({ key: run.id + ':' + task.taskId, task, run, unresolved: !resolvedStates.has(node.state) }))));
  const tasks = [...new Map(taskEntries.map(entry => [entry.key, entry])).values()];
  const currentTasks = tasks.filter(entry => liveStates.has(entry.run.state) && entry.unresolved);
  const working = currentTasks.filter(({ task, run }) => run.deviceStatus.connectivity === 'online' && ['running', 'leased'].includes(task.state));
  const artifacts = new Set(runs.flatMap(run => run.stages.flatMap(stage => stage.nodes.flatMap(node => node.artifactIds))));
  const resolved = nodes.filter(node => resolvedStates.has(node.state)).length;
  return { total: nodes.length, resolved, progress: nodes.length ? Math.round(resolved / nodes.length * 100) : null,
    remaining: nodes.length - resolved,
    working: working.length, tasks: tasks.length, taskComplete: tasks.filter(({ task }) => task.state === 'succeeded').length,
    waiting: currentTasks.filter(({ task }) => task.state === 'waiting_reply').length,
    artifacts: artifacts.size, repairs: nodes.reduce((sum, node) => sum + (node.check?.automaticRepairCount ?? 0) + (node.check?.manualRepairCount ?? 0), 0),
    completed: runs.filter(run => run.state === 'completed').length,
    attention: runs.filter(runBlocked),
    devices: [...new Map(runs.map(run => [run.deviceStatus.id, run.deviceStatus])).values()],
  };
}

const activityLabels: Record<string, string> = {
  started: 'Workflow started', completed: 'Workflow completed', stopped: 'Workflow stopped',
  progress: 'Agent reported progress', message: 'Agent posted a message', question: 'Agent requested a reply',
  complete: 'Agent task completed', failure: 'Agent task failed',
};

/** Merge recorded events across the selected scope, newest first; polling never creates events. */
export function recentActivity(runs: RunDetail[], names: Map<string, string>, limit = 30) {
  const events = runs.flatMap(run => (run.recentActivity ?? []).map(event => ({
    ...event, key: run.id + ':' + event.id, runId: run.id, requirementId: run.requirementId,
    requirementName: names.get(run.requirementId) ?? run.requirementName,
    label: activityLabels[event.kind] ?? 'Workflow activity recorded',
  }))).filter(event => Number.isFinite(Date.parse(event.time)));
  return [...new Map(events.map(event => [event.key, event])).values()]
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || b.key.localeCompare(a.key)).slice(0, limit);
}
