const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const occupied = document.querySelector('#occupied');
const tab = crypto.randomUUID();
const sections = { requirements: '需求', flows: '流程配置', agents: 'Agent 配置', runs: '运行看板', devices: '本机设备' };
const types = { feature: '新功能', refactor: '重构', hotfix: '紧急修复', fix: '常规修复' };
const statuses = {
  preparing: '准备仓库', running: '执行中', waiting: '等待回复', attention: '待人工处理',
  offline: '等待发起电脑上线', completed: '已完成', stopped: '已停止',
  pending: '待开始', active: '执行中', done: '完成', skipped: '本次未走该路线', blocked: '待人工处理',
  queued: '排队', leased: '执行中', failed: '失败', answered: '已回复', cancelled: '已取消',
};
const purposes = { requirement: '需求', product: '产品定义', frontend: '前端开发', backend: '后端开发', test: '检查与测试', repair: '修复', other: '其他' };
const state = { user: null, section: 'requirements', items: [], roles: [], selected: null, run: null, chat: null, epoch: 0, route: '', auth: 'login' };
let notifyTimer;
let busy = false;

const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const option = (value, label, chosen) => '<option value="' + safe(value) + '"' + (value === chosen ? ' selected' : '') + '>' + safe(label) + '</option>';
const options = (entries, chosen) => Object.entries(entries).map(([key, label]) => option(key, label, chosen)).join('');
const action = (name, label, id = '', classes = 'ghost') => '<button type="button" class="' + classes + '" data-action="' + name + '" data-id="' + safe(id) + '">' + safe(label) + '</button>';
const field = (label, contents) => '<label>' + label + contents + '</label>';
const input = (name, value = '', required = true, type = 'text') => '<input name="' + name + '" type="' + type + '" value="' + safe(value) + '"' + (required ? ' required' : '') + '>';
const textarea = (name, value = '', required = false) => '<textarea name="' + name + '"' + (required ? ' required' : '') + '>' + safe(value) + '</textarea>';
const pill = (status) => '<span class="pill ' + (['completed', 'done', 'pass'].includes(status) ? 'good' : ['failed', 'stopped'].includes(status) ? 'bad' : ['attention', 'offline', 'waiting', 'blocked'].includes(status) ? 'attn' : '') + '">' + safe(statuses[status] ?? status) + '</span>';

function tell(message, error = false) {
  notice.className = error ? 'error' : '';
  notice.textContent = message;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => { notice.textContent = ''; }, 6500);
}

async function api(path, method = 'GET', body) {
  const result = await fetch('/api' + path, {
    method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await result.json();
  if (!result.ok) throw Object.assign(new Error(data.error?.message ?? '操作失败'), { code: data.error?.code, details: data.error?.details });
  return data;
}

function heading(label, title, text, button = '') {
  return '<header class="mast"><div><p class="eyebrow">' + safe(label) + '</p><h1>' + safe(title) +
    '</h1><p class="subtle">' + safe(text) + '</p></div>' + button + '</header>';
}

function renderAuth() {
  const create = state.auth === 'register';
  app.innerHTML = '<main class="auth"><section class="auth-intro"><p class="eyebrow">LOCAL DELIVERY WORKSPACE</p><h1>AgentShip</h1><p>把需求、Agent 和每次交付的结果放在同一个工作台。</p></section>' +
    '<section class="auth-form"><h2>' + (create ? '注册账号' : '登录工作台') + '</h2><form class="grid" data-form="' + state.auth + '">' +
    (create ? field('姓名', input('name')) + field('用户名（字母、下划线、短横线）', input('username')) +
      field('邮箱', input('email', '', true, 'email')) + field('手机号', input('phone', '', true, 'tel')) : field('邮箱或用户名', input('identifier'))) +
    field('密码', input('password', '', true, 'password')) +
    (create ? field('确认密码', input('confirmPassword', '', true, 'password')) : '') +
    '<div class="row"><button class="accent">' + (create ? '创建账号' : '登录') + '</button>' +
    action('auth-toggle', create ? '已有账号' : '注册新账号') + '</div></form></section></main>';
}

function renderShell(content) {
  app.innerHTML = '<div class="shell"><aside class="sidebar"><div class="brand"><span class="mark">A</span> AgentShip</div>' +
    '<p class="eyebrow">Delivery Control</p><nav class="nav" aria-label="工作台导航">' +
    Object.entries(sections).map(([key, label]) => '<button type="button" data-action="navigate" data-id="' + key + '"' +
      (state.section === key ? ' aria-current="page"' : '') + '>' + label + '</button>').join('') +
    '</nav><div class="side-footer"><strong>' + safe(state.user.name) + '</strong><br><span class="mono">@' +
    safe(state.user.username) + '</span><br>' + action('logout', '退出账号', '', 'tiny') + '</div></aside>' +
    '<main class="main" id="workspace">' + content + '</main></div>';
}

function ownerPanel(item) {
  if (!item?.id) return '';
  return '<section class="panel"><h3>负责人</h3><p>主负责人 · ' + safe(item.owner.name) + ' <span class="mono">@' + safe(item.owner.username) +
    '</span></p><p>副负责人 · ' + (item.members.length ? item.members.map((entry) => safe(entry.name)).join('、') : '暂无') + '</p>' +
    (item.relation === 'owner' ? '<form data-form="ownership" class="grid">' +
      field('已注册用户的用户名', input('username')) + field('操作', '<select name="action">' + options({ add: '添加副负责人', remove: '移除副负责人', transfer: '转交主负责人' }, 'add') + '</select>') +
      '<div><button>保存负责人变更</button></div></form>' : '') + '</section>';
}

function ordinary(name, purpose = 'other', roles = []) {
  return { id: crypto.randomUUID(), name, type: 'work', purpose, prompt: '', dependencies: [], roles, coordinator: 'builtin:coordinator', order: 'parallel' };
}

function sampleFlow() {
  const request = ordinary('补齐需求', 'requirement', ['builtin:architecture']);
  const product = ordinary('产品定义', 'product', ['builtin:architecture']);
  product.dependencies = [request.id];
  const frontend = ordinary('前端开发', 'frontend', ['builtin:frontend_design']);
  const backend = ordinary('后端开发', 'backend', ['builtin:interface_data']);
  frontend.dependencies = backend.dependencies = [product.id];
  const repair = ordinary('修复问题', 'repair', ['builtin:implementation']);
  const release = { ...ordinary('发布交付'), type: 'publish', target: '试点环境', workflow: '' };
  const check = { ...ordinary('检查与测试', 'test', ['builtin:testing', 'builtin:quality_attributes', 'builtin:security_testing']),
    type: 'check', dependencies: [frontend.id, backend.id], branches: { pass: release.id, repair: repair.id, limit: 3 } };
  return { stages: [
    { name: '需求', nodes: [request] },
    { name: '研发', nodes: [product, frontend, backend] },
    { name: '验证与发布', nodes: [check, repair, release, { id: crypto.randomUUID(), name: '结束', type: 'end', dependencies: [] }] },
  ] };
}

function flowEditor(item) {
  const stages = item.data.stages;
  const all = stages.flatMap((stage) => stage.nodes.map((node) => ({ ...node, stage: stage.name })));
  const choices = (node, chosen) => option('', '请选择节点', chosen) + all.filter((other) => other.id !== node.id && other.type !== 'end')
    .map((other) => option(other.id, other.stage + ' / ' + other.name, chosen)).join('');
  return stages.map((stage, index) => '<section class="stage" data-stage="' + index + '"><div class="row between">' +
    '<h3>阶段 ' + (index + 1) + '</h3><div class="row">' + action('stage-up', '上移阶段', index, 'ghost tiny') +
    action('stage-remove', '移除阶段', index, 'ghost tiny') + '</div></div>' + field('阶段名称', input('stageName', stage.name)) +
    stage.nodes.map((node, nodeIndex) => {
      const lookup = index + ':' + nodeIndex;
      const roleOrder = [...new Set([...(node.roles ?? []), ...state.roles.map((role) => role.id)])];
      const available = new Map(state.roles.map((role) => [role.id, role]));
      return '<details open class="flow-node" data-node="' + safe(node.id) + '"><summary>' + safe(node.name || '新节点') + '</summary><div class="grid">' +
        '<div class="cols">' + field('节点名称', input('nodeName', node.name)) +
        field('节点类型', '<select name="nodeType">' + options({ work: '普通节点', check: '检查节点', publish: '发布节点', end: '结束节点' }, node.type) + '</select>') + '</div>' +
        (node.type === 'end' ? '<p class="subtle">结束节点在所有实际执行路线完成后标记运行完成。</p>' :
          '<div class="cols">' + field('用途', '<select name="purpose">' + options(purposes, node.purpose) + '</select>') +
          field('协调 Agent', '<select name="coordinator">' + state.roles.map((role) => option(role.id, role.name, node.coordinator)).join('') + '</select>') + '</div>' +
          field('任务说明', textarea('prompt', node.prompt)) +
          field('子 Agent 执行方式', '<select name="order">' + options({ parallel: '并行', serial: '按所列顺序逐个执行' }, node.order) + '</select>') +
          '<details><summary>子 Agent · 已选 ' + (node.roles?.length ?? 0) + '</summary>' +
          roleOrder.filter((role) => role !== 'builtin:coordinator' && available.has(role)).map((role) => {
            const selected = node.roles.includes(role);
            return '<div class="role-line"><label class="check"><input type="checkbox" name="role" value="' + safe(role) + '"' +
              (selected ? ' checked' : '') + '>' + safe(available.get(role).name) + '</label>' +
              (selected ? action('role-up', '上移', lookup + ':' + node.roles.indexOf(role), 'ghost tiny') : '') + '</div>';
          }).join('') + '</details>' +
          '<details><summary>前置节点</summary>' + all.filter((other) => other.id !== node.id && other.type !== 'end')
            .map((other) => '<label class="check"><input type="checkbox" name="dependency" value="' + safe(other.id) + '"' +
              (node.dependencies.includes(other.id) ? ' checked' : '') + '>' + safe(other.stage + ' / ' + other.name) + '</label>').join('') + '</details>' +
          (node.type === 'check' ? '<div class="cols">' +
            field('「通过」路线入口', '<select name="pass">' + choices(node, node.branches?.pass) + '</select>') +
            field('「需修复」路线入口', '<select name="repair">' + choices(node, node.branches?.repair) + '</select>') +
            field('自动修复次数上限', input('limit', node.branches?.limit ?? 3, true, 'number')) + '</div>' : '') +
          (node.type === 'publish' ? '<div class="cols">' + field('发布目标', input('target', node.target)) +
            field('GitHub Actions 工作流文件（真实发布）', input('workflow', node.workflow, false)) + '</div>' : '') +
          (node.type === 'work' || node.type === 'publish' ? '<div class="cols">' +
            field('条件路线归属（可选）', '<select name="checkId">' + option('', '随流程直接执行', '') +
              all.filter((other) => other.type === 'check').map((other) => option(other.id, other.name, node.route?.checkId)).join('') + '</select>') +
            field('路线结果', '<select name="outcome">' + options({ pass: '通过', repair: '需修复' }, node.route?.outcome) + '</select>') + '</div>' : '')) +
        '<div class="row">' + action('node-up', '上移节点', lookup, 'ghost tiny') + action('node-remove', '移除节点', lookup, 'ghost tiny') + '</div></div></details>';
    }).join('') + '<p>' + action('node-add', '添加节点', index, 'ghost tiny') + '</p></section>').join('') +
    '<div class="row">' + action('stage-add', '添加阶段') + action('sample-flow', '载入示例流程') + '</div>';
}

function renderObjects() {
  const kind = state.section;
  const item = state.selected;
  const descriptions = { requirements: '管理需求、Git 仓库关联及协作者。', flows: '设置阶段、节点、检查路线及子 Agent。', agents: '维护角色说明，或查看可选的内置角色。' };
  const list = state.items.map((entry) => action('object-open', entry.name, entry.id, 'item ghost')).join('');
  let editor = '<div class="empty">选择左侧条目，或新建' + sections[kind] + '。</div>';
  if (item) {
    const contents = kind === 'requirements' ? field('需求描述', textarea('description', item.data.description)) +
      field('关联 GitHub 仓库（owner/repo）', input('repo', item.data.repo, false)) :
      kind === 'agents' ? field('角色任务说明', textarea('prompt', item.data.prompt, true)) +
      field('本机 Skill 名称（可选）', input('skill', item.data.skill, false)) : flowEditor(item);
    editor = '<section class="panel"><form data-form="object" class="grid">' + field('名称', input('name', item.name)) +
      contents + '<div class="row"><button class="accent">' + (state.createThenStart ? '保存并继续' : '保存') + '</button>' + action('object-close', '关闭') +
      (kind === 'requirements' && item.id && item.relation === 'owner' ? action('start-open', '发起运行', item.id) : '') + '</div></form></section>' + ownerPanel(item);
  }
  const builtins = kind === 'agents' ? '<section class="panel"><h3>角色目录</h3><ul>' +
    state.roles.filter((role) => role.builtin).map((role) => '<li>' + safe(role.name) + (role.skill ? ' <code>' + safe(role.skill) + '</code>' : '') + '</li>').join('') + '</ul></section>' : '';
  renderShell(heading('Workspace', sections[kind], descriptions[kind], action('object-new', '新建', '', 'accent')) +
    '<div class="split"><div><section class="panel"><h3>可访问的配置</h3>' + (list || '<p class="empty">暂无条目</p>') + '</section>' +
    builtins + '</div><div>' + editor + '</div></div>');
}

function syncFlow(form) {
  if (!form) return;
  state.selected.name = form.elements.name.value;
  state.selected.data.stages = [...form.querySelectorAll('[data-stage]')].map((stage) => ({
    name: stage.querySelector('[name="stageName"]').value,
    nodes: [...stage.querySelectorAll('[data-node]')].map((node) => {
      const value = (name, fallback = '') => node.querySelector('[name="' + name + '"]')?.value ?? fallback;
      const selected = (name) => [...node.querySelectorAll('input[name="' + name + '"]:checked')].map((item) => item.value);
      const type = value('nodeType');
      const data = { id: node.dataset.node, name: value('nodeName'), type,
        purpose: value('purpose', 'other'), prompt: value('prompt'), dependencies: selected('dependency'),
        roles: selected('role'), coordinator: value('coordinator'), order: value('order', 'parallel') };
      if (type === 'check') data.branches = { pass: value('pass'), repair: value('repair'), limit: Number(value('limit', '3')) };
      if (type === 'publish') Object.assign(data, { target: value('target'), workflow: value('workflow') });
      if (value('checkId')) data.route = { checkId: value('checkId'), outcome: value('outcome') };
      return data;
    }),
  }));
}

function moveUp(items, index) {
  if (index > 0 && index < items.length) [items[index - 1], items[index]] = [items[index], items[index - 1]];
}

function changeFlow(name, locator) {
  syncFlow(document.querySelector('form[data-form="object"]'));
  const stages = state.selected.data.stages;
  const [index, nodeIndex, roleIndex] = locator.split(':').map(Number);
  if (name === 'stage-add') stages.push({ name: '新阶段', nodes: [ordinary('新节点')] });
  if (name === 'sample-flow') {
    state.selected.data = sampleFlow();
    state.selected.name ||= '完整交付演练';
  }
  if (name === 'stage-up') moveUp(stages, index);
  if (name === 'stage-remove') stages.splice(index, 1);
  if (name === 'node-add') stages[index].nodes.push(ordinary('新节点'));
  if (name === 'node-up') moveUp(stages[index].nodes, nodeIndex);
  if (name === 'node-remove') stages[index].nodes.splice(nodeIndex, 1);
  if (name === 'role-up') moveUp(stages[index].nodes[nodeIndex].roles, roleIndex);
  renderObjects();
}

function renderDemandChoice() {
  renderShell(heading('Start a run', '选择需求', '搜索已有需求，或填写名称创建新需求。', action('navigate', '返回看板', 'runs')) +
    '<section class="panel"><form data-form="choose-demand" class="grid">' +
    field('搜索需求名称', '<input name="demandSearch" placeholder="输入名称筛选下方需求">') +
    field('选择已有需求', '<select name="demandId" required>' + option('', '请选择需求', '') +
      state.startDemands.map((demand) => option(demand.id, demand.name, '')).join('') + '</select>') +
    '<div class="row"><button class="accent">继续</button>' + action('start-new-demand', '新建需求') + '</div></form></section>');
}

function renderStart() {
  const demand = state.start.demand;
  const roles = state.start.flows;
  const allowed = demand.data.repo ? types : { feature: types.feature };
  renderShell(heading('Start a run', '发起运行', '需求 → 工作类型 → 流程', action('navigate', '返回需求', 'requirements')) +
    '<section class="panel"><form data-form="start" class="grid"><h2>' + safe(demand.name) + '</h2>' +
    field('工作类型', '<select name="workType" required>' + (demand.data.repo ? option('', '请选择工作类型', '') : '') + options(allowed, demand.data.repo ? '' : 'feature') + '</select>') +
    field('搜索流程名称', '<input name="flowSearch" placeholder="输入名称筛选下方流程">') +
    field('选择已有流程', '<select name="flowId" required>' + option('', '请选择流程', '') +
      roles.map((flow) => option(flow.id, flow.name + (roles.filter((entry) => entry.name === flow.name).length > 1 ? ' · ' + flow.id.slice(0, 8) : ''), '')).join('') + '</select>') +
    (demand.data.description ? '<p class="subtle">' + safe(demand.data.description) + '</p>' :
      field('需求描述（无需求阶段时必填）', textarea('description', ''))) +
    '<label class="check"><input type="checkbox" name="allowExternal">若设备使用真实模式，授权本次运行准备 Git、提交工作分支并执行流程配置的发布。</label>' +
    '<p class="subtle">运行绑定此浏览器所在电脑上的 AgentShip 执行程序。</p><div><button class="accent">确认启动</button></div></form></section>');
}

function renderRuns() {
  const items = state.items.map((run) => '<button type="button" class="item ghost" data-action="run-open" data-id="' + safe(run.id) + '"><strong>' +
    safe(run.title) + '</strong><span>' + safe(types[run.workType]) + ' · ' + pill(run.status) +
    (run.mode === 'demo' ? ' <span class="pill">演练</span>' : '') + '</span></button>').join('');
  renderShell(heading('Run monitor', '运行看板', '查看阶段、节点、子 Agent 和交付产物。', action('start-choose', '发起运行', '', 'accent')) +
    '<section class="panel">' + (items || '<div class="empty">暂无运行。</div>') + '</section>');
}

function runButton(actionName, label, target) { return action('run-action', label, actionName + ':' + target, 'ghost tiny'); }

function publicationDetails(publication) {
  if (!publication) return '';
  const url = publication.url;
  const link = typeof url === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(url)
    ? ' <a href="' + safe(url) + '" target="_blank" rel="noopener noreferrer">查看发布记录</a>' : '';
  return '<p>' + safe(publication.summary) + link + '</p>';
}

function chatPanel(run) {
  if (!run.canChat) return '<section class="panel"><h2>运行聊天</h2><p class="subtle">有聊天权限的用户可取得操作权后查看消息与人工操作。</p>' +
    (run.owner ? action('chat-enter', '进入聊天', run.id, 'accent') : '') + '</section>';

  const questions = run.questions.map((question) => '<section class="node"><div class="row between"><strong>' + safe(question.role) +
    '</strong>' + pill(question.status) + '</div><p>' + safe(question.text) + '</p>' +
    (question.status === 'waiting' ? '<form class="grid" data-form="reply" data-id="' + safe(question.id) + '">' +
      field('回答', textarea('text', '', true)) + '<div class="row"><button>回复</button>' +
      (run.isInitiator ? runButton('cancel-question', '取消问题', question.id) : '') + '</div></form>' :
      question.answer ? '<p class="subtle">已回复 · ' + safe(question.answer) + '</p>' : '') + '</section>').join('');
  const chat = run.messages.map((message) => '<div class="message"><strong>' + safe(message.kind === 'user' ? '用户 → ' + message.role : message.role) +
    '</strong><br>' + safe(message.text) + '</div>').join('');
  const targets = run.nodes.flatMap((node) => node.tasks).filter((task) => ['queued', 'leased'].includes(task.status));
  const changes = run.changes.map((change) => '<div class="node"><strong>' + (change.status === 'confirmed' ? '已确认变更' : '待确认变更') + '</strong><p>' +
    safe(change.text) + '</p>' + (change.status === 'pending' && run.owner ? runButton('confirm-change', '确认生效', change.id) : '') + '</div>').join('');
  return '<section class="panel"><div class="row between"><h2>运行聊天</h2>' + action('chat-leave', '离开聊天') + '</div>' +
    (questions || '<p class="subtle">暂无待回复问题。</p>') + '<div class="chat-log">' + chat + '</div>' +
    (targets.length ? '<form class="grid" data-form="message">' + field('发给 Agent', '<select name="target">' +
      targets.map((task) => option(task.id, task.name, '')).join('') + '</select>') + field('消息', input('text')) +
      '<div><button>发送</button></div></form>' : '') +
    '<details><summary>正式需求变更</summary>' + changes + '<form class="grid" data-form="propose-change">' +
    field('拟变更后的完整需求描述', textarea('text', '', true)) + '<div><button>提交待确认变更</button></div></form></details></section>';
}

function renderRun(run) {
  const details = run.nodes.reduce((groups, node) => {
    (groups[node.stageIndex] ??= { name: node.stageName, nodes: [] }).nodes.push(node);
    return groups;
  }, []);
  let gate = run.block ? '<p class="gate">' + safe(run.block.message) + '</p>' : '';
  if (run.canChat && run.block) {
    const { kind, nodeId, taskId } = run.block;
    if (kind === 'repair-limit') gate += '<div class="row">' + runButton('repair', '再修一轮', nodeId) + runButton('stop', '停止本次运行', nodeId) + '</div>';
    if (kind === 'missing-check') gate += runButton('recheck', '重新检查', nodeId);
    if (kind === 'git') gate += runButton('retry-git', '重试 Git 准备', taskId);
    if (kind === 'description') gate += '<form data-form="describe" class="grid">' + field('补充需求描述', textarea('text', '', true)) + '<div><button>保存描述并继续</button></div></form>';
  }
  const nodes = details.map((stage, index) => '<section class="stage"><p class="eyebrow">STAGE ' + (index + 1) +
    '</p><h2>' + safe(stage.name) + '</h2>' + stage.nodes.map((node) => '<article class="node"><div class="row between"><h3>' +
      safe(node.name) + '</h3>' + pill(node.phase) + '</div>' +
      (node.check ? '<p class="subtle">自动修复次数 ' + node.check.rounds + ' · ' + safe({ pass: '通过', repair: '需修复', rechecking: '复查中', limit: '达到上限', missing: '缺少结论' }[node.check.result] ?? '等待检查') + '</p>' : '') +
      node.tasks.map((task) => '<div class="role-line"><span>' + safe(task.name) + ' · 第 ' + task.attempt + ' 次</span><span>' + pill(task.status) + ' ' +
        (run.canChat && task.status === 'failed' ? runButton('retry', '重试', task.id) : '') + '</span></div>' +
        (task.error ? '<p class="danger">' + safe(task.error) + '</p>' : '')).join('') +
      (node.result?.artifact ? '<details><summary>节点产物</summary><pre>' + safe(node.result.artifact) + '</pre></details>' : '') +
      publicationDetails(node.result?.publication) + '</article>').join('') + '</section>').join('');
  renderShell(heading('Delivery run', run.title, run.flowName + ' · ' + types[run.workType], action('navigate', '返回运行列表', 'runs')) +
    '<section class="panel"><div class="row">' + pill(run.status) + (run.mode === 'demo' ? '<span class="pill">演练模式</span>' : '') +
    '<span>' + safe(run.deviceName) + '</span></div>' +
    (run.repo ? '<p class="mono">' + safe(run.repo) + (run.git ? ' · ' + safe(run.git.branch) : '') + '</p>' : '') +
    gate + '</section><div class="split"><div>' + nodes + '</div><div>' + chatPanel(run) + '</div></div>');
}

function renderDevices() {
  const rows = state.items.map((device) => '<p><strong>' + safe(device.name) + '</strong> · ' +
    safe(device.mode === 'demo' ? '演练' : 'Codex') + ' · ' + (device.online ? '在线' : '离线') + '</p>').join('');
  renderShell(heading('Local worker', '本机设备', 'Agent 在发起运行的电脑上执行。') +
    '<section class="panel"><h2>已配对设备</h2>' + (rows || '<p class="empty">暂无设备</p>') + action('pair', '生成一次性配对码', '', 'accent') +
    (state.code ? '<p>配对码（10 分钟内有效）</p><pre>' + safe(state.code) + '</pre>' : '') +
    '</section><section class="panel"><h2>连接步骤</h2><p>打开项目目录中的终端，生成配对码后执行：</p>' +
    '<pre>node src/worker.mjs --pair --demo</pre><p>演练模式在本机模拟仓库、Agent 和发布结果。使用已登录的本机 Codex 和 gh 执行真实任务时：</p>' +
    '<pre>node src/worker.mjs --pair</pre><p>已配对的设备可以用 <code>node src/worker.mjs</code> 恢复。保持终端运行即可在网页发起。</p></section>');
}

function release() {
  if (!state.chat) return Promise.resolve();
  const active = state.chat;
  state.chat = null;
  return fetch('/api/runs/' + active + '/chat', { method: 'POST', keepalive: true,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab, action: 'release' }) }).catch(() => {});
}

async function navigate(section) {
  release();
  const epoch = ++state.epoch;
  Object.assign(state, { section, selected: null, run: null, route: '', code: null, createThenStart: false });
  if (sections[section] && ['requirements', 'agents', 'flows'].includes(section)) {
    const [items, roles] = await Promise.all([api('/objects/' + section), api('/catalog')]);
    if (epoch !== state.epoch) return;
    Object.assign(state, { items: items.items, roles: roles.roles });
    renderObjects();
  } else {
    const response = await api('/' + section);
    if (epoch !== state.epoch) return;
    state.items = response.items;
    if (section === 'runs') renderRuns();
    else renderDevices();
  }
}

async function openRun(runId) {
  if (state.chat && state.chat !== runId) release();
  const epoch = ++state.epoch;
  state.section = 'runs';
  state.route = 'run';
  const result = await api('/runs/' + runId + '?tab=' + tab);
  if (epoch !== state.epoch) return;
  state.run = result;
  renderRun(result);
}

async function openStart(demand) {
  const flows = await api('/objects/flows');
  state.start = { demand, flows: flows.items };
  state.route = 'start';
  renderStart();
}

async function act(name, key) {
  if (name === 'auth-toggle') { state.auth = state.auth === 'login' ? 'register' : 'login'; renderAuth(); return; }
  if (name === 'navigate') return navigate(key);
  if (name === 'logout') {
    release();
    await api('/logout', 'POST', {});
    state.user = null;
    renderAuth();
    return;
  }
  if (name === 'object-new') {
    state.createThenStart = false;
    state.selected = { name: '', data: state.section === 'flows' ? { stages: [{ name: '研发', nodes: [ordinary('执行'), { ...ordinary('结束'), type: 'end', coordinator: null }] }] } : {} };
    renderObjects();
    return;
  }
  if (name === 'object-open') { state.createThenStart = false; state.selected = await api('/objects/' + state.section + '/' + key); renderObjects(); return; }
  if (name === 'object-close') { state.createThenStart = false; state.selected = null; renderObjects(); return; }
  if (name === 'sample-flow' || /^(stage|node|role)-/.test(name)) return changeFlow(name, key);
  if (name === 'start-choose') {
    state.startDemands = (await api('/objects/requirements')).items.filter((demand) => demand.relation === 'owner');
    renderDemandChoice();
    return;
  }
  if (name === 'start-new-demand') {
    const draftName = document.querySelector('[name="demandSearch"]').value.trim();
    await navigate('requirements');
    state.createThenStart = true;
    state.selected = { name: draftName, data: {} };
    renderObjects();
    return;
  }
  if (name === 'start-open') return openStart(state.selected);
  if (name === 'run-open') return openRun(key);
  if (name === 'pair') {
    state.code = (await api('/devices/pair', 'POST', {})).code;
    state.items = (await api('/devices')).items;
    renderDevices();
    return;
  }
  if (name === 'chat-enter') {
    try {
      await api('/runs/' + key + '/chat', 'POST', { tab, action: 'acquire' });
      state.chat = key;
      await openRun(key);
    } catch (error) {
      if (error.code !== 'chat-occupied') throw error;
      document.querySelector('#occupant').textContent = error.details?.holder + ' 正在使用这个聊天页。';
      occupied.showModal();
    }
    return;
  }
  if (name === 'chat-leave') { await release(); return openRun(state.run.id); }
  if (name === 'run-action') {
    const [operation, target] = key.split(':');
    if (operation === 'stop' && !confirm('停止本次运行？')) return;
    const run = await api('/runs/' + state.run.id + '/actions', 'POST', { action: operation, target, tab });
    state.run = run;
    renderRun(run);
  }
}

async function submit(form) {
  const body = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form;
  if (kind === 'login' || kind === 'register') {
    state.user = (await api('/' + kind, 'POST', body)).user;
    return navigate('requirements');
  }
  if (kind === 'object') {
    const section = state.section;
    const selected = state.selected;
    if (section === 'flows') syncFlow(form);
    const data = section === 'flows' ? selected.data : section === 'agents' ? { prompt: body.prompt, skill: body.skill } :
      { description: body.description, repo: body.repo };
    const path = '/objects/' + section + (selected.id ? '/' + selected.id : '');
    try {
      state.selected = await api(path, selected.id ? 'PATCH' : 'POST', { name: body.name, data, version: selected.version });
    } catch (error) {
      if (error.code === 'name-taken' && error.details?.existingId &&
        confirm('已有同名需求。打开已有需求？')) {
        state.selected = await api('/objects/requirements/' + error.details.existingId);
        if (state.createThenStart) {
          state.createThenStart = false;
          return openStart(state.selected);
        }
        renderObjects();
        return;
      }
      throw error;
    }
    state.items = (await api('/objects/' + section)).items;
    tell('已保存');
    if (state.createThenStart) {
      state.createThenStart = false;
      return openStart(state.selected);
    }
    renderObjects();
    return;
  }
  if (kind === 'ownership') {
    const result = await api('/objects/' + state.section + '/' + state.selected.id + '/ownership', 'POST', body);
    state.selected = result.transferred ? null : result;
    state.items = (await api('/objects/' + state.section)).items;
    renderObjects();
    return;
  }
  if (kind === 'choose-demand') {
    if (!state.startDemands.some((entry) => entry.id === body.demandId)) throw new Error('请选择已有需求');
    return openStart(await api('/objects/requirements/' + body.demandId));
  }
  if (kind === 'start') {
    const chosen = state.start.flows.find((entry) => entry.id === body.flowId);
    if (!chosen) throw new Error('请从候选项选择已有流程');
    let proof;
    try {
      const reply = await fetch('http://127.0.0.1:4781/proof', { signal: AbortSignal.timeout(2200) });
      if (!reply.ok) throw new Error();
      proof = await reply.json();
    } catch { throw new Error('未连接本机执行程序。请先在本机设备页面完成配对。'); }
    let demand = state.start.demand;
    if (!demand.data.description && body.description?.trim()) {
      demand = await api('/objects/requirements/' + demand.id, 'PATCH', {
        name: demand.name, data: { ...demand.data, description: body.description }, version: demand.version,
      });
      state.start.demand = demand;
    }
    state.start.requestId ??= crypto.randomUUID();
    const result = await api('/runs', 'POST', { requirementId: demand.id, workType: body.workType, flowId: chosen.id,
      proof, requestId: state.start.requestId, allowExternal: body.allowExternal === 'on' });
    return openRun(result.id);
  }
  if (['reply', 'describe', 'message', 'propose-change'].includes(kind)) {
    const result = await api('/runs/' + state.run.id + '/actions', 'POST', {
      action: kind, text: body.text, target: form.dataset.id ?? body.target, tab,
    });
    state.run = result;
    renderRun(result);
  }
}

async function handle(event, operation) {
  if (busy) return;
  busy = true;
  try { await operation(); }
  catch (error) { tell(error.message, true); }
  finally { busy = false; }
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handle(event, () => act(button.dataset.action, button.dataset.id ?? ''));
});
app.addEventListener('submit', (event) => {
  event.preventDefault();
  handle(event, () => submit(event.target));
});
app.addEventListener('change', (event) => {
  if (state.section !== 'flows' || !state.selected || !['nodeType', 'role'].includes(event.target.name)) return;
  syncFlow(event.target.form);
  renderObjects();
});
app.addEventListener('input', (event) => {
  const selectName = { flowSearch: 'flowId', demandSearch: 'demandId' }[event.target.name];
  if (!selectName) return;
  const select = event.target.form.elements[selectName];
  const query = event.target.value.trim().toLowerCase();
  for (const entry of select.options) entry.hidden = Boolean(entry.value) && !entry.textContent.toLowerCase().includes(query);
  if (select.selectedOptions[0]?.hidden) select.value = '';
});
addEventListener('pagehide', release);

setInterval(async () => {
  if (!state.user || !state.run || busy || state.route !== 'run') return;
  const previous = state.run;
  try {
    if (state.chat) await api('/runs/' + state.chat + '/chat', 'POST', { tab, action: 'heartbeat' });
    const refreshed = await api('/runs/' + previous.id + '?tab=' + tab);
    if (state.run !== previous || state.route !== 'run' || busy) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (JSON.stringify(previous) !== JSON.stringify(refreshed)) {
      state.run = refreshed;
      renderRun(refreshed);
    }
  } catch (error) {
    if (error.code === 'chat-occupied' || error.code === 'chat-closed' || error.code === 'forbidden') {
      state.chat = null;
      if (state.run === previous && state.route === 'run') openRun(previous.id).catch(() => {});
    }
  }
}, 2000);

try {
  state.user = (await api('/me')).user;
  if (state.user) await navigate('requirements');
  else renderAuth();
} catch (error) {
  renderAuth();
  tell(error.message, true);
}
