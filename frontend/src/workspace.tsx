import { Select } from './select';
import { AgentFields } from './agent-fields';
import { RequirementHub } from './requirement-hub';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type ConfigData, type ConfigDetail,
  type ConfigSummary, type ObjectKind, type Page, type Project, type SelfContact, type Session } from './api';
import { Button, Field, Heading, formData } from './ui';
import { Brand, ConfigIcon, MissionGraphic } from './brand';
import { WorkflowEditor } from './workflow-editor';
import { useCommand } from './use-command';
import { RunStartPage } from './run-start';
import { RunsPage } from './runs';
import { DevicesPage } from './devices';
import { RunRepairControls } from './run-repair-controls';

const Dashboard = lazy(() => import('./dashboard').then(module => ({ default: module.Dashboard })));

export const workspaceKinds: Record<ObjectKind, { label: string; singular: string; description: string }> = {
  requirements: { label: 'Requirements', singular: 'requirement', description: 'Register delivery goals and collaborate with assigned co-owner.' },
  flows: { label: 'Workflows', singular: 'workflow', description: 'Orchestrate stages, nodes and collaborative roles to ensure orderly connection of each step of delivery.' },
  agents: { label: 'Agents', singular: 'agent', description: 'Maintain the Agent\'s role ID, description, and skill references.' },
};

type ConfigRoute = { kind: ObjectKind; id?: string; creating?: boolean };
export type WorkspaceRoute = ConfigRoute | { kind: 'dashboard' } | { kind: 'runs'; id?: string; creating?: boolean } | { kind: 'devices' } | { kind: 'repair'; id: string };

type WorkspaceProps = {
  session: Session & { user: NonNullable<Session['user']>; csrfToken: string };
  route: WorkspaceRoute;
  navigate: (path: string) => void;
  onSessionEnd: () => void;
  registerPopGuard: (guard: (() => boolean) | null) => void;
};

export function Workspace({ session, route, navigate, onSessionEnd, registerPopGuard }: WorkspaceProps) {
  const [contactOpen, setContactOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const logoutKey = useRef<string | null>(null);
  const flowDirty = useRef(false);
  const onFlowDirtyChange = useCallback((value: boolean) => { flowDirty.current = value; }, []);
  const confirmLeave = useCallback(() => !flowDirty.current || window.confirm('There are unfinished operations or unsaved modifications on the current page. Are you sure you want to leave and continue?'), []);
  useEffect(() => { registerPopGuard(confirmLeave); return () => registerPopGuard(null); }, [registerPopGuard, confirmLeave]);
  function navigateSafely(path: string) {
    if (confirmLeave()) { setContactOpen(false); navigate(path); }
  }
  const routeLabel = route.kind === 'dashboard' ? 'Dashboard' : route.kind === 'runs' ? (route.creating ? 'Start a run' : 'Run dashboard')
    : route.kind === 'repair' ? 'Run controls' : route.kind === 'devices' ? 'Local devices' : workspaceKinds[route.kind].label;

  async function logout() {
    if (logoutPending) return;
    if (!confirmLeave()) return;
    setLogoutPending(true);
    setLogoutError('');
    logoutKey.current ??= crypto.randomUUID();
    try {
      await request('/logout', { method: 'POST', csrf: session.csrfToken, commandKey: logoutKey.current });
      onSessionEnd();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSessionEnd();
      else setLogoutError(errorText(err));
    } finally {
      setLogoutPending(false);
    }
  }

  return <div className={"shell futuristic-shell command-shell" + (route.kind === 'dashboard' ? ' dashboard-shell' : '')} data-motion="enabled">
    <div className="ambient-field" aria-hidden="true"><i /><i /><span /></div>
    <header className="command-navigation">
      <Brand />
      <nav className="nav" aria-label="Workspace">
        <button type="button" aria-current={route.kind === 'dashboard' ? 'page' : undefined} onClick={() => navigateSafely('/dashboard')}><svg className="config-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>Dashboard</span><span className="nav-indicator" aria-hidden="true" /></button>
        {(Object.keys(workspaceKinds) as ObjectKind[]).map(kind =>
          <button type="button" key={kind} aria-current={route.kind === kind ? 'page' : undefined}
            onClick={() => { if (confirmLeave()) { setContactOpen(false); navigate('/' + kind); } }}>
            <ConfigIcon kind={kind} /><span>{workspaceKinds[kind].label}</span><span className="nav-indicator" aria-hidden="true" />
          </button>
        )}
        <button type="button" aria-current={route.kind === 'devices' ? 'page' : undefined} onClick={() => navigateSafely('/devices')}><span className="nav-symbol" aria-hidden="true">▣</span><span>Local devices</span><span className="nav-indicator" aria-hidden="true" /></button>
      </nav>
      <div className="command-account">
        <button type="button" className="account-trigger" aria-label="My contact information" aria-expanded={contactOpen} onClick={() => { setContactOpen(value => !value); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="avatar" aria-hidden="true">{[...session.user.displayName][0]}</span><span className="account-name">{session.user.displayName}</span></button>
        <button type="button" className="account-signout" disabled={logoutPending} onClick={() => void logout()}>{logoutPending ? 'Exiting…' : 'Sign out'}</button>
        {logoutError && <p role="alert">{logoutError}</p>}
      </div>
    </header>
    <main className="main">
      {route.kind !== 'dashboard' && <div className="topbar"><span>workbench <span className="crumb-divider">/</span> <strong>{routeLabel}</strong></span>
        <div className="topbar-controls"><span className="session-badge"><span className="signal-dot" /> Logged in</span></div></div>}
      <div className="main-content">
      {contactOpen && <ContactCard close={() => setContactOpen(false)} onUnauthorized={onSessionEnd} />}
      {route.kind === 'requirements' ? <RequirementHub csrf={session.csrfToken} initialId={route.id} creating={route.creating} navigate={navigateSafely} onUnauthorized={onSessionEnd} onDirtyChange={onFlowDirtyChange} /> : route.kind === 'dashboard' ? <Suspense fallback={<p role="status">Loading mission control…</p>}><Dashboard navigate={navigateSafely} onUnauthorized={onSessionEnd} /></Suspense> : route.kind === 'repair' ? <RunRepairControls key={route.id} runId={route.id} csrf={session.csrfToken} navigate={navigateSafely} onUnauthorized={onSessionEnd} />
        : route.kind === 'devices' ? <DevicesPage csrf={session.csrfToken} onUnauthorized={onSessionEnd} /> : route.kind === 'runs' ?
        route.creating ? <RunStartPage csrf={session.csrfToken} navigate={navigate} onUnauthorized={onSessionEnd} onDirtyChange={onFlowDirtyChange} /> :
          <RunsPage id={route.id} csrf={session.csrfToken} navigate={navigateSafely} onUnauthorized={onSessionEnd} /> :
        <ConfigWorkspace key={route.kind} route={route} csrf={session.csrfToken} navigate={navigate} onUnauthorized={onSessionEnd} onFlowDirtyChange={onFlowDirtyChange} confirmLeave={confirmLeave} />}
      <footer className="workspace-footer"><span>AGENTSHIP / DELIVERY WORKSPACE</span><span>Requirements · Process · Collaboration</span></footer>
      </div>
    </main>
  </div>;
}

function ContactCard({ close, onUnauthorized }: { close: () => void; onUnauthorized: () => void }) {
  const [state, setState] = useState<{ value?: SelfContact; error?: string }>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const control = new AbortController();
    request<SelfContact>('/me/contact', { signal: control.signal }).then(value => setState({ value })).catch(err => {
      if (control.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setState({ error: errorText(err) });
    });
    return () => control.abort();
  }, [onUnauthorized, revision]);

  return <section className="panel contact-panel" aria-labelledby="contact-title">
    <div className="row between"><h2 id="contact-title">My contact information</h2><Button onClick={close}>Close</Button></div>
    {state.value ? <dl className="contact-details">
      <div><dt>Email</dt><dd>{state.value.email ?? 'Not provided'}</dd></div>
      <div><dt>Phone number</dt><dd>{state.value.phone ?? 'Not provided'}</dd></div>
    </dl> : state.error ? <div className="row">
      <p role="alert" className="inline-error">{state.error}</p>
      <Button onClick={() => { setState({}); setRevision(n => n + 1); }}>Retry</Button>
    </div> : <p role="status">Loading…</p>}
  </section>;
}

type ConfigWorkspaceProps = {
  route: ConfigRoute;
  csrf: string;
  navigate: (path: string) => void;
  onUnauthorized: () => void;
  onFlowDirtyChange: (value: boolean) => void;
  confirmLeave: () => boolean;
};

function ConfigWorkspace({ route, csrf, navigate, onUnauthorized, onFlowDirtyChange, confirmLeave }: ConfigWorkspaceProps) {
  const { kind, id, creating } = route;
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState<Page<ConfigSummary> | null>(null);
  const [listError, setListError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<ConfigDetail | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const pageAbort = useRef<AbortController | null>(null);
  const display = workspaceKinds[kind];
  const path = '/' + kind;

  useEffect(() => {
    if (kind !== 'flows' && kind !== 'agents') return;
    const term = searchDraft.trim();
    if (term === search) return;
    const timer = window.setTimeout(() => {
      setListError(''); setPage(null); setSearch(term);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [kind, searchDraft, search]);

  useEffect(() => {
    pageAbort.current?.abort();
    const control = new AbortController();
    pageAbort.current = control;
    request<Page<ConfigSummary>>(queryPath(configPath(kind), { q: search, pageSize: '30' }), { signal: control.signal })
      .then(result => { if (!control.signal.aborted) setPage(result); })
      .catch(err => {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else setListError(errorText(err));
      });
    return () => control.abort();
  }, [kind, search, listRevision, onUnauthorized]);

  useEffect(() => {
    if (!id) return;
    const control = new AbortController();
    request<ConfigDetail>(configPath(kind, id), { signal: control.signal })
      .then(item => { if (!control.signal.aborted) setDetail(item); })
      .catch(err => {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else {
          setDetail(null);
          setDetailError({ id, message: errorText(err) });
        }
      });
    return () => control.abort();
  }, [kind, id, detailRevision, onUnauthorized]);

  async function more() {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setListError('');
    const signal = pageAbort.current?.signal;
    try {
      const next = await request<Page<ConfigSummary>>(queryPath(configPath(kind),
        { q: search, cursor: page.nextCursor, pageSize: '30' }), { signal });
      if (!signal?.aborted) {
        setPage(current => current && { items: [...current.items, ...next.items], nextCursor: next.nextCursor });
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else if (err instanceof ApiError && err.problem?.code === 'CURSOR_EXPIRED') refreshList();
      else setListError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function refreshList() {
    setListError('');
    setPage(null);
    setListRevision(n => n + 1);
  }

  function select(next: string) {
    if (!confirmLeave()) return;
    setNotice('');
    setDetailError(null);
    setDetail(null);
    if (next === id) setDetailRevision(n => n + 1);
    navigate(path + '/' + next);
  }

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) onUnauthorized();
    else if (id && currentWorkspacePath() === path + '/' + id && err instanceof ApiError
      && [403, 404].includes(err.status) && err.problem?.code !== 'MEMBER_UNAVAILABLE') {
      setDetail(null);
      setDetailError({ id, message: errorText(err) });
      refreshList();
    }
  }

  const active = detail?.id === id ? detail : null;
  const compactLibrary = kind === 'flows' || kind === 'agents';
  const agentSetup = kind === 'agents' && creating;
  const searchForm = <form className={compactLibrary ? 'search-row config-search' + (searchDraft.trim() !== search ? ' is-typing' : '') : 'search-row'} role="search" onClick={event => {
          if (compactLibrary && (event.target === event.currentTarget || (event.target as Element).closest('.search-lens'))) {
            (event.currentTarget.elements.namedItem('search') as HTMLInputElement)?.focus();
          }
        }} onSubmit={event => {
          const term = formData(event).text('search').trim();
          if (search === term) refreshList();
          else { setListError(''); setPage(null); setSearch(term); }
        }}>
          {compactLibrary && <span className="search-lens" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></span>}
          <input name="search" aria-label={'Search ' + display.label} type="search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder={compactLibrary ? `Find ${display.label.toLowerCase()} by name…` : 'Search by name'} />
          {compactLibrary && <button className="search-clear" type="button" aria-label={'Clear ' + display.singular + ' search'} disabled={!searchDraft} onClick={() => { setSearchDraft(''); if (search) { setListError(''); setPage(null); setSearch(''); } }}>×</button>}
          {compactLibrary ? <span className="search-live"><i aria-hidden="true" />Live search</span> : <button className="search-submit">Search</button>}
        </form>;

  return <>
    <Heading label={agentSetup ? 'AGENT CONFIGURATION / NEW AGENT' : 'MISSION CONTROL/Configuration workspace'} title={agentSetup ? 'Create agent' : display.label} text={agentSetup ? 'Define its role. Connect a skill. Bring it into your workflow.' : display.description}
      actions={agentSetup ? <Button onClick={() => { if (confirmLeave()) navigate(path); }}>Back to agents</Button> : !creating && <Button variant="accent" onClick={() => select('new')}>Create {display.singular}</Button>} />
    {notice && <p className="positive-note" role="status">{notice}</p>}
    <div className={compactLibrary ? 'split config-library' : 'split'}>
      {!agentSetup && <section className="panel config-list" aria-label={display.label + ' list'}>
        <div className="list-heading"><span>My {display.label}</span><span className="list-count">{page ? `Loaded ${page.items.length}` : '—'}</span></div>
        {compactLibrary ? <div className="library-search-area">{searchForm}</div> : searchForm}
        {listError && <div className="grid"><p className="inline-error" role="alert">{listError}</p>
          <Button onClick={refreshList}>Refresh list</Button></div>}
        {!page && !listError && <p role="status">Read list…</p>}
        {page?.items.length === 0 && (compactLibrary
          ? <div className="config-empty-state">
              <span className="config-empty-icon" aria-hidden="true"><ConfigIcon kind={kind} /></span>
              <div><h3>{search ? `No matching ${display.label.toLowerCase()}` : `No ${display.label.toLowerCase()} yet`}</h3>
                <p>{search ? `Try a different ${display.singular} name.` : kind === 'flows' ? 'Create a workflow to connect stages, nodes and agents.' : 'Create an agent to define its role and skills.'}</p></div>
            </div>
          : <div className="empty list-empty"><ConfigIcon kind={kind} /><p>{search ? 'There are no matching configurations.' : 'There is no visible configuration yet.'}</p><small>{search ? 'Try another name.' : 'Click on the upper right corner to create the first configuration.'}</small></div>)}
        {page?.items.map(item => <button key={item.id} type="button" className="item ghost"
          aria-current={id === item.id ? 'true' : undefined} onClick={() => select(item.id)}>
          <span className="item-body"><ConfigIcon kind={kind} /><span><strong>{item.name}</strong><small>{item.allowedActions.includes('manage_members') ? 'Manage configuration and members' : item.allowedActions.includes('edit') ? 'Editable configuration' : 'Viewable configuration'}</small></span></span><span className="pill">{kind === 'flows' ? item.workflowVersion == null ? 'Incomplete' : `v${item.workflowVersion}` : `v${item.version}`}</span>
        </button>)}
        {page?.nextCursor && <Button disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? 'Loading…' : 'load more'}</Button>}
      </section>}
      {(!compactLibrary || creating || id) && <section aria-label="Configuration details">
        {creating ? <ConfigEditor key="new" kind={kind} csrf={csrf} onError={fail} onUnauthorized={onUnauthorized} onDirtyChange={onFlowDirtyChange}
            onExisting={select} onSaved={saved => {
              if (currentWorkspacePath() !== path + '/new') return;
              setDetail(saved);
              setNotice('Created ' + display.singular + '.');
              refreshList();
              navigate(path + '/' + saved.id);
            }} />
          : active ? <>
            <ConfigEditor key={'editor:' + active.id + ':' + active.version} kind={kind} csrf={csrf} item={active} onError={fail} onUnauthorized={onUnauthorized} onDirtyChange={onFlowDirtyChange}
              onExisting={select} onSaved={saved => {
                if (currentWorkspacePath() !== path + '/' + active.id) return;
                setDetail(saved);
                setNotice('Configuration saved.');
                refreshList();
              }}
              onRefresh={() => setDetailRevision(n => n + 1)} />
            <OwnershipPanel key={'ownership:' + active.id + ':' + active.version} item={active} csrf={csrf} onError={fail} beforeChange={confirmLeave}
              onRefresh={() => setDetailRevision(n => n + 1)}
              onChanged={action => {
                if (currentWorkspacePath() !== path + '/' + active.id) return;
                setDetail(null);
                refreshList();
                if (action === 'transfer') {
                  setNotice('Configuration transferred.');
                  navigate(path);
                } else {
                  setNotice(action === 'add_deputy' ? 'Co-owner added.' : 'Co-owner removed.');
                  setDetailRevision(n => n + 1);
                }
              }} />
          </>
          : id ? detailError?.id === id ? <div className="panel grid">
              <p className="inline-error" role="alert">{detailError.message}</p>
              <Button onClick={() => select(id)}>reread</Button>
            </div> : <p className="panel" role="status">Read configuration…</p>
          : <section className="workspace-welcome">
              <div className="welcome-copy"><p className="eyebrow">YOUR NEXT MISSION</p><h2>From here, organize your next delivery.</h2>
                <p>Select a configuration from the left, or create a new {display.singular}.<br />Have goals, paths, and collaborative roles ready.</p>
                <span className="welcome-tag"><span className="signal-dot" /> The current configuration is managed by you and the authorized person responsible</span>
              </div>
              <MissionGraphic />
              <div className="workspace-guide">
                <div><ConfigIcon kind="requirements" /><span><strong>Define requirements</strong><small>Document goals and delivery instructions</small></span></div>
                <div><ConfigIcon kind="flows" /><span><strong>Plan workflows</strong><small>Organizational delivery path and responsibilities</small></span></div>
                <div><ConfigIcon kind="agents" /><span><strong>Configure Agent</strong><small>Define roles and skills</small></span></div>
              </div>
            </section>}
      </section>}
    </div>
  </>;
}

function currentWorkspacePath() {
  return window.location.pathname.toLowerCase().replace(/\/$/, '');
}

type EditProps = {
  kind: ObjectKind;
  csrf: string;
  item?: ConfigDetail;
  onError: (error: unknown) => void;
  onUnauthorized: () => void;
  onSaved: (item: ConfigDetail) => void;
  onExisting: (id: string) => void;
  onRefresh?: () => void;
  onDirtyChange?: (value: boolean) => void;
};

function ConfigEditor(props: EditProps) {
  return props.kind === 'flows' ? <WorkflowEditor {...props} /> : <BasicConfigEditor {...props} />;
}

function BasicConfigEditor({ kind, csrf, item, onError, onUnauthorized, onSaved, onExisting, onRefresh }: EditProps) {
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [existing, setExisting] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectError, setProjectError] = useState('');
  const [projectRevision, setProjectRevision] = useState(0);
  const mutation = useCommand(csrf);
  const canEdit = !item || item.allowedActions.includes('edit');
  const requirement = item?.data && 'projectId' in item.data ? item.data : undefined;
  const agent = item?.data && 'roleKey' in item.data ? item.data : undefined;

  useEffect(() => {
    if (kind !== 'requirements' || item) return;
    const control = new AbortController();
    async function readProjects() {
      const projects: Project[] = [];
      let cursor: string | undefined;
      do {
        const result: Page<Project> = await request<Page<Project>>(
          queryPath('/projects', { cursor, pageSize: '50' }), { signal: control.signal });
        projects.push(...result.items);
        cursor = result.nextCursor ?? undefined;
      } while (cursor && !control.signal.aborted);
      if (!control.signal.aborted) setProjects(projects);
    }
    void readProjects().catch(err => {
      if (control.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setProjectError(errorText(err));
    });
    return () => control.abort();
  }, [kind, item, onUnauthorized, projectRevision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    const { text } = formData(event);
    if (!canEdit || mutation.pending || conflict) return;
    setError('');
    setExisting('');
    try {
      const name = text('name').trim();
      if (!name) { setError('Please fill in the name.'); return; }
      let data: ConfigData;
      if (kind === 'requirements') {
        const projectId = requirement?.projectId ?? text('projectId');
        if (!projectId) { setError('Please select a project.'); return; }
        data = { projectId, description: text('description').trim() || null };
      } else {
        const roleKey = agent?.roleKey ?? text('roleKey').trim();
        if (!roleKey) { setError('Please fill in the role ID.'); return; }
        const skillRef = text('skillRef').trim();
        data = { roleKey, workspaceAccess: text('workspaceAccess') as 'read_only' | 'write' | 'legacy', description: text('description').trim(), ...(skillRef ? { skillRef } : {}) };
      }
      const saved = await mutation.send<ConfigDetail>(configPath(kind, item?.id), item ? 'PATCH' : 'POST',
        { name, data, ...(item ? { expectedVersion: item.version } : {}) });
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError) {
        setConflict(err.problem?.code === 'STALE_VERSION');
        const existingId = err.problem?.details?.existingRequirementId;
        if (typeof existingId === 'string' && /^[0-9a-f-]{36}$/i.test(existingId)) setExisting(existingId);
      }
      onError(err);
    }
  }

  return <section className={'panel' + (kind === 'agents' ? ' agent-editor' : '')}>
    <div className="row between">
      <h2>{item ? item.name : kind === 'agents' ? 'Configure your agent' : 'Create ' + workspaceKinds[kind].singular}</h2>
      {item && <span className="pill">Version {item.version}</span>}
    </div>
    <form className="grid form-stack" onSubmit={save}>
      <fieldset disabled={!canEdit || mutation.pending}>
        {kind !== 'agents' && <Field label="Name"><input name="name" defaultValue={item?.name} required /></Field>}
        {kind === 'requirements' && <>
          {item ? <p className="subtle">The requirements remain in the original project.</p> : <Field label="project">
            <Select name="projectId" required defaultValue="">
              <option value="">{projects === null ? 'Read items…' : projects.length ? 'Select a project' : 'No items available'}</option>
              {projects?.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
            </Select>
          </Field>}
          {projectError && <div className="row"><p className="inline-error" role="alert">{projectError}</p>
            <Button onClick={() => { setProjectError(''); setProjectRevision(n => n + 1); }}>Retry reading items</Button>
          </div>}
          <Field label="Requirement description"><textarea name="description" defaultValue={requirement?.description ?? ''} /></Field>
        </>}
        {kind === 'agents' && <AgentFields name={item?.name} roleKey={agent?.roleKey} description={agent?.description} skillRef={agent?.skillRef} workspaceAccess={agent?.workspaceAccess} />}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {existing && <Button onClick={() => onExisting(existing)}>Open existing requirements</Button>}
      {conflict && onRefresh && <Button onClick={onRefresh}>Read the latest version and edit again</Button>}
      {canEdit && <div className={'actions' + (kind === 'agents' ? ' agent-savebar' : '')}>{kind === 'agents' && <p>Agent name and role ID are required. You can refine instructions and skills later.</p>}<button className="accent" disabled={mutation.pending || conflict}>
        {mutation.pending ? 'Saving…' : item ? 'Save changes' : kind === 'agents' ? 'Create agent' : 'Create configuration'}</button></div>}
    </form>
  </section>;
}

type OwnershipAction = 'add_deputy' | 'remove_deputy' | 'transfer';

function OwnershipPanel({ item, csrf, onChanged, onError, onRefresh, beforeChange }: {
  item: ConfigDetail;
  csrf: string;
  onChanged: (action: OwnershipAction) => void;
  onError: (error: unknown) => void;
  onRefresh: () => void;
  beforeChange: () => boolean;
}) {
  const mutation = useCommand(csrf);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const canManage = item.allowedActions.includes('manage_members');

  async function change(action: OwnershipAction, target: { username: string } | { userId: string }) {
    if (mutation.pending || conflict || !canManage) return;
    if (!beforeChange()) return;
    setError('');
    try {
      await mutation.send(configPath(item.kind, item.id) + '/ownership', 'POST',
        { ...target, action, expectedVersion: item.version });
      onChanged(action);
    } catch (err) {
      setError(errorText(err));
      setConflict(err instanceof ApiError && err.problem?.code === 'STALE_VERSION');
      onError(err);
    }
  }

  return <section className="panel" aria-labelledby="ownership-title">
    <h2 id="ownership-title">Ownership</h2>
    <ul className="member-list">
      <li><span>{item.owner.displayName} <small>@{item.owner.username}</small></span><span className="pill good">Owner</span></li>
      {item.deputies.map(deputy => <li key={deputy.id}>
        <span>{deputy.displayName} <small>@{deputy.username}</small></span>
        <span className="actions"><span className="pill">Co-owner</span>
          {canManage && <Button variant="ghost tiny" disabled={mutation.pending || conflict}
            onClick={() => void change('remove_deputy', { userId: deputy.id })}>Remove @{deputy.username}</Button>}
        </span>
      </li>)}
    </ul>
    {!item.deputies.length && <p className="subtle">There is currently no co-owner.</p>}
    {canManage && <div className="grid">
      <form className="ownership-form" onSubmit={event => {
        const username = formData(event).text('deputy').trim();
        if (username) void change('add_deputy', { username });
      }}>
        <Field label="Co-owner username">
          <input name="deputy" required pattern="[A-Za-z0-9_\-]{1,100}" maxLength={100} autoComplete="off" />
        </Field>
        <button disabled={mutation.pending || conflict}>Add co-owner</button>
      </form>
      {transferring ? <form className="gate grid" onSubmit={event => {
        const username = formData(event).text('successor').trim();
        if (username) void change('transfer', { username });
      }}>
        <p>After a successful transfer, the new owner takes over the configuration and you lose access to it.</p>
        <Field label="Successor username">
          <input name="successor" required pattern="[A-Za-z0-9_\-]{1,100}" maxLength={100} autoComplete="off" />
        </Field>
        <div className="actions">
          <button className="accent" disabled={mutation.pending || conflict}>Confirm transfer</button>
          <Button disabled={mutation.pending} onClick={() => setTransferring(false)}>Cancel</Button>
        </div>
      </form> : <div><Button disabled={mutation.pending || conflict} onClick={() => setTransferring(true)}>Transfer ownership</Button></div>}
    </div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {conflict && <Button onClick={onRefresh}>Reload ownership</Button>}
  </section>;
}

