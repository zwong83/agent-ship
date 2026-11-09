import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { REPOSITORY, UUID } from './model.mjs';

const exec = promisify(execFile);
const REF = /^(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/;

export async function command(program, args, cwd) {
  try {
    const result = await exec(program, args, { cwd, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    return result.stdout.trim();
  } catch {
    throw new Error(program === 'gh' ? 'GitHub 操作失败，请核对本机 gh 登录、仓库权限和工作流。' :
      'Git 操作失败，请核对仓库权限、分支或本机 Git 配置。');
  }
}

export function worktree(root, runId) {
  if (!UUID.test(runId)) throw new Error('运行标识无效');
  return resolve(root, 'work', runId);
}

export function branchPlan(workType, runId, defaultBranch) {
  if (!['feature', 'refactor', 'hotfix', 'fix'].includes(workType) || !UUID.test(runId) || !REF.test(defaultBranch)) {
    throw new Error('工作类型或 Git 分支无效');
  }
  return { branch: workType + '/' + runId, base: workType === 'hotfix' ? defaultBranch : 'dev', defaultBranch };
}

function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPOSITORY.test(repo)) throw new Error('GitHub 仓库标识无效');
  return repo;
}

async function viewRepo(run, repo, cwd) {
  return JSON.parse(await run('gh', ['repo', 'view', validateRepo(repo), '--json', 'nameWithOwner,defaultBranchRef'], cwd));
}

export async function prepareGit(payload, cwd, run = command) {
  mkdirSync(dirname(cwd), { recursive: true, mode: 0o700 });
  const home = dirname(cwd);
  let repo = payload.repo;
  if (!repo) {
    if (!UUID.test(payload.demandId)) throw new Error('需求标识无效');
    const owner = await run('gh', ['api', 'user', '--jq', '.login'], home);
    repo = validateRepo(owner + '/agentship-' + payload.demandId);
    try {
      await viewRepo(run, repo, home);
    } catch {
      try { await run('gh', ['repo', 'create', repo, '--private', '--add-readme'], home); }
      catch { await viewRepo(run, repo, home); }
    }
  }
  const info = await viewRepo(run, repo, home);
  const defaultBranch = info.defaultBranchRef?.name;
  const plan = branchPlan(payload.workType, payload.runId, defaultBranch ?? '');
  if (!existsSync(join(cwd, '.git'))) await run('gh', ['repo', 'clone', validateRepo(repo), cwd], home);
  await run('git', ['fetch', '--prune', 'origin'], cwd);

  const hasRemote = async (branch) => Boolean(await run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/' + branch], cwd));
  if (plan.base === 'dev' && !(await hasRemote('dev'))) {
    try { await run('git', ['push', 'origin', 'refs/remotes/origin/' + defaultBranch + ':refs/heads/dev'], cwd); }
    catch (error) { if (!(await hasRemote('dev'))) throw error; }
    await run('git', ['fetch', 'origin'], cwd);
  }
  if (!(await hasRemote(plan.branch))) {
    try { await run('git', ['push', 'origin', 'refs/remotes/origin/' + plan.base + ':refs/heads/' + plan.branch], cwd); }
    catch (error) { if (!(await hasRemote(plan.branch))) throw error; }
    await run('git', ['fetch', 'origin'], cwd);
  }
  await run('git', ['switch', '-C', plan.branch, 'origin/' + plan.branch], cwd);
  return { repo: validateRepo(info.nameWithOwner), ...plan };
}

export async function publishCode(payload, cwd, run = command) {
  const branch = payload.git?.branch;
  if (!REF.test(branch ?? '')) throw new Error('工作分支无效');
  if (await run('git', ['status', '--porcelain'], cwd)) {
    const tracked = await run('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD'], cwd);
    const untracked = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], cwd);
    const sensitive = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|credentials\.json|[^/]+\.(?:pem|key|p12))(?:$|\/)/i;
    if ([...tracked.split('\0'), ...untracked.split('\0')].some((file) => sensitive.test(file))) {
      throw new Error('变更包含疑似凭据文件，请在本机处理后重试。');
    }
    await run('git', ['add', '--all'], cwd);
    await run('git', ['commit', '-m', 'AgentShip: ' + payload.node.name.slice(0, 100)], cwd);
  }
  await run('git', ['push', 'origin', 'HEAD:refs/heads/' + branch], cwd);
}

export async function deploy(payload, cwd, checkpoint, run = command) {
  const repo = validateRepo(payload.repo);
  const { workflow, target } = payload.node;
  const branch = payload.git?.branch;
  if (!workflow || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.ya?ml$/.test(workflow) || !REF.test(branch ?? '')) {
    throw new Error('请为真实发布配置 GitHub Actions 工作流和有效工作分支');
  }

  let published = payload.checkpoint?.deployment;
  if (!published) {
    const startedAt = new Date(Date.now() - 1_000).toISOString();
    published = { startedAt };
    await checkpoint({ checkpoint: { deployment: published } });
    const output = await run('gh', ['workflow', 'run', workflow, '--repo', repo, '--ref', branch,
      '--raw-field', 'environment=' + target], cwd);
    const workflowRun = /\/actions\/runs\/(\d+)/.exec(output)?.[1];
    if (workflowRun) {
      published = { ...published, workflowRun };
      await checkpoint({ checkpoint: { deployment: published } });
    }
  }

  for (let attempt = 0; attempt < 36; attempt += 1) {
    if (!published.workflowRun) {
      const runs = JSON.parse(await run('gh', ['run', 'list', '--repo', repo, '--workflow', workflow,
        '--branch', branch, '--event', 'workflow_dispatch', '--limit', '10',
        '--json', 'databaseId,createdAt,headBranch'], cwd));
      const candidates = runs.filter((entry) => entry.headBranch === branch && entry.createdAt >= published.startedAt);
      if (candidates.length > 1) throw new Error('检测到多条可能的发布运行，请在 GitHub 核对结果');
      if (candidates.length === 1) {
        published = { ...published, workflowRun: String(candidates[0].databaseId) };
        await checkpoint({ checkpoint: { deployment: published } });
      }
    }
    if (/^\d+$/.test(published.workflowRun ?? '')) {
      const info = JSON.parse(await run('gh', ['run', 'view', published.workflowRun, '--repo', repo,
        '--json', 'status,conclusion,url,headBranch'], cwd));
      if (info.headBranch !== branch) throw new Error('发布运行与当前工作分支不匹配');
      if (info.status === 'completed') {
        if (info.conclusion !== 'success') throw new Error('发布工作流未成功，请在 GitHub 核对结果');
        return { summary: '发布工作流已成功完成：' + target, url: info.url, mode: 'codex' };
      }
    }
    await sleep(2_000);
  }
  throw new Error('发布结果尚未确认；重试会先查询原发布工作流');
}

export async function demoTask(job) {
  const { payload, type } = job;
  await sleep(160);
  if (type === 'git') {
    return { type: 'complete', result: {
      repo: payload.repo || 'demo/agentship-' + payload.demandId, ...branchPlan(payload.workType, payload.runId, 'main'),
    } };
  }
  if (type === 'publish') {
    return { type: 'complete', result: { summary: '演练：模拟完成 ' + payload.node.target + ' 的发布', mode: 'demo' } };
  }
  const { node, role } = payload;
  const prompt = node.prompt + ' ' + role.prompt;
  if (type === 'agent' && prompt.includes('[demo:question]') && !payload.input) {
    return { type: 'question', result: { question: '演练：这个步骤需要兼容已有使用方式吗？' } };
  }
  if (type === 'agent' && prompt.includes('[demo:fail-once]') && job.revision === 1) {
    return { type: 'failure', result: { message: '演练：该角色首次执行失败，请点击重试' } };
  }
  const verdict = node.type === 'check' ? (prompt.includes('[demo:repair-once]') && node.wave === 1 ? 'repair' : 'pass') : 'none';
  const summary = '演练：' + role.name + '完成「' + node.name + '」' + (payload.input ? '，已接收输入' : '');
  const artifact = summary + '\n需求：' + payload.title + '\n' +
    (payload.siblings.length ? '子 Agent：' + payload.siblings.map((entry) => entry.role).join('、') : '');
  return { type: 'complete', result: { summary, artifact, verdict } };
}
