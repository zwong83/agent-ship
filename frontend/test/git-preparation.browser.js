async (page) => {
  page.setDefaultTimeout(10000);
  const origin = 'http://127.0.0.1:4190';
  const uid = n => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const user = { id: uid(1), displayName: 'Git 验证', username: 'git_fixture' };
  const run = { id: uid(2), projectId: uid(3), requirementId: uid(4), requirementName: 'Git 准备验证', workType: 'feature', workflowId: uid(5), workflowVersion: 2, state: 'waiting', deviceStatus: { id: uid(6), name: '当前电脑', mode: 'demo', connectivity: 'online', codexStatus: 'not_required' }, mode: 'demo', version: 3, initiatorId: user.id, requirementRevision: 1, sourceRequirementVersion: 2, eventsCursor: '0', allowedActions: [], blockerCode: 'AGENT_DISPATCH_PENDING', blocker: 'Git 准备完成，等待 Agent 派发', git: { repository: { provider: 'demo', repositoryId: 'local-demo', displayName: '演示仓库', defaultBranch: 'main' }, baseBranch: 'dev', workBranch: 'feature/run-test', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) }, stages: [{ id: uid(7), name: '实现阶段', nodes: [{ nodeId: uid(8), name: '实现功能', type: 'work', wave: 1, state: 'blocked', tasks: [], artifactIds: [], inputRequirementRevision: null, basedOnOlderRequirementRevision: false }] }] };
  await page.route('**/api/**', async route => {
    const path = route.request().url().replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const body = path === '/api/me' ? { user, csrfToken: 'fixture-csrf' } : path === '/api/devices' ? { items: [run.deviceStatus] } : run;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + '/runs/' + run.id);
  await page.getByRole('heading', { name: '仓库已就绪，等待 Agent 执行', exact: true }).waitFor({ timeout: 3000 });
  await page.getByText('main', { exact: true }).waitFor();
  await page.getByText('a'.repeat(40), { exact: true }).waitFor();
  await page.getByText('b'.repeat(40), { exact: true }).waitFor();
  await page.getByText('尚未派发执行任务', { exact: true }).waitFor();
  if (await page.getByRole('link', { name: '演示仓库', exact: true }).count()) throw new Error('Demo repository must not be an external link');
  run.gitPreparation = { state: 'ready', mode: 'demo', taskId: uid(9), attemptNumber: 1, steps: [
    { operationKey: 'repo', effect: 'create_repository', targetId: 'demo/repository', state: 'succeeded', providerResultId: 'demo-repo-1', observedAt: '2026-11-09T12:00:00Z' },
    { operationKey: 'base', effect: 'create_base_branch', targetId: 'dev', state: 'succeeded' },
    { operationKey: 'work', effect: 'create_work_branch', targetId: 'feature/run-test', state: 'succeeded' },
  ] };
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  await page.getByRole('heading', { name: 'Git 准备记录', exact: true }).waitFor();
  if (await page.getByText('已确认', { exact: true }).count() !== 3) throw new Error('Confirmed operation evidence lost');
  run.mode = 'codex'; run.gitPreparation.mode = 'codex'; run.git.repository = { ...run.git.repository, provider: 'github', displayName: 'agentship/sample-repo' };
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  const repositoryLink = page.getByRole('link', { name: 'agentship/sample-repo', exact: true });
  await repositoryLink.waitFor();
  if (await repositoryLink.getAttribute('href') !== 'https://github.com/agentship/sample-repo') throw new Error('Repository link escaped GitHub');
  run.git.repository.displayName = 'javascript:alert(1)';
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  await page.getByText('javascript:alert(1)', { exact: true }).waitFor();
  if (await page.getByRole('link', { name: 'javascript:alert(1)', exact: true }).count()) throw new Error('Unsafe repository display name became a link');
  delete run.git; run.state = 'preparing'; run.blocker = '准备工作分支'; run.gitPreparation.state = 'preparing';
  run.gitPreparation.steps[2].state = 'dispatching';
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  await page.getByRole('heading', { name: '准备仓库中', exact: true }).waitFor();
  await page.getByText('正在处理', { exact: true }).waitFor();
  run.state = 'needs_attention'; run.gitPreparation.state = 'needs_attention'; run.gitPreparation.message = '网络中断，工作分支的创建结果尚未确认'; run.gitPreparation.steps[2].state = 'unknown';
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  await page.getByText('结果待核对', { exact: true }).waitFor();
  await page.getByText('有操作尚未确认结果，系统需先核对仓库与分支的实际状态。不要重复创建仓库或分支。', { exact: true }).waitFor();
  if (await page.getByRole('button', { name: /重试|重新执行/ }).count()) throw new Error('Unsafe recovery action was invented');
  run.gitPreparation.steps[2].state = 'failed'; run.gitPreparation.message = '没有创建分支的权限';
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  await page.getByText('没有创建分支的权限', { exact: true }).waitFor();
  await page.getByText('失败', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Git evidence overflows mobile');
  await page.getByRole('button', { name: '本机设备', exact: true }).click();
  await page.getByLabel('本机执行模式', { exact: true }).selectOption('demo', { timeout: 3000 });
  const demoCommand = await page.getByLabel('本机执行程序命令', { exact: true }).textContent();
  if (!demoCommand.includes('--execute-git') || demoCommand.includes('--git-provider github')) throw new Error('Local demo should only opt into local Git');
  await page.getByLabel('本机执行模式', { exact: true }).selectOption('github');
  const realCommand = await page.getByLabel('本机执行程序命令', { exact: true }).textContent();
  if (!realCommand.includes('--execute-git') || !realCommand.includes('--mode codex --git-provider github')) throw new Error('Real GitHub command lacks explicit opt-in');
  await page.getByText('AGENTSHIP_GITHUB_TOKEN', { exact: false }).waitFor();
  if (await page.locator('input[type=password]').count()) throw new Error('Device page must not collect GitHub tokens');
  await page.getByLabel('本机执行模式', { exact: true }).selectOption('heartbeat');
  if ((await page.getByLabel('本机执行程序命令', { exact: true }).textContent()).includes('--execute-git')) throw new Error('Default connection must not execute Git');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Device mode instructions overflow mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  return 'git-preparation-passed-evidence-ready-preparing-unknown-failed-safe-links-device-optin-mobile';
}
