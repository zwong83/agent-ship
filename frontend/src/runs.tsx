import { useEffect, useState } from 'react';
import { ApiError, errorText, queryPath, request, type Page } from './api';
import { Button, Field, Heading } from './ui';
import { statusText, workTypeLabels, type CheckHistoryEntry, type GitContext, type GitPreparation, type RunArtifact, type RunCheckStatus, type RunDetail, type RunNode, type RunSummary, type RunTask } from './run-api';

import { RunArtifactArchive, type ArchiveControls } from './run-artifact-archive';
import { RunAttemptHistory } from './run-attempt-history';

type Props = { id?: string; csrf: string; navigate: (path: string) => void; onUnauthorized: () => void };

function waitingForDevice(run: RunSummary) {
  return run.deviceStatus.connectivity === 'offline'
    && !['completed', 'stopped', 'failed', 'needs_attention'].includes(run.state);
}

function statusTone(state: string) {
  if (['complete', 'completed', 'succeeded'].includes(state)) return 'good';
  if (['needs_attention', 'failed', 'waiting_reply'].includes(state)) return 'attn';
  if (['running', 'leased', 'ready'].includes(state)) return 'active';
  return '';
}

function StatusPill({ state, label }: { state: string; label?: string }) {
  return <span className={'pill ' + statusTone(state)}>{label ?? statusText(state)}</span>;
}

export function RunsPage({ id, csrf, navigate, onUnauthorized }: Props) {
  return id ? <RunDetailPage key={id} id={id} csrf={csrf} navigate={navigate} onUnauthorized={onUnauthorized} /> : <RunList navigate={navigate} onUnauthorized={onUnauthorized} />;
}

function RunList({ navigate, onUnauthorized }: Pick<Props, 'navigate' | 'onUnauthorized'>) {
  const [page, setPage] = useState<Page<RunSummary> | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const control = new AbortController();
    setPending(true); setError('');
    request<Page<RunSummary>>(queryPath('/runs', { q: query, cursor, pageSize: '30' }), { signal: control.signal })
      .then(value => { if (!control.signal.aborted) setPage(current => cursor && current ? { items: [...current.items, ...value.items], nextCursor: value.nextCursor } : value); })
      .catch(err => {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else { setPage(null); setError(errorText(err)); }
      }).finally(() => { if (!control.signal.aborted) setPending(false); });
    return () => control.abort();
  }, [query, cursor, refresh, onUnauthorized]);
  return <>
    <Heading label="MISSION CONTROL" title="运行看板" text="查看需求运行与已固定的流程快照。每一步状态都来自实际运行记录。"
      actions={<Button variant="accent" onClick={() => navigate('/runs/new')}>发起运行</Button>} />
    <section className="panel"><div className="run-toolbar"><Field label="搜索运行需求"><input type="search" value={query} placeholder="输入需求名称" onChange={e => { setQuery(e.target.value); setCursor(undefined); setPage(null); }} /></Field><Button onClick={() => { setCursor(undefined); setRefresh(n => n + 1); }}>刷新运行</Button></div>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {pending && !page && <p role="status">正在读取运行…</p>}
      {page?.items.length === 0 && <div className="empty"><h2>还没有运行</h2><p>选择一个需求和流程，发起你的第一次运行。</p></div>}
      <div className="run-list">{page?.items.map(run => <button type="button" className="run-card" key={run.id} onClick={() => navigate('/runs/' + run.id)}>
        <span className="run-card-icon" aria-hidden="true">↗</span><span className="run-card-main"><strong>{run.requirementName}</strong><small>{workTypeLabels[run.workType]} · 流程 v{run.workflowVersion} · {run.deviceStatus.name}</small></span>
        {waitingForDevice(run) ? <span className="pill attn">等待发起电脑上线</span> : <StatusPill state={run.state} />}
      </button>)}</div>
      {page?.nextCursor && <Button disabled={pending} onClick={() => setCursor(page.nextCursor!)}>加载更多运行</Button>}
    </section>
  </>;
}

function RunDetailPage({ id, csrf, navigate, onUnauthorized }: Props & { id: string }) {
  const [run, setRun] = useState<RunDetail>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const control = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const value = await request<RunDetail>('/runs/' + encodeURIComponent(id), { signal: control.signal });
        if (!control.signal.aborted) { setRun(value); setError(''); }
      } catch (err) {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else {
          if (err instanceof ApiError && [403, 404].includes(err.status)) setRun(undefined);
          setError(errorText(err));
        }
      } finally { loading = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { control.abort(); window.clearInterval(timer); };
  }, [id, refresh, onUnauthorized]);
  const offline = !!run && waitingForDevice(run);
  const nodes = run?.stages.flatMap(stage => stage.nodes) ?? [];
  const pendingReply = nodes.some(node => node.state === 'waiting_reply' || node.tasks.some(task => task.state === 'waiting_reply'));
  const gitReady = run?.state === 'waiting' && !!run.git
    && ['AGENT_EXECUTION_PENDING', 'AGENT_DISPATCH_PENDING'].includes(run.blockerCode ?? '')
    && nodes.every(node => node.state === 'blocked' && node.tasks.length === 0);
  return <>
    <Heading label="MISSION TIMELINE" title={run?.requirementName ?? '运行详情'} text="运行使用启动时固定的阶段、节点与 Agent 版本。"
      actions={<div className="row">
        <Button onClick={() => navigate('/runs')}>返回运行看板</Button>
        <Button onClick={() => setRefresh(n => n + 1)}>刷新运行</Button>
        {run?.allowedActions.includes('open_repair_control') &&
          <Button variant="accent" onClick={() => navigate('/runs/' + encodeURIComponent(id) + '/chat')}>运行操作</Button>}
      </div>} />
    {error && <p role="alert" className="inline-error">{error}</p>}
    {!run && !error && <p role="status">正在读取运行…</p>}
    {run && <>
      <section className={'run-status panel ' + (offline ? 'is-offline' : statusTone(run.state))} aria-label="当前运行状态"><span className="status-orbit" aria-hidden="true" /><div><p className="eyebrow">{run.mode === 'demo' ? 'DEVELOPMENT MODE · 本地演示' : 'CODEX MODE · 本机执行'}</p><h2>{offline ? '等待发起电脑上线' : gitReady ? '仓库已就绪，等待 Agent 执行' : run.state === 'waiting' && pendingReply ? '等待回复' : statusText(run.state)}</h2>
        <p>{offline ? '运行进度已保存。原电脑上线后可继续本次运行。' : run.blocker ?? (run.state === 'completed' ? '本次运行已到达流程的结束节点。' : '以下为平台记录的当前运行状态。')}</p>
        {run.state === 'queued' && <small>启动记录已创建，Git 准备尚未完成，Agent 节点尚未执行。</small>}
        {gitReady && <small>{run.mode === 'codex' && run.deviceStatus.codexStatus === 'unavailable'
          ? '发起电脑未检测到 Codex CLI。请检查安装后重新连接。'
          : <>在「本机设备」选择启用 Agent 的模式，并用相同设备目录启动执行程序。 <Button variant="tiny" onClick={() => navigate('/devices')}>查看设备设置</Button></>}</small>}
      </div></section>
      <div className="run-facts"><div><small>工作类型</small><strong>{workTypeLabels[run.workType]}</strong></div><div><small>固定流程版本</small><strong>v{run.workflowVersion}</strong></div><div><small>需求修订</small><strong>r{run.requirementRevision}</strong></div><div><small>发起电脑</small><strong>{run.deviceStatus.name}</strong></div></div>
      <RunTimeline stages={run.stages} nodes={nodes} archive={{ runId: id, csrf, local: run.mode === 'demo',
        allowed: run.allowedActions.includes('archive_deliverable'), refresh: () => setRefresh(value => value + 1) }} />
      <RunAttemptHistory runId={id} nodes={nodes} onUnauthorized={onUnauthorized} />
      {(run.git || run.gitPlan) && <section className="panel run-git"><h2>{run.git ? '已准备的仓库与分支' : '待执行的 Git 计划'}</h2>
        {run.git ? <GitEvidence git={run.git} mode={run.mode} /> : run.gitPlan && <>
          <dl><div><dt>仓库</dt><dd>{run.gitPlan.repositoryName} {run.gitPlan.createRepository ? '（待新建 · 公开）' : '（沿用需求仓库）'}</dd></div><div><dt>基础分支</dt><dd>{run.gitPlan.baseBranch ?? '仓库默认分支（待读取）'}</dd></div><div><dt>工作分支</dt><dd>{run.gitPlan.workBranch}</dd></div></dl>
          <p className="subtle">{run.gitPlan.ensureDev ? '若 dev 不存在，先从仓库默认分支创建 dev。' : '使用仓库的实际默认分支。'} 此处为计划，尚未确认仓库或分支已经创建。</p>
        </>}
      </section>}
      {run.gitPreparation && <GitProgress preparation={run.gitPreparation} />}
    </>}
  </>;
}

function RunTimeline({ stages, nodes, archive }: { stages: RunDetail['stages']; nodes: RunNode[]; archive: ArchiveControls }) {
  const nodeById = new Map(nodes.map(node => [node.nodeId, node]));
  const resolved = (node: RunNode) => ['complete', 'skipped'].includes(node.state);
  const completed = nodes.filter(node => node.state === 'complete').length;
  const skipped = nodes.filter(node => node.state === 'skipped').length;
  return <section className="run-timeline" aria-label="固定流程阶段">
    {nodes.length > 0 && <header className="run-progress panel">
      <div className="row between"><div><p className="eyebrow">EXECUTION SEQUENCE</p><h2>节点执行进度</h2></div>
        <span className="mono">{completed} / {nodes.length} 已完成{skipped > 0 && ` · ${skipped} 已跳过`}</span></div>
      <progress aria-label="已完成或跳过的节点" value={completed + skipped} max={nodes.length} />
    </header>}
    {stages.map((stage, index) => <article key={stage.id} className="panel run-stage">
      <header className="step-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{stage.name}</h2><small>{stage.nodes.filter(resolved).length} / {stage.nodes.length} 已处理</small></header>
      <div className="run-nodes">{stage.nodes.map(node => <RunNodeCard key={node.nodeId} node={node} nodeById={nodeById} archive={archive} />)}</div>
    </article>)}
  </section>;
}

const nodeTypeLabels: Record<RunNode['type'], string> = {
  work: '执行节点', check: '检查节点', publish: '发布节点', end: '结束节点',
};

const checkLabels: Record<RunCheckStatus['status'], string> = {
  pending: '等待检查', pass: '通过', repair: '需修复', unresolved: '待确认', limit_reached: '已达自动修复上限', stopped: '已停止',
};

const repairRoundLabels: Record<NonNullable<CheckHistoryEntry['repairRound']>['state'], string> = {
  queued: '等待修复', running: '修复中', complete: '修复完成', failed: '修复失败', stopped: '修复已停止',
};

function CheckCycle({ check, nodeState }: { check: RunCheckStatus; nodeState: string }) {
  const history = check.history ?? [];
  const round = history.find(entry => entry.wave === check.checkWave)?.repairRound;
  let label = checkLabels[check.status];
  let note: string | undefined;
  let tone = '';

  if (check.status === 'limit_reached') {
    tone = 'attn';
    note = '本检查的修复路线已暂停，等待人工处理。';
  } else if (check.status === 'unresolved') {
    tone = 'attn';
    note = '需要有效的检查结论才能选择后续路线。';
  } else if (check.status === 'repair' && round) {
    label = repairRoundLabels[round.state];
    if (round.state === 'running' || round.state === 'queued') {
      tone = 'active';
      note = '修复完成后会回到本检查节点复查。';
    } else if (round.state === 'failed') tone = 'attn';
  } else if (check.status === 'pending') {
    const recheck = check.checkWave > 1;
    const running = nodeState === 'running';
    label = recheck ? (running ? '复查中' : '等待复查') : (running ? '检查中' : checkLabels.pending);
    if (running) tone = 'active';
  } else if (check.status === 'pass') tone = 'good';

  return <section className="check-cycle" aria-label="检查与修复">
    <div className="row between"><h4>检查与修复</h4><span className={'pill ' + tone}>{label}</span></div>
    <dl className="check-cycle-counts">
      <div><dt>检查次数</dt><dd>第 {check.checkWave} 次</dd></div>
      <div><dt>自动修复</dt><dd>{check.automaticRepairCount} / {check.automaticRepairLimit} 轮</dd></div>
      {check.manualRepairCount > 0 && <div><dt>人工追加</dt><dd>{check.manualRepairCount} 轮</dd></div>}
    </dl>
    {check.automaticRepairLimit > 0 && <progress aria-label="已使用的自动修复轮次" value={check.automaticRepairCount} max={check.automaticRepairLimit} />}
    {note && <p className={'check-cycle-note ' + tone}>{note}</p>}
    {history.length > 0 && <details className="check-history">
      <summary>检查记录 · {history.length} 次</summary>
      <ol>{[...history].sort((first, second) => second.wave - first.wave).map(entry => <li key={entry.wave}>
        <div className="row between"><strong>第 {entry.wave} 次检查</strong><span>{checkLabels[entry.outcome]}</span></div>
        {entry.repairRound && <p>第 {entry.repairRound.number} 轮{entry.repairRound.kind === 'manual' ? '人工追加' : '自动修复'} · {repairRoundLabels[entry.repairRound.state]}</p>}
        {entry.testedCommit && <p className="check-candidate"><span>被测提交</span><code>{entry.testedCommit}</code></p>}
        {entry.completedAt && <time dateTime={entry.completedAt}>{new Date(entry.completedAt).toLocaleString()}</time>}
      </li>)}</ol>
    </details>}
  </section>;
}

function RunNodeCard({ node, nodeById, archive }: { node: RunNode; nodeById: Map<string, RunNode>; archive: ArchiveControls }) {
  const dependencies = (node.dependencies ?? []).map(id => nodeById.get(id)).filter(dep => dep != null);
  const waiting = dependencies.some(dep => !['complete', 'skipped'].includes(dep.state));
  return <section className={'run-node ' + statusTone(node.state) + (node.type === 'end' ? ' end-node' : '')}>
    <div className="row between"><h3>{node.name}</h3><StatusPill state={node.state} /></div>
    <p className="subtle node-meta">{nodeTypeLabels[node.type]}
      {node.inputRequirementRevision != null && ` · 需求 r${node.inputRequirementRevision}`}
      {node.basedOnOlderRequirementRevision && ' · 使用旧需求版本'}
      {node.wave > 1 && !node.check && ` · 第 ${node.wave} 轮`}
    </p>
    {dependencies.length > 0 && <p className="node-dependencies">{node.state === 'blocked' && waiting ? '等待前置' : '前置节点'} · {dependencies.map(dep => dep.name).join('、')}</p>}
    {node.check && <CheckCycle check={node.check} nodeState={node.state} />}
    {node.type === 'end' ? <p className="subtle">{node.state === 'complete' ? '已到达结束节点' : '等待本次运行的所有执行路线结束'}</p>
      : <NodeRoles node={node} />}
    {node.reason && <p className="node-reason">{node.reason}</p>}
    {!!node.artifacts?.length ? <NodeArtifacts artifacts={node.artifacts} archive={{ ...archive, allowed: archive.allowed && node.state === 'complete' }} />
      : node.artifactIds.length > 0 && <small>已记录 {node.artifactIds.length} 项产物</small>}
  </section>;
}

function NodeRoles({ node }: { node: RunNode }) {
  const roles = node.selectedRoles ?? [];
  const roleIds = new Set(roles.map(role => role.roleId));
  const rolesInOrder = [...roles.filter(role => role.kind === 'agent'), ...roles.filter(role => role.kind === 'coordinator')];
  const tasksByRole = new Map(node.tasks.map(task => [task.roleId, task]));
  const otherTasks = node.tasks.filter(task => !task.roleId || !roleIds.has(task.roleId));
  return <>
    {node.agentOrder && roles.some(role => role.kind === 'agent') && <p className="node-order">子 Agent {node.agentOrder === 'serial' ? '串行' : '并行'}</p>}
    {(roles.length > 0 || otherTasks.length > 0) && <ul className="run-roles" aria-label="节点角色与任务">
      {rolesInOrder.map(role => <RoleTaskRow key={role.roleId} name={role.displayName} version={role.agentVersion}
        label={role.kind === 'coordinator' ? '协调' : role.sequence != null ? `Agent ${role.sequence}` : 'Agent'} task={tasksByRole.get(role.roleId)} />)}
      {otherTasks.map(task => <RoleTaskRow key={task.taskId} name={task.roleDisplayName ?? '运行任务'} label="任务" task={task} />)}
    </ul>}
    {node.tasks.length === 0 && node.state !== 'skipped' && <p className="node-empty-task">尚未派发执行任务</p>}
  </>;
}

function RoleTaskRow({ name, version, label, task }: { name: string; version?: number; label: string; task?: RunTask }) {
  const state = task?.disposition ?? task?.state ?? 'pending';
  const stateLabel = !task ? '待派发' : state === 'queued' ? '待设备领取' : statusText(state);
  return <li className="run-role">
    <div className="run-role-identity"><span className="role-marker">{label}</span><strong>{name}</strong>{version != null && <small>v{version}</small>}</div>
    <div className="run-role-state"><StatusPill state={state} label={stateLabel} />{task && <small>第 {task.attemptNumber} 次</small>}</div>
    {task?.reason && <p>{task.reason}</p>}
  </li>;
}

const artifactKindLabels: Record<RunArtifact['kind'], string> = {
  product: '交付产物', code: '代码产物', test: '测试产物', publication: '发布证据', other: '节点产物',
};

function NodeArtifacts({ artifacts, archive }: { artifacts: RunArtifact[]; archive: ArchiveControls }) {
  return <div className="node-artifacts">
    <h4>已记录产物</h4>
    <ul>{artifacts.map(artifact => <li key={artifact.id}>
      <strong>{artifact.title || artifactKindLabels[artifact.kind]}</strong>
      {artifact.sourceRef && <p><span>{artifact.sourceRef.startsWith('local-git:') ? '本机引用' : '引用'}</span><code>{artifact.sourceRef}</code></p>}
      {artifact.commit && <p><span>提交</span><code>{artifact.commit}</code></p>}
      <RunArtifactArchive artifact={artifact} controls={archive} />
    </li>)}</ul>
  </div>;
}

function GitEvidence({ git, mode }: { git: GitContext; mode: 'demo' | 'codex' }) {
  const { repository } = git;
  const safeName = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repository.displayName)
    && !['.', '..'].includes(repository.displayName.split('/')[1]);
  const href = mode === 'codex' && repository.provider === 'github' && safeName ? 'https://github.com/' + repository.displayName : null;
  return <>
    {mode === 'demo' && <p className="git-mode-note">本地演示仓库 · 未在 GitHub 创建远程仓库</p>}
    <dl><div><dt>仓库</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{repository.displayName}</a> : repository.displayName}</dd></div>
      <div><dt>仓库默认分支</dt><dd>{repository.defaultBranch ?? '尚未记录'}</dd></div>
      <div><dt>基础分支</dt><dd>{git.baseBranch}</dd></div><div><dt>工作分支</dt><dd>{git.workBranch}</dd></div>
      <div><dt>基础提交</dt><dd><code>{git.baseCommit}</code></dd></div><div><dt>工作分支提交</dt><dd>{git.headCommit ? <code>{git.headCommit}</code> : '尚未记录'}</dd></div></dl>
  </>;
}

function GitProgress({ preparation }: { preparation: GitPreparation }) {
  const stateLabels: Record<GitPreparation['state'], string> = { queued: '待设备领取', preparing: '正在准备', ready: '准备完成', needs_attention: '待人工处理' };
  const stepLabels: Record<GitPreparation['steps'][number]['state'], string> = { intended: '待开始', dispatching: '正在处理', unknown: '结果待核对', succeeded: '已确认', failed: '失败' };
  const effectLabels: Record<GitPreparation['steps'][number]['effect'], string> = { create_repository: '创建仓库', create_base_branch: '准备基础分支', create_work_branch: '创建工作分支' };
  const unknown = preparation.steps.some(step => step.state === 'unknown');
  return <section className="panel git-preparation" aria-labelledby="git-preparation-title">
    <div className="row between"><h2 id="git-preparation-title">Git 准备记录</h2><span className={'pill ' + (preparation.state === 'ready' ? 'good' : preparation.state === 'needs_attention' ? 'attn' : '')}>{stateLabels[preparation.state]}</span></div>
    <p className="subtle">{preparation.mode === 'demo' ? '本地演示执行' : 'GitHub 执行'} · 第 {preparation.attemptNumber} 次准备</p>
    {preparation.message && <p className="git-preparation-message">{preparation.message}</p>}
    {unknown && <p className="git-reconcile-note">有操作尚未确认结果，系统需先核对仓库与分支的实际状态。不要重复创建仓库或分支。</p>}
    {preparation.state === 'needs_attention' && <p className="subtle">本次准备已暂停。请保留当前执行程序和运行记录，等待核对处理。</p>}
    <ol className="git-steps">{preparation.steps.map(step => <li key={step.operationKey} className={'git-step ' + step.state}>
      <div className="row between"><h3>{effectLabels[step.effect]}</h3><span className="pill">{stepLabels[step.state]}</span></div>
      <p className="git-target">{step.targetId}</p>
      {step.providerResultId && <p className="git-step-evidence"><span>已记录结果</span><code>{step.providerResultId}</code></p>}
      {step.observedAt && <small>核对时间 {new Date(step.observedAt).toLocaleString()}</small>}
    </li>)}</ol>
  </section>;
}
