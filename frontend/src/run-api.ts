export type WorkType = 'feature' | 'refactor' | 'hotfix' | 'fix';
export const workTypeLabels: Record<WorkType, string> = {
  feature: 'New feature', refactor: 'Refactor', hotfix: 'Hotfix', fix: 'Bug fix',
};

export interface DeviceStatus {
  id: string;
  name: string;
  mode: 'demo' | 'codex';
  connectivity: 'online' | 'offline';
  codexStatus: 'available' | 'unavailable' | 'unknown' | 'not_required';
  lastSeenAt?: string;
}

export interface PairingCode { code: string; expiresAt: string }
export interface DeviceChallenge { challengeId: string; nonce: string; expiresAt: string }
export interface DeviceProof { deviceId: string; challengeId: string; signature: string }

export interface RunStart {
  requirementId: string;
  requirementVersion: number;
  workflowId: string;
  workflowVersion: number;
  workType: WorkType;
  deviceProof: DeviceProof;
  githubNamespace?: string;
}

export interface RunStartReceipt { runId: string; state: 'queued' | 'preparing'; version: number }

export interface RunSummary {
  id: string;
  projectId: string;
  requirementId: string;
  requirementName: string;
  workType: WorkType;
  workflowId: string;
  workflowVersion: number;
  state: 'queued' | 'preparing' | 'running' | 'waiting' | 'needs_attention' | 'failed' | 'completed' | 'stopped';
  deviceStatus: DeviceStatus;
  mode: 'demo' | 'codex';
  version: number;
}

export interface RunTask {
  taskId: string;
  state: string;
  attemptNumber: number;
  kind: 'git' | 'agent' | 'coordinator' | 'publish' | 'reconcile';
  roleId?: string;
  roleDisplayName?: string;
  reason?: string;
  disposition?: 'skipped';
}

export interface CheckHistoryEntry {
  wave: number;
  outcome: 'pending' | 'pass' | 'repair' | 'unresolved';
  testedCommit?: string;
  completedAt?: string;
  repairRound?: { number: number; kind: 'automatic' | 'manual'; state: 'queued' | 'running' | 'complete' | 'failed' | 'stopped' };
}

export interface RunCheckStatus {
  originalCheckNodeId: string;
  checkWave: number;
  automaticRepairCount: number;
  automaticRepairLimit: number;
  manualRepairCount: number;
  status: CheckHistoryEntry['outcome'] | 'limit_reached' | 'stopped';
  history?: CheckHistoryEntry[];
}

export interface RunNode {
  nodeId: string;
  wave: number;
  name: string;
  type: 'work' | 'check' | 'publish' | 'end';
  state: string;
  tasks: RunTask[];
  artifactIds: string[];
  artifacts?: RunArtifact[];
  dependencies?: string[];
  agentOrder?: 'parallel' | 'serial';
  check?: RunCheckStatus;
  reason?: string;
  inputRequirementRevision: number | null;
  basedOnOlderRequirementRevision: boolean;
  selectedRoles?: { roleId: string; agentId: string; agentVersion: number; kind: 'coordinator' | 'agent'; displayName: string; sequence: number | null }[];
}

export interface RunArtifact {
  id: string;
  kind: 'product' | 'code' | 'test' | 'publication' | 'other';
  title?: string;
  sourceRef?: string;
  commit?: string;
  archive?: ArtifactArchive;
}

export interface ArtifactArchive {
  state: 'queued' | 'leased' | 'succeeded' | 'unknown' | 'failed';
  ref: string;
  commit?: string;
  reasonCode?: string;
  retryable?: boolean;
  retryApprovalAt?: string;
}

export interface GitPreparation {
  state: 'queued' | 'preparing' | 'ready' | 'needs_attention';
  mode: 'demo' | 'codex';
  taskId: string;
  attemptNumber: number;
  reasonCode?: string;
  message?: string;
  steps: {
    operationKey: string;
    effect: 'create_repository' | 'create_base_branch' | 'create_work_branch';
    targetId: string;
    state: 'intended' | 'dispatching' | 'unknown' | 'succeeded' | 'failed';
    providerResultId?: string;
    observedAt?: string;
  }[];
}

export interface GitContext {
  repository: { provider: string; repositoryId: string; displayName: string; defaultBranch?: string };
  baseBranch: string;
  workBranch: string;
  baseCommit: string;
  headCommit?: string;
}

export interface RunDetail extends RunSummary {
  recentActivity?: { id: string; kind: string; time: string }[];
  initiatorId: string;
  requirementRevision: number;
  sourceRequirementVersion: number;
  stages: { id: string; name: string; nodes: RunNode[] }[];
  allowedActions: string[];
  eventsCursor: string;
  blockerCode?: string;
  blocker?: string;
  gitPlan?: { provider: 'github'; repositoryName: string; createRepository: boolean; defaultBranch: string | null;
    baseSource: 'dev' | 'repository_default'; baseBranch: string | null; ensureDev: boolean; workBranch: string; visibility: 'public' | null };
  git?: GitContext;
  gitPreparation?: GitPreparation;
}

export const runStateLabels: Record<string, string> = {
  queued: 'Waiting to prepare warehouse', preparing: 'Preparing for warehouse', running: 'Executing', waiting: 'Waiting for processing',
  needs_attention: 'Needs attention', failed: 'Failed', completed: 'Completed', stopped: 'Stopped',
  blocked: 'Wait for precondition', ready: 'Queued', waiting_reply: 'Waiting for reply', complete: 'Completed',
  skipped: 'skipped', leased: 'Received', pending: 'Queued', succeeded: 'Completed',
  canceled: 'Canceled',
};

export function statusText(state: string) { return runStateLabels[state] ?? state; }

export async function localDeviceProof(challenge: DeviceChallenge): Promise<DeviceProof> {
  const control = new AbortController();
  const timer = window.setTimeout(() => control.abort(), 5000);
  try {
    const response = await fetch('http://127.0.0.1:4781/proof', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(challenge), credentials: 'omit', signal: control.signal,
    });
    if (!response.ok) throw new Error('The local device has not completed pairing or cannot be verified temporarily. Please check the local execution program.');
    const proof: DeviceProof = await response.json();
    if (proof.challengeId !== challenge.challengeId || !proof.deviceId || !proof.signature) {
      throw new Error('The verification result returned by the local device is invalid. Please pair again and try again.');
    }
    return proof;
  } catch (err) {
    if (err instanceof TypeError || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new Error('Unable to connect to this computer\'s executable program. Please go to "Local Device" first to complete pairing and allow the browser to access the local network.');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
