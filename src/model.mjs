import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export class Problem extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

export function requireThat(condition, message, code = 'invalid', status = 400) {
  if (!condition) throw new Problem(status, code, message);
}

export const id = () => randomUUID();
export const secret = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
export const TYPES = Object.freeze({ feature: '新功能', refactor: '重构', hotfix: '紧急修复', fix: '常规修复' });
export const CHAT_HEARTBEAT = 15_000;
export const CHAT_GRACE = 300_000;
export const DEVICE_ONLINE = 12_000;
export const JOB_LEASE = 25_000;

export function equal(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordHash(password, salt = secret()) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function matchesPassword(password, hash) {
  return equal(passwordHash(password, hash.split(':')[0]), hash);
}

export function proofSignature(deviceId, issuedAt, key) {
  return createHmac('sha256', key).update(deviceId + ':' + issuedAt).digest('hex');
}

export function str(value, label, max = 200, optional = false) {
  requireThat(typeof value === 'string' || (optional && value == null), label + '格式不正确');
  const text = (value ?? '').trim();
  requireThat((optional || text.length > 0) && text.length <= max, label + '长度不正确');
  return text;
}

const roles = [
  ['architecture', '架构设计', '界定系统组件、边界和依赖，交付可核对的架构结论。', 'architecture-agent'],
  ['interface_data', '接口与数据', '梳理接口、数据、事务和兼容性，交付契约建议与影响。', 'interface-data-agent'],
  ['frontend_design', '前端设计', '从用户旅程和接口契约推导界面状态、交互及验收条件。', 'frontend-design-agent'],
  ['quality_attributes', '质量属性', '分析安全、可用性、恢复和性能，明确验证方式。', 'quality-attributes-agent'],
  ['delivery_operations', '交付运维', '定义发布、环境、可观测性和异常处理。', 'delivery-operations-agent'],
  ['system_design_review', '系统设计评审', '独立核对系统设计的可行性、追溯和验证缺口。', 'system-design-review-agent'],
  ['security_testing', '安全验证', '在授权范围内核对安全控制并回报证据。', 'security-testing-agent'],
  ['performance_testing', '性能验证', '核对容量假设和性能证据，报告可验证限制。', 'performance-testing-agent'],
  ['convergence_review', '交付核对', '核对需求、代码、测试和交付证据的一致性。', 'convergence-review-agent'],
  ['implementation', '研发执行', '完成分派的研发任务，记录实际修改和验证结果。', ''],
  ['testing', '测试验证', '执行范围内的检查，准确区分通过、需修复和执行失败。', ''],
];

export const CATALOG = Object.freeze(roles.map(([key, name, prompt, skill]) => ({
  id: 'builtin:' + key, name, prompt, skill, builtin: true,
})));

export const COORDINATOR = {
  id: 'builtin:coordinator', name: '节点协调 Agent',
  prompt: '汇总分派结果，完成本节点要求并交付最终产物。执行和验证必须基于真实证据。',
  builtin: true,
};

const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const NODE_TYPES = new Set(['work', 'check', 'publish', 'end']);
const PURPOSES = new Set(['requirement', 'product', 'frontend', 'backend', 'test', 'repair', 'other']);

export function flowNodes(flow) {
  return flow.stages.flatMap((stage, stageIndex) => stage.nodes.map((node) => ({
    ...node, stageIndex, stageName: stage.name,
  })));
}

function normalizeNode(raw) {
  requireThat(raw && typeof raw === 'object', '节点配置无效');
  const nodeId = str(raw.id, '节点标识', 64);
  requireThat(NODE_ID.test(nodeId) && !Object.hasOwn(Object.prototype, nodeId), '节点标识无效');
  requireThat(NODE_TYPES.has(raw.type), '节点类型无效');
  const node = {
    id: nodeId, name: str(raw.name, '节点名称', 120), type: raw.type,
    purpose: PURPOSES.has(raw.purpose) ? raw.purpose : 'other',
    prompt: str(raw.prompt, '节点说明', 8000, true),
    dependencies: [], roles: [], coordinator: null, order: 'parallel',
  };
  const deps = raw.dependencies ?? [];
  requireThat(Array.isArray(deps) && deps.length <= 200 && deps.every((x) => typeof x === 'string'), '节点依赖无效');
  node.dependencies = [...new Set(deps)];
  if (raw.type === 'end') {
    requireThat(!(raw.roles?.length || raw.coordinator || raw.branches || raw.route), '结束节点只能标记完成');
    return node;
  }
  requireThat(Array.isArray(raw.roles ?? []), '子 Agent 清单无效');
  node.roles = [...new Set((raw.roles ?? []).map((role) => str(role, 'Agent 标识', 100)))];
  node.coordinator = str(raw.coordinator, '协调 Agent', 100, true) || COORDINATOR.id;
  node.order = raw.order === 'serial' ? 'serial' : 'parallel';
  if (raw.route) {
    requireThat(['pass', 'repair'].includes(raw.route.outcome), '分支类型无效');
    node.route = { checkId: str(raw.route.checkId, '分支检查节点', 64), outcome: raw.route.outcome };
  }
  if (raw.type === 'check') {
    requireThat(raw.branches?.pass && raw.branches?.repair, '请同时配置「通过」和「需修复」路线');
    const { limit } = raw.branches;
    requireThat(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, '自动修复上限须为 1 到 100 的整数');
    node.branches = {
      pass: str(raw.branches.pass, '通过路线', 64),
      repair: str(raw.branches.repair, '需修复路线', 64),
      limit,
    };
    requireThat(node.branches.pass !== node.branches.repair, '两种检查结果需要不同的入口节点');
  }
  if (raw.type === 'publish') {
    const target = str(raw.target, '发布目标', 120);
    const workflow = str(raw.workflow, 'GitHub Actions 工作流', 100, true);
    requireThat(!workflow || /^[A-Za-z0-9][A-Za-z0-9_.-]*\.ya?ml$/.test(workflow), '工作流文件名无效');
    Object.assign(node, { target, workflow });
  }
  return node;
}

export function normalizeFlow(raw, roleIds) {
  requireThat(Array.isArray(raw.stages) && raw.stages.length > 0 && raw.stages.length <= 30, '至少添加一个阶段');
  const flow = {
    stages: raw.stages.map((stage) => {
      requireThat(stage && Array.isArray(stage.nodes) && stage.nodes.length > 0 && stage.nodes.length <= 100, '每个阶段至少添加一个节点');
      return { name: str(stage.name, '阶段名称', 120), nodes: stage.nodes.map(normalizeNode) };
    }),
  };
  const nodes = flowNodes(flow);
  requireThat(nodes.length <= 200, '流程节点数量超出试点支持范围');
  requireThat(nodes.at(-1)?.type === 'end' && nodes.filter((node) => node.type === 'end').length === 1, '请在流程末尾设置唯一的结束节点');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  requireThat(byId.size === nodes.length, '节点标识重复');
  requireThat(nodes.some((node) => node.type !== 'end'), '至少添加一个普通执行节点');

  for (const node of nodes) {
    for (const role of [...node.roles, ...(node.coordinator ? [node.coordinator] : [])]) {
      requireThat(roleIds.has(role), '流程包含无权使用或不存在的 Agent');
    }
    if (!node.branches) continue;
    for (const outcome of ['pass', 'repair']) {
      const branch = byId.get(node.branches[outcome]);
      requireThat(branch && branch.type !== 'end', '分支入口必须是流程内的执行节点');
      requireThat(!branch.route || (branch.route.checkId === node.id && branch.route.outcome === outcome), '节点属于另一条条件路线');
      branch.route = { checkId: node.id, outcome };
    }
  }

  for (const node of nodes) {
    if (node.route) {
      const check = byId.get(node.route.checkId);
      requireThat(check?.type === 'check' && check.id !== node.id, '条件路线必须引用有效检查节点');
      requireThat(!check.route && node.type !== 'check', '首期条件检查不支持嵌套');
      if (node.route.outcome === 'repair') {
        requireThat(node.stageIndex === check.stageIndex, '修复路线须位于原检查节点所在阶段');
        requireThat(node.type !== 'publish', '需修复路线不能直接发布');
      }
      node.dependencies = [...new Set([...node.dependencies, check.id])];
    }
    for (const dep of node.dependencies) {
      const parent = byId.get(dep);
      requireThat(parent && parent.type !== 'end', '前置节点不存在或是结束节点');
      requireThat(parent.stageIndex <= node.stageIndex, '前置节点与阶段顺序冲突');
      if (node.route?.outcome === 'repair') {
        requireThat(!parent.route || parent.route.checkId !== node.route.checkId || parent.route.outcome === 'repair', '修复路线不能依赖通过路线');
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visited.has(node.id)) return;
    requireThat(!visiting.has(node.id), '有循环依赖');
    visiting.add(node.id);
    for (const dep of node.dependencies) visit(byId.get(dep));
    visiting.delete(node.id);
    visited.add(node.id);
  }
  for (const node of nodes) visit(node);
  const result = new Map(nodes.map(({ stageIndex, stageName, ...node }) => [node.id, node]));
  return { stages: flow.stages.map((stage) => ({
    name: stage.name, nodes: stage.nodes.map((node) => result.get(node.id)),
  })) };
}
