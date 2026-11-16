async page => {
  await page.getByText("Archived", { exact: true }).waitFor();
  await page.getByText("Archived for processing", { exact: true }).waitFor();
  await page.getByText("The tag with the same name in the repository already points to another commit.", { exact: true }).waitFor();
  await page.getByText(/refs\/tags\/agentship\//).first().waitFor();
  return 'agentShip-archive-pipeline-ok';
}
