async page => {
  const button = name => (name === '发起运行' ? page.getByRole('main') : page).getByRole('button', { name, exact: true });
  const field = name => page.getByLabel(name, { exact: true });
  const heading = name => page.getByRole('heading', { name, exact: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await field('邮箱或用户名').fill('launch_owner');
  await field('密码').fill('synthetic test phrase +!');
  await button('登录').click();
  await button('本机设备').click();
  await heading('Fixture computer').waitFor();
  await page.getByText('在线', { exact: true }).waitFor();
  await button('生成配对码').click();
  await page.getByText('一次性配对码', { exact: true }).waitFor();
  // The pairing secret is deliberately omitted from screenshots and test output.
  await button('运行看板').click();
  await button('发起运行').click();
  await button('添加新需求').click();
  await field('新需求名称').fill('浏览器创建的启动需求');
  await field('所属项目').selectOption({ index: 1 });
  await button('创建并选择需求').click();
  await field('选择流程').waitFor();
  if (await field('工作类型').inputValue() !== 'feature' || !(await field('工作类型').isDisabled())) {
    throw new Error('An unlinked requirement must lock the work type to feature');
  }
  await field('搜索流程').fill('启动含需求');
  await field('选择流程').selectOption({ label: '启动含需求流程 · v1' });
  await field('需求说明（可在需求节点补充）').waitFor();
  await field('GitHub 用户名或组织名').fill('fixture-team');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../launch-wizard-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
    throw new Error('Startup form has horizontal overflow on mobile');
  }
  await page.screenshot({ path: '../launch-wizard-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let committedRunId;
  await page.route('**/api/runs', async route => {
    if (route.request().method() !== 'POST') throw new Error('Expected launch POST');
    const response = await route.fetch();
    if (response.status() !== 201) throw new Error('Platform rejected the launch before the lost-response test');
    committedRunId = (await response.json()).runId;
    await route.abort('failed');
  }, { times: 1 });
  await button('确认并发起运行').click();
  await button('重试确认启动').click();
  await heading('待执行的 Git 计划').waitFor();
  const firstRunUrl = page.url();
  if (!committedRunId || !firstRunUrl.endsWith('/' + committedRunId)) throw new Error('Retry did not recover the committed run');
  await page.reload();
  await heading('浏览器创建的启动需求').waitFor();
  await page.locator('.run-roles li').filter({ hasText: '启动协调 Agent' }).waitFor();
  await page.getByText('Git 准备尚未完成', { exact: false }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../run-detail-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
    throw new Error('Run detail has horizontal overflow on mobile');
  }
  await page.screenshot({ path: '../run-detail-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await button('返回运行看板').click();
  await button('发起运行').click();
  await button('添加新需求').click();
  await field('新需求名称').fill('浏览器创建的启动需求');
  await field('所属项目').selectOption({ index: 1 });
  await button('创建并选择需求').click();
  await button('选择已有的同名需求').click();
  await field('选择流程').selectOption({ label: '启动前补齐说明流程 · v1' });
  await field('需求说明（启动前必填）').waitFor();
  await field('GitHub 用户名或组织名').fill('fixture-team');
  await button('确认并发起运行').click();
  await page.getByRole('alert').filter({ hasText: '启动前补齐需求说明' }).waitFor();

  await field('搜索需求').fill('已关联仓库需求');
  await field('选择需求').selectOption({ label: '已关联仓库需求' });
  await page.locator('.selection-note').filter({ hasText: 'fixture-team/existing' }).waitFor();
  if (await field('工作类型').inputValue() !== '' || await field('工作类型').isDisabled()) {
    throw new Error('A linked requirement must ask for a work type');
  }
  for (const type of ['feature', 'refactor', 'fix', 'hotfix']) {
    await field('工作类型').selectOption(type);
  }
  await field('选择流程').selectOption({ label: '启动前补齐说明流程 · v1' });
  if (await field('GitHub 用户名或组织名').count()) throw new Error('Linked repository must not ask for another namespace');
  await button('确认并发起运行').click();
  await heading('已关联仓库需求').waitFor();
  await heading('待执行的 Git 计划').waitFor();
  await page.getByText('仓库默认分支（待读取）', { exact: true }).waitFor();
  if (page.url() === firstRunUrl) throw new Error('Separate launch reused unrelated run identity');
  await button('返回运行看板').click();
  await field('搜索运行需求').fill('浏览器创建');
  await page.getByRole('button').filter({ hasText: '浏览器创建的启动需求' }).waitFor();
  if (await page.getByRole('button').filter({ hasText: '已关联仓库需求' }).count()) throw new Error('Run search did not narrow results');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../run-board-desktop.png', fullPage: true, animations: 'disabled' });
  return 'agentShip-launch-ok';
}
