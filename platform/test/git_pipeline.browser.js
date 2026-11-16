async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Email or username", { exact: true }).fill('git_pipeline');
  await page.getByLabel("Password", { exact: true }).fill('synthetic test phrase +!');
  await page.getByRole('button', { name: "Sign in", exact: true }).click();
  await page.getByRole('button', { name: "Run dashboard", exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Git pipeline fixture' }).click();
  await page.getByRole('heading', { name: "The warehouse is ready, waiting for Agent execution", exact: true }).waitFor();
  await page.getByRole('heading', { name: "Prepared warehouses and branches", exact: true }).waitFor();
  await page.getByText('本地演示仓库 · 未在 GitHub 创建远程仓库', { exact: true }).waitFor();
  if (await page.locator('a[href^="https://github.com/"]').count()) throw new Error('Demo evidence linked to a real repository');
  if (await page.locator('.git-step').count() && await page.locator('.git-step').count() !== 3) throw new Error('Expected three preparation steps');
  await page.screenshot({ path: '../git-pipeline-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Git view overflows mobile viewport');
  await page.screenshot({ path: '../git-pipeline-mobile.png', fullPage: false, animations: 'disabled' });
  await page.getByRole('heading', { name: "Prepared warehouses and branches", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../git-pipeline-evidence-mobile.png', fullPage: false, animations: 'disabled' });
  return 'agentShip-git-pipeline-ok';
}
