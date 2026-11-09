async (page) => {
  const password = 'synthetic browser test phrase +!';
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const field = (name) => page.getByLabel(name, { exact: true });

  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await heading('登录 AgentShip').waitFor();
  await page.locator('img[src="/agentship-mark.svg"]').first().evaluate(image => image.decode());
  await page.getByText('人来掌舵，Agent 协作。', { exact: true }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: '../first-batch-login.png', animations: 'disabled' });
  await button('创建账号').click();
  await field('姓名').fill('浏览器验证');
  await field('用户名').fill('fixture_browser');
  await field('邮箱').fill('fixture_browser@example.invalid');
  await field('手机号（含国家区号）').fill('+12025550191');
  await page.locator('input[name="password"]').fill(password);
  await field('确认密码').fill(password);
  await button('注册并验证').click();
  await heading('验证联系方式').waitFor();
  await button('查看本地模拟验证码').click();
  const inbox = page.getByLabel('本地模拟收件箱');
  for (const channel of ['邮箱', '手机号']) {
    const code = await inbox.locator('p').filter({ hasText: channel }).locator('code').innerText();
    await field(`${channel}验证码`).fill(code);
    await button(`验证${channel}`).click();
    if (channel === '邮箱') await page.getByText('邮箱已验证', { exact: true }).waitFor();
  }
  await page.getByText('账号已激活，可以登录。', { exact: true }).waitFor();
  await field('邮箱或用户名').fill('fixture_browser');
  await page.locator('input[name="password"]').fill(password);
  await button('登录').click();
  await heading('需求').waitFor();
  await page.getByText('还没有可见的配置。', { exact: true }).waitFor();
  await page.screenshot({ path: '../first-batch-dashboard.png', fullPage: true, animations: 'disabled' });

  await button('新建需求').click();
  await field('名称').fill('浏览器验证需求');
  const project = page.locator('select[name="projectId"]');
  await project.locator('option').nth(1).waitFor({ state: 'attached' });
  await project.selectOption({ index: 1 });
  await field('需求说明').fill('首批端到端验证');
  await button('创建配置').click();
  await heading('浏览器验证需求').waitFor();

  await page.reload();
  await heading('浏览器验证需求').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
    throw new Error('Configuration page overflows the mobile viewport');
  }
  await page.screenshot({ path: '../first-batch-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await field('副负责人用户名').fill('FIXTURE_DEPUTY');
  await button('添加副负责人').click();
  await button('移除 @fixture_deputy').click();
  await page.getByText('暂无副负责人。', { exact: true }).waitFor();

  await button('流程配置').click();
  await button('新建流程配置').click();
  await heading('新建流程配置').waitFor();

  await button('Agent 配置').click();
  await button('新建Agent 配置').click();
  await field('名称').fill('浏览器验证 Agent');
  await field('角色标识').fill('batch.browser');
  await field('说明').fill('首批 Agent 配置验证');
  await button('创建配置').click();
  await heading('浏览器验证 Agent').waitFor();
  await heading('负责人').waitFor();
  await button('本人联系方式').click();
  await page.getByText('fixture_browser@example.invalid', { exact: true }).waitFor();
  await button('关闭').click();
  await button('退出登录').click();
  await heading('登录 AgentShip').waitFor();
  return 'agentShip-browser-ok';
}
