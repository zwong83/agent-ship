async page => {
  await page.getByText('已归档', { exact: true }).waitFor();
  await page.getByText('归档待处理', { exact: true }).waitFor();
  await page.getByText('仓库中同名标签已指向其他提交。', { exact: true }).waitFor();
  await page.getByText(/refs\/tags\/agentship\//).first().waitFor();
  return 'agentShip-archive-pipeline-ok';
}
