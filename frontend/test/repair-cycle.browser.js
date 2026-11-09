async page => {
  const origin = 'http://127.0.0.1:4190';
  const id = n => '40000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const user = { id: id(1), displayName: '修复验证', username: 'repair_fixture' };
  const node = (n, name, type, state) => ({ nodeId: id(n), name, type, state, wave: 1, tasks: [], artifactIds: [],
    inputRequirementRevision: 1, basedOnOlderRequirementRevision: false });
  const quality = node(6, '质量检查', 'check', 'needs_attention');
  const independent = node(7, '独立检查', 'check', 'complete');
  const repair = node(8, '跨阶段修复', 'work', 'complete');
  const candidate = wave => String(wave).repeat(40);
  const history = [1, 2, 3].map(wave => ({ wave, outcome: 'repair', testedCommit: candidate(wave),
    repairRound: { number: wave, kind: 'automatic', state: 'complete' } }));
  quality.wave = 4;
  quality.check = { originalCheckNodeId: quality.nodeId, checkWave: 4, automaticRepairCount: 3, automaticRepairLimit: 3,
    manualRepairCount: 0, status: 'limit_reached', history: [...history, { wave: 4, outcome: 'repair', testedCommit: candidate(4) }] };
  independent.check = { originalCheckNodeId: independent.nodeId, checkWave: 1, automaticRepairCount: 0, automaticRepairLimit: 1,
    manualRepairCount: 0, status: 'pass' };
  const run = { id: id(2), projectId: id(3), requirementId: id(4), workflowId: id(5), requirementName: '检查修复验证', workType: 'feature',
    workflowVersion: 1, requirementRevision: 1, sourceRequirementVersion: 1, initiatorId: user.id, version: 4, state: 'needs_attention',
    allowedActions: [], eventsCursor: '20', mode: 'demo', blockerCode: 'AGENT_REPAIR_LIMIT_REACHED',
    blocker: '质量检查等待人工处理', deviceStatus: { id: id(9), name: '发起电脑', mode: 'demo', connectivity: 'online', codexStatus: 'not_required' },
    stages: [{ id: id(10), name: '检查', nodes: [quality, independent] }, { id: id(11), name: '修复', nodes: [repair] }] };

  await page.unroute('**/api/**');
  await page.route('**/api/**', async route => {
    const path = route.request().url().slice(origin.length).split('?')[0];
    const body = path === '/api/me' ? { user, csrfToken: 'fixture' } : run;
    await route.fulfill({ json: body });
  });
  await page.goto(origin + '/runs/' + run.id);
  const card = name => page.locator('.run-node').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const check = card('质量检查');
  await check.getByRole('heading', { name: '质量检查', exact: true }).waitFor();
  await check.getByText('3 / 3 轮', { exact: true }).waitFor({ timeout: 2500 });
  await check.getByText('第 4 次', { exact: true }).waitFor();
  await check.getByText('已达自动修复上限', { exact: true }).waitFor();
  await check.getByText('本检查的修复路线已暂停，等待人工处理。', { exact: true }).waitFor();
  await card('独立检查').getByText('0 / 1 轮', { exact: true }).waitFor();
  await card('独立检查').getByText('通过', { exact: true }).waitFor();
  await check.getByText('检查记录 · 4 次', { exact: true }).click();
  for (const wave of [1, 2, 3, 4]) await check.getByText(candidate(wave), { exact: true }).waitFor();
  if (await page.getByRole('button', { name: /再修|停止运行|重新检查/ }).count()) throw new Error('Read-only user received a repair command');
  const operations = page.getByRole('button', { name: '运行操作', exact: true });
  if (await operations.count()) throw new Error('Read-only user received a repair control entry');

  const refresh = () => page.getByRole('button', { name: '刷新运行', exact: true }).click();
  run.allowedActions = ['open_repair_control'];
  await refresh();
  await operations.waitFor({ timeout: 2500 });
  run.state = 'running'; delete run.blocker; delete run.blockerCode;
  quality.state = 'running'; quality.wave = 4;
  quality.check = { ...quality.check, status: 'repair', manualRepairCount: 1,
    history: [...history, { wave: 4, outcome: 'repair', testedCommit: candidate(4), repairRound: { number: 4, kind: 'manual', state: 'running' } }] };
  repair.state = 'running'; repair.wave = 4;
  await refresh();
  await check.getByText('修复中', { exact: true }).first().waitFor();
  await check.getByText('1 轮', { exact: true }).waitFor();
  await check.getByText('修复完成后会回到本检查节点复查。', { exact: true }).waitFor();

  quality.wave = 5;
  quality.check.history[3].repairRound.state = 'complete';
  quality.check = { ...quality.check, checkWave: 5, status: 'pending', history: [...quality.check.history, { wave: 5, outcome: 'pending' }] };
  repair.state = 'complete';
  await refresh();
  await check.getByText('复查中', { exact: true }).waitFor();
  await check.getByText('第 5 次', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Repair history overflows mobile');
  return 'agentShip-repair-cycle-ok';
}
