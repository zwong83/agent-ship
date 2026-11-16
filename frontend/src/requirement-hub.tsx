import { Select } from './select';
import { useEffect, useRef, useState } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type ConfigDetail, type ConfigSummary, type Page, type Project } from './api';
import { Button, Field } from './ui';
import { localDeviceProof, statusText, type DeviceChallenge, type RunStartReceipt, type RunSummary, type WorkType } from './run-api';
import { RunsPage } from './runs';
import { RunRepairControls } from './run-repair-controls';
import { useCommand } from './use-command';
import { MissionScene } from './mission-scene';

async function collect<T>(path: string, signal?: AbortSignal) {
  const items: T[] = []; let cursor: string | undefined;
  do { const page = await request<Page<T>>(path + (path.includes('?') ? '&' : '?') + new URLSearchParams({ pageSize: '100', ...(cursor ? { cursor } : {}) }), { signal }); items.push(...page.items); cursor = page.nextCursor ?? undefined; } while (cursor);
  return items;
}
const requirementCategories = [
  { key: 'all', label: 'All requirements' },
  { key: 'feature', label: 'Features' },
  { key: 'fix', label: 'Bug fixes' },
  { key: 'hotfix', label: 'Hotfixes' },
  { key: 'refactor', label: 'Refactors' },
  { key: 'not_started', label: 'Not started' },
] as const;
type RequirementCategory = typeof requirementCategories[number]['key'];

type Props = { csrf: string; onUnauthorized: () => void; navigate: (path: string) => void; initialId?: string; creating?: boolean; onDirtyChange: (dirty: boolean) => void };
export function RequirementHub({ csrf, onUnauthorized, navigate, initialId, creating, onDirtyChange }: Props) {
  const [items, setItems] = useState<ConfigSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [tabs, setTabs] = useState<string[]>(initialId ? [initialId] : []);
  const [active, setActive] = useState<string | null>(initialId ?? null);
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const [launch, setLaunch] = useState<{ id?: string } | null>(creating ? {} : null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<RequirementCategory>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (initialId) { setTabs(current => current.includes(initialId) ? current : [...current, initialId]); setActive(initialId); } else setActive(null); if (creating) setLaunch({}); }, [initialId, creating]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    Promise.all([collect<ConfigSummary>(configPath('requirements'), controller.signal), collect<RunSummary>('/runs', controller.signal)])
      .then(([requirements, executions]) => { if (!controller.signal.aborted) { setItems(requirements); setRuns(executions); setError(''); } })
      .catch(err => { if (!controller.signal.aborted) { if (err instanceof ApiError && err.status === 401) onUnauthorized(); else setError(errorText(err)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, onUnauthorized]);
  function open(id: string) { setTabs(current => current.includes(id) ? current : [...current, id]); setActive(id); }
  const requirement = items.find(item => item.id === active);
  const executions = runs.filter(run => run.requirementId === active);
  const runId = active ? selectedRuns[active] ?? (executions.find(run => ['running', 'preparing', 'queued', 'waiting', 'needs_attention'].includes(run.state)) ?? executions[0])?.id : undefined;
  const typesByRequirement = new Map<string, Set<WorkType>>();
  for (const run of runs) {
    if (!typesByRequirement.has(run.requirementId)) typesByRequirement.set(run.requirementId, new Set());
    typesByRequirement.get(run.requirementId)!.add(run.workType);
  }
  const matchesCategory = (item: ConfigSummary, key: RequirementCategory) => key === 'all' || (key === 'not_started'
    ? !typesByRequirement.has(item.id) : !!typesByRequirement.get(item.id)?.has(key));
  const visibleItems = items.filter(item => matchesCategory(item, category) && item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const categoryLabel = requirementCategories.find(value => value.key === category)!.label;
  return <div className="requirement-hub">
    <header className="mission-hero"><div className="mission-hero-copy"><p className="eyebrow"><span className="signal-dot" /> AGENTSHIP / MISSION CONTROL</p><h1>Ideas become<br /><span>executions.</span></h1><p className="subtle">Define the objective. Connect your agents.<br />Command delivery from one workspace.</p><Button variant="accent" onClick={() => setLaunch({})}>Start requirement <span aria-hidden="true">↗</span></Button></div><MissionScene /></header>
    <div className="mission-metrics"><div><span className="eyebrow">MISSION INDEX</span><strong>{loading ? '—' : String(items.length).padStart(2,'0')}</strong><small>Requirements</small></div><div><span className="eyebrow">IN EXECUTION</span><strong>{loading ? '—' : String(runs.filter(run => ['running','queued','preparing'].includes(run.state)).length).padStart(2,'0')}</strong><small>Active runs</small></div><div><span className="eyebrow">WORKSPACE CHANNELS</span><strong>{String(tabs.length).padStart(2,'0')}</strong><small>Open requirement tabs</small></div></div>
    <div className="requirement-category-tabs" role="tablist" aria-label="Requirement types">{requirementCategories.map(({ key, label }, index) => <button key={key} type="button" role="tab" id={'requirement-type-' + key} aria-selected={category === key} aria-controls="requirement-category-panel" tabIndex={category === key ? 0 : -1} onClick={() => { setCategory(key); setActive(null); }} onKeyDown={event => {
      const target = event.key === 'ArrowRight' ? (index + 1) % requirementCategories.length : event.key === 'ArrowLeft' ? (index - 1 + requirementCategories.length) % requirementCategories.length : event.key === 'Home' ? 0 : event.key === 'End' ? requirementCategories.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault(); setCategory(requirementCategories[target].key); setActive(null);
      document.getElementById('requirement-type-' + requirementCategories[target].key)?.focus();
    }}><span>{label}</span><span className="category-count">{loading ? '—' : items.filter(item => matchesCategory(item, key)).length}</span></button>)}</div>
    {tabs.length > 0 && <nav className="requirement-tabs" aria-label="Open requirement workspaces"><Button variant={active === null ? 'accent' : 'ghost'} onClick={() => setActive(null)}>Back to {categoryLabel.toLowerCase()}</Button>{tabs.map(id => <div className="requirement-tab" key={id}><button aria-current={id === active ? 'page' : undefined} onClick={() => setActive(id)}>{items.find(item => item.id === id)?.name ?? 'Requirement'}</button><button aria-label={'Close ' + (items.find(item => item.id === id)?.name ?? 'requirement')} onClick={() => { setTabs(current => current.filter(value => value !== id)); if (active === id) setActive(null); }}>×</button></div>)}</nav>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {active === null ? <section className="dashboard-board" id="requirement-category-panel" role="tabpanel" aria-labelledby={'requirement-type-' + category} tabIndex={0}><div className="row between"><h2>{categoryLabel}</h2><Button disabled={loading} onClick={() => setRevision(n => n + 1)}>Refresh</Button></div><Field label="Search requirements"><input type="search" placeholder="Find a mission…" value={query} onChange={event => setQuery(event.target.value)} /></Field>
      <p className="category-description">Types reflect recorded runs. A requirement with different run types can appear in more than one tab.</p>
      {!loading && <p className="category-results" role="status">{visibleItems.length} {visibleItems.length === 1 ? 'requirement' : 'requirements'}{query.trim() ? ' matching your search' : ''}</p>}
      {loading && <p role="status">Syncing requirements…</p>}
      {!loading && !items.length && category === 'all' && !query.trim() && <div className="mission-empty"><div className="mission-empty-symbol" aria-hidden="true">+</div><div><p className="eyebrow">YOUR FIRST MISSION AWAITS</p><h2>Give your agents an objective.</h2><p>Create a requirement and connect a workflow.<br />Execution progress and conversations stay together.</p><Button onClick={() => setLaunch({})}>Configure your first mission ↗</Button></div><ol className="mission-guide"><li><span>01</span><div><strong>Define the mission</strong><small>Scope, goals, and acceptance criteria</small></div></li><li><span>02</span><div><strong>Connect a workflow</strong><small>Your agents, in the right sequence</small></div></li><li><span>03</span><div><strong>Ship and collaborate</strong><small>Follow progress. Talk to your agents.</small></div></li></ol></div>}
      <div className="requirement-list">{visibleItems.map(item => { const related = runs.filter(run => run.requirementId === item.id); return <button className="requirement-list-item" key={item.id} onClick={() => open(item.id)}><span><small className="eyebrow">REQ / {item.id.slice(0, 8)}</small><strong>{item.name}</strong><small>Version {item.version} · {related.length} {related.length === 1 ? 'run' : 'runs'}</small></span><span className="pill">{related.some(run => ['running', 'preparing', 'queued'].includes(run.state)) ? 'In progress' : related.length ? 'View execution' : 'Not started'} ↗</span></button>; })}</div>
      {!loading && visibleItems.length === 0 && (items.length > 0 || category !== 'all' || query.trim()) && <div className="category-empty"><span className="eyebrow">{query.trim() ? 'NO MATCHES' : 'CHANNEL CLEAR'}</span><h3>{query.trim() ? 'No requirements match your search.' : 'No ' + categoryLabel.toLowerCase() + ' yet.'}</h3><p>{query.trim() ? 'Try a different name or clear the search.' : category === 'not_started' ? 'Requirements without a run will appear here.' : 'Requirements will appear here when a run of this type is created.'}</p><Button onClick={() => { setQuery(''); setCategory('all'); }}>Show all requirements</Button></div>}
    </section> : <section><div className="row between"><div><p className="eyebrow">REQUIREMENT WORKSPACE</p><h2>{requirement?.name ?? 'Loading requirement…'}</h2></div><Button onClick={() => setLaunch({ id: active })}>Ship another run</Button></div>
      {!executions.length && !loading && <div className="dashboard-empty"><h2>Ready for a workflow</h2><p>This requirement has no runs yet. Choose a workflow to start execution and open the agent chat.</p><Button variant="accent" onClick={() => setLaunch({ id: active })}>Choose workflow & ship</Button></div>}
      {executions.length > 1 && <Field label="Run history"><Select value={runId ?? ''} onChange={event => setSelectedRuns(current => ({ ...current, [active]: event.target.value }))}><option value="">Choose an execution</option>{executions.map(run => <option key={run.id} value={run.id}>Run {run.id.slice(0, 8)} · Workflow v{run.workflowVersion} · {statusText(run.state)}</option>)}</Select></Field>}
      {runId && <div className="requirement-execution" key={runId}><div className="requirement-workflow"><RunsPage embedded id={runId} csrf={csrf} navigate={navigate} onUnauthorized={onUnauthorized} /></div><aside className="requirement-chat"><RunRepairControls runId={runId} csrf={csrf} navigate={navigate} onUnauthorized={onUnauthorized} embedded /></aside></div>}
    </section>}
    {launch && <ShipDialog csrf={csrf} id={launch.id} onUnauthorized={onUnauthorized} onDirtyChange={onDirtyChange} close={() => { setLaunch(null); if (creating) navigate('/requirements'); }} shipped={(item, run) => { setItems(current => [item, ...current.filter(value => value.id !== item.id)]); setSelectedRuns(current => ({ ...current, [item.id]: run })); open(item.id); setLaunch(null); setRevision(n => n + 1); }} />}
  </div>;
}

type ShipProps = { csrf: string; id?: string; onUnauthorized: () => void; close: () => void; shipped: (item: ConfigDetail, run: string) => void; onDirtyChange: (dirty: boolean) => void };
function ShipDialog({ csrf, id, onUnauthorized, close, shipped, onDirtyChange }: ShipProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [flows, setFlows] = useState<ConfigSummary[]>([]);
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [projectId, setProjectId] = useState('');
  const [flowId, setFlowId] = useState(''); const [namespace, setNamespace] = useState('');
  const [workType, setWorkType] = useState<'feature' | 'fix' | 'hotfix' | 'refactor'>('feature');
  const [existing, setExisting] = useState<ConfigDetail>();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const saved = useRef<ConfigDetail | undefined>(undefined); const command = useCommand(csrf); const flight = useRef(false);
  const launchCommand = useRef<{ body: object; key: string } | undefined>(undefined);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (flight.current || launchCommand.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); const controller = new AbortController();
    Promise.all([collect<Project>('/projects', controller.signal), collect<ConfigSummary>(queryPath(configPath('flows'), { purpose: id ? 'use' : 'view', requirementId: id }), controller.signal), id ? request<ConfigDetail>(configPath('requirements', id), { signal: controller.signal }) : Promise.resolve(undefined)])
      .then(([p, f, item]) => { if (controller.signal.aborted) return; setProjects(p); setFlows(f.filter(flow => flow.allowedActions.includes('use') && flow.workflowVersion)); if (p.length === 1) setProjectId(p[0].id); if (item) { setExisting(item); setName(item.name); if ('projectId' in item.data) { setProjectId(item.data.projectId); setDescription(item.data.description ?? ''); } } })
      .catch(err => { if (!controller.signal.aborted) { if (err instanceof ApiError && err.status === 401) onUnauthorized(); else setError(errorText(err)); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); onDirtyChange(false); opener?.focus(); };
  }, [id, onUnauthorized, onDirtyChange]);
  useEffect(() => { if (!loading) dialog.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [loading]);
  async function ship() {
    if (flight.current) return; flight.current = true; setPending(true); setError(''); onDirtyChange(true);
    try {
      if (!launchCommand.current) {
        const flow = flows.find(value => value.id === flowId)!;
        const challenge = await request<DeviceChallenge>('/devices/challenge', { method: 'POST', csrf });
        const deviceProof = await localDeviceProof(challenge);
        let item = saved.current ?? existing;
        if (!item) { item = await command.send<ConfigDetail>(configPath('requirements'), 'POST', { name: name.trim(), data: { projectId, description: description.trim() } }); saved.current = item; }
        else if (item.name !== name.trim() || ('description' in item.data && item.data.description !== description.trim())) { item = await command.send<ConfigDetail>(configPath('requirements', item.id), 'PATCH', { name: name.trim(), expectedVersion: item.version, data: { projectId, description: description.trim() } }); saved.current = item; }
        saved.current = item;
        launchCommand.current = { key: crypto.randomUUID(), body: { requirementId: item.id, requirementVersion: item.version, workflowId: flow.id, workflowVersion: flow.workflowVersion, workType, deviceProof, ...(!item.repository ? { githubNamespace: namespace.trim() } : {}) } };
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      let receipt: RunStartReceipt;
      try { receipt = await request<RunStartReceipt>('/runs', { method: 'POST', csrf, commandKey: launchCommand.current.key, body: launchCommand.current.body, signal: controller.signal }); }
      finally { window.clearTimeout(timer); }
      launchCommand.current = undefined;
      onDirtyChange(false); shipped(saved.current!, receipt.runId);
    } catch (err) {
      const unknown = !!launchCommand.current && (!(err instanceof ApiError) || err.status >= 500);
      setUncertain(unknown); if (!unknown) { launchCommand.current = undefined; onDirtyChange(false); }
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(unknown ? 'Launch confirmation was interrupted. Retry Ship to check the same launch without creating a duplicate.' : (err instanceof Error && !(err instanceof ApiError) ? err.message : errorText(err)) + (saved.current ? ' Your requirement is saved; retry Ship to launch it.' : ''));
    } finally { setPending(false); flight.current = false; }
  }
  const ready = !loading && name.trim() && description.trim() && projectId && flows.some(flow => flow.id === flowId && flow.workflowVersion) && (existing?.repository || namespace.trim());
  const steps = [{ done: !!name.trim() && !!description.trim(), title: 'Define', text: 'Name your mission and its outcome' }, { done: !!flowId, title: 'Connect', text: 'Select the workflow to execute' }, { done: !!namespace.trim() || !!existing?.repository, title: 'Ship', text: 'Launch into your agent workspace' }];
  return <dialog ref={dialog} className="ship-dialog" aria-labelledby="ship-title" onCancel={event => { event.preventDefault(); if (!pending && !uncertain) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void ship(); }}><aside className="launch-rail"><p className="eyebrow">AGENTSHIP / LAUNCH</p><h2>From intent.<br /><span>To execution.</span></h2><p>One objective.<br />A connected team of agents.</p><ol>{steps.map((step, index) => <li className={step.done ? 'ready' : ''} key={step.title}><span aria-label={step.done ? 'Complete' : 'Incomplete'}>{step.done ? '✓' : '0' + (index + 1)}</span><div><strong>{step.title}</strong><small>{step.text}</small></div></li>)}</ol><div className="launch-rail-note">YOUR WORKSPACE OPENS<br />AFTER LAUNCH CONFIRMATION</div></aside><div className="launch-dialog-main"><header><p className="eyebrow">MISSION LAUNCH / NEW EXECUTION</p><h2 id="ship-title">{id ? 'Ship requirement' : 'Start requirement'}</h2><p className="subtle">Define your goal, connect a workflow, and open your agent workspace.</p></header>
      <fieldset className="launch-fields" disabled={loading || pending || uncertain}><Field label="Requirement name"><input autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field><Field label="Project"><Select required disabled={!!id} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Choose a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></Field><Field label="Requirement details"><textarea required rows={3} value={description} placeholder="What should the agents build? Include scope and acceptance criteria." onChange={event => setDescription(event.target.value)} /></Field><Field label="Workflow"><Select required value={flowId} onChange={event => setFlowId(event.target.value)}><option value="">Choose a saved workflow</option>{flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name} · v{flow.workflowVersion}</option>)}</Select></Field>{!loading && !flows.length && <p className="subtle">No workflows available. Create a workflow on the Workflows page first.</p>}
      {existing?.repository ? <Field label="Work type"><Select value={workType} onChange={event => setWorkType(event.target.value as typeof workType)}><option value="feature">Feature</option><option value="fix">Bug fix</option><option value="hotfix">Hotfix</option><option value="refactor">Refactor</option></Select></Field> : <Field label="GitHub username or organization"><input required value={namespace} onChange={event => setNamespace(event.target.value)} /></Field>}
      </fieldset><p className="subtle">Ship uses your paired local device. {existing?.repository ? 'The linked repository will be reused.' : 'The configured executor may create a public GitHub repository.'}</p>
      {loading && <p role="status">Loading launch options…</p>}{error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="row between"><Button disabled={pending || uncertain} onClick={close}>Cancel</Button><button className="accent" disabled={pending || (!uncertain && !ready)}>{pending ? 'Shipping…' : uncertain ? 'Retry Ship' : 'Ship ↗'}</button></footer></div>
    </form>
  </dialog>;
}
