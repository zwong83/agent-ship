import { useState } from 'react';
import { Button, Field } from './ui';

type Revision = { nodeId: string; wave: number; expectedRequirementRevision: number; expectedSourceRequirementVersion: number };
export type ChatWorkCommand = { action: 'retry' | 'skip'; targetId: string; expectedAttemptNumber: number }
  | { action: 'rerun'; nodeId: string; wave: number }
  | ({ action: 'propose-change'; proposedRequirement: { title: string; description: string | null } } & Revision)
  | ({ action: 'describe'; text: string } & Revision)
  | ({ action: 'confirm-change'; targetId: string } & Revision);

type FailedRole = {
  taskId: string; nodeId: string; wave: number; roleDisplayName: string; attemptNumber: number; reason?: string;
  actions: ('retry' | 'skip')[];
};
type Requirement = { nodeId: string; wave: number; title: string; description: string | null; revision: number; sourceVersion: number; canConfirm: boolean };
type RequirementChange = {
  id: string; state: 'pending' | 'confirmed' | 'rejected'; basedOnRevision: number; basedOnSourceRequirementVersion: number;
  nodeId: string; wave: number; summary: string; title?: string; description?: string | null; effectiveRevision?: number; canConfirm?: boolean;
};
type RerunTarget = { nodeId: string; wave: number; nodeName: string };

export type ChatWorkView = {
  allowedActions: string[]; failedRoles?: FailedRole[]; requirements?: Requirement[];
  changes?: RequirementChange[]; rerunTargets?: RerunTarget[];
};

type WorkProps = { view: ChatWorkView; disabled: boolean; onAction: (command: ChatWorkCommand) => Promise<boolean> };
const roleActionLabels = { retry: '重试失败角色', skip: '跳过失败角色' } as const;
const changeLabels = { pending: '待确认', confirmed: '已确认', rejected: '未通过' } as const;

export function ChatWorkControls({ view, disabled, onAction }: WorkProps) {
  const { allowedActions, failedRoles = [], requirements = [], changes = [], rerunTargets = [] } = view;
  return <>
    {failedRoles.length > 0 && <section className="chat-section" aria-labelledby="chat-failed-title">
      <h3 id="chat-failed-title">失败角色</h3>
      {failedRoles.map(role => <article key={role.taskId} className="run-node">
        <div className="row between"><strong>{role.roleDisplayName}</strong><span className="pill attn">第 {role.attemptNumber} 次尝试失败</span></div>
        {role.reason && <p className="chat-text">{role.reason}</p>}
        <div className="row chat-actions">
          {role.actions.filter(action => allowedActions.includes(action)).map(action => <Button key={action} disabled={disabled}
            onClick={() => void onAction({ action, targetId: role.taskId, expectedAttemptNumber: role.attemptNumber })}>
            {roleActionLabels[action]}
          </Button>)}
        </div>
      </article>)}
    </section>}
    {(requirements.length > 0 || changes.length > 0) && <section className="chat-section" aria-labelledby="chat-requirements-title">
      <h3 id="chat-requirements-title">需求变更</h3>
      {requirements.map(requirement => <RequirementEditor key={`${requirement.nodeId}:${requirement.wave}`} requirement={requirement}
        canPropose={allowedActions.includes('propose-change')} canDescribe={allowedActions.includes('describe') && requirement.canConfirm}
        disabled={disabled} onAction={onAction} />)}
      {changes.map(change => <article key={change.id} className="run-node">
        <div className="row between"><strong>{change.title || '需求变更提议'}</strong>
          <span className={'pill ' + (change.state === 'pending' ? 'attn' : change.state === 'confirmed' ? 'good' : '')}>
            {changeLabels[change.state]}{change.effectiveRevision ? ` · 版本 ${change.effectiveRevision}` : ''}
          </span></div>
        <p className="chat-text">{change.summary}</p>
        {change.description && change.description !== change.summary && <p className="chat-text">{change.description}</p>}
        {change.state === 'pending' && change.canConfirm && allowedActions.includes('confirm-change') && <div className="chat-actions">
          <Button variant="accent" disabled={disabled} onClick={() => void onAction({ action: 'confirm-change', targetId: change.id,
            nodeId: change.nodeId, wave: change.wave, expectedRequirementRevision: change.basedOnRevision,
            expectedSourceRequirementVersion: change.basedOnSourceRequirementVersion })}>确认变更</Button>
        </div>}
      </article>)}
    </section>}
    {allowedActions.includes('rerun') && rerunTargets.length > 0 && <section className="chat-section" aria-labelledby="chat-rerun-title">
      <h3 id="chat-rerun-title">按新需求版本重跑</h3>
      <p className="subtle">重跑生成新的节点轮次，原有产物和尝试记录继续保留。</p>
      {rerunTargets.map(target => <article key={`${target.nodeId}:${target.wave}`} className="run-node row between">
        <div><strong>{target.nodeName}</strong><p className="subtle">原轮次 · 第 {target.wave} 次</p></div>
        <Button disabled={disabled} onClick={() => void onAction({ action: 'rerun', nodeId: target.nodeId, wave: target.wave })}>重跑已完成节点</Button>
      </article>)}
    </section>}
  </>;
}

type Draft = { title: string; description: string; revision: number; sourceVersion: number };
function baseDraft(requirement: Requirement): Draft {
  return { title: requirement.title, description: requirement.description ?? '', revision: requirement.revision, sourceVersion: requirement.sourceVersion };
}

function RequirementEditor({ requirement, canPropose, canDescribe, disabled, onAction }: {
  requirement: Requirement; canPropose: boolean; canDescribe: boolean; disabled: boolean; onAction: WorkProps['onAction'];
}) {
  const [editing, setEditing] = useState<Draft>();
  const draft = editing ?? baseDraft(requirement);
  const stale = draft.revision !== requirement.revision || draft.sourceVersion !== requirement.sourceVersion;
  const describe = canDescribe && !requirement.description?.trim();
  const canSubmit = describe || canPropose;
  return <article className="run-node">
    <div className="row between"><strong>{requirement.title}</strong>
      <span className="pill">需求版本 {requirement.revision} · 第 {requirement.wave} 次</span></div>
    {requirement.description && <p className="chat-text">{requirement.description}</p>}
    {canSubmit && <form className="chat-requirement-form" onSubmit={async event => {
      event.preventDefault();
      if (disabled || stale) return;
      const title = draft.title.trim();
      const text = draft.description.trim();
      if (describe ? !text : !title) return;
      const revision = { nodeId: requirement.nodeId, wave: requirement.wave,
        expectedRequirementRevision: draft.revision, expectedSourceRequirementVersion: draft.sourceVersion };
      const accepted = await onAction(describe ? { action: 'describe', text, ...revision }
        : { action: 'propose-change', proposedRequirement: { title, description: text || null }, ...revision });
      if (accepted) setEditing(undefined);
    }}>
      {!describe && <Field label="变更后名称"><input value={draft.title} maxLength={120} disabled={disabled}
        onChange={event => setEditing({ ...draft, title: event.target.value })} /></Field>}
      <Field label={describe ? '需求说明' : '变更后说明'}><textarea aria-label={describe ? '需求说明' : '变更后说明'} rows={4}
        value={draft.description} maxLength={10000} disabled={disabled}
        onChange={event => setEditing({ ...draft, description: event.target.value })} /></Field>
      {stale && <div className="row"><p role="alert" className="inline-error">需求版本已更新，请载入最新版本后重新编辑。</p>
        <Button onClick={() => setEditing(undefined)}>载入最新需求</Button></div>}
      <button type="submit" className="accent" disabled={disabled || stale || (describe ? !draft.description.trim() : !draft.title.trim())}>
        {describe ? '补齐需求说明' : '提交变更提议'}
      </button>
    </form>}
  </article>;
}
