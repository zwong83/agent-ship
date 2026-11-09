async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('邮箱或用户名', { exact: true }).fill('agent_pipeline');
  await page.getByLabel('密码', { exact: true }).fill('synthetic test phrase +!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '运行看板', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Agent pipeline fixture' }).click();
  await page.getByRole('heading', { name: 'Agent pipeline fixture', exact: true }).waitFor();
  await page.getByRole('heading', { name: '已完成', exact: true }).waitFor();
  await page.getByRole('heading', { name: '交付结束', exact: true }).waitFor();
  await page.getByText('交付子 Agent 3', { exact: false }).first().waitFor();
  await page.getByText(/local-git:/).first().waitFor();
  if (await page.getByText('未选择角色', { exact: true }).count()) throw new Error('Unselected role leaked into run');
  await page.screenshot({ path: '../agent-pipeline-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: '实现方案', exact: true }).scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Execution view overflows mobile viewport');
  await page.screenshot({ path: '../agent-pipeline-mobile.png', animations: 'disabled' });
  return 'agentShip-agent-pipeline-ok';
}
