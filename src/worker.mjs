import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { UUID, digest, proofSignature } from './model.mjs';
import { CodexClient } from './codex.mjs';
import { demoTask, deploy, prepareGit, publishCode, worktree } from './providers.mjs';

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createDeviceBridge(origin, device) {
  return createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/proof' || request.headers.origin !== origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    const issuedAt = Date.now();
    response.writeHead(200, {
      'content-type': 'application/json', 'access-control-allow-origin': origin,
      'cache-control': 'no-store', 'vary': 'Origin',
    });
    response.end(JSON.stringify({
      deviceId: device.deviceId, issuedAt, signature: proofSignature(device.deviceId, issuedAt, digest(device.token)),
    }));
  });
}

export async function requestPlatform(origin, path, body, token) {
  const response = await fetch(origin + path, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error?.message ?? '平台请求失败', response.status);
  return data;
}

export function createWorker({ origin, device, root, capacity = 6, codex = new CodexClient(), request = requestPlatform, journalStore }) {
  const running = new Map();
  const workspaceWriters = new Map();
  let stopped = false;
  const send = (path, body) => request(origin, path, body, device.token);
  const journal = join(root, 'jobs');
  if (!journalStore) mkdirSync(journal, { recursive: true, mode: 0o700 });

  async function deliver(job, type, result) {
    while (!stopped) {
      try { return await send('/api/worker/jobs/' + job.id + '/event', { lease: job.lease, type, result }); }
      catch (error) {
        if (error instanceof RequestError) throw error;
        await sleep(1000);
      }
    }
    throw new Error('本机执行程序已停止');
  }

  async function writeToRun(runId, action) {
    const last = workspaceWriters.get(runId) ?? Promise.resolve();
    const current = last.catch(() => {}).then(action);
    workspaceWriters.set(runId, current);
    try { return await current; }
    finally { if (workspaceWriters.get(runId) === current) workspaceWriters.delete(runId); }
  }

  async function processJob(job, activity) {
    if (!UUID.test(job.id) || !Number.isSafeInteger(job.revision)) throw new Error('任务标识无效');
    const file = join(journal, job.id + '-' + job.revision + '.json');
    const saved = journalStore ? journalStore.get(file) : (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
    if (saved) {
      await deliver(job, saved.type, saved.result);
      return;
    }

    const checkpoint = (result) => deliver(job, 'progress', result);
    let event;
    try {
      if (device.mode === 'demo') {
        event = await demoTask(job);
      } else {
        const cwd = worktree(root, job.payload.runId);
        if (job.type === 'git') {
          event = { type: 'complete', result: await writeToRun(job.payload.runId, () => prepareGit(job.payload, cwd)) };
        } else if (job.type === 'publish') {
          event = { type: 'complete', result: await writeToRun(job.payload.runId, () => deploy(job.payload, cwd, checkpoint)) };
        } else {
          const execute = async () => {
            const result = await codex.complete(job, cwd, checkpoint, (threadId) => { activity.threadId = threadId; });
            if (job.type === 'coordinator' && result.type === 'complete' &&
              ['frontend', 'backend', 'repair'].includes(job.payload.node.purpose) && result.result.artifact) {
              await publishCode(job.payload, cwd);
            }
            return result;
          };
          event = job.type === 'coordinator' ? await writeToRun(job.payload.runId, execute) : await execute();
        }
      }
    } catch (error) {
      if (error instanceof RequestError) throw error;
      event = { type: 'failure', result: { message: String(error.message ?? '任务失败').slice(0, 280), threadId: activity.threadId } };
    }
    if (journalStore) journalStore.set(file, event);
    else writeFileSync(file, JSON.stringify(event), { mode: 0o600 });
    await deliver(job, event.type, event.result);
  }

  async function pollOnce() {
    const active = [...running.values()].map(({ job }) => ({ id: job.id, lease: job.lease }));
    const response = await send('/api/worker/poll', { limit: Math.max(0, capacity - running.size), active });
    for (const job of response.jobs) {
      if (running.has(job.id)) continue;
      const activity = { job };
      running.set(job.id, activity);
      activity.promise = processJob(job, activity)
        .catch(() => { console.error('任务回报中断；原设备可在续跑时重新提交结果。'); })
        .finally(() => { running.delete(job.id); });
    }
    for (const update of response.updates) {
      const activity = running.get(update.id);
      if (!activity || activity.job.lease !== update.lease || !activity.threadId || activity.delivering) continue;
      activity.delivering = true;
      try {
        const input = update.inbox.filter((entry) => !activity.delivered?.has(entry.id));
        if (input.length && await codex.steer(activity.threadId, input)) {
          activity.delivered ??= new Set();
          for (const entry of input) activity.delivered.add(entry.id);
          await send('/api/worker/jobs/' + update.id + '/event', {
            lease: update.lease, type: 'progress', result: { delivered: [...activity.delivered] },
          });
        }
      } catch { /* keep the message until it can be delivered */ }
      finally { activity.delivering = false; }
    }
  }

  return {
    pollOnce,
    async serve() {
      while (!stopped) {
        try { await pollOnce(); }
        catch (error) {
          if (error instanceof RequestError && error.status === 401) {
            stopped = true;
            throw error;
          }
        }
        await sleep(1200);
      }
    },
    async drain() { await Promise.all([...running.values()].map((item) => item.promise)); },
    stop() { stopped = true; codex.close(); },
  };
}

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

async function main() {
  const endpoint = new URL(flag('--server', 'http://127.0.0.1:4173'));
  if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.protocol !== 'http:' ||
    endpoint.username || endpoint.password || endpoint.pathname !== '/') throw new Error('首期执行程序仅接受本机 HTTP 地址');
  const origin = endpoint.origin;
  const root = resolve(flag('--state-dir', '.agentship/device'));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const credentials = join(root, 'identity.json');
  if (process.argv.includes('--pair')) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let code;
    try { code = (await terminal.question('请输入 AgentShip 设备页面上的一次性配对码：')).trim(); }
    finally { terminal.close(); }
    const mode = process.argv.includes('--demo') ? 'demo' : 'codex';
    const device = await requestPlatform(origin, '/api/worker/pair', { code, name: hostname().slice(0, 100), mode });
    writeFileSync(credentials, JSON.stringify({ ...device, mode, origin }), { mode: 0o600 });
  }
  if (!existsSync(credentials)) throw new Error('请先用 --pair 完成设备配对');
  const device = JSON.parse(readFileSync(credentials, 'utf8'));
  if (device.origin !== origin) throw new Error('平台地址已变化，请重新配对');
  const capacity = Number(flag('--concurrency', 6));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 16) throw new Error('并行容量须为 1 到 16 的整数');
  const bridge = createDeviceBridge(origin, device);
  await new Promise((resolve, reject) => {
    bridge.once('error', reject);
    bridge.listen(4781, '127.0.0.1', resolve);
  });
  const worker = createWorker({ origin, device, root, capacity });
  function stop() { worker.stop(); bridge.close(); }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('本机执行程序在线 · ' + (device.mode === 'demo' ? '演练模式' : 'Codex 模式'));
  try { await worker.serve(); }
  finally { stop(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('AgentShip 执行程序：' + error.message);
    process.exitCode = 1;
  });
}
