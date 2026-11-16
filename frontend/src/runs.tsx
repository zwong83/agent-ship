import { WorkflowMap } from './workflow-map';
import { useEffect, useState } from 'react';
import { ApiError, errorText, queryPath, request, type Page } from './api';
import { Button, Field, Heading } from './ui';
import { statusText, workTypeLabels, type CheckHistoryEntry, type GitContext, type GitPreparation, type RunArtifact, type RunCheckStatus, type RunDetail, type RunNode, type RunSummary, type RunTask } from './run-api';

import { RunArtifactArchive, type ArchiveControls } from './run-artifact-archive';
import { RunAttemptHistory } from './run-attempt-history';

type Props = { embedded?: boolean; id?: string; csrf: string; navigate: (path: string) => void; onUnauthorized: () => void };

function waitingForDevice(run: RunSummary) {
  return run.deviceStatus.connectivity === 'offline'
    && !['completed', 'stopped', 'failed', 'needs_attention'].includes(run.state);
}

function statusTone(state: string) {
  if (['complete', 'completed', 'succeeded'].includes(state)) return 'good';
  if (['needs_attention', 'failed', 'waiting_reply'].includes(state)) return 'attn';
  if (['running', 'leased'].includes(state)) return 'active';
  return '';
}

function StatusPill({ state, label }: { state: string; label?: string }) {
  return <span className={'pill ' + statusTone(state)}>{label ?? statusText(state)}</span>;
}

export function RunsPage({ id, csrf, navigate, onUnauthorized, embedded }: Props) {
  return id ? <RunDetailPage embedded={embedded} key={id} id={id} csrf={csrf} navigate={navigate} onUnauthorized={onUnauthorized} /> : <RunList navigate={navigate} onUnauthorized={onUnauthorized} />;
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
    <Heading label="MISSION CONTROL" title="Run dashboard" text="View process snapshots of demand runs and pinned processes. The status of each step comes from actual running records."
      actions={<Button variant="accent" onClick={() => navigate('/runs/new')}>Start a run</Button>} />
    <section className="panel"><div className="run-toolbar"><Field label="Search operational requirements"><input type="search" value={query} placeholder="Enter the requirement name" onChange={e => { setQuery(e.target.value); setCursor(undefined); setPage(null); }} /></Field><Button onClick={() => { setCursor(undefined); setRefresh(n => n + 1); }}>refresh run</Button></div>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {pending && !page && <p role="status">Reading and running...</p>}
      {page?.items.length === 0 && <div className="empty"><h2>Not running yet</h2><p>Choose a requirement and process to launch your first run.</p></div>}
      <div className="run-list">{page?.items.map(run => <button type="button" className="run-card" key={run.id} onClick={() => navigate('/runs/' + run.id)}>
        <span className="run-card-icon" aria-hidden="true">↗</span><span className="run-card-main"><strong>{run.requirementName}</strong><small>{workTypeLabels[run.workType]} · Process v{run.workflowVersion} · {run.deviceStatus.name}</small></span>
        {waitingForDevice(run) ? <span className="pill attn">Waiting for the initiating computer to come online</span> : <StatusPill state={run.state} />}
      </button>)}</div>
      {page?.nextCursor && <Button disabled={pending} onClick={() => setCursor(page.nextCursor!)}>load more runs</Button>}
    </section>
  </>;
}

function RunDetailPage({ id, csrf, navigate, onUnauthorized, embedded }: Props & { id: string }) {
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
    <Heading label="MISSION TIMELINE" title={run?.requirementName ?? 'Run details'} text="The run uses the stage, node, and agent versions that are fixed at startup."
      actions={<div className="row">
        <Button onClick={() => navigate('/requirements')}>All requirements</Button>
        <Button onClick={() => setRefresh(n => n + 1)}>refresh run</Button>
        {!embedded && run?.allowedActions.includes('open_repair_control') &&
          <Button variant="accent" onClick={() => navigate('/runs/' + encodeURIComponent(id) + '/chat')}>Run controls</Button>}
      </div>} />
    {error && <p role="alert" className="inline-error">{error}</p>}
    {!run && !error && <p role="status">Reading and running...</p>}
    {run && <>
      <section className={'run-status panel ' + (offline ? 'is-offline' : statusTone(run.state))} aria-label="Current running status"><span className="status-orbit" aria-hidden="true" /><div><p className="eyebrow">{run.mode === 'demo' ? 'DEVELOPMENT MODE · Local demo' : 'CODEX MODE · Native execution'}</p><h2>{offline ? 'Waiting for the initiating computer to come online' : gitReady ? 'The warehouse is ready, waiting for Agent execution' : run.state === 'waiting' && pendingReply ? 'Waiting for reply' : statusText(run.state)}</h2>
        <p>{offline ? 'Run progress saved. This run can be continued after the original computer comes online.' : run.blocker ?? (run.state === 'completed' ? 'This run has reached the end node of the process.' : 'The following is the current operating status recorded by the platform.')}</p>
        {run.state === 'queued' && <small>The startup record has been created, the Git preparation has not been completed, and the Agent node has not yet been executed.</small>}
        {gitReady && <small>{run.mode === 'codex' && run.deviceStatus.codexStatus === 'unavailable'
          ? 'The initiating computer does not detect the Codex CLI. Please check and reconnect after installation.'
          : <>Select the Agent-enabled mode in "Local Device" and start the executable program using the same device directory. <Button variant="tiny" onClick={() => navigate('/devices')}>View device settings</Button></>}</small>}
      </div></section>
      <div className="run-facts"><div><small>Work type</small><strong>{workTypeLabels[run.workType]}</strong></div><div><small>Fixed process version</small><strong>v{run.workflowVersion}</strong></div><div><small>Requirements revision</small><strong>r{run.requirementRevision}</strong></div><div><small>launch computer</small><strong>{run.deviceStatus.name}</strong></div></div>
      <WorkflowMap stages={run.stages.map(stage => ({ ...stage, nodes: stage.nodes.map(node => ({ id: node.nodeId, name: node.name, type: node.type, dependencies: node.dependencies ?? [] })) }))}
        execution={{ states: Object.fromEntries(nodes.map(node => [node.nodeId, node.state])), executing: !offline && run.state === 'running' }} />
      <RunTimeline executing={!offline && run.state === 'running'} stages={run.stages} nodes={nodes} archive={{ runId: id, csrf, local: run.mode === 'demo',
        allowed: run.allowedActions.includes('archive_deliverable'), refresh: () => setRefresh(value => value + 1) }} />
      <RunAttemptHistory runId={id} nodes={nodes} onUnauthorized={onUnauthorized} />
      {(run.git || run.gitPlan) && <section className="panel run-git"><h2>{run.git ? 'Prepared warehouses and branches' : 'Git plans to be executed'}</h2>
        {run.git ? <GitEvidence git={run.git} mode={run.mode} /> : run.gitPlan && <>
          <dl><div><dt>storehouse</dt><dd>{run.gitPlan.repositoryName} {run.gitPlan.createRepository ? '(To be created · Open to the public)' : '(Inherit the demand warehouse)'}</dd></div><div><dt>base branch</dt><dd>{run.gitPlan.baseBranch ?? 'Warehouse default branch (to be read)'}</dd></div><div><dt>working branch</dt><dd>{run.gitPlan.workBranch}</dd></div></dl>
          <p className="subtle">{run.gitPlan.ensureDev ? 'If dev does not exist, create dev from the default branch of the warehouse first.' : 'Use the actual default branch of the repository.'} This is a plan, there is no confirmation that the warehouse or branch has been created.</p>
        </>}
      </section>}
      {run.gitPreparation && <GitProgress preparation={run.gitPreparation} />}
    </>}
  </>;
}

function RunTimeline({ stages, nodes, archive, executing }: { stages: RunDetail['stages']; nodes: RunNode[]; archive: ArchiveControls; executing: boolean }) {
  const nodeById = new Map(nodes.map(node => [node.nodeId, node]));
  const resolved = (node: RunNode) => ['complete', 'skipped'].includes(node.state);
  const completed = nodes.filter(node => node.state === 'complete').length;
  const skipped = nodes.filter(node => node.state === 'skipped').length;
  return <section className="run-timeline" aria-label="fixed workflow stages">
    {nodes.length > 0 && <header className="run-progress panel">
      <div className="row between"><div><p className="eyebrow">EXECUTION SEQUENCE</p><h2>Node execution progress</h2></div>
        <span className="mono">{completed} / {nodes.length} Completed{skipped > 0 && ` · ${skipped} skipped`}</span></div>
      <progress aria-label="Completed or skipped nodes" value={completed + skipped} max={nodes.length} />
    </header>}
    {stages.map((stage, index) => <article key={stage.id} className="panel run-stage">
      <header className="step-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{stage.name}</h2><small>{stage.nodes.filter(resolved).length} / {stage.nodes.length} Processed</small></header>
      <div className="run-nodes">{stage.nodes.map(node => <RunNodeCard executing={executing} key={node.nodeId} node={node} nodeById={nodeById} archive={archive} />)}</div>
    </article>)}
  </section>;
}

const nodeTypeLabels: Record<RunNode['type'], string> = {
  work: 'execution node', check: 'Check node', publish: 'Publish node', end: 'End node',
};

const checkLabels: Record<RunCheckStatus['status'], string> = {
  pending: 'Waiting for inspection', pass: 'Pass', repair: 'Needs repair', unresolved: 'To be confirmed', limit_reached: 'The automatic repair limit has been reached', stopped: 'Stopped',
};

const repairRoundLabels: Record<NonNullable<CheckHistoryEntry['repairRound']>['state'], string> = {
  queued: 'Waiting for repair', running: 'Under repair', complete: 'Repair completed', failed: 'Repair failed', stopped: 'Repair stopped',
};

function CheckCycle({ check, nodeState }: { check: RunCheckStatus; nodeState: string }) {
  const history = check.history ?? [];
  const round = history.find(entry => entry.wave === check.checkWave)?.repairRound;
  let label = checkLabels[check.status];
  let note: string | undefined;
  let tone = '';

  if (check.status === 'limit_reached') {
    tone = 'attn';
    note = 'The repair route for this inspection has been suspended, waiting for manual processing.';
  } else if (check.status === 'unresolved') {
    tone = 'attn';
    note = 'Valid inspection conclusions are required to select subsequent routes.';
  } else if (check.status === 'repair' && round) {
    label = repairRoundLabels[round.state];
    if (round.state === 'running' || round.state === 'queued') {
      tone = 'active';
      note = 'After the repair is completed, we will return to this check node for review.';
    } else if (round.state === 'failed') tone = 'attn';
  } else if (check.status === 'pending') {
    const recheck = check.checkWave > 1;
    const running = nodeState === 'running';
    label = recheck ? (running ? 'Under review' : 'Waiting for review') : (running ? 'Under inspection' : checkLabels.pending);
    if (running) tone = 'active';
  } else if (check.status === 'pass') tone = 'good';

  return <section className="check-cycle" aria-label="Inspect and repair">
    <div className="row between"><h4>Inspect and repair</h4><span className={'pill ' + tone}>{label}</span></div>
    <dl className="check-cycle-counts">
      <div><dt>Check times</dt><dd>Attempt {check.checkWave}</dd></div>
      <div><dt>Automatic repair</dt><dd>{check.automaticRepairCount} / {check.automaticRepairLimit}</dd></div>
      {check.manualRepairCount > 0 && <div><dt>Manual addition</dt><dd>{check.manualRepairCount}</dd></div>}
    </dl>
    {check.automaticRepairLimit > 0 && <progress aria-label="Auto-repair rounds used" value={check.automaticRepairCount} max={check.automaticRepairLimit} />}
    {note && <p className={'check-cycle-note ' + tone}>{note}</p>}
    {history.length > 0 && <details className="check-history">
      <summary>Inspection records · {history.length}</summary>
      <ol>{[...history].sort((first, second) => second.wave - first.wave).map(entry => <li key={entry.wave}>
        <div className="row between"><strong>Attempt {entry.wave} inspections</strong><span>{checkLabels[entry.outcome]}</span></div>
        {entry.repairRound && <p>Attempt {entry.repairRound.number}{entry.repairRound.kind === 'manual' ? 'Manual addition' : 'Automatic repair'} · {repairRoundLabels[entry.repairRound.state]}</p>}
        {entry.testedCommit && <p className="check-candidate"><span>Submission under test</span><code>{entry.testedCommit}</code></p>}
        {entry.completedAt && <time dateTime={entry.completedAt}>{new Date(entry.completedAt).toLocaleString()}</time>}
      </li>)}</ol>
    </details>}
  </section>;
}

function RunNodeCard({ node, nodeById, archive, executing }: { node: RunNode; nodeById: Map<string, RunNode>; archive: ArchiveControls; executing: boolean }) {
  const dependencies = (node.dependencies ?? []).map(id => nodeById.get(id)).filter(dep => dep != null);
  const waiting = dependencies.some(dep => !['complete', 'skipped'].includes(dep.state));
  return <section className={'run-node ' + (!executing && statusTone(node.state) === 'active' ? '' : statusTone(node.state)) + (node.type === 'end' ? ' end-node' : '')}>
    <div className="row between"><h3>{node.name}</h3><StatusPill state={node.state} /></div>
    <p className="subtle node-meta">{nodeTypeLabels[node.type]}
      {node.inputRequirementRevision != null && ` · Requirements r${node.inputRequirementRevision}`}
      {node.basedOnOlderRequirementRevision && ' · Use old requirements version'}
      {node.wave > 1 && !node.check && ` · No. ${node.wave}`}
    </p>
    {dependencies.length > 0 && <p className="node-dependencies">{node.state === 'blocked' && waiting ? 'Wait for prefix' : 'Predecessor node'} · {dependencies.map(dep => dep.name).join('、')}</p>}
    {node.check && <CheckCycle check={node.check} nodeState={node.state} />}
    {node.type === 'end' ? <p className="subtle">{node.state === 'complete' ? 'End node reached' : 'Wait for all execution routes of this run to end'}</p>
      : <NodeRoles node={node} />}
    {node.reason && <p className="node-reason">{node.reason}</p>}
    {!!node.artifacts?.length ? <NodeArtifacts artifacts={node.artifacts} archive={{ ...archive, allowed: archive.allowed && node.state === 'complete' }} />
      : node.artifactIds.length > 0 && <small>Recorded {node.artifactIds.length} item product</small>}
  </section>;
}

function NodeRoles({ node }: { node: RunNode }) {
  const roles = node.selectedRoles ?? [];
  const roleIds = new Set(roles.map(role => role.roleId));
  const rolesInOrder = [...roles.filter(role => role.kind === 'agent'), ...roles.filter(role => role.kind === 'coordinator')];
  const tasksByRole = new Map(node.tasks.map(task => [task.roleId, task]));
  const otherTasks = node.tasks.filter(task => !task.roleId || !roleIds.has(task.roleId));
  return <>
    {node.agentOrder && roles.some(role => role.kind === 'agent') && <p className="node-order">Sub-agent {node.agentOrder === 'serial' ? 'serial' : 'parallel'}</p>}
    {(roles.length > 0 || otherTasks.length > 0) && <ul className="run-roles" aria-label="Node roles and tasks">
      {rolesInOrder.map(role => <RoleTaskRow key={role.roleId} name={role.displayName} version={role.agentVersion}
        label={role.kind === 'coordinator' ? 'coordination' : role.sequence != null ? `Agent ${role.sequence}` : 'Agent'} task={tasksByRole.get(role.roleId)} />)}
      {otherTasks.map(task => <RoleTaskRow key={task.taskId} name={task.roleDisplayName ?? 'Run tasks'} label="Task" task={task} />)}
    </ul>}
    {node.tasks.length === 0 && node.state !== 'skipped' && <p className="node-empty-task">No execution tasks have been dispatched yet</p>}
  </>;
}

function RoleTaskRow({ name, version, label, task }: { name: string; version?: number; label: string; task?: RunTask }) {
  const state = task?.disposition ?? task?.state ?? 'pending';
  const stateLabel = !task ? 'To be distributed' : state === 'queued' ? 'Waiting for equipment collection' : statusText(state);
  return <li className="run-role">
    <div className="run-role-identity"><span className="role-marker">{label}</span><strong>{name}</strong>{version != null && <small>v{version}</small>}</div>
    <div className="run-role-state"><StatusPill state={state} label={stateLabel} />{task && <small>Attempt {task.attemptNumber}</small>}</div>
    {task?.reason && <p>{task.reason}</p>}
  </li>;
}

const artifactKindLabels: Record<RunArtifact['kind'], string> = {
  product: 'Deliver product', code: 'code artifacts', test: 'Test product', publication: 'release evidence', other: 'node product',
};

function NodeArtifacts({ artifacts, archive }: { artifacts: RunArtifact[]; archive: ArchiveControls }) {
  return <div className="node-artifacts">
    <h4>Recorded product</h4>
    <ul>{artifacts.map(artifact => <li key={artifact.id}>
      <strong>{artifact.title || artifactKindLabels[artifact.kind]}</strong>
      {artifact.sourceRef && <p><span>{artifact.sourceRef.startsWith('local-git:') ? 'native reference' : 'Quote'}</span><code>{artifact.sourceRef}</code></p>}
      {artifact.commit && <p><span>submit</span><code>{artifact.commit}</code></p>}
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
    {mode === 'demo' && <p className="git-mode-note">Local demo repository · No remote repository created on GitHub</p>}
    <dl><div><dt>storehouse</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{repository.displayName}</a> : repository.displayName}</dd></div>
      <div><dt>Warehouse default branch</dt><dd>{repository.defaultBranch ?? 'Not recorded yet'}</dd></div>
      <div><dt>base branch</dt><dd>{git.baseBranch}</dd></div><div><dt>working branch</dt><dd>{git.workBranch}</dd></div>
      <div><dt>Basic submission</dt><dd><code>{git.baseCommit}</code></dd></div><div><dt>Working branch commit</dt><dd>{git.headCommit ? <code>{git.headCommit}</code> : 'Not recorded yet'}</dd></div></dl>
  </>;
}

function GitProgress({ preparation }: { preparation: GitPreparation }) {
  const stateLabels: Record<GitPreparation['state'], string> = { queued: 'Waiting for equipment collection', preparing: 'Preparing', ready: 'Ready to complete', needs_attention: 'Needs attention' };
  const stepLabels: Record<GitPreparation['steps'][number]['state'], string> = { intended: 'To be started', dispatching: 'Processing', unknown: 'Result to be verified', succeeded: 'Confirmed', failed: 'Failed' };
  const effectLabels: Record<GitPreparation['steps'][number]['effect'], string> = { create_repository: 'Create warehouse', create_base_branch: 'Prepare base branch', create_work_branch: 'Create a working branch' };
  const unknown = preparation.steps.some(step => step.state === 'unknown');
  return <section className="panel git-preparation" aria-labelledby="git-preparation-title">
    <div className="row between"><h2 id="git-preparation-title">Git preparation record</h2><span className={'pill ' + (preparation.state === 'ready' ? 'good' : preparation.state === 'needs_attention' ? 'attn' : '')}>{stateLabels[preparation.state]}</span></div>
    <p className="subtle">{preparation.mode === 'demo' ? 'Local demo execution' : 'GitHub execution'} · No. {preparation.attemptNumber} Preparation</p>
    {preparation.message && <p className="git-preparation-message">{preparation.message}</p>}
    {unknown && <p className="git-reconcile-note">There are operations whose results have not yet been confirmed. The system needs to first check the actual status of the warehouse and branches. Don't create duplicate repositories or branches.</p>}
    {preparation.state === 'needs_attention' && <p className="subtle">This preparation has been suspended. Please keep the current execution program and running records and wait for verification and processing.</p>}
    <ol className="git-steps">{preparation.steps.map(step => <li key={step.operationKey} className={'git-step ' + step.state}>
      <div className="row between"><h3>{effectLabels[step.effect]}</h3><span className="pill">{stepLabels[step.state]}</span></div>
      <p className="git-target">{step.targetId}</p>
      {step.providerResultId && <p className="git-step-evidence"><span>Results recorded</span><code>{step.providerResultId}</code></p>}
      {step.observedAt && <small>Check time {new Date(step.observedAt).toLocaleString()}</small>}
    </li>)}</ol>
  </section>;
}
