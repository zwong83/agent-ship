import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { type CatalogFilter, type CatalogRow, filterCatalogRows, catalogStatusLabels } from './dashboard-model';
const filters: { value: CatalogFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'running', label: 'Running' },
  { value: 'blocked', label: 'Blocked' }, { value: 'queued', label: 'Queued' },
];
function AgentIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="7" width="16" height="13" rx="5"/><path d="M12 3v4M8 13h1m6 0h1M9 17h6"/></svg>;
}
function activityText(row: CatalogRow) {
  if (row.activeAgents.length) return row.activeAgents.map(agent => agent.name).join(', ');
  if (row.waitingAgents.length) return 'Awaiting reply: ' + row.waitingAgents.map(agent => agent.name).join(', ');
  if (row.progressScope === 'history') return 'No active agent · Recorded history';
  if (!row.runs.length) return 'No active agent';
  if (row.runs.some(run => run.deviceStatus.connectivity === 'offline')) return 'No active agent · Device offline';
  return row.status === 'queued' ? 'No active agent · Waiting to start' : 'No agent executing';
}
function SlidingRequirementName({ name }: { name: string }) {
  const viewport = useRef<HTMLElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const container = viewport.current;
    const label = text.current;
    if (!container || !label) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const overflow = Math.ceil(label.getBoundingClientRect().width - container.clientWidth);
      setDistance(overflow > 1 ? overflow : 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(label);
    measure();
    void document.fonts.ready.then(measure);
    return () => { disposed = true; observer.disconnect(); };
  }, [name]);

  const motion = {
    '--name-travel': `-${distance}px`,
    '--name-duration': `${Math.max(4, distance / 24 + 2)}s`,
  } as CSSProperties;
  return <strong ref={viewport} className="requirement-name" title={name}
    data-sliding={distance > 0} style={motion}>
    <span ref={text} className="requirement-name-text" key={name}>{name}</span>
  </strong>;
}
export function RequirementList({ rows, selected, select, navigate, query, setQuery, filter, setFilter, loading, error, live }: {
  rows: CatalogRow[]; selected: string | null; select: (id: string) => void; navigate: (path: string) => void;
  query: string; setQuery: (value: string) => void; filter: CatalogFilter; setFilter: (value: CatalogFilter) => void;
  loading: boolean; error: string; live: boolean;
}) {
  const visible = filterCatalogRows(rows, filter, query);
  return <section className="requirements-panel" aria-labelledby="requirements-heading">
    <header className="requirements-heading"><div><h2 id="requirements-heading">Requirements</h2><p>All available requirements</p></div><span className="requirements-total">{loading ? '—' : String(rows.length).padStart(2, '0')}</span></header>
    <div className="requirements-toolbar">
    <div className="requirement-tabs" role="group" aria-label="Filter requirements by status">{filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{loading ? '—' : item.value === 'all' ? rows.length : rows.filter(row => row.status === item.value).length}</span></button>)}</div>
    <div className="requirement-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label="Find a requirement" placeholder="Find a requirement…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear requirement search" onClick={() => setQuery('')}>×</button>}</div>
    </div>
    <div className="requirement-scroll" role="region" aria-label="Available requirements" tabIndex={0}>
      {loading ? <p className="requirement-empty" role="status">{error ? 'Requirements unavailable. Refresh to reconnect.' : 'Loading requirements…'}</p> : !rows.length ? <div className="requirement-empty"><h3>No requirements yet</h3><p>Start a requirement to bring your agents together.</p><button type="button" onClick={() => navigate('/requirements/new')}>Start requirement ↗</button></div> : !visible.length ? <div className="requirement-empty"><h3>No matching requirements</h3><p>Try another name or status.</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>Reset filters</button></div> : <table className="requirements-table"><caption className="sr-only">Available requirements with current agents and workflow progress</caption><thead><tr><th scope="col">Requirement</th><th scope="col">Status</th><th scope="col">Current agent</th><th scope="col">Stage / node</th><th scope="col">Progress</th><th scope="col">Actions</th></tr></thead><tbody>{visible.map(row => {
        const current = row.execution[0];
        const activity = activityText(row);
        const chatAllowed = row.alertRun?.allowedActions.includes('open_repair_control');
        return <tr className="requirement-row" key={row.requirement.id} data-status={row.status} data-selected={selected === row.requirement.id}>
          <td><button className="requirement-select" type="button" aria-pressed={selected === row.requirement.id} aria-label={'Focus requirement ' + row.requirement.name} onClick={() => select(row.requirement.id)}><SlidingRequirementName name={row.requirement.name}/></button></td>
          <td><span className="requirement-state"><i aria-hidden="true"/>{catalogStatusLabels[row.status]}</span></td>
          <td><span className="requirement-agent" title={activity}><AgentIcon/><span>{!live && 'Last known: '}{activity}</span></span></td>
          <td><span className="requirement-stage">{current ? current.stage + ' / ' + current.node : row.progressScope === 'history' ? 'Recorded history · No live run' : row.status === 'not_started' ? 'Not started' : 'Preparing workflow'}</span>
            {(row.execution.length > 1 || row.activeAgents.length + row.waitingAgents.length > 1) && <details className="requirement-execution"><summary>View current activity ({row.execution.length} {row.execution.length === 1 ? 'node' : 'nodes'})</summary>{row.execution.map(entry => <div key={entry.key}><strong>{entry.stage} · {entry.node}</strong><span>{entry.activeAgents.length ? 'Executing: ' + entry.activeAgents.map(agent => agent.name).join(', ') : 'No agent executing'}</span>{entry.waitingAgents.length > 0 && <span>Awaiting reply: {entry.waitingAgents.map(agent => agent.name).join(', ')}</span>}</div>)}</details>}
          </td>
          <td><strong className="requirement-percent">{row.progress === null ? '—' : row.progress + '%'}</strong><span className="requirement-progress">{row.progress !== null ? <progress value={row.resolved} max={row.total} aria-label={row.requirement.name + ' workflow progress'}/> : <span className="requirement-progress-unknown" aria-hidden="true"/>}<small>{row.progress === null ? 'Progress not available' : `${row.resolved} of ${row.total} steps`}{row.progressScope === 'history' ? ' · Recorded history' : ''}</small></span></td>
          <td>{row.alertRun && (chatAllowed ? <button className="requirement-chat" type="button" disabled={!live} title={!live ? 'Refresh to confirm chat access' : 'Open blocked agent chat'} aria-label={'Open chat for ' + row.requirement.name} onClick={() => navigate('/runs/' + row.alertRun!.id + '/chat')}>Open chat ↗</button> : <span className="requirement-chat-unavailable">Chat access unavailable</span>)}</td>
        </tr>;
      })}</tbody></table>}
    </div>
    <footer className="requirement-count" role="status">{loading ? 'Reading workspace inventory' : `${visible.length} of ${rows.length} requirements`}{!loading && !live ? ' · Last successful snapshot' : ' · Scroll to explore'}</footer>
  </section>;
}
