import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from './ui';
import { Select } from './select';
import { canOpenChat, catalogRows, fleetMetrics, liveFleetRows, recentActivity, type CatalogFilter } from './dashboard-model';
import { EarthFleet } from './earth-fleet';
import { RequirementList } from './requirement-list';
import { useDashboardSnapshot, type DashboardSnapshotState } from './use-dashboard-snapshot';

function MetricCard({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section className={'telemetry-card ' + className} aria-label={title}><header><h2>{title}</h2></header><div className="telemetry-body" role="region" aria-label={title + ' details'} tabIndex={0}>{children}</div></section>;
}
/** Density follows the actual orbital scene, including the height available below its header. */
export const fleetCapacity = (width: number, height: number) => Math.min(width, height) >= 500 ? 6 : Math.min(width, height) >= 430 ? 4 : 2;

export function Dashboard({ navigate, onUnauthorized }: { navigate: (path: string) => void; onUnauthorized: () => void }) {
  const snapshot = useDashboardSnapshot(onUnauthorized);
  return <DashboardView snapshot={snapshot} refresh={snapshot.refresh} navigate={navigate} />;
}

/** Presentation owns only local scope/filter state; recorded data belongs to the snapshot store. */
export function DashboardView({ snapshot, refresh, navigate }: {
  snapshot: DashboardSnapshotState; refresh: () => void; navigate: (path: string) => void;
}) {
  const { data, error, pending, accessLost } = snapshot;
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [page, setPage] = useState(0);
  const [sectorSize, setSectorSize] = useState(2);
  const fleetStage = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [screenError, setScreenError] = useState('');
  const rows = catalogRows(data?.requirements ?? [], data?.runs ?? []);
  const fleet = liveFleetRows(data?.requirements ?? [], data?.runs ?? []);
  const focus = rows.find(row => row.requirement.id === selected);
  const requirementNames = new Map(rows.map(row => [row.requirement.id, row.requirement.name]));
  const scopedRuns = (focus ? focus.runs : fleet.flatMap(row => row.runs))
    .map(run => ({ ...run, requirementName: requirementNames.get(run.requirementId) ?? run.requirementName }));
  const metrics = fleetMetrics(scopedRuns);
  const activityRuns = focus ? (focus.runs.length ? focus.runs : focus.historyRuns)
    : scopedRuns.length ? scopedRuns : data?.runs ?? [];
  const activity = recentActivity(activityRuns, requirementNames);
  const historicalActivity = !scopedRuns.length;

  const pages = Math.max(1, Math.ceil(fleet.length / sectorSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = fleet.slice(currentPage * sectorSize, currentPage * sectorSize + sectorSize);
  const number = (value: number) => data ? value.toLocaleString() : '—';
  const live = Boolean(data) && !error;
  const scopeName = focus?.requirement.name ?? 'All requirements';
  const select = (id: string) => setSelected(value => value === id ? null : id);

  useEffect(() => {
    if (accessLost || (data && selected && !data.requirements.some(item => item.id === selected))) setSelected(null);
  }, [data, accessLost, selected]);
  useEffect(() => {
    if (!selected) return;
    const index = fleet.findIndex(row => row.requirement.id === selected);
    if (index >= 0) setPage(Math.floor(index / sectorSize));
  }, [selected, sectorSize]);
  useEffect(() => {
    const element = fleetStage.current;
    if (!element) return;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      const capacity = fleetCapacity(width, height);
      setSectorSize(current => current === capacity ? current : capacity);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggleScreen() {
    try {
      setScreenError('');
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setScreenError('Full screen is unavailable in this browser. The dashboard still uses the full page width.'); }
  }

  return <div className="fleet-dashboard orbital-dashboard dashboard-command command-layout">
    <header className="command-heading">
      <div className="command-title-group"><h1>Mission control</h1><span className="command-overline">WORKSPACE OVERVIEW</span><span className={'command-live' + (error ? ' is-stale' : '')} title={data ? 'Last updated: ' + data.updated.toLocaleTimeString() : undefined}><i aria-hidden="true"/>{error ? 'STALE' : !data ? 'CONNECTING' : 'LIVE'}</span></div>
      <div className="fleet-tools"><button type="button" className="ghost" disabled={pending} onClick={refresh} aria-label="Refresh dashboard">↻</button>{document.fullscreenEnabled && <Button onClick={() => void toggleScreen()}>{fullScreen ? 'Exit full screen' : 'Full screen'}</Button>}<Button variant="accent" onClick={() => navigate('/requirements/new')}>+ Start requirement</Button></div>
    </header>
    {(error || screenError) && <p role="alert" className="fleet-error">{error || screenError}{error && (data ? ' Showing the last successful snapshot. Refresh to confirm current activity and chat access.' : ' Use Refresh to reconnect.')}</p>}
    <section className="command-summary" aria-label="Workspace summary">
      <div className="command-summary-item"><strong>{number(focus ? 1 : rows.length)}</strong><span>{focus ? 'Requirement in focus' : 'Requirements'}</span></div>
      <div className="command-summary-item"><strong>{number(metrics.working)}</strong><span>{live ? 'Active agents' : 'Agents · last known'}</span></div>
      <div className="command-summary-item" data-attention={metrics.attention.length > 0}><strong>{number(metrics.attention.length)}</strong><span>Runs needing attention</span></div>
      <div className="command-summary-item"><strong>{number(metrics.total)}</strong><span>Workflow steps<small>{data && metrics.total ? `${metrics.resolved} resolved · ${metrics.progress}%` : data ? 'No live steps' : 'Awaiting telemetry'}</small></span></div>
    </section>
    {focus && <div className="command-scope" role="status"><span>Telemetry scope: <strong>{scopeName}</strong>{!focus.runs.length && ' · No live run'}</span><button type="button" onClick={() => setSelected(null)}>Show all requirements ×</button></div>}
    <div className={'command-grid' + (!live ? ' telemetry-stale' : '')}>
      <div className="command-telemetry command-telemetry-left">
        <MetricCard title="Agent activity"><div className="metric-primary"><strong>{number(metrics.working)}</strong><span>{live ? 'executing' : 'last known executing'}</span><span className={'activity-wave ' + (live && metrics.working ? 'working' : '')} aria-hidden="true">{[1,2,3,4,5,6,7].map(i => <i key={i} style={{ '--beat': i } as CSSProperties} />)}</span></div><dl className="metric-pairs"><div><dt>Waiting for a reply</dt><dd>{number(metrics.waiting)}</dd></div></dl>{focus && !focus.runs.length && <p className="telemetry-note">No live run for this requirement.</p>}</MetricCard>
        <MetricCard title="Token consumption" className="token-telemetry"><strong className="token-unreported">Not reported</strong><p className="telemetry-note">Waiting for usage telemetry.</p></MetricCard>
        <MetricCard title="Workflow progress" className="workflow-progress-card">
          <div className="metric-primary"><strong>{data && metrics.progress !== null ? metrics.progress + '%' : '—'}</strong><span>steps resolved</span></div>
          {metrics.total > 0 && <progress value={metrics.resolved} max={metrics.total} aria-label="Scoped workflow progress"/>}
          <dl className="metric-pairs"><div><dt>Resolved</dt><dd>{number(metrics.resolved)} / {number(metrics.total)}</dd></div><div><dt>Remaining</dt><dd>{number(metrics.remaining)}</dd></div></dl>
          {!metrics.total && <p className="telemetry-note">{data ? 'No live workflow steps in this scope.' : 'Awaiting workflow telemetry.'}</p>}
        </MetricCard>
      </div>
      <section className="fleet-space command-fleet" aria-labelledby="fleet-heading">
        <header className="fleet-space-header"><h2 id="fleet-heading">Requirement fleet</h2><Select aria-label="Telemetry requirement" value={selected ?? ''} onChange={event => setSelected(event.target.value || null)}><option value="">All requirements</option>{rows.map(row => <option key={row.requirement.id} value={row.requirement.id}>{row.requirement.name}</option>)}</Select></header>
        <div className="fleet-stage earth-stage" ref={fleetStage}>
          <EarthFleet rows={visible} selected={selected} select={select} navigate={navigate} live={live} hideRoster />
          {!data && <div className="earth-empty" role="status"><h3>{error ? 'Telemetry unavailable' : 'Connecting to your fleet'}</h3><p>{error ? 'Refresh to restore the connection.' : 'Loading current requirements…'}</p></div>}
          {data && !fleet.length && <div className="earth-empty"><span className="eyebrow">ORBIT / STANDBY</span><h3>No missions in flight</h3><p>Available requirements stay in the list. Start a workflow to launch an agent ship.</p><Button onClick={() => navigate('/requirements')}>View requirements ↗</Button></div>}
        </div>
        <footer className="command-fleet-footer"><p><span aria-hidden="true">ⓘ</span> Select a ship or requirement to focus</p><div className="fleet-pagination"><span>{number(fleet.length)} live {fleet.length === 1 ? 'ship' : 'ships'}</span>{pages > 1 && <><button type="button" disabled={currentPage === 0} aria-label="Previous fleet sector" onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage >= pages - 1} aria-label="Next fleet sector" onClick={() => setPage(currentPage + 1)}>→</button></>}</div></footer>
      </section>
      <div className="command-telemetry command-telemetry-right">
        <MetricCard title="Needs attention" className={metrics.attention.length ? 'attention-card' : ''}><div className="attention-list" role="region" aria-label="Runs needing attention" tabIndex={0}>{metrics.attention.map(run => <article className="attention-entry" key={run.id}><strong>{run.requirementName}</strong><p title={run.blocker ?? undefined}>{run.blocker ?? 'Review the blocked run for details.'}</p>{canOpenChat(run) ? <button type="button" disabled={!live} title={!live ? 'Refresh to confirm chat access' : undefined} aria-label={'Open attention chat for ' + run.requirementName} onClick={() => navigate('/runs/' + run.id + '/chat')}>Open chat ↗</button> : <span className="telemetry-note">Chat access unavailable</span>}</article>)}{data && !metrics.attention.length && <p className="telemetry-note">No blockers in this scope.</p>}{!data && <p className="telemetry-note">Awaiting recorded activity.</p>}</div></MetricCard>
        <MetricCard title="Delivery output"><dl className="output-metrics"><div><dt><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M6 2h8l5 5v15H6zM14 2v6h5M9 12h7M9 16h7"/></svg>Artifacts</dt><dd>{number(metrics.artifacts)}</dd></div><div><dt><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="1"/><path d="M12 17v4M7 21h10"/></svg>Devices online</dt><dd>{number(metrics.devices.filter(device => device.connectivity === 'online').length)} / {number(metrics.devices.length)}</dd></div></dl></MetricCard>
        <MetricCard title="Recent activity" className="recent-activity-card">
          <p className="activity-scope">{historicalActivity ? 'Recorded history' : 'Current run events'} · Latest 30</p>
          <div className="recent-activity-list" role="region" aria-label="Recent recorded activity" tabIndex={0}>
            {activity.map(event => <article key={event.key} data-kind={event.kind}>
              <span className="activity-marker" aria-hidden="true"/>
              <div><button type="button" onClick={() => select(event.requirementId)} aria-label={'Focus activity for ' + event.requirementName}>{event.requirementName}</button><p>{event.label}</p>
              <time dateTime={event.time} title={new Date(event.time).toLocaleString()}>{new Date(event.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(event.time).toLocaleTimeString()}</time></div>
            </article>)}
            {!activity.length && <p className="telemetry-note">{data ? 'No recorded events in this scope yet.' : 'Awaiting recorded activity.'}</p>}
          </div>
        </MetricCard>
      </div>
    </div>
      <RequirementList rows={rows} selected={selected} select={select} navigate={navigate} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} loading={!data} error={error} live={live}/>
    <footer className="fleet-bottom"><span><i className="signal-dot" /> {focus ? 'REQUIREMENT TELEMETRY' : 'LIVE WORKSPACE TELEMETRY'}</span><span>{data ? 'Last updated ' + data.updated.toLocaleTimeString() : 'Awaiting telemetry'} · {error ? 'Refresh interrupted' : 'Auto-sync every 5 seconds'}</span><span>AGENTSHIP / COMMAND DECK</span></footer>
  </div>;
}
