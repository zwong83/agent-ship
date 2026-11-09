async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('邮箱或用户名', { exact: true }).fill('chat_pipeline');
  await page.getByLabel('密码', { exact: true }).fill('synthetic test phrase +!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '运行看板', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Chat pipeline fixture' }).click();
  await page.getByRole('button', { name: '运行操作', exact: true }).click();
  await page.getByRole('button', { name: '获取操作权', exact: true }).click();
  await page.getByText('请补充本节点的验收条件。', { exact: true }).waitFor();
  await page.getByLabel('回复问答协调 Agent', { exact: true }).fill('Synthetic private acceptance answer for original role');
  await page.getByRole('button', { name: '回复', exact: true }).click();
  await page.getByText('已回复', { exact: true }).waitFor();
  await page.getByText('待投递', { exact: true }).first().waitFor();
  await page.screenshot({ path: '../chat-pipeline-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Chat view overflows mobile viewport');
  await page.getByText('请补充本节点的验收条件。', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../chat-pipeline-mobile.png', animations: 'disabled' });
  return 'agentShip-chat-pipeline-ok';
}
