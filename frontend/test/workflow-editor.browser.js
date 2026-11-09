async (page) => {
  page.setDefaultTimeout(10000);
  const origin = 'http://127.0.0.1:4190';
  const user = { id: '00000000-0000-4000-8000-000000000001', displayName: '流程验证', username: 'flow_fixture' };
  const flowId = '00000000-0000-4000-8000-000000000010';
  const catalog = Array.from({ length: 5 }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000010${index}`,
    name: ['协调者', '前端 Agent', '后端 Agent', '测试 Agent', '未选择 Agent'][index],
    availability: 'unknown', description: '本地界面验证角色',
  }));
  let saved = null;
  let saves = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = request.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    let body = {};
    let status = 200;
    if (pathname === '/api/me') body = { user, csrfToken: 'fixture-csrf' };
    else if (pathname === '/api/catalog') body = { items: catalog, nextCursor: null };
    else if (pathname === '/api/objects/flows' && request.method() === 'GET') body = { items: saved ? [saved] : [], nextCursor: null };
    else if (pathname.startsWith('/api/objects/flows') && ['POST', 'PATCH'].includes(request.method())) {
      const payload = request.postDataJSON();
      saved = { ...payload, id: flowId, kind: 'flows', version: ++saves, owner: user, deputies: [], allowedActions: ['view', 'edit', 'manage_members', 'use'] };
      body = saved;
      status = request.method() === 'POST' ? 201 : 200;
    } else if (pathname === `/api/objects/flows/${flowId}`) body = saved;
    else throw new Error('Unexpected fixture endpoint ' + pathname);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + '/flows/new');
  await page.getByRole('heading', { name: '新建流程配置', exact: true }).waitFor();
  await page.getByRole('button', { name: '添加阶段', exact: true }).click({ timeout: 3000 });
  await page.getByLabel('流程名称', { exact: true }).fill('多 Agent 交付流程');
  await page.getByLabel('阶段 1 名称', { exact: true }).fill('需求与研发');
  await page.getByRole('region', { name: '阶段 1', exact: true }).getByRole('button', { name: '添加节点', exact: true }).click();
  await page.getByLabel('节点名称', { exact: true }).fill('完成研发');
  await page.getByLabel('协调 Agent', { exact: true }).selectOption(catalog[0].id);
  for (const name of ['前端 Agent', '后端 Agent', '测试 Agent']) {
    await page.getByRole('checkbox', { name: new RegExp(name) }).check();
  }
  await page.getByLabel('子 Agent 执行方式', { exact: true }).selectOption('serial');
  await page.getByRole('button', { name: '上移 测试 Agent', exact: true }).click();
  await page.getByRole('button', { name: '保存流程', exact: true }).click();
  await page.getByText('流程必须有且只有一个结束节点。', { exact: true }).waitFor();
  if (saves !== 0) throw new Error('Invalid flow must not be submitted');
  await page.evaluate(() => { window.flowOriginalConfirm = window.confirm; window.confirm = () => false; });
  await page.getByRole('button', { name: '需求', exact: true }).click();
  await page.getByLabel('流程名称', { exact: true }).waitFor();
  if (await page.getByLabel('流程名称', { exact: true }).inputValue() !== '多 Agent 交付流程') throw new Error('Cancelled navigation lost the draft');
  await page.evaluate(() => { window.confirm = window.flowOriginalConfirm; delete window.flowOriginalConfirm; });
  await page.getByRole('button', { name: '添加阶段', exact: true }).click();
  await page.getByLabel('阶段 2 名称', { exact: true }).fill('收尾');
  await page.getByRole('region', { name: '阶段 2', exact: true }).getByRole('button', { name: '添加节点', exact: true }).click();
  await page.getByLabel('节点名称', { exact: true }).fill('汇总产物');
  await page.getByLabel('协调 Agent', { exact: true }).selectOption(catalog[0].id);
  await page.getByRole('checkbox', { name: '前置节点 完成研发', exact: true }).check();
  await page.getByRole('button', { name: '添加结束节点', exact: true }).click();
  await page.getByRole('checkbox', { name: '前置节点 汇总产物', exact: true }).check();
  await page.getByRole('button', { name: '保存流程', exact: true }).click();
  await page.getByRole('heading', { name: '多 Agent 交付流程', exact: true }).waitFor();
  if (saves !== 1) throw new Error('Expected one saved workflow');
  const stages = saved.data.stages;
  const first = stages[0].nodes[0];
  if (stages.length !== 2 || first.agentOrder !== 'serial' || first.agentIds.join(',') !== [catalog[1].id, catalog[3].id, catalog[2].id].join(',')) throw new Error('Agent choices/order did not reach the API');
  if (first.agentIds.includes(catalog[4].id)) throw new Error('An unselected Agent was included');
  if (stages[1].nodes[0].dependencies[0] !== first.id) throw new Error('Cross-stage dependency did not reach the API');
  const end = stages[1].nodes[1];
  if (end.type !== 'end' || end.agentIds || end.coordinatorId || end.route) throw new Error('End node carries execution data');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '在图中编辑 完成研发', exact: true }).focus();
  await page.keyboard.press('Enter');
  if (await page.getByLabel('节点名称', { exact: true }).inputValue() !== '完成研发') throw new Error('Keyboard graph selection failed');
  if (await page.getByLabel('子 Agent 执行方式', { exact: true }).inputValue() !== 'serial') throw new Error('Saved serial mode lost after reload');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Workflow editor overflows mobile viewport');
  await page.setViewportSize({ width: 1440, height: 1000 });
  return 'workflow-editor-passed-stages-dependencies-agents-validation-navigation-keyboard-mobile';
}
