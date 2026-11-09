import { useState } from 'react';
import { errorText } from './api';
import type { ArtifactArchive, RunArtifact } from './run-api';
import { Button } from './ui';
import { useCommand } from './use-command';

export type ArchiveControls = { runId: string; csrf: string; allowed: boolean; local: boolean; refresh: () => void };
const states: Record<ArtifactArchive['state'], string> = {
  queued: '等待发起电脑归档', leased: '正在归档', succeeded: '已归档', unknown: '等待核对归档结果', failed: '归档待处理',
};
const reasons: Record<string, string> = {
  ARCHIVE_SOURCE_UNAVAILABLE: '发起电脑无法核对这个本机产物。',
  ARCHIVE_PRIVATE_FILE: '快照包含受限的文件路径，请核对交付内容。',
  ARCHIVE_TAG_CONFLICT: '仓库中同名标签已指向其他提交。',
  ARCHIVE_TARGET_UNAVAILABLE: '无法访问对应仓库。',
  ARCHIVE_GRANT_REQUIRED: '归档授权已过期或需求负责人已变更。',
};

export function RunArtifactArchive({ artifact, controls }: { artifact: RunArtifact; controls: ArchiveControls }) {
  const [error, setError] = useState('');
  const command = useCommand(controls.csrf);
  const archive = artifact.archive;
  async function approve() {
    if (!artifact.commit || command.pending) return;
    const target = controls.local ? '本地演示仓库' : '需求关联的 GitHub 仓库';
    if (!window.confirm(`将提交 ${artifact.commit} 的交付快照归档到${target}。请先核对快照中的代码和产物均可公开。`)) return;
    setError('');
    try {
      await command.send<ArtifactArchive>(`/runs/${controls.runId}/archives`, 'POST', {
        artifactId: artifact.id, expectedCommit: artifact.commit, publicApproved: true,
        retryApprovalAt: archive?.retryApprovalAt,
      });
      controls.refresh();
    } catch (failure) { setError(errorText(failure)); }
  }
  if (archive) return <div className="artifact-archive">
    <span className={'pill ' + (archive.state === 'succeeded' ? 'good' : 'attn')}>{states[archive.state]}</span>
    <p><span>{controls.local ? '演示标签' : '归档标签'}</span><code>{archive.ref}</code></p>
    {archive.commit && <p><span>归档提交</span><code>{archive.commit}</code></p>}
    {archive.reasonCode && reasons[archive.reasonCode] && <p className="subtle">{reasons[archive.reasonCode]}</p>}
    {controls.allowed && archive.retryable && <Button disabled={command.pending} onClick={() => void approve()}>重新确认归档</Button>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
  if (!controls.allowed || !artifact.commit) return null;
  return <div className="artifact-archive">
    <Button disabled={command.pending} onClick={() => void approve()}>{command.pending ? '正在提交…' : '确认可公开并归档'}</Button>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
