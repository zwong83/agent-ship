async (page) => {
  page.setDefaultTimeout(10000);
  const origin = 'http://127.0.0.1:4190';
  const uid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const user = { id: uid(1), displayName: '启动验证', username: 'launch_fixture' };
  const project = { id: uid(2), name: '交付项目' };
  const requirement = { id: uid(3), kind: 'requirements', name: '新交付需求', version: 4, projectId: project.id, repository: null, owner: user, deputies: [], allowedActions: ['view', 'edit', 'start'], data: { projectId: project.id, description: null } };
  const linked = { ...requirement, id: uid(4), name: '已有仓库需求', repository: { provider: 'github', repositoryId: uid(5), displayName: 'team/existing' } };
  const flow = { id: uid(6), kind: 'flows', name: '研发流程', version: 9, workflowVersion: 3, owner: user, deputies: [], allowedActions: ['view', 'use'], data: { stages: [{ id: uid(7), name: '研发交付', nodes: [{ id: uid(8), name: '实现功能', type: 'work', purpose: 'backend', dependencies: [], coordinatorId: uid(10), agentIds: [uid(11)] }, { id: uid(9), name: '交付完成', type: 'end', dependencies: [uid(8)] }] }] } };
  const device = { id: uid(12), name: '当前电脑', mode: 'demo', connectivity: 'online', codexStatus: 'not_required' };
  const run = { id: uid(13), projectId: project.id, requirementId: requirement.id, requirementName: requirement.name, workType: 'feature', workflowId: flow.id, workflowVersion: 3, state: 'queued', deviceStatus: device, mode: 'demo', version: 1, initiatorId: user.id, requirementRevision: 1, sourceRequirementVersion: 5, eventsCursor: '0', allowedActions: [], blockerCode: 'GIT_PREPARATION_PENDING', blocker: '等待发起电脑执行 Git 准备任务', gitPlan: { provider: 'github', repositoryName: 'delivery/requirement-test', createRepository: true, defaultBranch: null, baseSource: 'dev', baseBranch: 'dev', ensureDev: true, workBranch: 'feature/run-test', visibility: 'public' }, stages: [{ id: uid(7), name: '研发交付', nodes: flow.data.stages[0].nodes.map(node => ({ nodeId: node.id, name: node.name, type: node.type, wave: 1, state: 'blocked', tasks: [], artifactIds: [], inputRequirementRevision: null, basedOnOlderRequirementRevision: false, selectedRoles: node.type === 'end' ? [] : [{ roleId: uid(14), agentId: uid(10), agentVersion: 2, kind: 'coordinator', displayName: '协调 Agent', sequence: null }, { roleId: uid(15), agentId: uid(11), agentVersion: 1, kind: 'agent', displayName: '后端 Agent', sequence: null }] })) }] };
  const startCommands = [];
  const queries = [];
  let challenges = 0;
  let proofs = 0;
  let patches = 0;
  let pairings = 0;
  await page.route('http://127.0.0.1:4781/**', async route => {
    const body = route.request().postDataJSON();
    proofs++;
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin }, body: JSON.stringify({ deviceId: device.id, challengeId: body.challengeId, signature: 'fixture-proof' }) });
  });
  await page.route('**/api/**', async route => {
    const req = route.request();
    const rawUrl = req.url().replace(/^https?:\/\/[^/]+/, '');
    const path = rawUrl.split('?')[0];
    let body;
    let status = 200;
    if (path === '/api/me') body = { user, csrfToken: 'fixture-csrf' };
    else if (path === '/api/projects') body = { items: [project], nextCursor: null };
    else if (path === '/api/objects/requirements' && req.method() === 'POST') { status = 409; body = { code: 'REQUIREMENT_EXISTS', message: '已有同名需求', details: { existingRequirementId: requirement.id } }; }
    else if (path === '/api/objects/requirements') { queries.push(rawUrl.split('?')[1] || ''); body = { items: [requirement, linked], nextCursor: null }; }
    else if (path === '/api/objects/requirements/' + requirement.id && req.method() === 'PATCH') { patches++; Object.assign(requirement, { ...req.postDataJSON(), version: requirement.version + 1 }); body = requirement; }
    else if (path === '/api/objects/requirements/' + requirement.id) body = requirement;
    else if (path === '/api/objects/requirements/' + linked.id) body = linked;
    else if (path === '/api/objects/flows') { queries.push(rawUrl.split('?')[1] || ''); body = { items: [flow], nextCursor: null }; }
    else if (path === '/api/objects/flows/' + flow.id) body = flow;
    else if (path === '/api/devices/challenge') { challenges++; body = { challengeId: uid(20 + challenges), nonce: 'fixture-nonce', expiresAt: new Date(Date.now() + 120000).toISOString() }; status = 201; }
    else if (path === '/api/devices') body = { items: [device] };
    else if (path === '/api/devices/pair') { pairings++; body = { code: 'FIXTURE123', expiresAt: new Date(Date.now() + 120000).toISOString() }; status = 201; }
    else if (path === '/api/runs' && req.method() === 'POST') {
      startCommands.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] });
      if (startCommands.length === 1) { await route.abort('failed'); return; }
      body = { runId: run.id, state: 'queued', version: 1 }; status = 201;
    } else if (path === '/api/runs') body = { items: [run], nextCursor: null };
    else if (path === '/api/runs/' + run.id) body = run;
    else throw new Error('Unexpected fixture endpoint ' + path);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + '/requirements');
  await page.getByRole('heading', { name: '需求', exact: true }).waitFor();
  await page.getByRole('button', { name: '发起运行', exact: true }).click({ timeout: 3000 });
  await page.getByRole('heading', { name: '发起运行', exact: true }).waitFor();
  await page.getByLabel('搜索需求', { exact: true }).fill('搜索不是选择');
  if (!(await page.getByRole('button', { name: '确认并发起运行', exact: true }).isDisabled())) throw new Error('Typing a search must not select a requirement');
  await page.getByLabel('选择需求', { exact: true }).selectOption(linked.id);
  await page.getByText('沿用需求关联的仓库；新功能、重构及常规修复从 dev 创建分支，紧急修复从仓库默认分支创建。').waitFor();
  if (await page.getByLabel('工作类型', { exact: true }).inputValue() !== '') throw new Error('Linked requirement must explicitly choose work type');
  await page.getByLabel('工作类型', { exact: true }).selectOption('hotfix');
  await page.getByRole('button', { name: '添加新需求', exact: true }).click();
  await page.getByLabel('新需求名称', { exact: true }).fill(requirement.name);
  await page.getByLabel('所属项目', { exact: true }).selectOption(project.id);
  await page.getByRole('button', { name: '创建并选择需求', exact: true }).click();
  await page.getByRole('button', { name: '选择已有的同名需求', exact: true }).click();
  await page.getByText('尚未关联仓库 · 新需求', { exact: false }).waitFor();
  if (!(await page.getByLabel('工作类型', { exact: true }).isDisabled()) || await page.getByLabel('工作类型', { exact: true }).inputValue() !== 'feature') throw new Error('Unlinked requirement must lock feature');
  await page.getByLabel('选择流程', { exact: true }).selectOption(flow.id);
  await page.getByLabel('GitHub 用户名或组织名', { exact: true }).fill('delivery');
  await page.getByRole('button', { name: '确认并发起运行', exact: true }).click();
  await page.getByText('所选流程没有需求节点，请在启动前补齐需求说明。', { exact: true }).waitFor();
  if (challenges || startCommands.length) throw new Error('Incomplete requirement must stop before proof');
  await page.getByLabel('需求说明（启动前必填）', { exact: true }).fill('完成登录后的协作交付');
  await page.getByRole('button', { name: '确认并发起运行', exact: true }).click();
  await page.getByRole('button', { name: '重试确认启动', exact: true }).waitFor();
  if (!(await page.getByLabel('GitHub 用户名或组织名', { exact: true }).isDisabled())) throw new Error('Unknown outcome must freeze payload');
  await page.evaluate(() => { window.launchOriginalConfirm = window.confirm; window.confirm = () => false; history.back(); });
  await page.getByRole('button', { name: '重试确认启动', exact: true }).waitFor();
  if (!page.url().endsWith('/runs/new')) throw new Error('Cancelled Back lost the uncertain launch route');
  await page.evaluate(() => { window.confirm = window.launchOriginalConfirm; delete window.launchOriginalConfirm; });
  await page.getByRole('button', { name: '重试确认启动', exact: true }).click();
  await page.getByRole('heading', { name: requirement.name, exact: true }).waitFor();
  await page.getByRole('heading', { name: '等待准备仓库', exact: true }).waitFor();
  if (startCommands.length !== 2 || challenges !== 1 || proofs !== 1 || patches !== 1) throw new Error('Unexpected challenge/proof/start/patch counts');
  if (JSON.stringify(startCommands[0]) !== JSON.stringify(startCommands[1])) throw new Error('Retry changed key or proof payload');
  if (startCommands[0].body.requirementVersion !== 5 || startCommands[0].body.workflowVersion !== 3 || startCommands[0].body.workType !== 'feature' || startCommands[0].body.githubNamespace !== 'delivery') throw new Error('Wrong launch snapshot');
  if (!queries.some(q => q.includes('purpose=start')) || !queries.some(q => q.includes('purpose=use') && q.includes(requirement.id))) throw new Error('Candidate scope missing');
  await page.getByRole('heading', { name: '待执行的 Git 计划', exact: true }).waitFor();
  await page.getByText('协调 Agent', { exact: false }).waitFor();
  await page.getByText('尚未派发执行任务', { exact: true }).waitFor();
  if (await page.getByText('执行中', { exact: true }).count()) throw new Error('Queued run invented progress');
  device.connectivity = 'offline';
  await page.getByRole('button', { name: '刷新运行', exact: true }).click();
  await page.getByRole('heading', { name: '等待发起电脑上线', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Run detail overflows mobile');
  await page.getByRole('button', { name: '本机设备', exact: true }).click();
  await page.getByRole('button', { name: '生成配对码', exact: true }).click();
  await page.getByText('FIXTURE123', { exact: true }).waitFor();
  if (pairings !== 1 || !(await page.getByLabel('本机执行程序命令').textContent()).includes('--port 4781')) throw new Error('Pairing command is not current');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Devices overflows mobile');
  await page.getByRole('button', { name: '发起运行', exact: true }).click();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Start form overflows mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  return 'run-start-passed-scopes-type-lock-description-gate-retry-proof-snapshots-offline-pairing-mobile';
}
