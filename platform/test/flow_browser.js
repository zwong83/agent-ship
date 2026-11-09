async (page) => {
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const field = (name) => page.getByLabel(name, { exact: true });
  const title = '浏览器端多 Agent 流程';
  const coordinator = '流程协调 Agent';
  const frontend = '前端子 Agent';
  const backend = '后端子 Agent';
  const reviewer = '复核子 Agent';

  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await heading('登录 AgentShip').waitFor();
  await field('邮箱或用户名').fill('fixture_owner');
  await page.locator('input[name="password"]').fill('synthetic test phrase +!');
  await button('登录').click();
  await heading('需求').waitFor();

  await button('流程配置').click();
  await button('新建流程配置').click();
  await heading('新建流程配置').waitFor();
  await field('流程名称').fill(title);

  const stage = (index) => page.getByRole('region', { name: `阶段 ${index + 1}`, exact: true });
  const selectNode = (name) => button(`编辑节点 ${name}`).click();
  const dependency = (name) => field(`前置节点 ${name}`);
  const mode = () => page.getByRole('combobox', { name: /^子 Agent 执行方式/ });
  const coordinatorPicker = page.getByRole('combobox', { name: /^协调 Agent/ });
  async function addStage(index, name) {
    await button('添加阶段').click();
    await field(`阶段 ${index + 1} 名称`).fill(name);
    return stage(index);
  }
  async function addNode(parent, name, { dependencies = [], agents = [] } = {}) {
    await button('添加节点', parent).click();
    await field('节点名称').fill(name);
    await coordinatorPicker.selectOption({ label: coordinator });
    for (const prerequisite of dependencies) await dependency(prerequisite).check();
    for (const agent of agents) await page.getByRole('checkbox', { name: agent }).check();
  }

  const preparation = await addStage(0, '准备阶段');
  await addNode(preparation, '分析需求', { agents: [frontend, backend, reviewer] });
  if (await mode().inputValue() !== 'parallel') {
    throw new Error('New work node did not default to parallel Agent order');
  }
  await button('保存流程').click();
  await page.getByRole('alert').filter({ hasText: /结束/ }).waitFor();
  await heading('新建流程配置').waitFor();

  const development = await addStage(1, '并行开发');
  await addNode(development, '前端实现', { dependencies: ['分析需求'] });
  await addNode(development, '后端实现', { dependencies: ['分析需求'] });
  const delivery = await addStage(2, '汇合交付');
  await addNode(delivery, '汇总产物', { dependencies: ['前端实现', '后端实现'] });
  await button('添加结束节点').click();
  await field('节点名称').fill('结束');
  await dependency('汇总产物').check();
  await button('保存流程').click();
  await page.getByText('已创建流程配置。', { exact: true }).waitFor();
  await heading(title).waitFor();
  await heading('负责人').waitFor();

  await page.reload();
  await heading(title).waitFor();
  await selectNode('分析需求');
  if (await mode().inputValue() !== 'parallel') {
    throw new Error('Reopened initial version did not preserve parallel Agent order');
  }
  await mode().selectOption('serial');
  await button(`上移 ${reviewer}`).click();
  await button(`上移 ${reviewer}`).click();
  await selectNode('结束');
  await dependency('前端实现').check();
  await button('保存流程').click();
  await page.getByText('配置已保存。', { exact: true }).waitFor();
  await page.getByText('流程版本 v2', { exact: true }).waitFor();
  await page.reload();
  await heading(title).waitFor();
  await selectNode('分析需求');
  if (await mode().inputValue() !== 'serial') {
    throw new Error('Reopened work node did not preserve serial Agent order');
  }
  await selectNode('结束');
  if (!(await dependency('前端实现').isChecked())) {
    throw new Error('Reopened end node lost its edited dependency');
  }
  if (await coordinatorPicker.count()) throw new Error('End node exposed Agent configuration');
  const map = page.getByRole('region', { name: '流程依赖图', exact: true });
  const mapNode = button('在图中编辑 分析需求', map);
  await mapNode.focus();
  await mapNode.press('Enter');
  await mode().waitFor();
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });

  await page.screenshot({ path: '../flow-editor-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
    throw new Error('Flow editor overflows the mobile viewport');
  }
  const mapScroller = page.getByLabel('可横向滚动的流程图', { exact: true });
  if (!(await mapScroller.evaluate(element => element.scrollWidth > element.clientWidth))) {
    throw new Error('The mobile diagram must remain horizontally scrollable');
  }
  await page.screenshot({ path: '../flow-editor-mobile.png', fullPage: true, animations: 'disabled' });
  const editor = page.getByRole('region', { name: '流程编辑器', exact: true });
  await editor.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: '../flow-editor-mobile-map.png', animations: 'disabled' });
  const mapPosition = await page.evaluate(() => window.scrollY);
  const settings = heading('节点设置');
  await settings.scrollIntoViewIfNeeded();
  const bounds = await settings.boundingBox();
  if (!bounds || bounds.y < 0 || bounds.y >= 844 || await page.evaluate(() => window.scrollY) <= mapPosition) {
    throw new Error('Mobile document cannot scroll from the diagram to node settings');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await selectNode('前端实现');
  await dependency('后端实现').check();
  await selectNode('后端实现');
  await dependency('前端实现').check();
  await button('保存流程').click();
  await page.getByRole('alert').filter({ hasText: /循环依赖/ }).waitFor();
  await dependency('前端实现').uncheck();
  await selectNode('前端实现');
  await dependency('后端实现').uncheck();

  await selectNode('分析需求');
  await page.getByRole('combobox', { name: /^节点类型/ }).selectOption('check');
  await button('保存流程').click();
  await page.getByRole('alert').filter({ hasText: /通过|修复/ }).waitFor();
  await page.getByText('有未保存的修改', { exact: true }).waitFor();
  return 'agentShip-flow-ok';
}
