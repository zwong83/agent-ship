async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Email or username", { exact: true }).fill('repair_pipeline');
  await page.getByLabel("Password", { exact: true }).fill('synthetic test phrase +!');
  await page.getByRole('button', { name: "Sign in", exact: true }).click();
  await page.getByRole('button', { name: "Run dashboard", exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Repair pipeline fixture' }).click();
  await page.getByRole('heading', { name: '原检查', exact: true }).waitFor();
  await page.screenshot({ path: '../repair-pipeline-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: "Run controls", exact: true }).click();
  await page.getByRole('button', { name: "Get operating rights", exact: true }).click();
  await page.getByRole('button', { name: "One more round of practice", exact: true }).waitFor();
  const second = await page.context().newPage();
  try {
    await second.goto(page.url());
    await second.getByRole('button', { name: "Get operating rights", exact: true }).click();
    const occupied = second.getByRole('dialog', { name: '运行操作页已被占用', exact: true });
    await occupied.getByRole('alert').filter({ hasText: 'Fixture 988 正在使用' }).waitFor();
    if (await second.getByRole('button', { name: "One more round of practice", exact: true }).count()) throw new Error('Competing tab has action controls');
    await occupied.getByRole('button', { name: '知道了', exact: true }).click();
    const released = page.waitForResponse(response => response.url().endsWith('/chat') && response.ok()
      && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'release');
    await page.getByRole('button', { name: '返回运行看板', exact: true }).click();
    await released;
    await second.getByRole('button', { name: "Get operating rights", exact: true }).click();
    await second.getByRole('button', { name: "One more round of practice", exact: true }).waitFor();
    await second.setViewportSize({ width: 390, height: 844 });
    if (await second.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Repair controls overflow on mobile');
    await second.screenshot({ path: '../repair-pipeline-mobile.png', animations: 'disabled' });
    await second.getByRole('button', { name: "One more round of practice", exact: true }).click();
    await second.getByRole('status').filter({ hasText: '已提交再修一轮' }).waitFor();
    await second.getByRole('button', { name: '释放操作权', exact: true }).click();
    await second.getByRole('button', { name: "Get operating rights", exact: true }).waitFor();
  } finally { await second.close(); }
  return 'agentShip-repair-pipeline-ok';
}
