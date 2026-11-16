import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type ConfigSummary, type Page } from './api';
import { type RunDetail, type RunSummary } from './run-api';
import { Button } from './ui';
import { canOpenChat, fleetLabels, fleetMetrics, liveFleetRows, operationalRuns } from './dashboard-model';
import { EarthFleet } from './earth-fleet';
import { LiveExecution } from './live-execution';

async function allPages<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await request<Page<T>>(queryPath(path, { pageSize: '100', cursor }), { signal });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Workspace refresh could not finish. Please retry.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

type Snapshot = { requirements: ConfigSummary[]; runs: RunDetail[]; updated: Date };
function MetricCard({ title, code, children, className = '' }: { title: string; code: string; children: ReactNode; className?: string }) {
  return <section className={'telemetry-card ' + className} aria-label={title}><header><span className="telemetry-code">{code}</span><h2>{title}</h2><span className="telemetry-corner" aria-hidden="true" /></header>{children}</section>;
}

export function Dashboard({ navigate, onUnauthorized }: { navigate: (path: string) => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sectorSize, setSectorSize] = useState(window.innerWidth >= 1200 ? 6 : window.innerWidth >= 600 && window.innerWidth <= 980 ? 4 : 2);
  const [fullScreen, setFullScreen] = useState(false);
  const [screenError, setScreenError] = useState('');
  const cache = useRef(new Map<string, RunDetail>());
  useEffect(() => {
    const control = new AbortController();
    let loading = false;
    async function load() {
      if (loading || control.signal.aborted) return;
      loading = true; setPending(true);
      try {
        const [requirements, summaries] = await Promise.all([
          allPages<ConfigSummary>(configPath('requirements'), control.signal), allPages<RunSummary>('/runs', control.signal),
        ]);
        const nextCache = new Map<string, RunDetail>();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(4, summaries.length) }, async () => {
          while (next < summaries.length && !control.signal.aborted) {
            const summary = summaries[next++];
            const previous = cache.current.get(summary.id);
            const detail = previous?.version === summary.version && ['completed', 'stopped', 'failed'].includes(summary.state) ? previous : await request<RunDetail>('/runs/' + summary.id, { signal: control.signal });
            nextCache.set(summary.id, { ...detail, deviceStatus: summary.deviceStatus });
          }
        }));
        if (!control.signal.aborted) {
          cache.current = nextCache;
          setData({ requirements, runs: summaries.map(run => nextCache.get(run.id)!), updated: new Date() });
          setError('');
          setSelected(id => operationalRuns([...nextCache.values()]).some(run => run.requirementId === id) && requirements.some(req => req.id === id) ? id : null);
        }
      } catch (err) {
        if (!control.signal.aborted) {
          if (err instanceof ApiError && [401, 403].includes(err.status)) { setData(undefined); cache.current.clear(); if (err.status === 401) onUnauthorized(); }
          setError(errorText(err));
        }
      } finally { loading = false; if (!control.signal.aborted) setPending(false); }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { control.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [revision, onUnauthorized]);
  useEffect(() => {
    const resize = () => { setSectorSize(window.innerWidth >= 1200 ? 6 : window.innerWidth >= 600 && window.innerWidth <= 980 ? 4 : 2); setPage(0); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
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

  const rows = liveFleetRows(data?.requirements ?? [], data?.runs ?? []);
  const focus = rows.find(row => row.requirement.id === selected);
  const requirementNames = new Map(rows.map(row => [row.requirement.id, row.requirement.name]));
  const scopedRuns = (focus ? focus.runs : rows.flatMap(row => row.runs)).map(run => ({ ...run, requirementName: requirementNames.get(run.requirementId) ?? run.requirementName }));
  const metrics = fleetMetrics(scopedRuns);
  const scopeRows = focus ? [focus] : rows;
  const filtered = rows.filter(row => row.requirement.name.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / sectorSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * sectorSize, currentPage * sectorSize + sectorSize);
  const number = (value: number) => data ? value.toLocaleString() : '—';
  const active = scopeRows.filter(row => row.state === 'active').length;
  const preparing = scopeRows.filter(row => row.state === 'active' && row.runs.every(run => ['queued', 'preparing'].includes(run.state))).length;
  const blocked = scopeRows.filter(row => row.state === 'attention').length;
  const scopeName = focus?.requirement.name ?? 'All running requirements';
  const live = Boolean(data) && !error;

  return <div className="fleet-dashboard orbital-dashboard">
    <header className="fleet-masthead"><div><p className="eyebrow">AGENTSHIP / COMMAND DECK</p><h1>Mission control<span className="title-coordinate" aria-hidden="true"> / 01</span></h1></div>
      <div className="fleet-tools"><span className={'fleet-sync ' + (error ? 'is-stale' : '')} title={data ? 'Last successful refresh: ' + data.updated.toLocaleTimeString() : undefined}><i className="signal-dot" />{error ? 'Connection interrupted' : !data ? 'Connecting…' : pending ? 'Syncing…' : 'Auto-sync · 5s'}<small>{data ? data.updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Establishing telemetry'}</small></span>
        <button type="button" className="ghost" disabled={pending} onClick={() => setRevision(value => value + 1)} aria-label="Refresh dashboard">↻</button>
        {document.fullscreenEnabled && <Button onClick={() => void toggleScreen()}>{fullScreen ? 'Exit full screen' : 'Full screen'}</Button>}
        <Button variant="accent" onClick={() => navigate('/requirements/new')}>+ Start requirement</Button>
      </div>
    </header>
    {(error || screenError) && <p role="alert" className="fleet-error">{error || screenError}{error && (data ? ' Showing the last successful snapshot.' : ' Use Refresh to reconnect.')}</p>}
    <div className="fleet-scope"><div><span className="scope-led" aria-hidden="true" /><span>TELEMETRY SCOPE</span><strong title={scopeName}>{scopeName}</strong></div>{focus ? <button type="button" onClick={() => setSelected(null)}>Show all running requirements ×</button> : <span className="scope-hint">Select a ship to focus its telemetry</span>}</div>
    <div className={'fleet-console' + (!live ? ' telemetry-stale' : '')}>
      <div className="telemetry-rail telemetry-left">
        <MetricCard code="01" title="Requirement status">
          <div className="metric-primary"><strong>{number(scopeRows.length)}</strong><span>{focus ? 'requirement in focus' : 'live requirements'}</span></div>
          <div className="status-spectrum" aria-hidden="true">{scopeRows.length ? Object.keys(fleetLabels).map(state => <i key={state} className={'tone-' + state} style={{ flex: scopeRows.filter(row => row.state === state).length }} />) : <i className="tone-idle" />}</div>
          <dl className="metric-pairs"><div><dt><i className="execution-light" />Running</dt><dd>{number(active - preparing)}</dd></div><div><dt><i className="execution-light is-blocked" />Blocked</dt><dd>{number(blocked)}</dd></div><div><dt>Queued / preparing</dt><dd>{number(preparing)}</dd></div></dl>
          <div className="live-progress"><span>Workflow progress</span><strong>{data && metrics.progress !== null ? metrics.progress + '%' : '—'}</strong><progress value={metrics.resolved} max={metrics.total || 1} aria-label="Live workflow progress" /><small>{number(metrics.resolved)} / {number(metrics.total)} steps resolved</small></div>
        </MetricCard>
        <MetricCard code="02" title="Agent activity">
          <div className="metric-primary"><strong>{number(metrics.working)}</strong><span>agent tasks executing</span><span className={'activity-wave ' + (live && metrics.working ? 'working' : '')} aria-hidden="true">{[1,2,3,4,5,6,7].map(i => <i key={i} style={{ '--beat': i } as CSSProperties} />)}</span></div>
          <dl className="metric-pairs"><div><dt>Completed tasks</dt><dd>{number(metrics.taskComplete)} / {number(metrics.tasks)}</dd></div><div><dt>Waiting for a reply</dt><dd>{number(metrics.waiting)}</dd></div></dl><p className="telemetry-note">Coordinators + supporting agents.</p>
        </MetricCard>
        <MetricCard code="03" title="Live execution" className="execution-telemetry"><LiveExecution runs={scopedRuns} selected={selected} select={id => setSelected(value => value === id ? null : id)} navigate={navigate} loading={!data} /></MetricCard>
      </div>
      <section className="fleet-space" aria-label="Requirement fleet">
        <header className="fleet-space-header"><div><p className="eyebrow">SPATIAL OPERATIONS</p><h2>Requirement fleet</h2></div><span className="fleet-sector">SECTOR {String(currentPage + 1).padStart(2, '0')}</span></header>
        <div className="fleet-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label="Find a requirement ship" placeholder="Locate a requirement…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />{query && <button type="button" aria-label="Clear requirement search" onClick={() => { setQuery(''); setPage(0); }}>×</button>}</div>
        <div className="fleet-stage earth-stage">
          <EarthFleet rows={visible} selected={selected} select={id => setSelected(value => value === id ? null : id)} navigate={navigate} live={live} />
          {!data && <div className="earth-empty" role="status"><h3>{error ? 'Telemetry unavailable' : 'Connecting to your fleet'}</h3><p>{error ? 'Refresh to restore the connection.' : 'Loading current requirements…'}</p></div>}
          {data && !rows.length && <div className="earth-empty"><span className="eyebrow">ORBIT / STANDBY</span><h3>No missions in flight.</h3><p>Start a requirement to launch an orbital path.<br />Blocked missions stay visible until resolved.</p><Button onClick={() => navigate('/requirements')}>View requirements ↗</Button></div>}
          {data && rows.length > 0 && !visible.length && <div className="earth-empty"><h3>No matching missions</h3><Button onClick={() => setQuery('')}>Clear search</Button></div>}
        </div>
        <div className="orbit-legend"><span><i className="execution-light" />In progress</span><span><i className="execution-light is-blocked" />Blocked · select red dot to chat</span></div>
        <footer className="fleet-space-footer"><span>{data ? `${filtered.length} ${filtered.length === 1 ? 'ship' : 'ships'} located` : 'Awaiting telemetry'}<small>One ship · one orbital path</small></span><div className="fleet-pagination"><button type="button" disabled={currentPage === 0} aria-label="Previous fleet sector" onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage >= pages - 1} aria-label="Next fleet sector" onClick={() => setPage(currentPage + 1)}>→</button></div></footer>
        {focus && <div className="fleet-focus-action"><div><strong title={focus.requirement.name}>{focus.requirement.name}</strong><span>{focus.runs.length} live runs · {focus.alertRun ? 'Blocked' : 'In progress'}</span></div><Button variant="accent" onClick={() => navigate('/requirements/' + focus.requirement.id)}>Open requirement ↗</Button></div>}
      </section>
      <div className="telemetry-rail telemetry-right">
        <MetricCard code="04" title="Token consumption" className="token-telemetry"><span className="telemetry-tag">NOT CONNECTED</span><div className="metric-primary"><strong>—</strong><span>tokens not reported</span></div><div className="token-baseline" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div><dl className="metric-pairs"><div><dt>Input tokens</dt><dd>—</dd></div><div><dt>Output tokens</dt><dd>—</dd></div></dl><p className="telemetry-note">The execution service does not record token usage yet.</p></MetricCard>
        <MetricCard code="05" title="Attention queue" className={metrics.attention.length ? 'attention-card' : ''}><div className="metric-primary"><strong>{number(metrics.attention.length)}</strong><span>runs need attention</span></div><div className="attention-list">{metrics.attention.slice(0, 2).map(run => <button key={run.id} type="button" onClick={() => navigate('/runs/' + run.id + (canOpenChat(run) ? '/chat' : ''))}><strong>{run.requirementName}</strong><span>{run.blocker ?? (run.state === 'failed' ? 'Run failed' : run.state === 'waiting' ? 'Waiting for processing' : 'Review required')} ↗</span></button>)}{data && !metrics.attention.length && <p className="telemetry-note">No blockers reported in this scope.</p>}{metrics.attention.length > 2 && <Button onClick={() => navigate('/requirements')}>View all requirements ↗</Button>}</div></MetricCard>
        <MetricCard code="06" title="Delivery output"><dl className="output-metrics"><div><dt>Artifacts</dt><dd>{number(metrics.artifacts)}</dd></div><div><dt>Live runs</dt><dd>{number(scopedRuns.length)}</dd></div><div><dt>Repair cycles</dt><dd>{number(metrics.repairs)}</dd></div></dl><div className="device-signal"><span className="signal-dot" /><span>{number(metrics.devices.filter(device => device.connectivity === 'online').length)} / {number(metrics.devices.length)} assigned devices online</span></div></MetricCard>
      </div>
    </div>
    <footer className="fleet-bottom"><span><i className="signal-dot" /> {focus ? 'REQUIREMENT TELEMETRY' : 'LIVE REQUIREMENT TELEMETRY'}</span><span>Recorded data · automatic refresh every 5 seconds</span><span>AGENTSHIP / COMMAND DECK</span></footer>
  </div>;
}
