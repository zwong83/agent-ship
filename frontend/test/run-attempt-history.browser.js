async page => {
  const origin = 'http://127.0.0.1:4190';
  const id = n => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const user = { id: id(1), displayName: '尝试历史验证', username: 'history_fixture' };
  const run = { id: id(2), projectId: id(3), requirementId: id(4), workflowId: id(5), requirementName: '带历史的运行', workType: 'feature',
    workflowVersion: 1, requirementRevision: 2, sourceRequirementVersion: 3, initiatorId: user.id, version: 5, state: 'running',
    allowedActions: ['view'], eventsCursor: '20', mode: 'demo', deviceStatus: { id: id(6), name: '发起电脑', mode: 'demo', connectivity: 'online', codexStatus: 'not_required' },
    stages: [{ id: id(7), name: '开发', nodes: [{ nodeId: id(8), wave: 2, name: '前端实现', type: 'work', state: 'running', tasks: [], artifactIds: [],
      inputRequirementRevision: 2, basedOnOlderRequirementRevision: false }] }] };
  const failed = { taskId: id(9), attemptId: id(10), attemptNumber: 1, kind: 'agent', state: 'failed', inputRequirementRevision: 1,
    basedOnOlderRequirementRevision: true, nodeId: id(8), wave: 1, roleId: 'frontend', roleDisplayName: '前端 Agent（固定版本）',
    reason: '发起电脑执行失败。', artifactIds: [] };
  const recovered = { ...failed, attemptId: id(11), attemptNumber: 2, state: 'succeeded', reason: undefined, artifactIds: [id(12)] };
  const params = [];
  await page.unroute('**/api/**');
  await page.route('**/api/**', async route => {
    const [path, query = ''] = route.request().url().slice(origin.length).split('?');
    if (path === '/api/me') return route.fulfill({ json: { user, csrfToken: 'history-fixture' } });
    if (path.endsWith('/attempts')) {
      params.push(query);
      return route.fulfill({ json: query.includes('cursor=after-failed') ? { items: [recovered], nextCursor: null }
        : { items: [failed], nextCursor: 'after-failed' } });
    }
    return route.fulfill({ json: run });
  });
  await page.goto(`${origin}/runs/${run.id}`);
  await page.getByRole('heading', { name: '带历史的运行', exact: true }).waitFor();
  if (params.length) throw new Error('Board eagerly read attempt history');
  const open = page.getByRole('button', { name: '查看尝试历史', exact: true });
  await open.waitFor({ timeout: 3000 });
  await open.click();
  await page.getByText('前端 Agent（固定版本）', { exact: true }).waitFor();
  await page.getByText('基于旧版本', { exact: true }).waitFor();
  await page.getByRole('button', { name: '加载更多尝试', exact: true }).click();
  await page.getByText('第 2 次尝试', { exact: true }).waitFor();
  if (await page.getByText('第 1 次尝试', { exact: true }).count() !== 1 || !params.at(-1)?.includes('cursor=after-failed')) {
    throw new Error('Loading the next page lost or duplicated previous attempts');
  }
  await page.getByLabel('筛选节点', { exact: true }).selectOption(id(8));
  await page.getByText('第 2 次尝试', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('第 1 次尝试', { exact: true }).waitFor();
  if (!params.at(-1)?.includes(`nodeId=${id(8)}`) || params.at(-1)?.includes('cursor=')) {
    throw new Error('Node change reused a cursor from another query');
  }
  return 'agentShip-run-attempt-history-ok';
}
