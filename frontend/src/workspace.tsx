import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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

export const workspaceKinds: Record<ObjectKind, { label: string; singular: string; description: string }> = {
  requirements: { label: '需求', singular: '需求', description: '登记交付目标，并与指定的副负责人协作。' },
  flows: { label: '流程配置', singular: '流程配置', description: '编排阶段、节点与协作角色，让每一步交付有序衔接。' },
  agents: { label: 'Agent 配置', singular: 'Agent 配置', description: '维护 Agent 的角色标识、说明和技能引用。' },
};

type ConfigRoute = { kind: ObjectKind; id?: string; creating?: boolean };
export type WorkspaceRoute = ConfigRoute | { kind: 'runs'; id?: string; creating?: boolean } | { kind: 'devices' } | { kind: 'repair'; id: string };

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
  const confirmLeave = useCallback(() => !flowDirty.current || window.confirm('当前页面有未完成的操作或未保存的修改。确定离开并继续？'), []);
  useEffect(() => { registerPopGuard(confirmLeave); return () => registerPopGuard(null); }, [registerPopGuard, confirmLeave]);
  function navigateSafely(path: string) {
    if (confirmLeave()) { setContactOpen(false); navigate(path); }
  }
  const routeLabel = route.kind === 'runs' ? (route.creating ? '发起运行' : '运行看板')
    : route.kind === 'repair' ? '运行操作' : route.kind === 'devices' ? '本机设备' : workspaceKinds[route.kind].label;

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

  return <div className="shell">
    <aside className="sidebar">
      <Brand />
      <p className="nav-label">工作空间 <span>WORKSPACE</span></p>
      <nav className="nav" aria-label="工作台">
        <button type="button" aria-current={route.kind === 'runs' && !route.creating ? 'page' : undefined} onClick={() => navigateSafely('/runs')}><span className="nav-symbol" aria-hidden="true">◫</span><span>运行看板</span><span className="nav-indicator" aria-hidden="true" /></button>
        <button type="button" aria-current={route.kind === 'runs' && route.creating ? 'page' : undefined} onClick={() => navigateSafely('/runs/new')}><span className="nav-symbol" aria-hidden="true">↗</span><span>发起运行</span><span className="nav-indicator" aria-hidden="true" /></button>
        {(Object.keys(workspaceKinds) as ObjectKind[]).map(kind =>
          <button type="button" key={kind} aria-current={route.kind === kind ? 'page' : undefined}
            onClick={() => { if (confirmLeave()) { setContactOpen(false); navigate('/' + kind); } }}>
            <ConfigIcon kind={kind} /><span>{workspaceKinds[kind].label}</span><span className="nav-indicator" aria-hidden="true" />
          </button>
        )}
        <button type="button" aria-current={route.kind === 'devices' ? 'page' : undefined} onClick={() => navigateSafely('/devices')}><span className="nav-symbol" aria-hidden="true">▣</span><span>本机设备</span><span className="nav-indicator" aria-hidden="true" /></button>
      </nav>
      <div className="sidebar-note"><span className="eyebrow">BUILT FOR COLLABORATION</span><p>一个方向。<br />多个 Agent，一起交付。</p><span className="sidebar-line" /></div>
      <div className="side-footer">
        <div className="account-row"><span className="avatar" aria-hidden="true">{[...session.user.displayName][0]}</span>
          <div><strong>{session.user.displayName}</strong><small>@{session.user.username}</small></div></div>
        <button type="button" aria-pressed={contactOpen} onClick={() => setContactOpen(value => !value)}>本人联系方式</button>
        <button type="button" disabled={logoutPending} onClick={() => void logout()}>{logoutPending ? '退出中…' : '退出登录'}</button>
        {logoutError && <p role="alert">{logoutError}</p>}
      </div>
    </aside>
    <main className="main">
      <div className="topbar"><span>工作台 <span className="crumb-divider">/</span> <strong>{routeLabel}</strong></span>
        <span className="session-badge"><span className="signal-dot" /> 已登录</span></div>
      <div className="main-content">
      {contactOpen && <ContactCard close={() => setContactOpen(false)} onUnauthorized={onSessionEnd} />}
      {route.kind === 'repair' ? <RunRepairControls key={route.id} runId={route.id} csrf={session.csrfToken} navigate={navigateSafely} onUnauthorized={onSessionEnd} />
        : route.kind === 'devices' ? <DevicesPage csrf={session.csrfToken} onUnauthorized={onSessionEnd} /> : route.kind === 'runs' ?
        route.creating ? <RunStartPage csrf={session.csrfToken} navigate={navigate} onUnauthorized={onSessionEnd} onDirtyChange={onFlowDirtyChange} /> :
          <RunsPage id={route.id} csrf={session.csrfToken} navigate={navigateSafely} onUnauthorized={onSessionEnd} /> :
        <ConfigWorkspace key={route.kind} route={route} csrf={session.csrfToken} navigate={navigate} onUnauthorized={onSessionEnd} onFlowDirtyChange={onFlowDirtyChange} confirmLeave={confirmLeave} />}
      <footer className="workspace-footer"><span>AGENTSHIP / DELIVERY WORKSPACE</span><span>需求 · 流程 · 协作</span></footer>
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
    <div className="row between"><h2 id="contact-title">本人联系方式</h2><Button onClick={close}>关闭</Button></div>
    {state.value ? <dl className="contact-details">
      <div><dt>邮箱</dt><dd>{state.value.email}</dd></div>
      <div><dt>手机号</dt><dd>{state.value.phone}</dd></div>
    </dl> : state.error ? <div className="row">
      <p role="alert" className="inline-error">{state.error}</p>
      <Button onClick={() => { setState({}); setRevision(n => n + 1); }}>重试</Button>
    </div> : <p role="status">读取中…</p>}
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

  return <>
    <Heading label="MISSION CONTROL / 配置工作区" title={display.label} text={display.description}
      actions={<Button variant="accent" onClick={() => select('new')}>新建{display.singular}</Button>} />
    {notice && <p className="positive-note" role="status">{notice}</p>}
    <div className={kind === 'flows' ? 'split flow-workspace' : 'split'}>
      <section className="panel config-list" aria-label={display.label + '列表'}>
        <div className="list-heading"><span>我的{display.label}</span><span className="list-count">{page ? `已加载 ${page.items.length}` : '—'}</span></div>
        <form className="search-row" role="search" onSubmit={event => {
          const term = formData(event).text('search').trim();
          if (search === term) refreshList();
          else { setListError(''); setPage(null); setSearch(term); }
        }}>
          <input name="search" aria-label={'搜索' + display.label} type="search" placeholder="按名称搜索" />
          <button>搜索</button>
        </form>
        {listError && <div className="grid"><p className="inline-error" role="alert">{listError}</p>
          <Button onClick={refreshList}>刷新列表</Button></div>}
        {!page && !listError && <p role="status">读取列表…</p>}
        {page?.items.length === 0 && <div className="empty list-empty"><ConfigIcon kind={kind} /><p>{search ? '没有符合条件的配置。' : '还没有可见的配置。'}</p><small>{search ? '试试其他名称。' : '点击右上方，新建第一项配置。'}</small></div>}
        {page?.items.map(item => <button key={item.id} type="button" className="item ghost"
          aria-current={id === item.id ? 'true' : undefined} onClick={() => select(item.id)}>
          <span className="item-body"><ConfigIcon kind={kind} /><span><strong>{item.name}</strong><small>{item.allowedActions.includes('manage_members') ? '可管理配置与成员' : item.allowedActions.includes('edit') ? '可编辑配置' : '可查看配置'}</small></span></span><span className="pill">{kind === 'flows' ? item.workflowVersion == null ? '待完善' : `v${item.workflowVersion}` : `v${item.version}`}</span>
        </button>)}
        {page?.nextCursor && <Button disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? '读取中…' : '加载更多'}</Button>}
      </section>
      <section aria-label="配置详情">
        {creating ? <ConfigEditor key="new" kind={kind} csrf={csrf} onError={fail} onUnauthorized={onUnauthorized} onDirtyChange={onFlowDirtyChange}
            onExisting={select} onSaved={saved => {
              if (currentWorkspacePath() !== path + '/new') return;
              setDetail(saved);
              setNotice('已创建' + display.singular + '。');
              refreshList();
              navigate(path + '/' + saved.id);
            }} />
          : active ? <>
            <ConfigEditor key={active.id + ':' + active.version} kind={kind} csrf={csrf} item={active} onError={fail} onUnauthorized={onUnauthorized} onDirtyChange={onFlowDirtyChange}
              onExisting={select} onSaved={saved => {
                if (currentWorkspacePath() !== path + '/' + active.id) return;
                setDetail(saved);
                setNotice('配置已保存。');
                refreshList();
              }}
              onRefresh={() => setDetailRevision(n => n + 1)} />
            <OwnershipPanel key={active.id + ':' + active.version} item={active} csrf={csrf} onError={fail} beforeChange={confirmLeave}
              onRefresh={() => setDetailRevision(n => n + 1)}
              onChanged={action => {
                if (currentWorkspacePath() !== path + '/' + active.id) return;
                setDetail(null);
                refreshList();
                if (action === 'transfer') {
                  setNotice('已转交配置。');
                  navigate(path);
                } else {
                  setNotice(action === 'add_deputy' ? '已添加副负责人。' : '已移除副负责人。');
                  setDetailRevision(n => n + 1);
                }
              }} />
          </>
          : id ? detailError?.id === id ? <div className="panel grid">
              <p className="inline-error" role="alert">{detailError.message}</p>
              <Button onClick={() => select(id)}>重新读取</Button>
            </div> : <p className="panel" role="status">读取配置…</p>
          : <section className="workspace-welcome">
              <div className="welcome-copy"><p className="eyebrow">YOUR NEXT MISSION</p><h2>从这里，组织下一次交付。</h2>
                <p>从左侧选择一项配置，或新建{display.singular}。<br />把目标、路径与协作角色准备好。</p>
                <span className="welcome-tag"><span className="signal-dot" /> 当前配置由你与获授权的负责人共同管理</span>
              </div>
              <MissionGraphic />
              <div className="workspace-guide">
                <div><ConfigIcon kind="requirements" /><span><strong>明确需求</strong><small>记录目标与交付说明</small></span></div>
                <div><ConfigIcon kind="flows" /><span><strong>规划流程</strong><small>组织交付路径与职责</small></span></div>
                <div><ConfigIcon kind="agents" /><span><strong>配置 Agent</strong><small>定义角色与技能</small></span></div>
              </div>
            </section>}
      </section>
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
      if (!name) { setError('请填写名称。'); return; }
      let data: ConfigData;
      if (kind === 'requirements') {
        const projectId = requirement?.projectId ?? text('projectId');
        if (!projectId) { setError('请选择项目。'); return; }
        data = { projectId, description: text('description').trim() || null };
      } else {
        const roleKey = agent?.roleKey ?? text('roleKey').trim();
        if (!roleKey) { setError('请填写角色标识。'); return; }
        const skillRef = text('skillRef').trim();
        data = { roleKey, description: text('description').trim(), ...(skillRef ? { skillRef } : {}) };
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

  return <section className="panel">
    <div className="row between">
      <h2>{item ? item.name : '新建' + workspaceKinds[kind].singular}</h2>
      {item && <span className="pill">版本 {item.version}</span>}
    </div>
    <form className="grid form-stack" onSubmit={save}>
      <fieldset disabled={!canEdit || mutation.pending}>
        <Field label="名称"><input name="name" defaultValue={item?.name} required /></Field>
        {kind === 'requirements' && <>
          {item ? <p className="subtle">需求保留在原有项目中。</p> : <Field label="项目">
            <select name="projectId" required defaultValue="">
              <option value="">{projects === null ? '读取项目…' : projects.length ? '请选择项目' : '没有可用项目'}</option>
              {projects?.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </Field>}
          {projectError && <div className="row"><p className="inline-error" role="alert">{projectError}</p>
            <Button onClick={() => { setProjectError(''); setProjectRevision(n => n + 1); }}>重试读取项目</Button>
          </div>}
          <Field label="需求说明"><textarea name="description" defaultValue={requirement?.description ?? ''} /></Field>
        </>}
        {kind === 'agents' && <>
          <Field label="角色标识"><input name="roleKey" defaultValue={agent?.roleKey} readOnly={!!agent} required /></Field>
          <Field label="说明"><textarea name="description" defaultValue={agent?.description ?? ''} /></Field>
          <Field label="技能引用（可选）"><input name="skillRef" defaultValue={agent?.skillRef} /></Field>
        </>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {existing && <Button onClick={() => onExisting(existing)}>打开已有需求</Button>}
      {conflict && onRefresh && <Button onClick={onRefresh}>读取最新版本并重新编辑</Button>}
      {canEdit && <div className="actions"><button className="accent" disabled={mutation.pending || conflict}>
        {mutation.pending ? '保存中…' : item ? '保存修改' : '创建配置'}</button></div>}
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
    <h2 id="ownership-title">负责人</h2>
    <ul className="member-list">
      <li><span>{item.owner.displayName} <small>@{item.owner.username}</small></span><span className="pill good">主负责人</span></li>
      {item.deputies.map(deputy => <li key={deputy.id}>
        <span>{deputy.displayName} <small>@{deputy.username}</small></span>
        <span className="actions"><span className="pill">副负责人</span>
          {canManage && <Button variant="ghost tiny" disabled={mutation.pending || conflict}
            onClick={() => void change('remove_deputy', { userId: deputy.id })}>移除 @{deputy.username}</Button>}
        </span>
      </li>)}
    </ul>
    {!item.deputies.length && <p className="subtle">暂无副负责人。</p>}
    {canManage && <div className="grid">
      <form className="ownership-form" onSubmit={event => {
        const username = formData(event).text('deputy').trim();
        if (username) void change('add_deputy', { username });
      }}>
        <Field label="副负责人用户名">
          <input name="deputy" required pattern="[A-Za-z0-9_\-]{1,100}" maxLength={100} autoComplete="off" />
        </Field>
        <button disabled={mutation.pending || conflict}>添加副负责人</button>
      </form>
      {transferring ? <form className="gate grid" onSubmit={event => {
        const username = formData(event).text('successor').trim();
        if (username) void change('transfer', { username });
      }}>
        <p>转交成功后，新主负责人接管配置，你将失去对它的访问。</p>
        <Field label="接任人用户名">
          <input name="successor" required pattern="[A-Za-z0-9_\-]{1,100}" maxLength={100} autoComplete="off" />
        </Field>
        <div className="actions">
          <button className="accent" disabled={mutation.pending || conflict}>确认转交</button>
          <Button disabled={mutation.pending} onClick={() => setTransferring(false)}>取消</Button>
        </div>
      </form> : <div><Button disabled={mutation.pending || conflict} onClick={() => setTransferring(true)}>转交主负责人</Button></div>}
    </div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {conflict && <Button onClick={onRefresh}>读取最新负责人</Button>}
  </section>;
}

