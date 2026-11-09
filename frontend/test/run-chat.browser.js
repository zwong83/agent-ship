async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const origin = 'http://127.0.0.1:4190';
  const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const user = { id: id(1), displayName: '协作验证', username: 'chat_fixture' };
  const runId = id(2);
  const nodeId = id(3);
  const question = { id: id(4), nodeId, wave: 2, roleId: 'reviewer', roleDisplayName: '评审 Agent', taskId: id(5),
    text: '验收需要覆盖移动端吗？', state: 'waiting', canReply: true, canCancel: true, createdAt: '2026-11-09T09:11:00Z' };
  const staleQuestion = { ...question, id: id(8), text: '旧轮次问题。', canReply: false, canCancel: false };
  const readyToCancel = { ...question, id: id(9), text: '可取消的补充问题。', canReply: false };
  const requirement = { nodeId, wave: 2, title: '需求说明', description: '旧说明。', revision: 1, sourceVersion: 3, canConfirm: true };
  const failedRole = { taskId: id(10), nodeId: id(12), wave: 1, roleDisplayName: '构建 Agent', attemptNumber: 2,
    reason: '本机测试未通过。', actions: ['retry', 'skip'] };
  const view = {
    messages: [{ id: id(6), type: 'message', text: '已读取原需求。', direction: 'agent_to_user', senderRoleId: 'coordinator',
      senderLabel: '协调 Agent', nodeId, wave: 2, createdAt: '2026-11-09T09:10:00Z' }],
    questions: [question, staleQuestion, readyToCancel], changes: [], nextCursor: 'older-fixture', deviceOnline: false, runState: 'waiting',
    targets: [{ nodeId, wave: 2, nodeName: '需求梳理', coordinatorRoleId: 'coordinator', roles: [
      { roleId: 'coordinator', roleDisplayName: '协调 Agent', availability: 'ready' },
      { roleId: 'reviewer', roleDisplayName: '评审 Agent', availability: 'ready' },
    ] }],
    allowedActions: ['message', 'reply', 'cancel-question', 'retry', 'skip', 'propose-change', 'confirm-change', 'describe', 'rerun'],
    failedRoles: [failedRole], requirements: [requirement], rerunTargets: [{ nodeId: id(11), wave: 1, nodeName: '旧文档节点' }],
  };
  let tab;
  let revoked = false;
  const commands = [];
  await page.unroute('**/api/**');
  await page.route('**/api/**', async route => {
    const req = route.request();
    const [pathname, query = ''] = req.url().slice(origin.length).split('?');
    const root = `/api/runs/${runId}`;
    if (pathname === '/api/me') return route.fulfill({ json: { user, csrfToken: 'chat-fixture-csrf' } });
    if (pathname === `${root}/chat/access`) return route.fulfill({ status: 404, json: {} });
    if (pathname === `${root}/repair-control`) return route.fulfill({ json: { targets: [] } });
    if (pathname === `${root}/chat` && req.method() === 'POST') {
      const body = req.postDataJSON();
      if (body.action === 'release') return route.fulfill({ json: { accepted: true } });
      tab = body.tabId;
      return route.fulfill({ json: { tabId: tab, epoch: 7, credential: 'fixture-lease', heartbeatDueAt: '2026-11-09T09:11:30Z' } });
    }
    if (pathname === `${root}/chat`) {
      const params = query.split('&');
      const authorized = req.headers()['x-chat-lease'] === 'fixture-lease' && params.includes(`tabId=${tab}`)
        && params.includes('epoch=7') && !query.includes('leaseCredential');
      if (!authorized || revoked) return route.fulfill({ status: 409, json: { error: { code: 'CHAT_LEASE_LOST' } } });
      if (params.includes('cursor=older-fixture')) return route.fulfill({ json: { ...view, messages: [{ id: id(7), type: 'message',
        text: '此前已登记需求。', direction: 'system', createdAt: '2026-11-09T09:00:00Z' }], nextCursor: null } });
      return route.fulfill({ json: view });
    }
    if (pathname === `${root}/actions`) {
      const body = req.postDataJSON();
      commands.push(body);
      if (body.action === 'reply' && body.targetId === question.id) {
        question.state = 'answered';
        question.deliveryState = 'pending';
        question.answer = body.text;
      }
      if (body.action === 'cancel-question' && body.targetId === readyToCancel.id) readyToCancel.state = 'canceled';
      if (body.action === 'retry' && body.targetId === failedRole.taskId) view.failedRoles = [];
      if (body.action === 'propose-change') view.changes.push({ id: id(13), state: 'pending', basedOnRevision: requirement.revision,
        basedOnSourceRequirementVersion: requirement.sourceVersion, nodeId, wave: 2, summary: '扩大验收范围。',
        title: body.proposedRequirement.title, description: body.proposedRequirement.description, canConfirm: true });
      if (body.action === 'confirm-change' && view.changes[0]) {
        view.changes[0].state = 'confirmed';
        view.changes[0].effectiveRevision = 2;
        view.changes[0].canConfirm = false;
        requirement.revision = 2;
        requirement.sourceVersion = 4;
      }
      return route.fulfill({ json: { accepted: true, receiptId: id(99) } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${origin}/runs/${runId}/chat`);
  if (await page.getByText(question.text, { exact: true }).count()) throw new Error('Chat content leaked before acquiring the lease');
  await page.getByRole('button', { name: '获取操作权', exact: true }).click();
  await page.getByText(question.text, { exact: true }).waitFor({ timeout: 3000 });
  await page.getByText('发起电脑离线', { exact: false }).first().waitFor();
  const questionCard = page.locator('.chat-question').filter({ hasText: question.text });
  if (await page.locator('.chat-question').filter({ hasText: staleQuestion.text }).getByRole('button').count()) {
    throw new Error('Historical question received an action');
  }
  await questionCard.getByLabel('回复评审 Agent').fill('需要覆盖移动端。');
  await questionCard.getByRole('button', { name: '回复', exact: true }).click();
  await page.getByText('已回复', { exact: true }).waitFor();
  const reply = commands.at(-1);
  if (reply?.action !== 'reply' || reply.targetId !== question.id || reply.text !== '需要覆盖移动端。' || reply.tabId !== tab
    || reply.epoch !== 7 || reply.leaseCredential !== 'fixture-lease') throw new Error('Reply lost its question or lease binding');
  const composer = page.getByLabel('消息内容', { exact: true });
  await composer.waitFor({ timeout: 3000 });
  await composer.fill('请整理本轮验收点。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await composer.waitFor();
  const coordinator = commands.at(-1);
  if (coordinator?.action !== 'message' || coordinator.nodeId !== nodeId || coordinator.wave !== 2
    || 'targetRoleId' in coordinator || coordinator.text !== '请整理本轮验收点。') throw new Error('Default send failed to target coordinator');
  await composer.fill('@评审 Agent 请校验移动端。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const directed = commands.at(-1);
  if (directed?.targetRoleId !== 'reviewer' || directed.text !== '请校验移动端。') throw new Error('Mention did not bind selected role');
  const accepted = commands.length;
  await composer.fill('@未知角色 请查看。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('未找到唯一可接收消息的 @Agent，请从当前节点的角色中选择。', { exact: true }).waitFor();
  if (commands.length !== accepted) throw new Error('Invalid mention was silently redirected');
  await page.getByRole('button', { name: '查看更早消息', exact: true }).click();
  await page.getByText('此前已登记需求。', { exact: true }).waitFor();
  const timeline = await page.getByRole('log').locator('.chat-entry p').allTextContents();
  if (timeline.join('|') !== '此前已登记需求。|已读取原需求。') throw new Error('Chat history reordered or duplicated messages');
  const retry = page.getByRole('button', { name: '重试失败角色', exact: true });
  await retry.waitFor({ timeout: 3000 });
  if (await page.getByRole('button', { name: '回复', exact: true }).count()) throw new Error('Historical question received a reply action');
  await page.getByRole('button', { name: '取消提问', exact: true }).click();
  await page.getByText('已取消', { exact: true }).waitFor();
  if (commands.at(-1)?.targetId !== readyToCancel.id) throw new Error('Cancel request selected the wrong question');
  await retry.click();
  await retry.waitFor({ state: 'hidden' });
  const retried = commands.at(-1);
  if (retried?.action !== 'retry' || retried.targetId !== failedRole.taskId || retried.expectedAttemptNumber !== 2) {
    throw new Error('Retry lost its failed task attempt');
  }
  await page.getByLabel('变更后名称', { exact: true }).fill('增加移动端验收');
  await page.getByLabel('变更后说明', { exact: true }).fill('需要移动端验收记录。');
  await page.getByRole('button', { name: '提交变更提议', exact: true }).click();
  await page.getByText('扩大验收范围。', { exact: true }).waitFor();
  const proposal = commands.at(-1);
  if (proposal?.expectedRequirementRevision !== 1 || proposal.expectedSourceRequirementVersion !== 3 || proposal.wave !== 2
    || proposal.proposedRequirement?.title !== '增加移动端验收') throw new Error('Proposal lost active BRD snapshot');
  await page.getByRole('button', { name: '确认变更', exact: true }).click();
  await page.getByText('已确认 · 版本 2', { exact: true }).waitFor();
  const confirmed = commands.at(-1);
  if (confirmed?.action !== 'confirm-change' || confirmed.targetId !== id(13) || confirmed.nodeId !== nodeId
    || confirmed.expectedSourceRequirementVersion !== 3) throw new Error('Confirmation lost proposal binding');
  await page.getByRole('button', { name: '重跑已完成节点', exact: true }).click();
  const rerun = commands.at(-1);
  if (rerun?.action !== 'rerun' || rerun.nodeId !== id(11) || rerun.wave !== 1) throw new Error('Rerun failed to select existing wave');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Chat overflows mobile');
  await page.screenshot({ path: '.agentship/verification/run-chat-mobile.png', animations: 'disabled', fullPage: true });
  revoked = true;
  await page.getByText('操作权已失效，请重新获取。', { exact: true }).waitFor({ timeout: 6000 });
  if (await page.getByRole('log').count() || await page.getByText(question.text, { exact: true }).count()) {
    throw new Error('Revoked tab still displays protected chat');
  }
  return 'agentShip-run-chat-ok';
}
