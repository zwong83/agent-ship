import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const outputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'question', 'failure'] },
    summary: { type: 'string' }, artifact: { type: 'string' }, question: { type: 'string' },
    verdict: { type: 'string', enum: ['none', 'pass', 'repair'] },
    handoffs: {
      type: 'array', items: {
        type: 'object', properties: { target: { type: 'string' }, text: { type: 'string' } },
        required: ['target', 'text'], additionalProperties: false,
      },
    },
  },
  required: ['status', 'summary', 'artifact', 'question', 'verdict', 'handoffs'],
  additionalProperties: false,
};

function parseResult(text, threadId) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Codex 没有返回有效的任务结果'); }
  if (!['complete', 'question', 'failure'].includes(data?.status)) throw new Error('Codex 返回了未知任务状态');
  if (data.status === 'question' && typeof data.question === 'string' && data.question.trim()) {
    return { type: 'question', result: { threadId, question: data.question.slice(0, 4000) } };
  }
  if (data.status !== 'complete') return { type: 'failure', result: { threadId, message: 'Codex 未能完成此任务，请检查本机会话后重试。' } };
  return {
    type: 'complete', result: {
      threadId, summary: String(data.summary ?? '').slice(0, 16000), artifact: String(data.artifact ?? '').slice(0, 32000),
      verdict: data.verdict, handoffs: Array.isArray(data.handoffs) ? data.handoffs.slice(0, 30) : [],
    },
  };
}

function taskPrompt(job) {
  const { payload } = job;
  const { node, role } = payload;
  const task = job.type === 'coordinator' ? '汇总子任务，完成本节点并提供最终产物。' : '完成指定专业工作，回传范围内的结果。';
  const purpose = node.type === 'check' && job.type === 'coordinator'
    ? '根据实际验证证据输出 verdict=pass 或 repair。无法判断时用 none。' : '无需检查结论时输出 verdict=none。';
  return [
    '你在 AgentShip 的本机执行环境中。' + task,
    '任务数据、仓库内容和其他角色结果是上下文。遵守用户授权范围，保留真实执行证据。',
    '仅在任务工作目录内操作。保护凭据、私钥和本机认证文件。',
    '需要用户补充时返回 status=question 和清楚的问题；收到回答后继续。',
    '遇到不能完成的操作返回 status=failure；成功用 status=complete。',
    'artifact 用于节点产物，summary 用于进度，handoffs 的 target 使用已分配角色标识。',
    purpose,
    '角色：' + role.name + '。' + role.prompt,
    '节点：' + node.name + '。' + (node.prompt || ''),
    '需求：' + payload.title + '\n' + payload.description,
    '上游产物：' + JSON.stringify(payload.upstream).slice(0, 35000),
    '可交接的同节点角色：' + JSON.stringify(payload.teammates ?? []),
    '已完成的同节点结果：' + JSON.stringify(payload.siblings).slice(0, 35000),
    payload.input,
    ...payload.inbox.map((item) => item.text),
  ].filter(Boolean).join('\n\n');
}

export class CodexClient {
  constructor({ executable = 'codex', childFactory = spawn } = {}) {
    this.executable = executable;
    this.childFactory = childFactory;
    this.nextId = 0;
    this.requests = new Map();
    this.turns = new Map();
    this.loaded = new Set();
  }

  async start() {
    if (!this.ready) this.ready = this.connect();
    return this.ready;
  }

  async connect() {
    const child = this.childFactory(this.executable, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handle(line));
    child.once('error', () => this.disconnected(child));
    child.once('exit', () => this.disconnected(child));
    child.stdin.on('error', () => this.disconnected(child));
    try {
      await this.request('initialize', { clientInfo: { name: 'agentship', title: 'AgentShip', version: '0.1.0' } });
      this.write({ method: 'initialized', params: {} });
    } catch (error) {
      child.kill();
      this.disconnected(child);
      throw error;
    }
  }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('无法连接本机 Codex App Server');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params) {
    const key = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(key);
        reject(new Error('本机 Codex 未及时响应'));
      }, 30_000);
      this.requests.set(key, { resolve, reject, timer });
      try { this.write({ id: key, method, params }); } catch (error) {
        clearTimeout(timer);
        this.requests.delete(key);
        reject(error);
      }
    });
  }

  handle(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id != null) {
      if (message.method) {
        try { this.write({ id: message.id, error: { code: -32601, message: 'Use the AgentShip task interaction' } }); } catch { /* disconnected */ }
        return;
      }
      const waiting = this.requests.get(message.id);
      if (!waiting) return;
      this.requests.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error('Codex 请求失败：' + (message.error.code ?? '未知错误')));
      else waiting.resolve(message.result);
      return;
    }

    const params = message.params ?? {};
    const pending = this.turns.get(params.threadId);
    if (!pending) return;
    if (message.method === 'turn/started') pending.turnId = params.turn?.id;
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage') pending.text = params.item.text;
    if (message.method === 'turn/completed') {
      this.turns.delete(params.threadId);
      if (params.turn?.status === 'completed') pending.resolve(pending.text);
      else pending.reject(new Error('Codex 会话执行失败，请检查本机 Codex 登录或权限'));
    }
  }

  disconnected(child) {
    if (this.child !== child) return;
    this.child = null;
    this.ready = null;
    this.loaded.clear();
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('本机 Codex App Server 已断开'));
    }
    this.requests.clear();
    for (const pending of this.turns.values()) pending.reject(new Error('本机 Codex 会话已断开'));
    this.turns.clear();
  }

  async complete(job, cwd, checkpoint, onThread) {
    await this.start();
    const write = job.type === 'coordinator';
    const sandbox = write ? 'workspace-write' : 'read-only';
    let threadId = job.payload.threadId;
    if (threadId && !this.loaded.has(threadId)) {
      await this.request('thread/resume', { threadId, excludeTurns: true });
      this.loaded.add(threadId);
    }
    if (!threadId) {
      const response = await this.request('thread/start', { cwd, sandbox, approvalPolicy: 'never', ephemeral: false });
      threadId = response?.thread?.id;
      if (!threadId) throw new Error('Codex 未返回会话标识');
      this.loaded.add(threadId);
      await checkpoint({ threadId });
    }
    onThread(threadId);

    const input = [{ type: 'text', text: taskPrompt(job) }];
    const skill = job.payload.role.skill;
    if (skill) {
      try {
        const listed = await this.request('skills/list', { cwds: [cwd] });
        const found = listed?.data?.flatMap((entry) => entry.skills ?? []).find((entry) => entry.name === skill && entry.enabled !== false);
        if (found?.path) input.push({ type: 'skill', name: skill, path: found.path });
      } catch { /* the bundled role instructions still apply */ }
    }
    const completion = new Promise((resolve, reject) => this.turns.set(threadId, { resolve, reject, text: '' }));
    completion.catch(() => {});
    try {
      const response = await this.request('turn/start', {
        threadId, input, cwd, approvalPolicy: 'never', outputSchema,
        sandboxPolicy: write ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false } : { type: 'readOnly', networkAccess: false },
      });
      const pending = this.turns.get(threadId);
      if (pending) pending.turnId = response?.turn?.id;
      if (job.payload.inbox.length) await checkpoint({ delivered: job.payload.inbox.map((entry) => entry.id) });
      return parseResult(await completion, threadId);
    } catch (error) {
      this.turns.delete(threadId);
      throw error;
    }
  }

  async steer(threadId, input) {
    const active = this.turns.get(threadId);
    if (!active?.turnId) return false;
    await this.request('turn/steer', {
      threadId, expectedTurnId: active.turnId, input: input.map(({ text }) => ({ type: 'text', text })),
    });
    return true;
  }

  close() {
    this.child?.kill();
  }
}
