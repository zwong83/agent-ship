export type ObjectKind = 'requirements' | 'flows' | 'agents';
export type Section = ObjectKind | 'runs' | 'devices';
export type WorkType = 'feature' | 'refactor' | 'hotfix' | 'fix';
export type NodeType = 'work' | 'check' | 'publish' | 'end';
export type Purpose = 'requirement' | 'product' | 'frontend' | 'backend' | 'test' | 'repair' | 'other';
export type CheckOutcome = 'pass' | 'repair';

export const sections: Record<Section, string> = {
  requirements: '需求', flows: '流程配置', agents: 'Agent 配置', runs: '运行看板', devices: '本机设备',
};
export const workTypes: Record<WorkType, string> = { feature: '新功能', refactor: '重构', hotfix: '紧急修复', fix: '常规修复' };
export const purposes: Record<Purpose, string> = {
  requirement: '需求', product: '产品定义', frontend: '前端开发', backend: '后端开发', test: '检查与测试', repair: '修复', other: '其他',
};

export interface User { id: string; name: string; username: string }
export interface Role { id: string; name: string; builtin?: boolean; skill?: string }
export interface FlowNode {
  id: string;
  name: string;
  type: NodeType;
  purpose: Purpose;
  prompt: string;
  dependencies: string[];
  roles: string[];
  coordinator: string | null;
  order: 'parallel' | 'serial';
  branches?: { pass: string; repair: string; limit: number };
  route?: { checkId: string; outcome: CheckOutcome };
  target?: string;
  workflow?: string;
}
export interface Stage { name: string; nodes: FlowNode[] }
export interface ConfigData {
  description?: string;
  repo?: string;
  prompt?: string;
  skill?: string;
  stages?: Stage[];
}
export interface Config {
  id: string;
  name: string;
  relation: 'owner' | 'deputy';
  owner: User;
  members: User[];
  version: number;
  data: ConfigData;
}
export interface Device { id: string; name: string; mode: 'demo' | 'codex'; online: boolean }
export interface DeviceProof { deviceId: string; issuedAt: number; signature: string }
export interface RunSummary {
  id: string;
  title: string;
  status: string;
  workType: WorkType;
  mode: 'demo' | 'codex';
}
export interface RunTask { id: string; name: string; status: string; attempt: number; error?: string }
export interface Publication { summary: string; url?: string }
export interface RunNode {
  id: string;
  name: string;
  phase: string;
  stageIndex: number;
  stageName: string;
  check?: { rounds: number; result?: string };
  tasks: RunTask[];
  result?: { artifact?: string; publication?: Publication };
}
export interface Question { id: string; role: string; text: string; status: string; answer?: string }
export interface RunView extends RunSummary {
  flowName: string;
  repo?: string;
  git?: { branch: string };
  deviceName?: string;
  owner: boolean;
  isInitiator: boolean;
  canChat: boolean;
  block?: { kind: string; message: string; nodeId?: string; taskId?: string };
  nodes: RunNode[];
  questions?: Question[];
  messages?: { id: string; kind: string; role: string; text: string }[];
  changes?: { id: string; status: string; text: string }[];
}

interface ErrorDetails { existingId?: string; holder?: string }

export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly details?: ErrorDetails) {
    super(message);
  }
}

export async function api<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const result = await fetch('/api' + path, {
    method,
    ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (result.ok) return result.json() as Promise<T>;
  const payload = await result.json().catch(() => null) as { error?: { message?: string; code?: string; details?: ErrorDetails } } | null;
  throw new ApiError(payload?.error?.message ?? '操作失败', payload?.error?.code, payload?.error?.details);
}

export function ordinary(name: string, purpose: Purpose = 'other', roles: string[] = []): FlowNode {
  return { id: crypto.randomUUID(), name, type: 'work', purpose, prompt: '', dependencies: [], roles, coordinator: 'builtin:coordinator', order: 'parallel' };
}

export function endNode(): FlowNode {
  return { ...ordinary('结束'), type: 'end', coordinator: null };
}

export function sampleFlow(): Stage[] {
  const request = ordinary('补齐需求', 'requirement', ['builtin:architecture']);
  const product = ordinary('产品定义', 'product', ['builtin:architecture']);
  product.dependencies = [request.id];
  const frontend = ordinary('前端开发', 'frontend', ['builtin:frontend_design']);
  const backend = ordinary('后端开发', 'backend', ['builtin:interface_data']);
  frontend.dependencies = backend.dependencies = [product.id];
  const repair = ordinary('修复问题', 'repair', ['builtin:implementation']);
  const release: FlowNode = { ...ordinary('发布交付'), type: 'publish', target: '试点环境', workflow: '' };
  const check: FlowNode = { ...ordinary('检查与测试', 'test', ['builtin:testing', 'builtin:quality_attributes', 'builtin:security_testing']),
    type: 'check', dependencies: [frontend.id, backend.id], branches: { pass: release.id, repair: repair.id, limit: 3 } };
  return [
    { name: '需求', nodes: [request] },
    { name: '研发', nodes: [product, frontend, backend] },
    { name: '验证与发布', nodes: [check, repair, release, endNode()] },
  ];
}

export function moveUp<T>(items: T[], index: number): T[] {
  const reordered = [...items];
  if (index > 0 && index < items.length) {
    [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
  }
  return reordered;
}

export function toggle(items: string[], value: string, selected: boolean): string[] {
  return selected ? [...items.filter((entry) => entry !== value), value] : items.filter((entry) => entry !== value);
}
