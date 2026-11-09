import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { makeServer } from '../src/server.mjs';
import { CHAT_GRACE, CHAT_HEARTBEAT, CATALOG, COORDINATOR, digest, id, normalizeFlow, proofSignature } from '../src/model.mjs';
import { createRun, jobInput, receiveResult, runAction } from '../src/engine.mjs';
import { createWorker } from '../src/worker.mjs';
import { CodexClient } from '../src/codex.mjs';
import { branchPlan, deploy, prepareGit, publishCode } from '../src/providers.mjs';

const roles = new Map([COORDINATOR, ...CATALOG].map((role) => [role.id, role]));
const node = (key, dependencies = [], options = {}) => ({
  id: key, name: key, type: 'work', purpose: 'other', dependencies, roles: [], ...options,
});
const end = () => ({ id: 'end', name: '结束', type: 'end' });
const stage = (nodes, name = '研发') => ({ name, nodes });
const credential = 'synthetic-passphrase-123';

async function fixture(t) {
  let now = Date.now();
  const server = makeServer({ clock: () => now });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  async function call(path, { method = 'GET', body, cookie, token, status = 200 } = {}) {
    const response = await fetch(origin + '/api' + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(data));
    return { ...data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const post = (path, body, cookie, status = 200) => call(path, { method: 'POST', body, cookie, status });
  const user = (name) => post('/register', {
    name, username: name, email: name + '@example.test', phone: '123456789', password: credential, confirmPassword: credential,
  });
  const object = (kind, name, data, cookie) => post('/objects/' + kind, { name, data }, cookie);
  async function device(cookie) {
    const pair = await post('/devices/pair', {}, cookie);
    const result = await post('/worker/pair', { code: pair.code, name: 'Test machine', mode: 'demo' });
    return { ...result, mode: 'demo' };
  }
  const proof = (device) => ({ deviceId: device.deviceId, issuedAt: now, signature: proofSignature(device.deviceId, now, digest(device.token)) });
  return { origin, call, post, user, object, device, proof, advance: (milliseconds) => { now += milliseconds; } };
}

function directRun(flow) {
  return createRun({
    owner: 'owner', requirement: { id: id(), name: 'Example', data: { description: 'test', repo: 'demo/project' } },
    flow: { name: 'Flow', data: normalizeFlow(flow, roles) }, roles: Object.fromEntries(roles),
    workType: 'feature', device: { id: id(), mode: 'demo' }, now: 1,
  });
}

function complete(run, key, result = { artifact: 'result', summary: 'done' }) {
  receiveResult(run, run.jobs[key], 'complete', result, run.updatedAt + 1);
}

function finishGit(run) {
  complete(run, run.gitJob, { repo: 'demo/project', branch: 'feature/example', base: 'dev', defaultBranch: 'main' });
}

test('TA-01/02: auth, uniqueness, owner transfer, and stale deputy save', async (t) => {
  const f = await fixture(t);
  const owner = await f.user('alpha');
  const deputy = await f.user('bravo');
  assert.equal((await f.post('/login', { identifier: 'alpha@example.test', password: credential })).user.id, owner.user.id);
  assert.equal((await f.post('/login', { identifier: 'ALPHA', password: credential })).user.id, owner.user.id);
  await f.post('/login', { identifier: 'alpha', password: 'wrong' }, undefined, 401);
  await f.call('/objects/requirements', { status: 401 });

  const demand = await f.object('requirements', '登录改进', { description: 'description' }, owner.cookie);
  const conflict = await f.post('/objects/requirements', { name: demand.name, data: {} }, deputy.cookie, 409);
  assert.equal(conflict.error.details, undefined);
  await f.call('/objects/requirements/' + demand.id, { cookie: deputy.cookie, status: 404 });
  const path = '/objects/requirements/' + demand.id;
  const share = (action) => f.post(path + '/ownership', { action, username: 'bravo' }, owner.cookie);
  await share('add');
  const before = await f.call(path, { cookie: deputy.cookie });
  await share('remove');
  const removed = await f.call(path, {
    method: 'PATCH', cookie: deputy.cookie, body: { name: before.name, data: { description: 'changed' }, version: before.version }, status: 403,
  });
  assert.equal(removed.error.code, 'removed');
  assert.equal((await f.call(path, { cookie: owner.cookie })).data.description, 'description');
  await share('transfer');
  assert.equal((await f.call(path, { cookie: deputy.cookie })).relation, 'owner');
  await f.call(path, { cookie: owner.cookie, status: 404 });
});

test('TA-03: invalid flow rejects cycle, later dependency, missing end, and single route', () => {
  assert.throws(() => normalizeFlow({ stages: [stage([node('a', ['b']), node('b', ['a']), end()])] }, roles), /循环依赖/);
  assert.throws(() => normalizeFlow({ stages: [stage([node('a', ['b'])]), stage([node('b'), end()])] }, roles), /阶段顺序/);
  assert.throws(() => normalizeFlow({ stages: [stage([node('a')])] }, roles), /结束节点/);
  assert.throws(() => normalizeFlow({ stages: [stage([node('a', [], { type: 'check', branches: { pass: 'b', limit: 2 } }), node('b'), end()])] }, roles), /同时配置/);
});

test('TA-04: starting validates demand owner, description, type, and original device', async (t) => {
  const f = await fixture(t);
  const owner = await f.user('owner');
  const other = await f.user('other');
  const demand = await f.object('requirements', 'Only owner', {}, owner.cookie);
  const flow = await f.object('flows', 'Without intake', { stages: [stage([node('a'), end()])] }, owner.cookie);
  const intake = await f.object('flows', 'With intake', { stages: [stage([node('a', [], { purpose: 'requirement' }), end()])] }, owner.cookie);
  const computer = await f.device(owner.cookie);
  const stranger = await f.device(other.cookie);
  const body = { requirementId: demand.id, flowId: flow.id, workType: 'feature', requestId: id(), proof: f.proof(computer) };
  await f.post('/runs', body, owner.cookie, 400);
  await f.post('/runs', { ...body, flowId: intake.id, workType: 'hotfix' }, owner.cookie, 400);
  await f.post('/runs', { ...body, flowId: intake.id, proof: f.proof(stranger) }, owner.cookie, 409);
  await f.post('/objects/requirements/' + demand.id + '/ownership', { action: 'add', username: 'other' }, owner.cookie);
  await f.post('/runs', { ...body, flowId: intake.id, proof: f.proof(stranger) }, other.cookie, 403);
  const started = await f.post('/runs', { ...body, flowId: intake.id }, owner.cookie);
  assert.equal((await f.post('/runs', { ...body, flowId: intake.id }, owner.cookie)).id, started.id);
  await f.post('/runs/' + started.id + '/chat', { action: 'acquire', tab: id() }, other.cookie, 403);
});

test('TA-04: Git plans support configured default and missing dev', async () => {
  const runId = id();
  assert.equal(branchPlan('hotfix', runId, 'master').base, 'master');
  assert.equal(branchPlan('hotfix', runId, 'main').base, 'main');
  const calls = [];
  const fake = async (program, args) => {
    calls.push([program, ...args]);
    if (args[0] === 'repo' && args[1] === 'view') return JSON.stringify({ nameWithOwner: 'demo/project', defaultBranchRef: { name: 'main' } });
    return '';
  };
  const result = await prepareGit({ repo: 'demo/project', runId, workType: 'refactor' }, resolve('unused-test-worktree'), fake);
  assert.equal(result.base, 'dev');
  const pushed = calls.filter((parts) => parts[1] === 'push');
  assert.deepEqual(pushed, [
    ['git', 'push', 'origin', 'refs/remotes/origin/main:refs/heads/dev'],
    ['git', 'push', 'origin', 'refs/remotes/origin/dev:refs/heads/refactor/' + runId],
  ]);
});

test('TA-05: stage barriers and common upstream control concurrency', () => {
  const run = directRun({ stages: [
    stage([node('root'), node('a', ['root']), node('b', ['root']), node('independent')]),
    stage([node('later'), end()], '发布'),
  ] });
  finishGit(run);
  const get = (key) => run.nodes.find((entry) => entry.id === key);
  assert.equal(get('root').phase, 'active');
  assert.equal(get('independent').phase, 'pending');
  assert.equal(get('later').phase, 'pending');
  complete(run, get('root').finalJob);
  assert.equal(get('a').phase, 'active');
  assert.equal(get('b').phase, 'active');
  complete(run, get('a').finalJob);
  assert.equal(get('independent').phase, 'pending');
  complete(run, get('b').finalJob);
  assert.equal(get('independent').phase, 'active');
  complete(run, get('independent').finalJob);
  assert.equal(get('later').phase, 'active');
  complete(run, get('later').finalJob);
  assert.equal(run.status, 'completed');
});

test('TA-05: a serial sub-agent receives handoffs addressed to its configured role', () => {
  const first = 'builtin:architecture';
  const next = 'builtin:interface_data';
  const run = directRun({ stages: [stage([
    node('work', [], { roles: [first, next, 'builtin:testing'], order: 'serial' }), end(),
  ])] });
  finishGit(run);
  const [work] = run.nodes;
  const firstJob = run.jobs[work.jobs[0]];
  assert.equal(work.jobs.length, 1);
  assert.deepEqual(jobInput(run, firstJob).teammates.map(({ id: roleId }) => roleId), [next, 'builtin:testing']);
  complete(run, firstJob.id, { handoffs: [{ target: next, text: '按已确认的接口约束继续。' }] });
  const nextJob = run.jobs[work.jobs[1]];
  assert.equal(nextJob.roleId, next);
  assert.deepEqual(jobInput(run, nextJob).inbox.map(({ text }) => text), ['按已确认的接口约束继续。']);
  assert.equal(work.jobs.length, 2);
});

test('TA-05: concurrently started nodes share a common completed upstream', () => {
  const run = directRun({ stages: [
    stage([node('a'), node('b'), node('c')]),
    stage([node('x', ['a', 'b']), node('y', ['a', 'c']), node('z', ['b', 'c']), end()]),
  ] });
  finishGit(run);
  const [a, b, c, x, y, z] = run.nodes;
  for (const parent of [a, b, c]) complete(run, parent.finalJob);
  assert.deepEqual([x.phase, y.phase, z.phase], ['active', 'active', 'pending']);
  complete(run, x.finalJob);
  assert.equal(z.phase, 'active');
});

test('TA-07: same-check rework, missing result and authorized stop', () => {
  const run = directRun({ stages: [stage([
    node('check', [], { type: 'check', branches: { pass: 'pass', repair: 'repair', limit: 1 } }),
    node('repair', ['check']), node('pass', ['check']), end(),
  ])] });
  finishGit(run);
  const get = (key) => run.nodes.find((entry) => entry.id === key);
  complete(run, get('check').finalJob, { artifact: 'No verdict' });
  assert.equal(run.block.kind, 'missing-check');
  assert.equal(get('repair').phase, 'pending');
  runAction(run, { action: 'recheck', target: 'check' }, 'owner', 3);
  complete(run, get('check').finalJob, { artifact: 'finding', verdict: 'repair' });
  assert.equal(run.checks.check.rounds, 1);
  complete(run, get('repair').finalJob);
  assert.equal(get('check').wave, 3);
  complete(run, get('check').finalJob, { artifact: 'still an issue', verdict: 'repair' });
  assert.equal(run.block.kind, 'repair-limit');
  runAction(run, { action: 'repair', target: 'check' }, 'owner', 5);
  assert.equal(run.checks.check.rounds, 1);
  complete(run, get('repair').finalJob);
  complete(run, get('check').finalJob, { artifact: 'still an issue', verdict: 'repair' });
  assert.equal(run.block.kind, 'repair-limit');
  runAction(run, { action: 'stop', target: 'check' }, 'owner', 6);
  assert.equal(run.status, 'stopped');
  assert.equal(get('pass').phase, 'pending');
});

test('TA-07: two checks have separate automatic repair limits', () => {
  const check = (key, limit, dependencies = []) => node(key, dependencies, {
    type: 'check', branches: { pass: key + '-pass', repair: key + '-repair', limit },
  });
  const run = directRun({ stages: [stage([
    check('first', 1), node('first-repair'), node('first-pass'),
    check('second', 2, ['first-pass']), node('second-repair'), node('second-pass'), end(),
  ])] });
  finishGit(run);
  const [first, firstRepair, firstPass, second, secondRepair] = run.nodes;
  const repair = { artifact: 'finding', verdict: 'repair' };
  const pass = { artifact: 'verified', verdict: 'pass' };
  complete(run, first.finalJob, repair);
  complete(run, firstRepair.finalJob);
  complete(run, first.finalJob, pass);
  complete(run, firstPass.finalJob);
  for (let round = 1; round <= 2; round += 1) {
    complete(run, second.finalJob, repair);
    assert.equal(run.checks.second.rounds, round);
    assert.equal(run.checks.first.rounds, 1);
    complete(run, secondRepair.finalJob);
  }
  complete(run, second.finalJob, repair);
  assert.equal(run.block.nodeId, second.id);
});

test('TA-06: pending changes require confirmation and only the initiator cancels a question', () => {
  const run = directRun({ stages: [stage([node('work'), end()])] });
  finishGit(run);
  const task = run.jobs[run.nodes[0].finalJob];
  runAction(run, { action: 'propose-change', text: 'updated scope' }, 'owner', 3);
  assert.equal(jobInput(run, task).description, 'test');
  runAction(run, { action: 'confirm-change', target: run.changes[0].id }, 'owner', 4);
  assert.equal(jobInput(run, task).description, 'updated scope');
  receiveResult(run, task, 'question', { question: 'continue?' }, 5);
  const [question] = run.questions;
  const action = { action: 'cancel-question', target: question.id };
  assert.throws(() => runAction(run, action, 'other-user', 6), /只有运行发起人/);
  assert.equal(question.status, 'waiting');
  runAction(run, action, 'owner', 7);
  assert.equal(question.status, 'cancelled');
  assert.equal(task.status, 'queued');
  assert.match(jobInput(run, task).input, /根据已有信息继续/);
});

test('TA-05/06/08: local HTTP worker dispatches three roles, routes a question, and retries only a failed role', async (t) => {
  const f = await fixture(t);
  const owner = await f.user('tester');
  const computer = await f.device(owner.cookie);
  const ask = await f.object('agents', 'Ask', { prompt: '[demo:question]' }, owner.cookie);
  const fail = await f.object('agents', 'Fail', { prompt: '[demo:fail-once]' }, owner.cookie);
  const demand = await f.object('requirements', '完整交付', { description: 'Test delivery' }, owner.cookie);
  const flow = await f.object('flows', 'Three', { stages: [stage([node('design', [], {
    roles: [ask.id, fail.id, 'builtin:architecture'],
  }), end()])] }, owner.cookie);
  const started = await f.post('/runs', { requirementId: demand.id, flowId: flow.id, workType: 'feature',
    proof: f.proof(computer), requestId: id() }, owner.cookie);
  const worker = createWorker({ origin: f.origin, device: computer, root: '.', journalStore: new Map() });
  t.after(() => worker.stop());
  const tab = id();
  const path = '/runs/' + started.id;
  await f.post(path + '/chat', { tab, action: 'acquire' }, owner.cookie);
  await f.post(path + '/chat', { tab: id(), action: 'acquire' }, owner.cookie, 409);
  for (let i = 0; i < 2; i += 1) { await worker.pollOnce(); await worker.drain(); }
  const run = () => f.call(path + '?tab=' + tab, { cookie: owner.cookie });
  const pending = await run();
  assert.equal(pending.nodes[0].tasks.length, 3);
  const succeeded = pending.nodes[0].tasks.find((entry) => entry.status === 'done');
  const failed = pending.nodes[0].tasks.find((entry) => entry.status === 'failed');
  const question = pending.questions.find((entry) => entry.status === 'waiting');
  assert.ok(succeeded && failed && question);
  await f.post(path + '/chat', { tab, action: 'release' }, owner.cookie);
  assert.equal((await run()).questions, undefined);
  await f.post(path + '/chat', { tab, action: 'acquire' }, owner.cookie);
  assert.equal((await run()).questions[0].id, question.id);
  await f.post(path + '/actions', { tab, action: 'reply', target: question.id, text: '是' }, owner.cookie);
  await f.post(path + '/actions', { tab, action: 'retry', target: failed.id }, owner.cookie);
  for (let i = 0; i < 2; i += 1) { await worker.pollOnce(); await worker.drain(); }
  const finished = await run();
  assert.equal(finished.status, 'completed');
  assert.equal(finished.nodes[0].tasks.find((entry) => entry.id === succeeded.id).attempt, 1);
  assert.equal(finished.nodes[0].tasks.find((entry) => entry.id === failed.id).attempt, 2);
  assert.equal(finished.nodes[0].result.artifact.includes('演练'), true);
  assert.equal(finished.questions[0].status, 'answered');
  assert.equal(finished.mode, 'demo');
  assert.equal((await f.call('/objects/requirements/' + demand.id, { cookie: owner.cookie })).data.repo, '');

  f.advance(CHAT_HEARTBEAT + CHAT_GRACE - 1);
  await f.post(path + '/chat', { tab: id(), action: 'acquire' }, owner.cookie, 409);
  f.advance(2);
  await f.post(path + '/chat', { tab: id(), action: 'acquire' }, owner.cookie);
});

test('TA-08: reconnect uses the same run and fences stale leases', async (t) => {
  const f = await fixture(t);
  const user = await f.user('recovery');
  const computer = await f.device(user.cookie);
  const demand = await f.object('requirements', 'Reconnect', { description: 'a' }, user.cookie);
  const flow = await f.object('flows', 'Reconnect flow', { stages: [stage([node('a'), end()])] }, user.cookie);
  const started = await f.post('/runs', { requirementId: demand.id, flowId: flow.id, workType: 'feature',
    proof: f.proof(computer), requestId: id() }, user.cookie);
  const poll = () => f.call('/worker/poll', { method: 'POST', token: computer.token, body: { limit: 1, active: [] } });
  const [old] = (await poll()).jobs;
  f.advance(26_000);
  assert.equal((await f.call('/runs/' + started.id, { cookie: user.cookie })).status, 'offline');
  const [fresh] = (await poll()).jobs;
  assert.equal(old.id, fresh.id);
  assert.notEqual(old.lease, fresh.lease);
  const event = (lease, status) => f.call('/worker/jobs/' + fresh.id + '/event', {
    method: 'POST', token: computer.token, status, body: { lease, type: 'complete', result: {
      repo: 'demo/example', defaultBranch: 'main', base: 'dev', branch: 'feature/example',
    } },
  });
  await event(old.lease, 409);
  await event(fresh.lease, 200);
  assert.equal((await f.call('/runs/' + started.id, { cookie: user.cookie })).id, started.id);
});

test('TA-08 protocol: Codex stdio turn, structured question, resume of original thread', async () => {
  const requests = [];
  const fake = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = () => child.emit('exit', 0);
    const send = (data) => child.stdout.write(JSON.stringify(data) + '\n');
    child.stdin.on('data', (chunk) => {
      const request = JSON.parse(chunk);
      requests.push(request);
      if (request.id == null) return;
      if (request.method === 'initialize') return send({ id: request.id, result: {} });
      if (request.method === 'thread/start' || request.method === 'thread/resume') {
        return send({ id: request.id, result: { thread: { id: 'thread-123' } } });
      }
      if (request.method === 'turn/start') {
        const threadId = request.params.threadId;
        const answered = request.params.input[0].text.includes('用户回复');
        send({ id: request.id, result: { turn: { id: 'turn-1' } } });
        setImmediate(() => {
          send({ method: 'item/completed', params: { threadId, item: { type: 'agentMessage',
            text: JSON.stringify({ status: answered ? 'complete' : 'question', question: '确认?', artifact: answered ? '交付产物' : '' }) } } });
          send({ method: 'turn/completed', params: { threadId, turn: { status: 'completed' } } });
        });
      }
    });
    return child;
  };
  const payload = {
    role: { name: 'Tester', prompt: 'run tests' }, node: { type: 'work', name: 'Tests' },
    title: 'Issue', description: '', upstream: [], siblings: [], inbox: [], input: '',
  };
  const first = new CodexClient({ childFactory: fake });
  const checkpoints = [];
  const question = await first.complete({ type: 'agent', payload }, '.', async (value) => checkpoints.push(value), () => {});
  assert.equal(question.type, 'question');
  assert.equal(checkpoints[0].threadId, 'thread-123');
  first.close();
  const second = new CodexClient({ childFactory: fake });
  const result = await second.complete({ type: 'agent', payload: { ...payload, threadId: 'thread-123', input: '用户回复：是' } }, '.', async () => {}, () => {});
  assert.equal(result.result.artifact, '交付产物');
  assert.ok(requests.some((entry) => entry.method === 'thread/resume' && entry.params.threadId === 'thread-123'));
  second.close();
});

test('TA-08 provider: publish retries reconcile the recorded run and verify success', async () => {
  const payload = {
    repo: 'owner/project', git: { branch: 'feature/example' }, node: { workflow: 'release.yml', target: 'pilot' },
  };
  const calls = [];
  const checkpoints = [];
  const mock = async (program, args) => {
    calls.push([program, ...args.slice(0, 2)]);
    if (args[0] === 'workflow') return 'https://github.com/owner/project/actions/runs/123';
    if (args[0] === 'run' && args[1] === 'view') {
      return JSON.stringify({ status: 'completed', conclusion: 'success', headBranch: 'feature/example' });
    }
    assert.fail('Unexpected provider call');
  };
  const checkpoint = async ({ checkpoint: state }) => checkpoints.push(state);
  const first = await deploy(payload, '.', checkpoint, mock);
  const resumed = await deploy({ ...payload, checkpoint: checkpoints.at(-1) }, '.', checkpoint, mock);
  assert.equal(first.summary, resumed.summary);
  assert.deepEqual(calls, [['gh', 'workflow', 'run'], ['gh', 'run', 'view'], ['gh', 'run', 'view']]);
});

test('TA-08 provider: automatic publishing rejects candidate credential paths before staging', async () => {
  const calls = [];
  const mock = async (program, args) => {
    calls.push([program, args[0]]);
    if (args[0] === 'status') return '?? config/.env.local';
    if (args[0] === 'diff') return '';
    if (args[0] === 'ls-files') return 'config/.env.local\0';
    assert.fail('Unexpected Git call');
  };
  await assert.rejects(publishCode({ git: { branch: 'feature/example' }, node: { name: 'test' } }, '.', mock), /疑似凭据文件/);
  assert.deepEqual(calls, [['git', 'status'], ['git', 'diff'], ['git', 'ls-files']]);
});
