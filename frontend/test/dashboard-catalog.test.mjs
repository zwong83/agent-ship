import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/dashboard-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const model = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const requirement = (id, name = id) => ({ id, name, kind: 'requirements', version: 1, allowedActions: ['view'] });
const node = (nodeId, state = 'running', extra = {}) => ({ nodeId, wave: 1, name: nodeId, type: 'work', state,
  tasks: [], artifactIds: [], inputRequirementRevision: 1, basedOnOlderRequirementRevision: false, ...extra });
const run = (id, requirementId, state = 'running', nodes = []) => ({ id, requirementId, requirementName: requirementId,
  state, version: 1, deviceStatus: { id: 'device-' + id, connectivity: 'online' }, allowedActions: ['view', 'open_repair_control'],
  stages: [{ id: 'build', name: 'Build', nodes }] });
const rowFor = (rows, id) => rows.find(row => row.requirement.id === id);

// FRS catalog inventory and status: catalog visibility never depends on having a live run.
const requirements = ['draft', 'done', 'failed', 'stopped', 'mixed', 'queued', 'preparing', 'working', 'blocked'].map(id => requirement(id));
const runs = [run('c1','done','completed',[node('finish','complete')]), run('f1','failed','failed'), run('s1','stopped','stopped'),
  run('m1','mixed','completed'), run('m2','mixed','stopped'), run('q1','queued','queued'), run('p1','preparing','preparing'),
  run('w1','working','running',[node('work')]), run('w-old','working','failed'), run('b1','blocked','needs_attention')];
const rows = model.catalogRows(requirements,runs);
assert.equal(rows.length, requirements.length, 'All accessible catalog requirements remain visible');
assert.deepEqual(Object.fromEntries(rows.map(row => [row.requirement.id,row.status])), {
  blocked:'blocked',done:'completed',draft:'not_started',failed:'failed',mixed:'history',preparing:'queued',queued:'queued',stopped:'stopped',working:'running',
});
assert.deepEqual(rowFor(rows,'working').runs.map(run=>run.id),['w1'],'A historical failure cannot enter the live telemetry scope');
assert.deepEqual(rowFor(rows,'working').historyRuns.map(run=>run.id),['w-old']);
assert.equal(rowFor(rows,'draft').progress,null,'No workflow must not fabricate zero percent');
assert.equal(rowFor(rows,'draft').progressScope,'none');
assert.equal(rowFor(rows,'queued').progress,null,'A queued run without a denominator has unknown progress');
assert.equal(rowFor(rows,'done').progress,100);
assert.equal(rowFor(rows,'done').progressScope,'history');
assert.equal(rowFor(rows,'done').runs.length,0);
assert.deepEqual(rowFor(rows,'done').activeAgents,[]);
assert.deepEqual(rowFor(rows,'done').execution,[]);
assert.deepEqual(model.catalogRows([],runs),[],'Runs never expose a requirement missing from the accessible catalog');
console.log('PASS catalog lifecycle coverage, operational/history separation and unavailable progress.');

// FRS progress and repair waves: one current node per run; old failure/task state cannot survive repair.
const repaired = run('repair','repairing','running',[
  node('build','failed',{wave:1, tasks:[{taskId:'old-active',kind:'agent',state:'running',roleDisplayName:'Old agent'}],artifactIds:['old-artifact']}),
  node('build','complete',{wave:2,artifactIds:['new-artifact','old-artifact'],check:{automaticRepairCount:2,manualRepairCount:1}}),
  node('verify','running',{tasks:[],check:{automaticRepairCount:0,manualRepairCount:0}}),
]);
const repairedRow = model.catalogRows([requirement('repairing')],[repaired])[0];
assert.equal(repairedRow.status,'running','An obsolete failed wave cannot leave a repaired requirement blocked');
assert.equal(repairedRow.total,2,'Repair waves must not inflate the workflow denominator');
assert.equal(repairedRow.resolved,1);
assert.equal(repairedRow.progress,50);
assert.equal(model.runBlocked(repaired),false);
const repairedMetrics = model.fleetMetrics([repaired]);
assert.equal(repairedMetrics.total,2);
assert.equal(repairedMetrics.working,0,'An old wave running receipt cannot count as a current agent');
assert.equal(repairedMetrics.artifacts,2,'Outputs from prior waves remain recorded and deduplicated');
assert.equal(repairedMetrics.repairs,3);
assert.equal(model.liveFleetRows([requirement('repairing')],[repaired])[0].progress,50,'List and fleet share the current-node denominator');
const twoRuns = model.catalogRows([requirement('repairing')],[repaired,run('second','repairing','running',[node('build','running')])])[0];
assert.equal(twoRuns.total,3,'Node IDs in separate runs remain separate workflow steps');
assert.equal(twoRuns.progress,33);
assert.equal(model.catalogRows([requirement('repairing')],[{...repaired,stages:[{...repaired.stages[0],nodes:[...repaired.stages[0].nodes].reverse()}]}])[0].progress,50,'Wave selection does not depend on response ordering');
console.log('PASS latest-wave progress, repaired blockers, active task counts, retained artifacts and concurrent run denominators.');

// SYS-D02: search is a trimmed case-insensitive name substring, independent from focus.
const named = model.catalogRows([requirement('z','API Delivery'),requirement('a','api delivery'),requirement('other','Data platform')],
  [run('nz','z'),run('na','a','queued')]);
assert.deepEqual(model.filterCatalogRows(named,'all','  API delivery ').map(row=>row.requirement.id),['a','z']);
assert.deepEqual(model.filterCatalogRows(named,'running','api').map(row=>row.requirement.id),['z']);
assert.deepEqual(model.filterCatalogRows(named,'queued','API').map(row=>row.requirement.id),['a']);
assert.deepEqual(model.filterCatalogRows(named,'blocked',''),[]);
assert.deepEqual(model.filterCatalogRows(named,'all','not present'),[]);
assert.equal(model.filterCatalogRows(named,'all','').length,3,'All includes unstarted catalog entries');
assert.equal(named.length,3,'Filtering must not mutate global inventory');
assert.equal(model.catalogStatusLabels.not_started,'Not started');
assert.equal(model.catalogStatusLabels.history,'Recorded history');
console.log('PASS trimmed name search, exclusive status filters, global inventory preservation and clear labels.');

// SYS-D04: executing tasks, not assigned roles, determine current agents across parallel stages.
const task = (taskId,state,roleDisplayName,kind='agent',extra={}) => ({taskId,state,roleDisplayName,kind,attemptNumber:1,...extra});
const parallel = run('parallel','parallel','running',[
  node('api','running',{tasks:[task('backend','running','Backend engineer'),task('lead','leased','Delivery lead','coordinator'),task('finished','succeeded','Former agent')],
    selectedRoles:[{roleId:'future',kind:'agent',displayName:'Assigned future agent'}]}),
  node('future','blocked',{selectedRoles:[{roleId:'future',kind:'agent',displayName:'Assigned future agent'}]}),
  node('done','complete',{tasks:[task('stale','leased','Stale completed agent'),task('stale-wait','waiting_reply','Stale waiting agent')]}),
]);
parallel.stages.push({id:'validate',name:'Validate',nodes:[node('review','waiting_reply',{
  tasks:[task('qa','waiting_reply','QA engineer'),task('anonymous','running',undefined)]
})]});
const parallelRow=model.catalogRows([requirement('parallel')],[parallel])[0];
assert.deepEqual(parallelRow.activeAgents.map(agent=>agent.name),['Backend engineer','Delivery lead','Agent']);
assert.deepEqual(parallelRow.waitingAgents.map(agent=>agent.name),['QA engineer']);
assert.equal(parallelRow.activeAgents[1].kind,'coordinator');
assert.equal(parallelRow.activeAgents[0].key,'parallel:backend');
assert.equal(parallelRow.activeAgents[2].stage,'Validate');
assert.equal(parallelRow.activeAgents[2].node,'review');
assert.deepEqual(parallelRow.execution.map(entry=>entry.node),['api','review'],'Parallel executing stages remain visible; future and resolved nodes do not');
assert.equal(parallelRow.execution[1].waitingAgents[0].name,'QA engineer');
assert.equal(model.fleetMetrics([parallel]).working,3,'Summary and list use identical active-task semantics');
assert.equal(model.fleetMetrics([parallel]).waiting,1,'Resolved nodes cannot retain a waiting-reply count');
const offline={...parallel,deviceStatus:{...parallel.deviceStatus,connectivity:'offline'}};
assert.equal(model.catalogRows([requirement('parallel')],[offline])[0].activeAgents.length,0,'Offline work cannot claim current execution');
assert.equal(model.catalogRows([requirement('parallel')],[offline])[0].status,'blocked');
const assignedOnly=run('assigned','assigned','running',[node('work','running',{selectedRoles:[{kind:'agent',displayName:'Only assigned'}]})]);
assert.deepEqual(model.catalogRows([requirement('assigned')],[assignedOnly])[0].activeAgents,[]);
const historical={...parallel,state:'completed'};
assert.deepEqual(model.catalogRows([requirement('parallel')],[historical])[0].waitingAgents,[],'Historical waiting receipts are not current responsibilities');
assert.equal(model.fleetMetrics([historical]).waiting,0);
const pending=model.catalogRows([requirement('queued')],[run('pending','queued','queued')])[0];
assert.equal(pending.execution[0].stage,'Preparation');
assert.equal(pending.execution[0].node,'Waiting to start');
assert.equal(pending.activeAgents.length,0);
const duplicateTask=run('dupe','dupe','running',[node('work','running',{tasks:[task('same','running','Same agent'),task('same','running','Same agent')]})]);
assert.equal(model.catalogRows([requirement('dupe')],[duplicateTask])[0].activeAgents.length,1,'Duplicate task receipts do not inflate current activity');
console.log('PASS actual named agents, parallel stage/node context, role fallback, waiting separation, offline and stale receipts.');

// SYS-D01/09 and SEC-D01: duplicate pages do not duplicate requirements; task identity includes its run.
assert.equal(model.catalogRows([requirement('dupe'),requirement('dupe')],[duplicateTask]).length,1,'Duplicate catalog page entries appear once');
const collision={...duplicateTask,id:'other-run'};
const collisionMetrics=model.fleetMetrics([duplicateTask,collision]);
assert.equal(collisionMetrics.working,2,'Tasks with equal local IDs in separate runs remain independent');
assert.equal(collisionMetrics.tasks,2);
const waitingCollision=[duplicateTask,collision].map(run=>({...run,stages:[{id:'b',name:'Build',nodes:[node('waiting','waiting_reply',{tasks:[task('same','waiting_reply','Agent')]} )]}]}));
assert.equal(model.fleetMetrics(waitingCollision).waiting,2);
const inaccessible={...run('restricted','blocked','needs_attention'),allowedActions:['view']};
const permitted=run('permitted','blocked','needs_attention');
assert.equal(model.catalogRows([requirement('blocked')],[inaccessible,permitted])[0].alertRun.id,'permitted');
assert.equal(model.canOpenChat(model.catalogRows([requirement('blocked')],[inaccessible])[0].alertRun),false);
const frozenInput=structuredClone({requirements,runs});
function freeze(value) { if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
freeze(frozenInput);
const unchanged=JSON.stringify(frozenInput);
model.catalogRows(frozenInput.requirements,frozenInput.runs);
assert.equal(JSON.stringify(frozenInput),unchanged,'Projection preserves API snapshots');
console.log('PASS duplicate inventory, run-scoped task identity, chat permissions and immutable inputs.');

// SYS-D04 / DES-D02: task receipts remain visible while a node-state update is catching up.
const receiptLag=run('lag','lag','running',[
  node('primary','running'),
  node('lagging','blocked',{tasks:[task('live','leased','Live agent'),task('reply','waiting_reply','Waiting agent')]}),
  node('assigned-future','blocked',{selectedRoles:[{kind:'agent',displayName:'Future assignee'}]}),
]);
const lagRow=model.catalogRows([requirement('lag')],[receiptLag])[0];
assert.equal(lagRow.activeAgents.length,1,'A real executing receipt must not disappear behind a lagging unresolved node state');
assert.equal(lagRow.waitingAgents.length,1);
assert.deepEqual(lagRow.execution.map(entry=>entry.node),['primary','lagging']);
assert.equal(lagRow.activeAgents.length,model.fleetMetrics([receiptLag]).working,'List and summary agree during node-state lag');
console.log('PASS actual task visibility during lagging node-state updates.');
