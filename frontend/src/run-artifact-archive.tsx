import { useState } from 'react';
import { errorText } from './api';
import type { ArtifactArchive, RunArtifact } from './run-api';
import { Button } from './ui';
import { useCommand } from './use-command';

export type ArchiveControls = { runId: string; csrf: string; allowed: boolean; local: boolean; refresh: () => void };
const states: Record<ArtifactArchive['state'], string> = {
  queued: 'Waiting to initiate computer archiving', leased: 'Archiving', succeeded: 'Archived', unknown: 'Waiting for verification of archived results', failed: 'Archived for processing',
};
const reasons: Record<string, string> = {
  ARCHIVE_SOURCE_UNAVAILABLE: 'It is suggested that the computer cannot verify this local product.',
  ARCHIVE_PRIVATE_FILE: 'Snapshot contains restricted file paths, please check the deliverables.',
  ARCHIVE_TAG_CONFLICT: 'The tag with the same name in the repository already points to another commit.',
  ARCHIVE_TARGET_UNAVAILABLE: 'The corresponding warehouse cannot be accessed.',
  ARCHIVE_GRANT_REQUIRED: 'The archiving authorization has expired or the requirement owner has changed.',
};

export function RunArtifactArchive({ artifact, controls }: { artifact: RunArtifact; controls: ArchiveControls }) {
  const [error, setError] = useState('');
  const command = useCommand(controls.csrf);
  const archive = artifact.archive;
  async function approve() {
    if (!artifact.commit || command.pending) return;
    const target = controls.local ? 'Local demo repository' : 'GitHub repository associated with requirements';
    if (!window.confirm(`Archive the delivery snapshot at commit ${artifact.commit} to ${target}? Confirm that all code and artifacts in the snapshot are safe to publish.`)) return;
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
    <p><span>{controls.local ? 'Demo tag' : 'Archive tag'}</span><code>{archive.ref}</code></p>
    {archive.commit && <p><span>Archive submission</span><code>{archive.commit}</code></p>}
    {archive.reasonCode && reasons[archive.reasonCode] && <p className="subtle">{reasons[archive.reasonCode]}</p>}
    {controls.allowed && archive.retryable && <Button disabled={command.pending} onClick={() => void approve()}>Reconfirm archive</Button>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
  if (!controls.allowed || !artifact.commit) return null;
  return <div className="artifact-archive">
    <Button disabled={command.pending} onClick={() => void approve()}>{command.pending ? 'Submitting…' : 'Confirm that it can be made public and archived'}</Button>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
