async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('邮箱或用户名', { exact: true }).fill('git_pipeline');
  await page.getByLabel('密码', { exact: true }).fill('synthetic test phrase +!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '运行看板', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Git pipeline fixture' }).click();
  await page.getByRole('heading', { name: '仓库已就绪，等待 Agent 执行', exact: true }).waitFor();
  await page.getByRole('heading', { name: '已准备的仓库与分支', exact: true }).waitFor();
  await page.getByText('本地演示仓库 · 未在 GitHub 创建远程仓库', { exact: true }).waitFor();
  if (await page.locator('a[href^="https://github.com/"]').count()) throw new Error('Demo evidence linked to a real repository');
  if (await page.locator('.git-step').count() && await page.locator('.git-step').count() !== 3) throw new Error('Expected three preparation steps');
  await page.screenshot({ path: '../git-pipeline-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Git view overflows mobile viewport');
  await page.screenshot({ path: '../git-pipeline-mobile.png', fullPage: false, animations: 'disabled' });
  await page.getByRole('heading', { name: '已准备的仓库与分支', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../git-pipeline-evidence-mobile.png', fullPage: false, animations: 'disabled' });
  return 'agentShip-git-pipeline-ok';
}
