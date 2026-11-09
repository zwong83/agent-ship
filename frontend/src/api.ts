export type ObjectKind = 'requirements' | 'flows' | 'agents';
export type VerificationChannel = 'email' | 'phone';
export type ConfigAction = 'view' | 'edit' | 'manage_members' | 'use' | 'start';

export interface User {
  id: string;
  displayName: string;
  username: string;
}

export interface Session {
  user: User | null;
  csrfToken: string | null;
}

export interface SelfContact {
  email: string;
  phone: string;
}

export interface RegistrationReceipt {
  status: 'verification_required';
  requiredChannels: VerificationChannel[];
  registrationRef: string;
  expiresAt: string;
}

export interface RegistrationVerification {
  status: 'verification_required' | 'active';
  verifiedChannels: VerificationChannel[];
}

export interface ConfigSummary {
  id: string;
  kind: ObjectKind;
  name: string;
  version: number;
  workflowVersion?: number | null;
  projectId?: string;
  repository?: { provider: string; repositoryId: string; displayName: string } | null;
  allowedActions: ConfigAction[];
}

export interface FlowNode {
  id: string;
  name: string;
  type: 'work' | 'check' | 'publish' | 'end';
  purpose?: 'requirement' | 'product' | 'frontend' | 'backend' | 'test' | 'repair' | 'other';
  dependencies: string[];
  coordinatorId?: string;
  agentIds?: string[];
  agentOrder?: 'parallel' | 'serial';
  checkRoutes?: { passNodeId: string; repairNodeId: string; automaticRepairLimit: number };
  route?: { checkNodeId: string; outcome: 'pass' | 'repair' };
  publication?: { targetId: string; workflowRef?: string };
}

export interface FlowStage {
  id: string;
  name: string;
  nodes: FlowNode[];
}

export interface AgentChoice {
  id: string;
  name: string;
  availability: 'available' | 'unavailable' | 'unknown';
  description?: string;
}

export type ConfigData =
  | { projectId: string; description: string | null }
  | { stages: FlowStage[] }
  | { roleKey: string; description: string; skillRef?: string };

export interface ConfigDetail extends ConfigSummary {
  owner: User;
  deputies: User[];
  data: ConfigData;
}

export interface Project {
  id: string;
  name: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiProblem {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly problem?: ApiProblem) {
    super(problem?.message || '请求暂未完成。');
  }
}

const messages: Record<string, string> = {
  ACCESS_REVOKED: '你的编辑权限已被移除。',
  STALE_VERSION: '这项配置已更新。请重新读取后再保存。',
  MEMBER_UNAVAILABLE: '找不到可添加或转交的用户名。',
  IDENTIFIER_UNAVAILABLE: '该用户名、邮箱或手机号已被使用。',
  INVALID_CREDENTIALS: '登录信息有误，或账号尚未激活。',
  VERIFICATION_UNAVAILABLE: '验证码无效或已过期。',
  NAME_UNAVAILABLE: '此名称无法使用。',
  REQUIREMENT_EXISTS: '你已有同名需求。',
  RATE_LIMITED: '操作太频繁，请稍后再试。',
};

export function errorText(error: unknown) {
  if (!(error instanceof ApiError)) return '无法连接平台，请重试。';
  if (error.problem?.code && messages[error.problem.code]) return messages[error.problem.code];
  if (error.status === 429) return '操作太频繁，请稍后再试。';
  return error.message;
}

type Request = {
  method?: 'POST' | 'PATCH';
  body?: object;
  csrf?: string;
  chatLease?: string;
  commandKey?: string;
  signal?: AbortSignal;
};

export async function request<T>(path: string, options: Request = {}): Promise<T> {
  const { method, body, csrf, chatLease, commandKey, signal } = options;
  const headers = new Headers({ accept: 'application/json' });
  if (body) headers.set('content-type', 'application/json');
  if (csrf) headers.set('X-CSRF-Token', csrf);
  if (chatLease) headers.set('X-Chat-Lease', chatLease);
  if (commandKey) headers.set('Idempotency-Key', commandKey);
  const response = await fetch('/api' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin', cache: 'no-store', signal,
  });
  if (response.ok) return response.json() as Promise<T>;
  const payload = await response.json().catch(() => null) as ApiProblem & { error?: ApiProblem } | null;
  throw new ApiError(response.status, payload?.error ?? payload ?? undefined);
}

export function configPath(kind: ObjectKind, id?: string) {
  return '/objects/' + kind + (id ? '/' + encodeURIComponent(id) : '');
}

export function queryPath(path: string, fields: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(fields).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return query.size ? path + '?' + query : path;
}
