import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type AgentChoice, type ConfigDetail, type FlowNode, type FlowStage, type Page } from './api';
import { Button, Field } from './ui';
import { useCommand } from './use-command';
import { moveItem, newNode, nodePurposeLabels, nodeTypeLabels, removeNodes, replaceNode, workflowIssues } from './workflow-model';
import { WorkflowMap } from './workflow-map';

type Props = {
  csrf: string;
  item?: ConfigDetail;
  onError: (error: unknown) => void;
  onUnauthorized: () => void;
  onSaved: (item: ConfigDetail) => void;
  onRefresh?: () => void;
  onDirtyChange?: (value: boolean) => void;
};

type Confirmation = { message: string; apply: () => void };

export function WorkflowEditor({ csrf, item, onError, onUnauthorized, onSaved, onRefresh, onDirtyChange }: Props) {
  const [name, setName] = useState(item?.name ?? '');
  const [stages, setStages] = useState<FlowStage[]>(() => item && 'stages' in item.data ? structuredClone(item.data.stages) : []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AgentChoice[] | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const mutation = useCommand(csrf);
  const canEdit = !item || item.allowedActions.includes('edit');
  const nodes = stages.flatMap(stage => stage.nodes);
  const selected = nodes.find(node => node.id === selectedId);
  const selectedStage = stages.findIndex(stage => stage.nodes.some(node => node.id === selectedId));

  useEffect(() => {
    const control = new AbortController();
    async function loadCatalog() {
      const choices: AgentChoice[] = [];
      let cursor: string | undefined;
      do {
        const result: Page<AgentChoice> = await request(queryPath('/catalog', { flowId: item?.id, cursor, pageSize: '50' }), { signal: control.signal });
        choices.push(...result.items);
        cursor = result.nextCursor ?? undefined;
      } while (cursor && !control.signal.aborted);
      if (!control.signal.aborted) setCatalog(choices);
    }
    void loadCatalog().catch(err => {
      if (control.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setCatalogError(errorText(err));
    });
    return () => control.abort();
  }, [item?.id, onUnauthorized, catalogRevision]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function markDirty(value: boolean) {
    dirtyRef.current = value;
    setDirty(value);
    onDirtyChange?.(value);
  }

  function update(next: FlowStage[] | ((current: FlowStage[]) => FlowStage[])) {
    setStages(next);
    markDirty(true);
    setIssues([]);
    setError('');
  }

  function updateNode(node: FlowNode) {
    update(current => replaceNode(current, node));
  }

  function addNode(stageId: string, type: FlowNode['type'] = 'work') {
    const node = newNode(type);
    update(current => current.map(stage => stage.id === stageId ? { ...stage, nodes: [...stage.nodes, node] } : stage));
    setSelectedId(node.id);
  }

  function deleteNode(node: FlowNode) {
    setConfirmation({ message: `移除「${node.name}」后，引用它的前置依赖会一并移除，相关条件路线需要重新设置。`, apply: () => {
      update(current => removeNodes(current, new Set([node.id])));
      if (selectedId === node.id) setSelectedId(null);
    } });
  }

  function deleteStage(stage: FlowStage) {
    setConfirmation({ message: `移除阶段「${stage.name}」及其中 ${stage.nodes.length} 个节点？相关前置依赖会一并移除，条件路线需要重新设置。`, apply: () => {
      const removed = new Set(stage.nodes.map(node => node.id));
      update(current => removeNodes(current.filter(value => value.id !== stage.id), removed));
      if (selectedId && removed.has(selectedId)) setSelectedId(null);
    } });
  }

  function changeType(node: FlowNode, type: FlowNode['type']) {
    const apply = () => {
      const next: FlowNode = type === 'end'
        ? { id: node.id, name: node.name, type, dependencies: node.dependencies }
        : { ...node, type, purpose: node.purpose ?? 'other', coordinatorId: node.coordinatorId ?? '', agentIds: node.agentIds ?? [], agentOrder: node.agentOrder ?? 'parallel' };
      if (type !== 'check') delete next.checkRoutes;
      if (type !== 'publish') delete next.publication;
      update(current => replaceNode(current, next).map(stage => ({ ...stage, nodes: stage.nodes.map(value => {
        if (node.type === 'check' && type !== 'check' && value.route?.checkNodeId === node.id) {
          const clean = { ...value }; delete clean.route; return clean;
        }
        return value;
      }) })));
    };
    if (type === 'end' || node.type === 'check') setConfirmation({ message: '切换节点类型会清除不适用的 Agent 或检查路线配置。确定切换？', apply });
    else apply();
  }

  function changeRoute(node: FlowNode, outcome: 'pass' | 'repair', entry: string) {
    const routes = node.checkRoutes ?? { passNodeId: '', repairNodeId: '', automaticRepairLimit: 3 };
    const next = { ...node, checkRoutes: { ...routes, [outcome === 'pass' ? 'passNodeId' : 'repairNodeId']: entry } };
    const oldEntry = outcome === 'pass' ? routes.passNodeId : routes.repairNodeId;
    update(current => replaceNode(current, next).map(stage => ({ ...stage, nodes: stage.nodes.map(value => {
      if (value.id === entry) return { ...value, route: { checkNodeId: node.id, outcome } };
      if (value.id === oldEntry && value.route?.checkNodeId === node.id && value.route.outcome === outcome) {
        const clean = { ...value }; delete clean.route; return clean;
      }
      return value;
    }) })));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.pending || conflict || !canEdit) return;
    const invalid = workflowIssues(stages);
    if (!name.trim()) invalid.unshift('请填写流程名称。');
    const available = new Set(catalog?.filter(agent => agent.availability !== 'unavailable').map(agent => agent.id));
    for (const node of nodes) {
      if (node.type === 'end') continue;
      if ([node.coordinatorId, ...(node.agentIds ?? [])].some(id => id && !available.has(id))) invalid.push(`「${node.name}」有不可用或无权使用的 Agent，请重新选择。`);
    }
    setIssues(invalid);
    setError('');
    if (invalid.length) return;
    try {
      const saved = await mutation.send<ConfigDetail>(configPath('flows', item?.id), item ? 'PATCH' : 'POST', {
        name: name.trim(), data: { stages }, ...(item ? { expectedVersion: item.version } : {}),
      });
      markDirty(false);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError) {
        setConflict(err.problem?.code === 'STALE_VERSION');
        const details = err.problem?.details;
        if (Array.isArray(details?.issues)) setIssues(details.issues.map(issue => typeof issue === 'string' ? issue : String(issue.message ?? '请检查流程配置。')));
      }
      onError(err);
    }
  }

  return <section className="panel flow-editor" aria-label="流程编辑器">
    <div className="row between"><div><p className="eyebrow">WORKFLOW BUILDER</p><h2>{item ? item.name : '新建流程配置'}</h2></div>
      <span className="pill">{dirty ? '有未保存的修改' : item ? item.workflowVersion == null ? '待完善' : `流程版本 v${item.workflowVersion}` : '新流程'}</span></div>
    <form onSubmit={save} className="flow-form">
      <fieldset disabled={!canEdit || mutation.pending}>
        <Field label="流程名称"><input name="flowName" value={name} onChange={event => { setName(event.target.value); markDirty(true); }} placeholder="例如：产品研发交付" required /></Field>
        <div className="flow-toolbar"><div><strong>{stages.length}</strong> 阶段 <span> / </span><strong>{nodes.length}</strong> 节点</div>
          <div className="actions"><Button onClick={() => update(current => [...current, { id: crypto.randomUUID(), name: `阶段 ${current.length + 1}`, nodes: [] }])}>添加阶段</Button>
            <Button disabled={!stages.length || nodes.some(node => node.type === 'end')} onClick={() => addNode(stages[stages.length - 1].id, 'end')}>添加结束节点</Button></div></div>
        <WorkflowMap stages={stages} selectedId={selectedId} select={setSelectedId} />
        <div className="flow-builder">
          <div className="flow-stages">
            {stages.length === 0 && <div className="empty"><h3>建立第一个阶段</h3><p>阶段依次推进。每个阶段中可以添加多个节点，再用依赖连接它们。</p></div>}
            {stages.map((stage, index) => <section className="flow-stage-card" key={stage.id} aria-label={`阶段 ${index + 1}`}>
              <header><span className="flow-stage-index">{String(index + 1).padStart(2, '0')}</span>
                <input aria-label={`阶段 ${index + 1} 名称`} value={stage.name} onChange={event => update(current => current.map(value => value.id === stage.id ? { ...value, name: event.target.value } : value))} />
                <div className="flow-order"><button type="button" aria-label={`上移阶段 ${stage.name}`} disabled={index === 0} onClick={() => update(current => moveItem(current, index, -1))}>↑</button><button type="button" aria-label={`下移阶段 ${stage.name}`} disabled={index === stages.length - 1} onClick={() => update(current => moveItem(current, index, 1))}>↓</button>
                  <button type="button" aria-label={`移除阶段 ${stage.name}`} onClick={() => deleteStage(stage)}>×</button></div></header>
              <div className="flow-node-list">
                {stage.nodes.map((node, nodeIndex) => <div key={node.id} className={'flow-node-card ' + (selectedId === node.id ? 'selected' : '')}>
                  <button type="button" className="flow-node-select" aria-label={`编辑节点 ${node.name}`} aria-pressed={selectedId === node.id} onClick={() => setSelectedId(node.id)}>
                    <span className={'flow-node-symbol ' + node.type}>{node.type === 'end' ? '◎' : node.type === 'check' ? '◇' : '▣'}</span>
                    <span><strong>{node.name || '未命名节点'}</strong><small>{nodeTypeLabels[node.type]}{node.type !== 'end' ? ` · ${(node.agentIds?.length ?? 0)} 子 Agent` : ''}</small></span>
                  </button>
                  <div className="flow-order"><button type="button" aria-label={`上移节点 ${node.name}`} disabled={nodeIndex === 0} onClick={() => update(current => current.map(value => value.id === stage.id ? { ...value, nodes: moveItem(value.nodes, nodeIndex, -1) } : value))}>↑</button><button type="button" aria-label={`下移节点 ${node.name}`} disabled={nodeIndex === stage.nodes.length - 1} onClick={() => update(current => current.map(value => value.id === stage.id ? { ...value, nodes: moveItem(value.nodes, nodeIndex, 1) } : value))}>↓</button><button type="button" aria-label={`移除节点 ${node.name}`} onClick={() => deleteNode(node)}>×</button></div>
                </div>)}
                {!stage.nodes.length && <p className="subtle">此阶段还没有节点。</p>}
                <button type="button" className="flow-add-node" onClick={() => addNode(stage.id)}>添加节点</button>
              </div>
            </section>)}
          </div>
          <aside className="flow-inspector" aria-label="节点设置">
            {selected ? <NodeInspector key={selected.id} node={selected} stages={stages} stageIndex={selectedStage} catalog={catalog} catalogError={catalogError}
              retryCatalog={() => { setCatalog(null); setCatalogError(''); setCatalogRevision(value => value + 1); }}
              update={updateNode} changeType={type => changeType(selected, type)} changeRoute={(outcome, entry) => changeRoute(selected, outcome, entry)} />
              : <div className="inspector-empty"><span>⌘</span><h3>选择一个节点</h3><p>在阶段列表或流程图中选择节点，设置依赖、协调 Agent 和子 Agent。</p></div>}
          </aside>
        </div>
      </fieldset>
      {issues.length > 0 && <div className="inline-error" role="alert"><strong>流程还不能保存</strong><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {conflict && onRefresh && <Button onClick={() => setConfirmation({ message: '重新读取会替换当前未保存的修改。确定读取最新版本？', apply: onRefresh })}>读取最新版本并重新编辑</Button>}
      <div className="flow-savebar"><p>保存时校验依赖和角色权限，并保留独立的流程版本。</p>{canEdit && <button className="accent" disabled={mutation.pending || conflict || catalog === null}>{mutation.pending ? '保存中…' : '保存流程'}</button>}</div>
    </form>
    {confirmation && <ConfirmDialog confirmation={confirmation} close={() => setConfirmation(null)} />}
  </section>;
}

function ConfirmDialog({ confirmation, close }: { confirmation: Confirmation; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="flow-confirm" ref={dialog} onCancel={close} aria-labelledby="flow-confirm-title">
    <h3 id="flow-confirm-title">确认修改流程</h3><p>{confirmation.message}</p><div className="actions"><Button onClick={close}>取消</Button><Button variant="accent" onClick={() => { confirmation.apply(); close(); }}>确认修改</Button></div>
  </dialog>;
}

function NodeInspector({ node, stages, stageIndex, catalog, catalogError, retryCatalog, update, changeType, changeRoute }: {
  node: FlowNode; stages: FlowStage[]; stageIndex: number; catalog: AgentChoice[] | null; catalogError: string;
  retryCatalog: () => void; update: (node: FlowNode) => void; changeType: (type: FlowNode['type']) => void;
  changeRoute: (outcome: 'pass' | 'repair', entry: string) => void;
}) {
  const [agentSearch, setAgentSearch] = useState('');
  const allNodes = stages.flatMap(stage => stage.nodes);
  const dependencies = stages.slice(0, stageIndex + 1).flatMap(stage => stage.nodes).filter(value => value.id !== node.id && value.type !== 'end');
  const choices = catalog ?? [];
  const agentsById = new Map(choices.map(agent => [agent.id, agent]));
  const route = node.checkRoutes ?? { passNodeId: '', repairNodeId: '', automaticRepairLimit: 3 };
  const selectedAgents = node.agentIds ?? [];
  const missingDependencies = node.dependencies.filter(id => !dependencies.some(value => value.id === id));
  const displayedAgents = choices.filter(agent => agent.id !== node.coordinatorId && (agent.name + ' ' + (agent.description ?? '')).toLowerCase().includes(agentSearch.toLowerCase()));

  return <div className="grid">
    <div><p className="eyebrow">NODE SETTINGS</p><h3>节点设置</h3></div>
    <Field label="节点名称"><input value={node.name} onChange={event => update({ ...node, name: event.target.value })} required /></Field>
    <Field label="节点类型"><select aria-label="节点类型" value={node.type} onChange={event => changeType(event.target.value as FlowNode['type'])}>
      <option value="work">工作节点</option><option value="check">检查节点</option><option value="end">结束节点</option>{node.type === 'publish' && <option value="publish">发布节点（暂不可用）</option>}
    </select></Field>
    {node.type !== 'end' && <Field label="节点用途"><select aria-label="节点用途" value={node.purpose ?? 'other'} onChange={event => update({ ...node, purpose: event.target.value as FlowNode['purpose'] })}>{Object.entries(nodePurposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
    <div className="inspector-section"><h3>前置依赖</h3><p className="field-help">选择同阶段或更早阶段的节点。所有前置节点交出最终产物后，当前节点才可开始。</p>
      <div className="choice-list">{dependencies.map(value => <label className="choice-row" key={value.id}><input type="checkbox" aria-label={`前置节点 ${value.name}`} checked={node.dependencies.includes(value.id)} onChange={event => update({ ...node, dependencies: event.target.checked ? [...node.dependencies, value.id] : node.dependencies.filter(id => id !== value.id) })} /><span>{value.name}</span></label>)}
        {missingDependencies.map(id => <label className="choice-row missing-choice" key={id}><input type="checkbox" checked aria-label="移除无效前置节点" onChange={() => update({ ...node, dependencies: node.dependencies.filter(value => value !== id) })} /><span>无效或更晚阶段的前置节点</span></label>)}
        {!dependencies.length && !missingDependencies.length && <p className="subtle">暂无可选择的前置节点。</p>}</div>
    </div>
    {node.type === 'end' ? <p className="gate">结束节点只标记流程完成。请放在最后阶段的末尾，并连接需要汇合的前置节点。</p> : <>
      <div className="inspector-section"><h3>Agent 协作</h3><p className="field-help">协调 Agent 汇总节点产物，子 Agent 按选定角色参与。</p>
        {catalogError && <div className="grid"><p role="alert" className="inline-error">{catalogError}</p><Button onClick={retryCatalog}>重新读取 Agent</Button></div>}
        {!catalog && !catalogError && <p role="status">读取有权使用的 Agent…</p>}
        <Field label="协调 Agent"><select aria-label="协调 Agent" value={node.coordinatorId ?? ''} onChange={event => update({ ...node, coordinatorId: event.target.value, agentIds: selectedAgents.filter(id => id !== event.target.value) })}>
          <option value="">请选择协调 Agent</option>{node.coordinatorId && !agentsById.has(node.coordinatorId) && <option value={node.coordinatorId}>已无权使用的 Agent · 请重新选择</option>}
          {choices.map(agent => <option key={agent.id} value={agent.id} disabled={agent.availability === 'unavailable'}>{agent.name}{agent.availability === 'unavailable' ? '（不可用）' : ''}</option>)}
        </select></Field>
        <div className="agent-select"><div className="row between"><label htmlFor={`agent-search-${node.id}`}>子 Agent</label><span className="pill">已选 {selectedAgents.length}</span></div>
          <input id={`agent-search-${node.id}`} type="search" value={agentSearch} onChange={event => setAgentSearch(event.target.value)} placeholder="搜索角色名称或说明" />
          <div className="choice-list">{displayedAgents.map(agent => <label className="choice-row" key={agent.id}><input type="checkbox" checked={selectedAgents.includes(agent.id)} disabled={agent.availability === 'unavailable'} onChange={event => update({ ...node, agentIds: event.target.checked ? [...selectedAgents, agent.id] : selectedAgents.filter(id => id !== agent.id) })} /><span>{agent.name}<small>{agent.availability === 'unavailable' ? '当前不可用' : agent.description}</small></span></label>)}
            {catalog && !displayedAgents.length && <p className="subtle">没有符合条件的可选角色。</p>}</div>
        </div>
        <Field label="子 Agent 执行方式"><select aria-label="子 Agent 执行方式" value={node.agentOrder ?? 'parallel'} onChange={event => update({ ...node, agentOrder: event.target.value as FlowNode['agentOrder'] })}><option value="parallel">并行执行（默认）</option><option value="serial">按顺序执行</option></select></Field>
        {selectedAgents.length > 0 && <ol className="selected-agents">{selectedAgents.map((id, index) => <li key={id}><span>{agentsById.get(id)?.name ?? '已无权使用的 Agent'}</span><div className="flow-order">
          {node.agentOrder === 'serial' && <><button type="button" disabled={index === 0} aria-label={`上移 ${agentsById.get(id)?.name ?? '不可用角色'}`} onClick={() => update({ ...node, agentIds: moveItem(selectedAgents, index, -1) })}>↑</button><button type="button" disabled={index === selectedAgents.length - 1} aria-label={`下移 ${agentsById.get(id)?.name ?? '不可用角色'}`} onClick={() => update({ ...node, agentIds: moveItem(selectedAgents, index, 1) })}>↓</button></>}
          <button type="button" aria-label={`移除子 Agent ${agentsById.get(id)?.name ?? '不可用角色'}`} onClick={() => update({ ...node, agentIds: selectedAgents.filter(value => value !== id) })}>×</button>
        </div></li>)}</ol>}
      </div>
      {node.type === 'check' && <div className="inspector-section grid"><h3>检查结果路线</h3><p className="field-help">两条路线都需要配置。选择入口后会同时标记入口节点所属路线。</p>
        <Field label="通过后进入"><select aria-label="通过后进入" value={route.passNodeId} onChange={event => changeRoute('pass', event.target.value)}><option value="">请选择通过路线入口</option>{allNodes.filter(value => value.id !== node.id && value.type !== 'end').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></Field>
        <Field label="需修复时进入"><select aria-label="需修复时进入" value={route.repairNodeId} onChange={event => changeRoute('repair', event.target.value)}><option value="">请选择修复路线入口</option>{allNodes.filter(value => value.id !== node.id && value.type !== 'end').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></Field>
        <Field label="自动修复上限"><input type="number" min="0" step="1" value={route.automaticRepairLimit} onChange={event => update({ ...node, checkRoutes: { ...route, automaticRepairLimit: event.target.value === '' ? -1 : Number(event.target.value) } })} /></Field>
        <small>第一次修复计为第 1 轮。到达上限后等待人工处理。</small>
      </div>}
    </>}
    {node.type !== 'end' && <div className="inspector-section grid"><h3>所属条件路线</h3><p className="field-help">普通节点可保持不属于条件路线。路线内的后续节点需选择对应检查及结果。</p>
      <Field label="所属检查节点"><select aria-label="所属检查节点" value={node.route?.checkNodeId ?? ''} onChange={event => {
        const next = { ...node };
        if (event.target.value) next.route = { checkNodeId: event.target.value, outcome: node.route?.outcome ?? 'pass' };
        else delete next.route;
        update(next);
      }}><option value="">不属于条件路线</option>{allNodes.filter(value => value.type === 'check' && value.id !== node.id).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></Field>
      {node.route && <Field label="所属路线结果"><select aria-label="所属路线结果" value={node.route.outcome} onChange={event => update({ ...node, route: { ...node.route!, outcome: event.target.value as 'pass' | 'repair' } })}><option value="pass">通过路线</option><option value="repair">需修复路线</option></select></Field>}
    </div>}
  </div>;
}
