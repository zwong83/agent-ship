export type WorkflowTone = 'preview' | 'active' | 'complete' | 'attention' | 'pending' | 'skipped';

export function workflowNodeTone(state: string | undefined, executing: boolean): WorkflowTone {
  if (!state) return 'preview';
  if (['complete', 'completed', 'succeeded'].includes(state)) return 'complete';
  if (state === 'skipped') return 'skipped';
  if (['failed', 'needs_attention', 'waiting_reply', 'stopped', 'cancelled', 'canceled'].includes(state)) return 'attention';
  if (executing && ['running', 'leased'].includes(state)) return 'active';
  return 'pending';
}

export function workflowConnectionTone(source: WorkflowTone, target: WorkflowTone): WorkflowTone {
  if (source === 'preview' && target === 'preview') return 'preview';
  if (source === 'skipped' || target === 'skipped') return 'skipped';
  if (source !== 'complete') return 'pending';
  return target === 'active' || target === 'complete' || target === 'attention' ? target : 'pending';
}
