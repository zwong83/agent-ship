import { useEffect, useRef, useState } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type ConfigDetail, type Page, type Project } from './api';
import { Button, Field, Heading } from './ui';
import { StartPicker } from './start-picker';
import { useCommand } from './use-command';
import { localDeviceProof, workTypeLabels, type DeviceChallenge, type RunStart, type RunStartReceipt, type WorkType } from './run-api';

type Props = { csrf: string; navigate: (path: string) => void; onUnauthorized: () => void; onDirtyChange: (dirty: boolean) => void };

export function RunStartPage({ csrf, navigate, onUnauthorized, onDirtyChange }: Props) {
  const [requirement, setRequirement] = useState<ConfigDetail>();
  const [flow, setFlow] = useState<ConfigDetail>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectError, setProjectError] = useState('');
  const [projectRevision, setProjectRevision] = useState(0);
  const [workType, setWorkType] = useState<WorkType | ''>('');
  const [description, setDescription] = useState('');
  const [namespace, setNamespace] = useState('');
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState('');
  const [pending, setPending] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const selection = useRef(0);
  const prepared = useRef<{ body: RunStart; key: string } | null>(null);
  const mutation = useCommand(csrf);
  const locked = pending || uncertain || mutation.pending || selecting;
  const requirementData = requirement?.data && 'projectId' in requirement.data ? requirement.data : undefined;
  const stages = flow?.data && 'stages' in flow.data ? flow.data.stages : [];
  const canDefer = stages.some(stage => stage.nodes.some(node => node.purpose === 'requirement'));
  const linked = !!requirement?.repository;
  const canEdit = requirement?.allowedActions.includes('edit');

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (prepared.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => { window.removeEventListener('beforeunload', handler); onDirtyChange(false); };
  }, [onDirtyChange]);

  useEffect(() => {
    if (!creating) return;
    const control = new AbortController();
    setProjectError('');
    async function loadProjects() {
      const items: Project[] = [];
      let cursor: string | undefined;
      do {
        const page: Page<Project> = await request(queryPath('/projects', { cursor, pageSize: '50' }), { signal: control.signal });
        items.push(...page.items); cursor = page.nextCursor ?? undefined;
      } while (cursor && !control.signal.aborted);
      if (!control.signal.aborted) setProjects(items);
    }
    void loadProjects().catch(err => {
      if (control.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setProjectError(errorText(err));
    });
    return () => control.abort();
  }, [creating, onUnauthorized, projectRevision]);

  function showError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) onUnauthorized();
    setError(err instanceof ApiError ? errorText(err) : err instanceof Error ? err.message : '操作暂未完成，请重试。');
  }

  function acceptRequirement(value: ConfigDetail) {
    setRequirement(value); setFlow(undefined); setCreating(false); setExistingId('');
    setWorkType(value.repository ? '' : 'feature');
    setDescription('description' in value.data ? value.data.description ?? '' : '');
  }

  async function select(kind: 'requirements' | 'flows', id: string) {
    if (locked) return;
    const token = ++selection.current;
    setSelecting(true); setError('');
    try {
      const value = await request<ConfigDetail>(configPath(kind, id));
      if (token !== selection.current) return;
      if (kind === 'requirements') acceptRequirement(value); else setFlow(value);
    } catch (err) {
      if (token !== selection.current) return;
      if (kind === 'requirements') { setRequirement(undefined); setFlow(undefined); } else setFlow(undefined);
      showError(err);
    } finally { if (token === selection.current) setSelecting(false); }
  }

  async function createRequirement() {
    if (locked) return;
    setError(''); setExistingId('');
    if (!newName.trim() || !projectId) { setError('请填写需求名称并选择所属项目。'); return; }
    try {
      const value = await mutation.send<ConfigDetail>(configPath('requirements'), 'POST', {
        name: newName.trim(), data: { projectId, description: null },
      });
      acceptRequirement(value);
    } catch (err) {
      showError(err);
      if (err instanceof ApiError && typeof err.problem?.details?.existingRequirementId === 'string') {
        setExistingId(err.problem.details.existingRequirementId);
      }
    }
  }

  async function start() {
    if (inFlight.current) return;
    setError('');
    if (!prepared.current) {
      if (!requirement || !requirementData || !flow || !flow.workflowVersion || !workType) {
        setError('请先选择需求、工作类型和已保存的流程。'); return;
      }
      if (!requirement.allowedActions.includes('start') || !flow.allowedActions.includes('use')) {
        setError('当前账号没有发起此需求或使用该流程的权限，请重新选择。'); return;
      }
      if (!canDefer && !description.trim()) { setError('所选流程没有需求节点，请在启动前补齐需求说明。'); return; }
      if (!linked && !namespace.trim()) { setError('请填写用于自动创建仓库的 GitHub 用户名或组织名。'); return; }
      if (description.trim() !== (requirementData.description ?? '').trim() && !canEdit) {
        setError('没有编辑此需求的权限，请联系负责人补齐说明。'); return;
      }
    }
    inFlight.current = true; setPending(true);
    try {
      if (!prepared.current) {
        let selected = requirement!;
        if (description.trim() !== (requirementData!.description ?? '').trim()) {
          selected = await mutation.send<ConfigDetail>(configPath('requirements', selected.id), 'PATCH', {
            name: selected.name, expectedVersion: selected.version,
            data: { projectId: requirementData!.projectId, description: description.trim() || null },
          });
          setRequirement(selected);
        }
        const challenge = await request<DeviceChallenge>('/devices/challenge', { method: 'POST', csrf });
        const proof = await localDeviceProof(challenge);
        const body: RunStart = { requirementId: selected.id, requirementVersion: selected.version,
          workflowId: flow!.id, workflowVersion: flow!.workflowVersion!, workType: workType as WorkType,
          deviceProof: proof, ...(!linked ? { githubNamespace: namespace.trim() } : {}) };
        // Keep the exact proof and command key when the response is lost: the server may already have created the run.
        prepared.current = { body, key: crypto.randomUUID() };
        onDirtyChange(true);
      }
      const control = new AbortController();
      const timer = window.setTimeout(() => control.abort(), 15000);
      let receipt: RunStartReceipt;
      try {
        receipt = await request<RunStartReceipt>('/runs', { method: 'POST', body: prepared.current.body,
          commandKey: prepared.current.key, csrf, signal: control.signal });
      } finally { window.clearTimeout(timer); }
      prepared.current = null; onDirtyChange(false); setUncertain(false);
      navigate('/runs/' + receipt.runId);
    } catch (err) {
      const unknownOutcome = !!prepared.current && (!(err instanceof ApiError) || err.status >= 500);
      setUncertain(unknownOutcome);
      if (unknownOutcome) setError('尚未收到启动结果，运行可能已经创建。请点击「重试确认启动」，系统会核对同一次请求，避免重复创建。');
      else { prepared.current = null; onDirtyChange(false); showError(err); }
    } finally { inFlight.current = false; setPending(false); }
  }

  return <>
    <Heading label="LAUNCH A MISSION" title="发起运行" text="选择交付目标与流程，由当前这台电脑承接运行。" />
    <div className="launch-layout">
      <div className="launch-steps">
        <section className="panel launch-step"><div className="step-heading"><span>01</span><h2>选择需求</h2></div>
          <div className="row"><Button disabled={locked} variant={!creating ? 'accent' : 'ghost'} onClick={() => setCreating(false)}>选择已有需求</Button>
            <Button disabled={locked} variant={creating ? 'accent' : 'ghost'} onClick={() => setCreating(true)}>添加新需求</Button></div>
          {creating ? <div className="form launch-form">
            <Field label="新需求名称"><input value={newName} maxLength={200} disabled={locked} onChange={e => setNewName(e.target.value)} /></Field>
            <Field label="所属项目"><select aria-label="所属项目" value={projectId} disabled={locked} onChange={e => setProjectId(e.target.value)}><option value="">请选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
            {projectError && <div><p role="alert" className="inline-error">{projectError}</p><Button onClick={() => setProjectRevision(n => n + 1)}>重新读取项目</Button></div>}
            <Button disabled={locked} onClick={() => void createRequirement()}>创建并选择需求</Button>
            {existingId && <Button disabled={locked} onClick={() => void select('requirements', existingId)}>选择已有的同名需求</Button>}
          </div> : <StartPicker kind="requirements" label="需求" purpose="start" selected={requirement} disabled={locked} onSelect={id => void select('requirements', id)} onUnauthorized={onUnauthorized} />}
          {requirement && <p className="selection-note">已选择：<strong>{requirement.name}</strong> · {linked ? requirement.repository!.displayName : '尚未关联仓库 · 新需求'}</p>}
        </section>
        <section className="panel launch-step"><div className="step-heading"><span>02</span><h2>确定工作类型</h2></div>
          <Field label="工作类型"><select aria-label="工作类型" value={workType} disabled={locked || !requirement || !linked} onChange={e => setWorkType(e.target.value as WorkType | '')}>
            <option value="">请选择工作类型</option>{Object.entries(workTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></Field>
          {requirement && !linked && <p className="subtle">未关联仓库的需求固定为新功能。系统将在 Git 准备阶段自动创建仓库。</p>}
          {linked && <p className="subtle">沿用需求关联的仓库；新功能、重构及常规修复从 dev 创建分支，紧急修复从仓库默认分支创建。</p>}
        </section>
        <section className="panel launch-step"><div className="step-heading"><span>03</span><h2>选择流程</h2></div>
          {requirement ? <StartPicker key={requirement.id} kind="flows" label="流程" purpose="use" requirementId={requirement.id} selected={flow} disabled={locked} onSelect={id => void select('flows', id)} onUnauthorized={onUnauthorized} /> : <p className="subtle">选择需求后，显示你有权限使用的流程。</p>}
          <p className="subtle">这里只能选已有流程。添加或调整流程请前往「流程配置」。</p>
          {flow && <div className="launch-flow-preview" aria-label="所选流程阶段">{stages.map((stage, i) => <div key={stage.id}><small>STAGE {String(i + 1).padStart(2, '0')}</small><strong>{stage.name}</strong><span>{stage.nodes.length} 个节点</span></div>)}</div>}
        </section>
        {requirement && flow && <section className="panel launch-step"><div className="step-heading"><span>04</span><h2>补齐启动信息</h2></div>
          <Field label={'需求说明' + (canDefer ? '（可在需求节点补充）' : '（启动前必填）')}><textarea rows={5} value={description} disabled={locked || !canEdit} onChange={e => setDescription(e.target.value)} /></Field>
          <p className="subtle">{canDefer ? '流程包含需求节点，可以先填写名称，运行到该节点时再细化需求。' : '流程不包含需求节点，需先补齐说明。启动时会保存你的修改。'}</p>
          {!linked && <Field label="GitHub 用户名或组织名"><input value={namespace} disabled={locked} autoComplete="off" placeholder="例如 your-team" onChange={e => setNamespace(e.target.value)} /></Field>}
          {!linked && <p className="subtle">新仓库设为公开；仓库名称与工作分支由系统按固定规则生成。</p>}
        </section>}
      </div>
      <aside className="panel launch-summary"><p className="eyebrow">MISSION BRIEF</p><h2>启动预览</h2>
        <dl><div><dt>需求</dt><dd>{requirement?.name ?? '待选择'}</dd></div><div><dt>工作类型</dt><dd>{workType ? workTypeLabels[workType] : '待选择'}</dd></div><div><dt>流程</dt><dd>{flow ? `${flow.name} · v${flow.workflowVersion ?? '待完善'}` : '待选择'}</dd></div><div><dt>执行设备</dt><dd>当前这台电脑</dd></div></dl>
        <p className="subtle">启动前会验证本机配对。创建运行后，先等待设备准备 Git 仓库与分支。</p>
        <p className="subtle">确认启动后，已启用 Git 执行的本机程序将按上述计划准备仓库与分支；真实 GitHub 模式会创建或修改远程仓库。</p>
        <Button disabled={pending || mutation.pending || selecting || !requirement || !flow || !workType || creating} variant="accent" onClick={() => void start()}>{pending ? '正在确认启动…' : uncertain ? '重试确认启动' : '确认并发起运行'}</Button>
        {error && <p role="alert" className="inline-error">{error}</p>}
        {!uncertain && <Button disabled={pending} onClick={() => navigate('/devices')}>前往本机设备</Button>}
        {!uncertain && requirement && <Button disabled={pending || selecting} onClick={() => void select('requirements', requirement.id)}>重新读取需求与权限</Button>}
      </aside>
    </div>
  </>;
}
