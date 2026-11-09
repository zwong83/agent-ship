import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import {
  CATALOG, COORDINATOR, CHAT_GRACE, CHAT_HEARTBEAT, DEVICE_ONLINE, JOB_LEASE,
  Problem, REPOSITORY, TYPES, UUID, digest, equal, flowNodes, id, matchesPassword,
  normalizeFlow, passwordHash, proofSignature, requireThat, secret, str,
} from './model.mjs';
import { createRun, isFinal, jobInput, receiveResult, runAction } from './engine.mjs';

const SESSION_AGE = 24 * 60 * 60 * 1000;
const PAIR_AGE = 10 * 60 * 1000;
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
]);
const KINDS = new Set(['requirements', 'agents', 'flows']);
const USERNAME = /^[A-Za-z_-][A-Za-z_-]{2,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d .-]{5,32}$/;
const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  requireThat(request.headers['content-type']?.split(';')[0] === 'application/json', '请提交 JSON 数据', 'content-type', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    requireThat(size <= 1024 * 1024, '请求内容过大', 'too-large', 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    requireThat(data && typeof data === 'object' && !Array.isArray(data), '请求内容无效');
    return data;
  } catch {
    throw new Problem(400, 'invalid-json', '请求内容不是有效的 JSON');
  }
}

function cookieToken(request) {
  return request.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith('as_session='))?.slice('as_session='.length);
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username };
}

function register(state, body) {
  const name = str(body.name, '姓名', 100);
  const username = str(body.username, '用户名', 40);
  const email = str(body.email, '邮箱', 200).toLowerCase();
  const phone = str(body.phone, '手机号', 32);
  const password = body.password;
  requireThat(USERNAME.test(username), '用户名需为 3 到 40 位字母、下划线或短横线');
  requireThat(EMAIL.test(email) && PHONE.test(phone), '邮箱或手机号格式不正确');
  requireThat(typeof password === 'string' && password.length >= 10 && password.length <= 128, '密码长度须为 10 到 128 位');
  requireThat(password === body.confirmPassword, '两次密码不一致');
  requireThat(!Object.values(state.users).some((user) => user.username.toLowerCase() === username.toLowerCase() || user.email === email),
    '用户名或邮箱不可用', 'conflict', 409);
  const user = { id: id(), name, username, email, phone, hash: passwordHash(password) };
  state.users[user.id] = user;
  return user;
}

function login(state, body) {
  const identifier = str(body.identifier, '邮箱或用户名', 200).toLowerCase();
  const password = body.password;
  requireThat(typeof password === 'string' && password.length <= 128, '登录信息不正确', 'unauthorized', 401);
  const user = Object.values(state.users).find((entry) => entry.username.toLowerCase() === identifier || entry.email === identifier);
  const valid = matchesPassword(password, user?.hash ?? dummyHash);
  requireThat(user && valid, '登录信息不正确', 'unauthorized', 401);
  return user;
}

const dummyHash = passwordHash(secret());

function sessionFor(state, request, now) {
  const token = cookieToken(request);
  const session = token && state.sessions[digest(token)];
  return session && session.expires > now ? state.users[session.userId] : null;
}

function issueSession(state, user, now) {
  const token = secret();
  state.sessions[digest(token)] = { userId: user.id, expires: now + SESSION_AGE };
  return token;
}

function canAccess(object, user) {
  return object?.owner === user.id || Boolean(object?.members.includes(user.id));
}

function objectFor(state, kind, key, user) {
  const object = state.objects[key];
  requireThat(object?.kind === kind && canAccess(object, user), '配置不存在或无法访问', 'not-found', 404);
  return object;
}

function publicObject(state, object, user) {
  const owner = state.users[object.owner];
  return {
    id: object.id, kind: object.kind, name: object.name, data: object.data, version: object.version,
    owner: publicUser(owner), members: object.members.map((key) => publicUser(state.users[key])),
    relation: object.owner === user.id ? 'owner' : 'deputy', updatedAt: object.updatedAt,
  };
}

function availableRoles(state, user) {
  return new Map([COORDINATOR, ...CATALOG,
    ...Object.values(state.objects).filter((object) => object.kind === 'agents' && canAccess(object, user))
      .map((object) => ({ id: object.id, name: object.name, ...object.data })),
  ].map((role) => [role.id, role]));
}

function saveObject(state, user, kind, current, body, now) {
  if (current) requireThat(body.version === current.version, '配置已更新，请刷新后再保存', 'conflict', 409);
  const name = str(body.name, '名称', 120);
  const input = body.data ?? {};
  requireThat(input && typeof input === 'object' && !Array.isArray(input), '配置数据无效');
  let data;
  if (kind === 'requirements') {
    const conflict = Object.values(state.objects).find((object) => object.kind === kind &&
      object.id !== current?.id && object.name.normalize('NFKC').toLowerCase() === name.normalize('NFKC').toLowerCase());
    if (conflict) throw new Problem(409, 'name-taken',
      conflict.owner === user.id ? '请选择已有的同名需求' : '该名称不可用，请换一个名称',
      conflict.owner === user.id ? { existingId: conflict.id } : undefined);
    const repo = str(input.repo, 'GitHub 仓库', 150, true);
    requireThat(!repo || REPOSITORY.test(repo), '仓库须使用 owner/repo 格式');
    requireThat(!current || current.owner === user.id || (current.data.repo ?? '') === repo, '只有主负责人可以更改仓库关联', 'forbidden', 403);
    data = { description: str(input.description, '需求描述', 16000, true), repo };
  } else if (kind === 'agents') {
    const skill = str(input.skill, 'Skill 名称', 100, true);
    requireThat(!skill || /^[a-zA-Z0-9_-]+$/.test(skill), 'Skill 名称无效');
    data = { prompt: str(input.prompt, '任务说明', 8000), skill };
  } else {
    data = normalizeFlow(input, availableRoles(state, user));
  }
  const object = {
    id: current?.id ?? id(), owner: current?.owner ?? user.id, members: current?.members ?? [],
    removed: current?.removed ?? [], kind, name, data, version: (current?.version ?? 0) + 1, updatedAt: now,
  };
  state.objects[object.id] = object;
  return publicObject(state, object, user);
}

function ownership(state, user, object, body, now) {
  requireThat(object.owner === user.id, '只有主负责人可以管理负责人', 'forbidden', 403);
  const username = str(body.username, '对方用户名', 40).toLowerCase();
  const recipient = Object.values(state.users).find((entry) => entry.username.toLowerCase() === username);
  requireThat(recipient && recipient.id !== user.id, '请选择其他已注册用户');
  if (body.action === 'add') {
    object.members = [...new Set([...object.members, recipient.id])];
    object.removed = (object.removed ?? []).filter((key) => key !== recipient.id);
  } else if (body.action === 'remove') {
    if (object.members.includes(recipient.id)) object.removed = [...new Set([...(object.removed ?? []), recipient.id])];
    object.members = object.members.filter((key) => key !== recipient.id);
  }
  else if (body.action === 'transfer') {
    object.owner = recipient.id;
    object.members = object.members.filter((key) => key !== recipient.id && key !== user.id);
  } else requireThat(false, '负责人操作无效');
  object.version += 1;
  object.updatedAt = now;
  return canAccess(object, user) ? publicObject(state, object, user) : { transferred: true };
}

function workerFor(state, request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
  const hash = match && digest(match[1]);
  const device = hash && Object.values(state.devices).find((entry) => equal(hash, entry.keyHash));
  requireThat(device, '设备未配对', 'unauthorized', 401);
  return device;
}

function startRun(state, user, body, now) {
  const requirement = objectFor(state, 'requirements', body.requirementId, user);
  requireThat(requirement.owner === user.id, '只有需求主负责人可以发起运行', 'forbidden', 403);
  const flow = objectFor(state, 'flows', body.flowId, user);
  requireThat(Object.hasOwn(TYPES, body.workType) && (requirement.data.repo || body.workType === 'feature'), '未关联仓库的需求只能以新功能启动');
  requireThat(requirement.data.description || flowNodes(flow.data).some((node) => node.purpose === 'requirement'), '该流程没有需求阶段，请先填写需求描述');
  const proof = body.proof ?? {};
  const device = state.devices[proof.deviceId];
  requireThat(device?.userId === user.id && Number.isFinite(proof.issuedAt) && Math.abs(now - proof.issuedAt) < 30_000 &&
    typeof proof.signature === 'string' && equal(proof.signature, proofSignature(device.id, proof.issuedAt, device.keyHash)) &&
    now - device.seen < DEVICE_ONLINE, '请先在当前电脑启动并配对 AgentShip 执行程序', 'device', 409);
  requireThat(device.mode !== 'codex' || body.allowExternal === true, '请确认本次运行的 Git 和发布权限', 'confirmation', 409);

  const nonce = str(body.requestId, '启动请求标识', 80);
  requireThat(UUID.test(nonce), '启动请求标识无效');
  const previous = Object.values(state.runs).find((run) => run.owner === user.id && run.requestId === nonce);
  if (previous) return { id: previous.id, duplicate: true };

  const roleIds = new Set(flowNodes(flow.data).flatMap((node) => [...node.roles, ...(node.coordinator ? [node.coordinator] : [])]));
  const roles = availableRoles(state, user);
  for (const roleId of roleIds) requireThat(roles.has(roleId), '当前用户无法使用此流程的部分 Agent');
  const run = createRun({
    owner: user.id, requirement, flow, roles: Object.fromEntries([...roleIds].map((key) => [key, roles.get(key)])),
    workType: body.workType, device, now,
  });
  run.requestId = nonce;
  state.runs[run.id] = run;
  return { id: run.id };
}

function visibleRun(state, user, key) {
  const run = state.runs[key];
  requireThat(run && canAccess(state.objects[run.demandId], user), '运行不存在或无法访问', 'not-found', 404);
  return run;
}

function currentLock(state, run, now) {
  const lock = run.lock;
  if (!lock || state.objects[run.demandId]?.owner !== lock.userId ||
    now - lock.seen >= CHAT_HEARTBEAT + CHAT_GRACE) return null;
  return lock;
}

function chat(state, run, user, body, now) {
  requireThat(state.objects[run.demandId]?.owner === user.id, '当前角色无运行聊天权限', 'forbidden', 403);
  const { tab, action } = body;
  requireThat(typeof tab === 'string' && UUID.test(tab), '标签页标识无效');
  const lock = currentLock(state, run, now);
  const holds = lock?.userId === user.id && lock.tab === tab;
  if (action === 'release') {
    if (holds) run.lock = null;
    return { held: false };
  }
  requireThat(action === 'heartbeat' || action === 'acquire', '聊天操作无效');
  if (lock && !holds) {
    throw new Problem(409, 'chat-occupied', state.users[lock.userId].name + ' 正在使用聊天页',
      { holder: state.users[lock.userId].name });
  }
  requireThat(action === 'acquire' || holds, '聊天操作权已释放，请重新进入', 'chat-closed', 409);
  run.lock = { tab, userId: user.id, seen: now };
  return { held: true };
}

function projectedRun(state, run, user, now, tab) {
  const device = state.devices[run.deviceId];
  const owner = state.objects[run.demandId]?.owner === user.id;
  const lock = currentLock(state, run, now);
  const canChat = owner && lock?.userId === user.id && lock.tab === tab;
  const status = !isFinal(run) && (!device || now - device.seen >= DEVICE_ONLINE) ? 'offline' : run.status;
  const result = {
    id: run.id, title: run.demandName, flowName: run.flowName, workType: run.workType,
    repo: run.repo, git: run.git, status, mode: run.mode, block: run.block, createdAt: run.createdAt,
    owner, isInitiator: run.owner === user.id, canChat, deviceName: device?.name,
    nodes: run.nodes.map((node) => ({
      id: node.id, name: node.name, stageName: node.stageName, stageIndex: node.stageIndex,
      phase: node.phase, type: node.type, wave: node.wave, check: run.checks[node.id],
      result: node.result, history: node.history,
      tasks: [...node.jobs, node.finalJob, node.publishJob].filter(Boolean).map((key) => {
        const job = run.jobs[key];
        return { id: key, name: run.roles[job.roleId]?.name ?? '发布', status: job.status, attempt: job.attempt, error: job.error };
      }),
    })),
  };
  if (canChat) Object.assign(result, {
    questions: run.questions, messages: run.messages, changes: run.changes, audit: run.audit,
  });
  return result;
}

function normalizeResult(body, task) {
  const type = body.type;
  const raw = body.result ?? {};
  requireThat(['progress', 'question', 'complete', 'failure'].includes(type) && raw && typeof raw === 'object', '执行事件无效');
  const result = {};
  if (raw.threadId) result.threadId = str(raw.threadId, '会话标识', 120);
  if (type === 'progress') {
    if (raw.checkpoint && typeof raw.checkpoint === 'object') result.checkpoint = raw.checkpoint;
    if (Array.isArray(raw.delivered)) result.delivered = raw.delivered.filter((key) => typeof key === 'string').slice(0, 200);
  } else if (type === 'question') {
    requireThat(['agent', 'coordinator'].includes(task.type), '该任务不支持提问');
    result.question = str(raw.question, '问题', 4000);
  } else if (type === 'failure') {
    result.message = str(raw.message, '失败说明', 300, true);
  } else if (task.type === 'git') {
    requireThat(REPOSITORY.test(raw.repo), '返回的仓库标识无效');
    Object.assign(result, { repo: raw.repo, branch: str(raw.branch, '工作分支', 200), base: str(raw.base, '基准分支', 200),
      defaultBranch: str(raw.defaultBranch, '默认分支', 200) });
  } else if (task.type === 'publish') {
    Object.assign(result, { summary: str(raw.summary, '发布结果', 1000), url: str(raw.url, '发布链接', 1000, true), mode: raw.mode });
  } else {
    Object.assign(result, { artifact: str(raw.artifact, '产物', 32000, true), summary: str(raw.summary, '摘要', 16000, true) });
    if (['pass', 'repair'].includes(raw.verdict)) result.verdict = raw.verdict;
    if (Array.isArray(raw.handoffs)) result.handoffs = raw.handoffs.slice(0, 30)
      .filter((entry) => entry && typeof entry.target === 'string' && typeof entry.text === 'string')
      .map((entry) => ({ target: entry.target.slice(0, 100), text: entry.text.slice(0, 4000) }));
  }
  return result;
}

function poll(state, device, body, now) {
  device.seen = now;
  const limit = Math.min(16, Math.max(0, Number.isSafeInteger(body.limit) ? body.limit : 1));
  const active = new Map((Array.isArray(body.active) ? body.active.slice(0, 40) : [])
    .filter((entry) => entry && typeof entry.id === 'string').map((entry) => [entry.id, entry.lease]));
  const jobs = [];
  const updates = [];
  for (const run of Object.values(state.runs)) {
    if (run.deviceId !== device.id || isFinal(run)) continue;
    for (const task of Object.values(run.jobs)) {
      if (task.status === 'leased' && active.get(task.id) === task.lease) {
        task.leaseUntil = now + JOB_LEASE;
        if (task.inbox.length) updates.push({ id: task.id, lease: task.lease, inbox: task.inbox });
        continue;
      }
      if (run.block?.kind === 'repair-limit' || jobs.length >= limit) continue;
      if (task.status !== 'queued' && !(task.status === 'leased' && task.leaseUntil <= now)) continue;
      task.status = 'leased';
      task.lease = secret();
      task.leaseUntil = now + JOB_LEASE;
      jobs.push({ id: task.id, type: task.type, lease: task.lease, revision: task.revision, payload: jobInput(run, task) });
    }
  }
  return { jobs, updates };
}

function workerEvent(state, device, key, body, now) {
  const run = Object.values(state.runs).find((entry) => entry.deviceId === device.id && Object.hasOwn(entry.jobs, key));
  const task = run?.jobs[key];
  requireThat(task, '设备无法访问该任务', 'not-found', 404);
  if (task.lastLease && equal(task.lastLease, body.lease) && body.type !== 'progress') return { accepted: true, duplicate: true };
  requireThat(!isFinal(run) && task.status === 'leased' && task.lease && equal(task.lease, body.lease),
    '任务租约已过期', 'stale-lease', 409);
  const result = normalizeResult(body, task);
  if (body.type === 'complete' && task.type === 'git' && run.mode === 'codex') {
    const demand = state.objects[run.demandId];
    if (demand.data.repo && demand.data.repo.toLowerCase() !== result.repo.toLowerCase()) {
      receiveResult(run, task, 'failure', { message: '需求仓库关联已变更，请核对后重新发起运行。' }, now);
      device.seen = now;
      return { accepted: true };
    }
    if (!demand.data.repo) {
      demand.data.repo = result.repo;
      demand.version += 1;
      demand.updatedAt = now;
    }
  }
  receiveResult(run, task, body.type, result, now);
  device.seen = now;
  return { accepted: true };
}

export function makeServer({ database = ':memory:', clock = Date.now } = {}) {
  const store = new Store(database);
  const throttles = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self' http://127.0.0.1:4781; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host = request.headers.host ?? '';
      requireThat(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host), '仅接受本机访问', 'host', 403);
      const url = new URL(request.url, 'http://' + host);
      requireThat(url.host === host, '请求地址无效');
      const method = request.method;
      if (!url.pathname.startsWith('/api/')) {
        if (url.pathname === '/favicon.ico' && method === 'GET') {
          response.writeHead(204).end();
          return;
        }
        const file = STATIC.get(url.pathname);
        requireThat(file && method === 'GET', '页面不存在', 'not-found', 404);
        response.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-cache' });
        response.end(await readFile(resolve(WEB_ROOT, file[0])));
        return;
      }
      response.setHeader('cache-control', 'no-store');
      const isWrite = ['POST', 'PATCH'].includes(method);
      if (isWrite && request.headers.origin) {
        requireThat(request.headers.origin === url.origin, '请求来源无效', 'origin', 403);
      }
      const body = isWrite ? await readBody(request) : {};
      const now = clock();
      const parts = url.pathname.split('/').slice(2);
      const [area, first, second, third] = parts;
      let headers;
      const handle = (state) => {
        if (isWrite && parts.length === 1 && ['register', 'login'].includes(area) && method === 'POST') {
          const key = request.socket.remoteAddress + ':' + area;
          const prior = throttles.get(key);
          const entry = prior && now - prior.start < 60_000 ? prior : { start: now, count: 0 };
          entry.count += 1;
          throttles.set(key, entry);
          requireThat(entry.count <= 20, '尝试次数过多，请稍后重试', 'rate-limit', 429);
          const user = area === 'register' ? register(state, body) : login(state, body);
          const token = issueSession(state, user, now);
          headers = { 'set-cookie': 'as_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400' };
          return { user: publicUser(user) };
        }
        if (area === 'worker' && method === 'POST') {
          if (first === 'pair' && parts.length === 2) {
            const code = str(body.code, '配对码', 60);
            const pair = state.pairs[digest(code)];
            requireThat(pair && pair.expires > now, '配对码无效或已过期', 'pair', 403);
            const name = str(body.name, '电脑名称', 100);
            requireThat(['demo', 'codex'].includes(body.mode), '设备模式无效');
            const token = secret();
            const device = { id: id(), userId: pair.userId, name, mode: body.mode, keyHash: digest(token), seen: now };
            state.devices[device.id] = device;
            delete state.pairs[digest(code)];
            return { deviceId: device.id, token };
          }
          const device = workerFor(state, request);
          if (first === 'poll' && parts.length === 2) return poll(state, device, body, now);
          if (first === 'jobs' && third === 'event' && parts.length === 4) return workerEvent(state, device, second, body, now);
          throw new Problem(404, 'not-found', '设备接口不存在');
        }

        const user = sessionFor(state, request, now);
        if (area === 'me' && method === 'GET' && parts.length === 1) return { user: user ? publicUser(user) : null };
        requireThat(user, '请先登录', 'unauthorized', 401);
        if (area === 'logout' && method === 'POST' && parts.length === 1) {
          delete state.sessions[digest(cookieToken(request))];
          for (const run of Object.values(state.runs)) if (run.lock?.userId === user.id) run.lock = null;
          headers = { 'set-cookie': 'as_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' };
          return { ok: true };
        }
        if (area === 'catalog' && method === 'GET' && parts.length === 1) {
          return { roles: [...availableRoles(state, user).values()].map(({ id: roleId, name, skill, builtin }) => ({ id: roleId, name, skill, builtin })) };
        }
        if (area === 'objects' && KINDS.has(first)) {
          if (parts.length === 2) {
            if (method === 'GET') return { items: Object.values(state.objects).filter((item) => item.kind === first && canAccess(item, user))
              .sort((a, b) => b.updatedAt - a.updatedAt).map((item) => publicObject(state, item, user)) };
            if (method === 'POST') return saveObject(state, user, first, null, body, now);
          }
          if (parts.length === 3 || (parts.length === 4 && third === 'ownership')) {
            const requested = state.objects[second];
            if (method === 'PATCH' && requested?.kind === first && !canAccess(requested, user) &&
              requested.removed?.includes(user.id)) throw new Problem(403, 'removed', '你已被移除为该配置的副负责人');
            const object = objectFor(state, first, second, user);
            if (parts.length === 3 && method === 'GET') return publicObject(state, object, user);
            if (parts.length === 3 && method === 'PATCH') return saveObject(state, user, first, object, body, now);
            if (third === 'ownership' && method === 'POST') return ownership(state, user, object, body, now);
          }
        }
        if (area === 'devices') {
          if (method === 'GET' && parts.length === 1) return { items: Object.values(state.devices).filter((item) => item.userId === user.id)
            .map(({ id: deviceId, name, mode, seen }) => ({ id: deviceId, name, mode, online: now - seen < DEVICE_ONLINE })) };
          if (method === 'POST' && first === 'pair' && parts.length === 2) {
            const code = secret();
            state.pairs[digest(code)] = { userId: user.id, expires: now + PAIR_AGE };
            return { code, expires: now + PAIR_AGE };
          }
        }
        if (area === 'runs') {
          if (method === 'GET' && parts.length === 1) return {
            items: Object.values(state.runs).filter((run) => canAccess(state.objects[run.demandId], user))
              .sort((a, b) => b.createdAt - a.createdAt).map((run) => {
                const view = projectedRun(state, run, user, now);
                return { id: view.id, title: view.title, status: view.status, workType: view.workType, createdAt: view.createdAt, mode: view.mode };
              }),
          };
          if (method === 'POST' && parts.length === 1) return startRun(state, user, body, now);
          const run = visibleRun(state, user, first);
          if (method === 'GET' && parts.length === 2) return projectedRun(state, run, user, now, url.searchParams.get('tab'));
          if (method === 'POST' && second === 'chat' && parts.length === 3) return chat(state, run, user, body, now);
          if (method === 'POST' && second === 'actions' && parts.length === 3) {
            const lock = currentLock(state, run, now);
            requireThat(lock?.userId === user.id && lock.tab === body.tab, '请先取得聊天页操作权', 'forbidden', 403);
            if (['reply', 'message', 'describe', 'propose-change'].includes(body.action)) body.text = str(body.text, '内容', 16000);
            runAction(run, body, user.id, now);
            if (body.action === 'describe') {
              const demand = state.objects[run.demandId];
              demand.data.description = run.description;
              demand.version += 1;
              demand.updatedAt = now;
            }
            return projectedRun(state, run, user, now, body.tab);
          }
        }
        throw new Problem(404, 'not-found', '接口不存在');
      };
      const value = isWrite ? store.mutate(handle) : handle(store.read());
      json(response, 200, value, headers);
    } catch (error) {
      if (error instanceof Problem) json(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
      else {
        console.error('AgentShip request failed:', error.name);
        json(response, 500, { error: { code: 'internal', message: '操作暂时无法完成' } });
      }
    }
  });
  server.once('close', () => store.close());
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const portFlag = process.argv.indexOf('--port');
  const port = portFlag < 0 ? 4173 : Number(process.argv[portFlag + 1]);
  const databaseFlag = process.argv.indexOf('--database');
  const database = databaseFlag < 0 ? resolve('.agentship', 'workspace.sqlite') : process.argv[databaseFlag + 1];
  const server = makeServer({ database });
  server.listen(port, '127.0.0.1', () => console.log('AgentShip 已启动 · http://127.0.0.1:' + server.address().port));
}
