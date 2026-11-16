import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/dashboard-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { fleetRows, fleetMetrics, operationalRuns, liveFleetRows, executionRows, runBlocked, canOpenChat } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const requirement = { id: 'r1', name: 'Delivery', kind: 'requirements', version: 1 };
const task = { taskId: 't1', kind: 'agent', state: 'leased' };
const run = { id: 'run1', requirementId: 'r1', state: 'running', deviceStatus: { id: 'd1', connectivity: 'online' },
  stages: [{ nodes: [{ state: 'running', tasks: [task], artifactIds: ['a1'], check: { automaticRepairCount: 2, manualRepairCount: 1 } },
    { state: 'skipped', tasks: [], artifactIds: ['a1'] }] }] };

assert.equal(fleetRows([requirement], [])[0].state, 'idle');
assert.equal(fleetRows([requirement], [])[0].progress, null, 'Unstarted work must not claim zero or complete progress');
assert.equal(fleetRows([requirement], [run])[0].state, 'active');
assert.equal(fleetRows([requirement], [run])[0].progress, 50);
assert.equal(fleetRows([requirement], [{ ...run, state: 'needs_attention' }])[0].state, 'attention');
assert.equal(fleetRows([requirement], [{ ...run, state: 'completed' }])[0].state, 'completed');
assert.equal(fleetRows([requirement], [{ ...run, state: 'stopped' }])[0].state, 'stopped');
assert.equal(fleetRows([requirement], [{ ...run, deviceStatus: { ...run.deviceStatus, connectivity: 'offline' } }])[0].online, false);
assert.equal(fleetRows([requirement], [{ ...run, state: 'completed' }, run])[0].state, 'active', 'A completed historical run does not hide ongoing work');
const metrics = fleetMetrics([run]);
assert.equal(metrics.working, 1);
assert.equal(metrics.artifacts, 1, 'Repeated artifact references count only once');
assert.equal(metrics.repairs, 3);
assert.equal(metrics.resolved, 1);
assert.equal(metrics.tasks, 1);
assert.equal(fleetMetrics([{ ...run, state: 'stopped' }]).working, 0, 'Terminal runs must not animate stale leased tasks');
assert.equal(fleetMetrics([{ ...run, deviceStatus: { ...run.deviceStatus, connectivity: 'offline' } }]).working, 0);
assert.equal(fleetMetrics([run, { ...run, id: 'run2' }]).devices.length, 1);
assert.equal(fleetMetrics([]).progress, null);
assert.equal(fleetMetrics([{ ...run, stages: [{ nodes: [{ state: 'waiting_reply', tasks: [{ ...task, state: 'waiting_reply' }], artifactIds: [] }] }] }]).waiting, 1);
assert.equal(fleetRows([requirement, { ...requirement, id: 'r2', name: 'Another mission' }], [run])[0].requirement.id, 'r2', 'Ships retain stable name order across polling');
console.log('PASS dashboard metrics: aggregation, scope, progress, duplicate artifacts, offline execution and terminal runs.');

const liveRun = { ...run, allowedActions: ['view', 'open_repair_control'], stages: [
  { id: 's1', name: 'Build', nodes: [{ nodeId: 'n1', wave: 1, name: 'Interface', state: 'running', tasks: [task], artifactIds: [],
    selectedRoles: [{ kind: 'coordinator', displayName: 'Delivery lead' }, { kind: 'agent', displayName: 'Frontend engineer' }] },
    { nodeId: 'n2', wave: 1, name: 'Services', state: 'running', tasks: [], artifactIds: [], selectedRoles: [] }] },
  { id: 's2', name: 'Validate', nodes: [{ nodeId: 'n3', wave: 1, name: 'Future review', state: 'blocked', tasks: [], artifactIds: [] }] },
] };
const blocked = { ...liveRun, id: 'blocked', state: 'needs_attention' };
const history = ['completed', 'stopped', 'failed'].map((state, i) => ({ ...liveRun, id: 'old' + i, state }));
assert.equal(operationalRuns([...history, liveRun, blocked]).length, 2);
assert.equal(liveFleetRows([requirement, { ...requirement, id: 'draft' }], history).length, 0, 'Historical and unstarted work must not enter the live fleet');
const liveRows = liveFleetRows([requirement], [...history, liveRun, blocked]);
assert.equal(liveRows.length, 1, 'Multiple current runs share one requirement ship');
assert.equal(liveRows[0].runs.length, 2, 'Selected requirement metrics must not include its historical runs');
assert.equal(liveRows[0].alertRun.id, 'blocked');
assert.equal(liveRows[0].state, 'attention');
assert.equal(liveFleetRows([requirement], [...history, liveRun])[0].state, 'active', 'An old failed run must not leave a red alert');
assert.equal(runBlocked(liveRun), false, 'Future dependency waits must not mark an executing requirement as blocked');
assert.equal(runBlocked({ ...liveRun, deviceStatus: { ...run.deviceStatus, connectivity: 'offline' } }), true);
assert.equal(canOpenChat({ ...blocked, allowedActions: ['view'] }), false, 'Do not invent chat permission');
const withoutAccess = { ...blocked, id: 'restricted', allowedActions: ['view'] };
assert.equal(liveFleetRows([requirement], [withoutAccess, blocked])[0].alertRun.id, 'blocked', 'Prefer an actionable blocked run for the direct chat shortcut');
const execution = executionRows([liveRun, ...history]);
assert.deepEqual(execution.map(entry => entry.node), ['Interface', 'Services'], 'Include parallel current nodes; exclude future stages and historical runs');
assert.equal(execution[0].stage, 'Build');
assert.equal(execution[0].coordinator, 'Delivery lead');
assert.deepEqual(execution[0].agents, ['Frontend engineer']);
assert.equal(executionRows([{ ...liveRun, state: 'preparing', stages: [] }])[0].node, 'Repository preparation');
const other = { ...liveRun, id: 'other', requirementId: 'r2' };
const scoped = liveFleetRows([requirement, { ...requirement, id: 'r2', name: 'Another mission' }], [liveRun, other]);
assert.equal(fleetMetrics(scoped.find(row => row.requirement.id === 'r1').runs).total, 3);
assert.equal(fleetMetrics(scoped.flatMap(row => row.runs)).total, 6);
console.log('PASS live scope, blocked chat permissions, concurrent requirements, parallel stages and assigned agents.');
