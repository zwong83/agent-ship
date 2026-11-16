async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Email or username", { exact: true }).fill('chat_pipeline');
  await page.getByLabel("Password", { exact: true }).fill('synthetic test phrase +!');
  await page.getByRole('button', { name: "Sign in", exact: true }).click();
  await page.getByRole('button', { name: "Run dashboard", exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Chat pipeline fixture' }).click();
  await page.getByRole('button', { name: "Run controls", exact: true }).click();
  await page.getByRole('button', { name: "Get operating rights", exact: true }).click();
  await page.getByText('请补充本节点的验收条件。', { exact: true }).waitFor();
  await page.getByLabel('回复问答协调 Agent', { exact: true }).fill('Synthetic private acceptance answer for original role');
  await page.getByRole('button', { name: '回复', exact: true }).click();
  await page.getByText("Replied", { exact: true }).waitFor();
  await page.getByText("Awaiting delivery", { exact: true }).first().waitFor();
  await page.screenshot({ path: '../chat-pipeline-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Chat view overflows mobile viewport');
  await page.getByText('请补充本节点的验收条件。', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../chat-pipeline-mobile.png', animations: 'disabled' });
  return 'agentShip-chat-pipeline-ok';
}
