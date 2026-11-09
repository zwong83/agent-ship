async page => {
  const origin = 'http://127.0.0.1:4190';
  const id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const user = { id: id(1), displayName: '调度验证', username: 'scheduler_fixture' };
  const role = (n, displayName, kind, sequence) => ({ roleId: id(n), agentId: id(n + 30), agentVersion: 2, kind, displayName, sequence });
  const roles = [role(10, '实现 Agent', 'agent', 1), role(11, '复核 Agent', 'agent', 2), role(12, '汇总 Agent', 'coordinator', null)];
  const task = (n, state, attemptNumber = 1) => ({ taskId: id(n + 20), roleId: id(n), kind: n === 12 ? 'coordinator' : 'agent', state, attemptNumber });
  const work = { nodeId: id(13), wave: 1, name: '实现交付', type: 'work', state: 'waiting_reply', dependencies: [], agentOrder: 'serial',
    selectedRoles: roles, tasks: [task(10, 'succeeded'), { ...task(11, 'waiting_reply', 2), reason: '等待确认接口范围' }],
    artifactIds: [], inputRequirementRevision: 2, basedOnOlderRequirementRevision: true };
  const end = { nodeId: id(14), wave: 1, name: '交付结束', type: 'end', state: 'blocked', dependencies: [work.nodeId],
    tasks: [], artifactIds: [], inputRequirementRevision: null, basedOnOlderRequirementRevision: false };
  const run = { id: id(2), projectId: id(3), requirementId: id(4), requirementName: '多 Agent 调度验证', workType: 'feature',
    workflowId: id(5), workflowVersion: 2, initiatorId: user.id, requirementRevision: 3, sourceRequirementVersion: 3,
    eventsCursor: '12', allowedActions: [], state: 'waiting', blockerCode: 'AGENT_WAITING_REPLY', blocker: '复核 Agent 等待回复',
    mode: 'codex', version: 9, deviceStatus: { id: id(6), name: '发起电脑', mode: 'codex', connectivity: 'online', codexStatus: 'available' },
    git: { repository: { provider: 'github', repositoryId: '2345', displayName: 'fixture/repository', defaultBranch: 'main' },
      baseBranch: 'dev', workBranch: 'feature/scheduler', baseCommit: '1'.repeat(40), headCommit: '1'.repeat(40) },
    stages: [{ id: id(7), name: '研发', nodes: [work] }, { id: id(8), name: '结束', nodes: [end] }] };

  await page.unroute('**/api/**');
  await page.route('**/api/**', async route => {
    const path = route.request().url().slice(origin.length).split('?')[0];
    const body = path === '/api/me' ? { user, csrfToken: 'fixture' } : path === '/api/devices' ? { items: [run.deviceStatus] } : run;
    await route.fulfill({ json: body });
  });
  await page.goto(origin + '/runs/' + run.id);
  const refresh = () => page.getByRole('button', { name: '刷新运行', exact: true }).click();
  const status = page.getByRole('region', { name: '当前运行状态' });
  await status.getByRole('heading', { name: '等待回复', exact: true }).waitFor({ timeout: 3000 });
  const roleRow = name => page.locator('.run-roles li').filter({ hasText: name });
  await roleRow('实现 Agent').getByText('已完成', { exact: true }).waitFor();
  await roleRow('复核 Agent').getByText('第 2 次', { exact: true }).waitFor();
  await roleRow('复核 Agent').getByText('等待确认接口范围', { exact: true }).waitFor();
  await roleRow('汇总 Agent').getByText('待派发', { exact: true }).waitFor();
  await page.getByText('等待前置 · 实现交付', { exact: true }).waitFor();
  await page.getByText('子 Agent 串行', { exact: true }).waitFor();

  run.state = 'needs_attention'; run.blockerCode = 'AGENT_EXECUTION_FAILED'; run.blocker = '复核任务需要处理';
  work.state = 'needs_attention'; work.tasks[1] = { ...task(11, 'failed', 2), reason: '执行超时' };
  await refresh();
  await status.getByRole('heading', { name: '待人工处理', exact: true }).waitFor();
  await roleRow('复核 Agent').getByText('执行超时', { exact: true }).waitFor();
  if (await page.getByRole('button', { name: /重试|跳过|恢复/ }).count()) throw new Error('Read-only board exposed a write action');

  run.state = 'completed'; delete run.blocker; delete run.blockerCode;
  run.deviceStatus.connectivity = 'offline'; work.state = 'complete'; end.state = 'complete';
  work.tasks = [task(10, 'succeeded'), { ...task(11, 'failed', 2), disposition: 'skipped' }, task(12, 'succeeded')];
  const commit = 'd'.repeat(40);
  work.artifactIds = [id(15)];
  work.artifacts = [{ id: id(15), kind: 'product', runId: run.id, nodeId: work.nodeId, wave: 1,
    attemptId: id(16), requirementRevision: 2, mode: 'codex', createdAt: '2026-11-09T12:00:00Z',
    title: '协调交付结果', sourceRef: 'javascript:alert(1)', commit, repositoryId: '2345' }];
  await refresh();
  await status.getByRole('heading', { name: '已完成', exact: true }).waitFor();
  await page.getByText('已到达结束节点', { exact: true }).waitFor();
  await roleRow('复核 Agent').getByText('已跳过', { exact: true }).waitFor();
  await page.getByText('协调交付结果', { exact: true }).waitFor();
  await page.getByText(commit, { exact: true }).waitFor();
  await page.getByText('javascript:alert(1)', { exact: true }).waitFor();
  if (await page.getByRole('link', { name: /javascript|协调交付结果/ }).count() || await page.locator('a[href*="/commit/"]').count()) {
    throw new Error('Local artifact evidence became a remote or unsafe link');
  }
  const localRef = 'local-git:refs/heads/feature/scheduler#delivery.md';
  work.artifacts[0].sourceRef = localRef;
  await refresh();
  await page.getByText('本机引用', { exact: true }).waitFor();
  await page.getByText(localRef, { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Node view overflows mobile');
  await page.getByRole('button', { name: '本机设备', exact: true }).click();
  const mode = page.getByLabel('本机执行模式', { exact: true });
  const command = page.getByLabel('本机执行程序命令', { exact: true });
  await mode.selectOption('demo-agents', { timeout: 3000 });
  const demo = await command.textContent();
  if (!demo.includes('--execute-git --execute-agents') || demo.includes('--mode codex')) throw new Error('Demo Agent execution lacks local opt-in');
  await mode.selectOption('codex-agents');
  const codex = await command.textContent();
  if (!codex.includes('--execute-git --execute-agents --mode codex --git-provider github')) throw new Error('Codex execution lacks real opt-in');
  await mode.selectOption('github');
  if ((await command.textContent()).includes('--execute-agents')) throw new Error('Git-only mode enabled Agent execution');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Execution modes overflow mobile');
  return 'agentShip-node-execution-ok';
}
