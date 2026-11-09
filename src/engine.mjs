import { flowNodes, id, requireThat } from './model.mjs';

const TERMINAL = new Set(['done', 'skipped']);
const RUN_TERMINAL = new Set(['completed', 'stopped']);
const ACTIVE_JOB = new Set(['queued', 'leased']);

export function isFinal(run) {
  return RUN_TERMINAL.has(run.status);
}

function enqueue(run, type, node, role, extra = {}) {
  const task = {
    id: id(), type, nodeId: node?.id ?? null, roleId: role ?? null, status: 'queued',
    revision: 1, attempt: 1, lease: null, leaseUntil: 0, threadId: null,
    input: '', inbox: [], history: [], ...extra,
  };
  run.jobs[task.id] = task;
  return task.id;
}

export function createRun({ owner, requirement, flow, roles, workType, device, now }) {
  const run = {
    id: id(), owner, demandId: requirement.id, demandName: requirement.name,
    description: requirement.data.description, workType, deviceId: device.id, mode: device.mode,
    createdAt: now, updatedAt: now, status: 'preparing', flowName: flow.name,
    nodes: flowNodes(flow.data).map((node) => ({ ...node, phase: 'pending', wave: 0, jobs: [], history: [] })),
    roles, jobs: {}, questions: [], messages: [], changes: [], audit: [], checks: {},
    lock: null, repo: requirement.data.repo || '', git: null, block: null,
  };
  run.gitJob = enqueue(run, 'git', null, null);
  return run;
}

function checkState(run, nodeId) {
  return run.checks[nodeId] ??= { result: null, rounds: 0 };
}

function routeNodes(run, checkId, outcome) {
  return run.nodes.filter((node) => node.route?.checkId === checkId && node.route.outcome === outcome);
}

function startNode(run, node) {
  if (node.wave && node.result) node.history.push({ wave: node.wave, result: node.result });
  node.wave += 1;
  node.phase = 'active';
  node.jobs = [];
  node.handoffs = [];
  node.finalJob = null;
  node.publishJob = null;
  node.result = null;
  dispatchNode(run, node);
}

function dispatchNode(run, node) {
  const tasks = node.jobs.map((jobId) => run.jobs[jobId]);
  if (node.order === 'serial' && tasks.some((task) => task.status !== 'done')) return;
  const missingRoles = node.roles.filter((role) => !tasks.some((task) => task.roleId === role));
  if (missingRoles.length) {
    const roles = node.order === 'serial' ? missingRoles.slice(0, 1) : missingRoles;
    for (const role of roles) {
      const inbox = (node.handoffs ?? []).filter((entry) => entry.target === role);
      node.jobs.push(enqueue(run, 'agent', node, role, { inbox }));
      node.handoffs = (node.handoffs ?? []).filter((entry) => entry.target !== role);
    }
    return;
  }
  if (!node.finalJob && tasks.every((task) => task.status === 'done')) {
    node.finalJob = enqueue(run, 'coordinator', node, node.coordinator);
  }
}

function repairRound(run, node, manual = false) {
  const check = checkState(run, node.id);
  if (!manual) check.rounds += 1;
  check.result = 'repair';
  node.phase = 'done';
  for (const repair of routeNodes(run, node.id, 'repair')) repair.phase = 'pending';
}

function acceptCheck(run, node, result) {
  const check = checkState(run, node.id);
  if (!['pass', 'repair'].includes(result.verdict)) {
    node.phase = 'blocked';
    check.result = 'missing';
    return;
  }
  node.phase = 'done';
  if (result.verdict === 'pass') {
    check.result = 'pass';
    for (const repair of routeNodes(run, node.id, 'repair')) {
      if (!TERMINAL.has(repair.phase)) repair.phase = 'skipped';
    }
    return;
  }
  if (check.rounds < node.branches.limit) repairRound(run, node);
  else check.result = 'limit';
}

function settleNode(run, node) {
  dispatchNode(run, node);
  const final = run.jobs[node.finalJob];
  if (!final || final.status !== 'done') return;
  if (!final.result.artifact) {
    final.status = 'failed';
    final.error = '协调 Agent 尚未提供节点最终产物';
    return;
  }
  if (node.type === 'publish') {
    if (!node.publishJob) node.publishJob = enqueue(run, 'publish', node, null);
    const publication = run.jobs[node.publishJob];
    if (publication.status !== 'done') return;
    node.result = { ...final.result, publication: publication.result };
  } else {
    node.result = final.result;
  }
  if (node.type === 'check') acceptCheck(run, node, final.result);
  else node.phase = 'done';
}

function activeRoute(run, node) {
  return !node.route || run.checks[node.route.checkId]?.result === node.route.outcome;
}

function scheduleStage(run) {
  const stage = run.nodes.find((node) => !TERMINAL.has(node.phase))?.stageIndex;
  if (stage == null) return false;
  const nodes = run.nodes.filter((node) => node.stageIndex === stage);
  const active = nodes.filter((node) => ['active', 'blocked'].includes(node.phase));
  const byId = new Map(run.nodes.map((node) => [node.id, node]));
  const ready = nodes.filter((node) => node.phase === 'pending' && activeRoute(run, node) &&
    node.dependencies.every((dep) => TERMINAL.has(byId.get(dep)?.phase)));

  const end = ready.find((node) => node.type === 'end');
  if (end && run.nodes.every((node) => node === end || TERMINAL.has(node.phase))) {
    end.phase = 'done';
    run.status = 'completed';
    return true;
  }

  const executable = ready.filter((node) => node.type !== 'end' &&
    (node.type !== 'publish' || Object.values(run.checks).every((check) => check.result === 'pass')));
  const first = active[0] ?? executable[0];
  if (!first) return false;
  let sharedParents = first.dependencies.filter((dep) => byId.get(dep).phase === 'done' &&
    active.every((other) => other.dependencies.includes(dep)));
  let started = false;
  const candidates = active.length ? executable : [first, ...executable.slice(1)];
  for (const node of candidates) {
    const commonParents = sharedParents.filter((dep) => node.dependencies.includes(dep));
    if (node !== first && !commonParents.length) continue;
    sharedParents = commonParents;
    if (node.purpose === 'requirement' && !run.description.trim()) {
      node.phase = 'blocked';
      node.block = 'description';
    } else {
      startNode(run, node);
    }
    started = true;
  }
  return started;
}

export function tickRun(run, now = Date.now()) {
  run.updatedAt = now;
  if (isFinal(run)) return;
  const git = run.jobs[run.gitJob];
  if (git.status !== 'done') {
    run.status = git.status === 'failed' ? 'attention' : 'preparing';
    run.block = git.status === 'failed' ? { kind: 'git', taskId: git.id, message: git.error } : null;
    return;
  }
  run.git = git.result;
  run.repo = git.result.repo;

  for (const node of run.nodes) {
    if (node.phase === 'active') settleNode(run, node);
  }
  for (const node of run.nodes.filter((candidate) => candidate.type === 'check')) {
    const check = run.checks[node.id];
    if (check?.result === 'repair' && routeNodes(run, node.id, 'repair').every((repair) => repair.phase === 'done')) {
      check.result = 'rechecking';
      startNode(run, node);
    }
  }

  const paused = run.nodes.find((node) => run.checks[node.id]?.result === 'limit');
  if (!paused) {
    while (scheduleStage(run) && !isFinal(run)) { /* schedule the eligible stage */ }
  }
  if (isFinal(run)) { run.block = null; return; }

  const missing = run.nodes.find((node) => run.checks[node.id]?.result === 'missing');
  const description = run.nodes.find((node) => node.block === 'description');
  const failed = Object.values(run.jobs).find((job) => job.status === 'failed' &&
    run.nodes.some((node) => node.phase === 'active' && [...node.jobs, node.finalJob, node.publishJob].includes(job.id)));
  const waiting = run.questions.some((question) => question.status === 'waiting');
  if (paused) run.block = { kind: 'repair-limit', nodeId: paused.id, message: '已达到自动修复次数上限' };
  else if (missing) run.block = { kind: 'missing-check', nodeId: missing.id, message: '缺少有效检查结论' };
  else if (description) run.block = { kind: 'description', nodeId: description.id, message: '请补齐需求描述' };
  else if (failed) run.block = { kind: 'agent', taskId: failed.id, message: failed.error };
  else if (waiting) run.block = { kind: 'question', message: '有 Agent 等待回复' };
  else run.block = null;

  run.status = paused || missing || description || failed ? 'attention' :
    Object.values(run.jobs).some((job) => ACTIVE_JOB.has(job.status)) ? 'running' : waiting ? 'waiting' : 'attention';
}

export function jobInput(run, task) {
  const node = run.nodes.find((entry) => entry.id === task.nodeId);
  const collect = (jobId) => {
    const job = run.jobs[jobId];
    return job?.status === 'done' ? { role: run.roles[job.roleId]?.name, ...job.result } : null;
  };
  return {
    runId: run.id, demandId: run.demandId, title: run.demandName, description: run.description,
    repo: run.repo, git: run.git, workType: run.workType, role: run.roles[task.roleId],
    node: node ? { id: node.id, name: node.name, type: node.type, purpose: node.purpose, prompt: node.prompt,
      target: node.target, workflow: node.workflow, wave: node.wave } : null,
    upstream: node ? run.nodes.filter((entry) => node.dependencies.includes(entry.id) ||
      (node.type === 'check' && entry.route?.checkId === node.id && entry.route.outcome === 'repair'))
      .filter((entry) => entry.result).map((entry) => ({ name: entry.name, artifact: entry.result.artifact })) : [],
    teammates: node ? node.roles.filter((roleId) => roleId !== task.roleId)
      .map((roleId) => ({ id: roleId, name: run.roles[roleId].name })) : [],
    siblings: node ? node.jobs.filter((jobId) => jobId !== task.id).map(collect).filter(Boolean) : [],
    input: task.input, inbox: task.inbox, threadId: task.threadId, checkpoint: task.checkpoint,
    mode: run.mode,
  };
}

export function receiveResult(run, task, type, result, now) {
  if (type === 'progress') {
    if (result.threadId) task.threadId = result.threadId;
    if (result.checkpoint) task.checkpoint = result.checkpoint;
    if (result.delivered) task.inbox = task.inbox.filter((entry) => !result.delivered.includes(entry.id));
    return;
  }
  task.lastLease = task.lease;
  task.lease = null;
  if (result.threadId) task.threadId = result.threadId;
  if (type === 'question') {
    task.status = 'waiting';
    run.questions.push({
      id: id(), taskId: task.id, role: run.roles[task.roleId]?.name ?? '协调 Agent',
      text: result.question, status: 'waiting', createdAt: now,
    });
  } else if (type === 'failure') {
    task.status = 'failed';
    task.error = result.message || '暂时无法确认失败原因';
  } else {
    task.status = 'done';
    task.result = result;
    if (task.roleId && result.summary) run.messages.push({
      id: id(), kind: 'agent', role: run.roles[task.roleId]?.name ?? 'Agent', text: result.summary, time: now,
    });
    if (task.type === 'agent') {
      const node = run.nodes.find((entry) => entry.id === task.nodeId);
      for (const handoff of result.handoffs ?? []) {
        if (handoff.target === task.roleId || !node.roles.includes(handoff.target)) continue;
        const target = node.jobs.map((jobId) => run.jobs[jobId]).find((job) => job.roleId === handoff.target);
        const message = { id: id(), target: handoff.target, text: handoff.text };
        if (!target) (node.handoffs ??= []).push(message);
        else if (target.status !== 'done') target.inbox.push(message);
      }
    }
  }
  tickRun(run, now);
}

function queueAgain(task, input, retry = false) {
  if (retry) {
    task.history.push({ attempt: task.attempt, error: task.error });
    task.attempt += 1;
  }
  task.revision += 1;
  task.status = 'queued';
  task.input = input;
  task.lease = null;
  task.leaseUntil = 0;
}

export function runAction(run, { action, target, text }, actor, now) {
  requireThat(!isFinal(run), '本次运行已结束', 'closed', 409);
  const node = run.nodes.find((entry) => entry.id === target);
  const task = run.jobs[target];
  if (action === 'retry' || action === 'retry-git') {
    requireThat(task?.status === 'failed' && (action === 'retry-git') === (task.type === 'git'), '该任务当前不可重试');
    queueAgain(task, '请在本次任务范围内纠正失败并重新完成任务。', true);
  } else if (action === 'reply' || action === 'cancel-question') {
    const question = run.questions.find((entry) => entry.id === target);
    requireThat(question?.status === 'waiting', '该问题已处理', 'conflict', 409);
    requireThat(action !== 'cancel-question' || actor === run.owner, '只有运行发起人可以取消问题', 'forbidden', 403);
    question.status = action === 'reply' ? 'answered' : 'cancelled';
    question.answer = text || null;
    question.resolvedAt = now;
    queueAgain(run.jobs[question.taskId], action === 'reply' ? '用户回复：' + text : '提问已取消，请根据已有信息继续。');
  } else if (action === 'recheck') {
    requireThat(node?.type === 'check' && run.checks[node.id]?.result === 'missing', '该检查当前无需重新执行');
    run.checks[node.id].result = 'rechecking';
    startNode(run, node);
  } else if (action === 'repair' || action === 'stop') {
    requireThat(node?.type === 'check' && run.checks[node.id]?.result === 'limit', '当前未达到修复上限');
    if (action === 'repair') repairRound(run, node, true);
    else {
      run.status = 'stopped';
      run.block = null;
    }
  } else if (action === 'describe') {
    const requirementNode = run.nodes.find((entry) => entry.block === 'description');
    requireThat(requirementNode, '当前无需补充描述');
    run.description = text;
    requirementNode.block = null;
    requirementNode.phase = 'pending';
  } else if (action === 'propose-change') {
    run.changes.push({ id: id(), text, userId: actor, status: 'pending', time: now });
  } else if (action === 'confirm-change') {
    const change = run.changes.find((entry) => entry.id === target);
    requireThat(change?.status === 'pending', '该变更已处理', 'conflict', 409);
    Object.assign(change, { status: 'confirmed', confirmedBy: actor, confirmedAt: now });
    run.description = change.text;
    for (const running of Object.values(run.jobs)) {
      if (ACTIVE_JOB.has(running.status) && running.roleId) running.inbox.push({ id: id(), text: '已确认需求变更：' + change.text });
    }
  } else if (action === 'message') {
    const recipient = task ?? Object.values(run.jobs).find((job) => job.roleId && ACTIVE_JOB.has(job.status));
    requireThat(recipient?.roleId && ACTIVE_JOB.has(recipient.status), '请选择当前正在执行或排队的 Agent');
    recipient.inbox.push({ id: id(), text });
    run.messages.push({ id: id(), kind: 'user', role: run.roles[recipient.roleId]?.name, text, time: now });
  } else {
    requireThat(false, '操作类型无效');
  }
  run.audit.push({ action, actor, target: target ?? null, time: now });
  tickRun(run, now);
}
