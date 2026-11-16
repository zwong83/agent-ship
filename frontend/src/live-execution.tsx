import type { RunDetail } from './run-api';
import { canOpenChat, executionRows, runBlocked } from './dashboard-model';

export function LiveExecution({ runs, selected, select, navigate, loading }: {
  runs: RunDetail[]; selected: string | null; select: (id: string) => void; navigate: (path: string) => void; loading: boolean;
}) {
  const entries = executionRows(runs);
  return <>
    <div className="execution-scroll" role="region" tabIndex={0} aria-label="Current stages, nodes and assigned agents">
      {loading ? <p className="telemetry-note" role="status">Reading current execution…</p> : !entries.length ? <p className="telemetry-note">No running requirements in this scope.</p> : entries.map(entry => <article className="execution-entry" key={entry.key}>
        <button type="button" className="execution-select" aria-pressed={selected === entry.run.requirementId} onClick={() => select(entry.run.requirementId)} aria-label={'Focus requirement ' + entry.run.requirementName}>
          <i className={'execution-light ' + (runBlocked(entry.run) ? 'is-blocked' : '')} aria-hidden="true" /><strong>{entry.run.requirementName}</strong><span aria-hidden="true">↗</span>
        </button>
        <dl><div><dt>Stage</dt><dd>{entry.stage}</dd></div><div><dt>Node</dt><dd>{entry.node}</dd></div><div><dt>Coordinator</dt><dd>{entry.coordinator || 'Not assigned yet'}</dd></div>{entry.agents.length > 0 && <div><dt>Agents</dt><dd>{entry.agents.join(', ')}</dd></div>}</dl>
        <div className="execution-entry-footer"><span>{runBlocked(entry.run) ? 'Blocked' : entry.state === 'ready' ? 'Ready' : entry.state === 'blocked' ? 'Dependency wait' : entry.state === 'queued' ? 'Queued' : entry.state === 'preparing' ? 'Preparing' : 'Executing'} · {entry.run.id.slice(0, 6)}</span>
          {runBlocked(entry.run) && (canOpenChat(entry.run) ? <button type="button" onClick={() => navigate('/runs/' + entry.run.id + '/chat')} aria-label={'Open chat for ' + entry.run.requirementName}>Open chat ↗</button> : <span>Chat access unavailable</span>)}</div>
      </article>)}
    </div>
    <p className="execution-scroll-hint">{entries.length} current {entries.length === 1 ? 'node' : 'nodes'} · Scroll to inspect</p>
  </>;
}
