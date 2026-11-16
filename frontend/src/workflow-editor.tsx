import { Select } from './select';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type AgentChoice, type ConfigDetail, type FlowNode, type FlowStage, type Page } from './api';
import { Button, Field } from './ui';
import { useCommand } from './use-command';
import { dependencyIssue, moveItem, newNode, nodeTypeLabels, removeNodes, replaceNode, workflowIssues } from './workflow-model';
import { WorkflowMap } from './workflow-map';
import { NodeSettingsSection } from './node-settings-section';

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
  const [editorView, setEditorView] = useState<'stages' | 'node'>('stages');
  const settingsPanel = useRef<HTMLDivElement>(null);
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

  function selectNode(id: string) {
    setSelectedId(id);
    setEditorView('node');
  }

  useEffect(() => {
    if (editorView === 'node' && settingsPanel.current) {
      const top = settingsPanel.current.getBoundingClientRect().top;
      const navigationBottom = document.querySelector('.command-navigation')?.getBoundingClientRect().bottom ?? 0;
      if (window.matchMedia('(max-width: 1000px)').matches || top < navigationBottom + 16 || top > window.innerHeight / 2) {
        settingsPanel.current.scrollIntoView({ block: 'start' });
      }
    }
  }, [selectedId, editorView]);

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
    selectNode(node.id);
  }

  function deleteNode(node: FlowNode) {
    setConfirmation({ message: `Remove "${node.name}"? References to this node will be removed. Related conditional routes must be configured again.`, apply: () => {
      update(current => removeNodes(current, new Set([node.id])));
      if (selectedId === node.id) { setSelectedId(null); setEditorView('stages'); }
    } });
  }

  function deleteStage(stage: FlowStage) {
    setConfirmation({ message: `Remove stage "${stage.name}" and its ${stage.nodes.length} nodes? Related dependencies will be removed and conditional routes must be configured again.`, apply: () => {
      const removed = new Set(stage.nodes.map(node => node.id));
      update(current => removeNodes(current.filter(value => value.id !== stage.id), removed));
      if (selectedId && removed.has(selectedId)) { setSelectedId(null); setEditorView('stages'); }
    } });
  }

  function changeType(node: FlowNode, type: FlowNode['type']) {
    const apply = () => {
      const next: FlowNode = type === 'end'
        ? { id: node.id, name: node.name, type, dependencies: node.dependencies }
        : { ...node, type, collectRequirements: node.collectRequirements ?? node.purpose === 'requirement', coordinatorId: node.coordinatorId ?? '', agentIds: node.agentIds ?? [], agentOrder: node.agentOrder ?? 'parallel' };
      if (type !== 'check') delete next.checkRoutes;
      if (type !== 'publish') delete next.publication;
      update(current => replaceNode(current, next).map(stage => ({ ...stage, nodes: stage.nodes.map(value => {
        if (node.type === 'check' && type !== 'check' && value.route?.checkNodeId === node.id) {
          const clean = { ...value }; delete clean.route; return clean;
        }
        return value;
      }) })));
    };
    if (type === 'end' || node.type === 'check') setConfirmation({ message: 'Switching node types clears out unavailable Agents or checks route configurations. Are you sure to switch?', apply });
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
    if (!name.trim()) invalid.unshift('Please fill in the process name.');
    const available = new Set(catalog?.filter(agent => agent.availability !== 'unavailable').map(agent => agent.id));
    for (const node of nodes) {
      if (node.type === 'end') continue;
      if ([node.coordinatorId, ...(node.agentIds ?? [])].some(id => id && !available.has(id))) invalid.push(`Select an available, authorized agent for "${node.name}".`);
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
        if (Array.isArray(details?.issues)) setIssues(details.issues.map(issue => typeof issue === 'string' ? issue : String(issue.message ?? 'Please check the process configuration.')));
      }
      onError(err);
    }
  }

  return <section className="panel flow-editor" aria-label="Process editor">
    <div className="row between"><div><p className="eyebrow">WORKFLOW BUILDER</p><h2>{item ? item.name : 'Create New workflow configuration'}</h2></div>
      <span className="pill">{dirty ? 'Unsaved changes' : item ? item.workflowVersion == null ? 'Incomplete' : `Workflow version v${item.workflowVersion}` : 'New workflow'}</span></div>
    <form onSubmit={save} className="flow-form">
      <fieldset disabled={!canEdit || mutation.pending}>
        <Field label="Process name"><input name="flowName" value={name} onChange={event => { setName(event.target.value); markDirty(true); }} placeholder="For example: product development delivery" required /></Field>
        <div className="flow-toolbar"><div><strong>{stages.length}</strong> stage <span> / </span><strong>{nodes.length}</strong> node</div>
          <div className="actions"><Button onClick={() => { update(current => [...current, { id: crypto.randomUUID(), name: `Stage ${current.length + 1}`, nodes: [] }]); setEditorView('stages'); }}>Add stage</Button>
            <Button disabled={!stages.length || nodes.some(node => node.type === 'end')} onClick={() => addNode(stages[stages.length - 1].id, 'end')}>Add end node</Button></div></div>
        <div className="workflow-design-layout">
        <WorkflowMap stages={stages} selectedId={selectedId} select={selectNode} vertical
          onConnect={canEdit && !mutation.pending && !conflict ? (sourceId, targetId) => {
            if (dependencyIssue(stages, sourceId, targetId)) return;
            const target = nodes.find(node => node.id === targetId)!;
            updateNode({ ...target, dependencies: [...target.dependencies, sourceId] });
            selectNode(targetId);
          } : undefined} />
        <div className="flow-builder" ref={settingsPanel}>
          <nav className="editor-view-switch" aria-label="Workflow configuration view">
            <button type="button" aria-pressed={editorView === 'stages'} onClick={() => setEditorView('stages')}>Stages & nodes <span>{stages.length}</span></button>
            <button type="button" aria-pressed={editorView === 'node'} disabled={!selected} onClick={() => setEditorView('node')}>Node settings</button>
          </nav>
          {editorView === 'stages' && <div className="flow-stages">
            <div className="stage-list-intro"><h3>Build your sequence</h3><p>Organize stages here. Select a node to configure its details.</p></div>
            {stages.length === 0 && <div className="empty"><h3>Establish the first stage</h3><p>The stages advance in sequence. Multiple nodes can be added to each stage and then connected using dependencies.</p></div>}
            {stages.map((stage, index) => <section className="flow-stage-card" key={stage.id} aria-label={`stage ${index + 1}`}>
              <header><span className="flow-stage-index">{String(index + 1).padStart(2, '0')}</span>
                <input aria-label={`stage ${index + 1} name`} value={stage.name} onChange={event => update(current => current.map(value => value.id === stage.id ? { ...value, name: event.target.value } : value))} />
                <div className="flow-order"><button type="button" aria-label={`Moving up stage ${stage.name}`} disabled={index === 0} onClick={() => update(current => moveItem(current, index, -1))}>↑</button><button type="button" aria-label={`moving down stage ${stage.name}`} disabled={index === stages.length - 1} onClick={() => update(current => moveItem(current, index, 1))}>↓</button>
                  <button type="button" aria-label={`removal phase ${stage.name}`} onClick={() => deleteStage(stage)}>×</button></div></header>
              <div className="flow-node-list">
                {stage.nodes.map((node, nodeIndex) => <div key={node.id} className={'flow-node-card ' + (selectedId === node.id ? 'selected' : '')}>
                  <button type="button" className="flow-node-select" aria-label={`Edit node ${node.name}`} aria-pressed={selectedId === node.id} onClick={() => selectNode(node.id)}>
                    <span className={'flow-node-symbol ' + node.type}>{node.type === 'end' ? '◎' : node.type === 'check' ? '◇' : '▣'}</span>
                    <span><strong>{node.name || 'Unnamed node'}</strong><small>{nodeTypeLabels[node.type]}{node.type !== 'end' ? ` · ${(node.agentIds?.length ?? 0)} Sub-agent` : ''}</small></span>
                  </button>
                  <div className="flow-order"><button type="button" aria-label={`Move node up ${node.name}`} disabled={nodeIndex === 0} onClick={() => update(current => current.map(value => value.id === stage.id ? { ...value, nodes: moveItem(value.nodes, nodeIndex, -1) } : value))}>↑</button><button type="button" aria-label={`Move node down ${node.name}`} disabled={nodeIndex === stage.nodes.length - 1} onClick={() => update(current => current.map(value => value.id === stage.id ? { ...value, nodes: moveItem(value.nodes, nodeIndex, 1) } : value))}>↓</button><button type="button" aria-label={`Remove node ${node.name}`} onClick={() => deleteNode(node)}>×</button></div>
                </div>)}
                {!stage.nodes.length && <p className="subtle">There are no nodes at this stage yet.</p>}
                <button type="button" className="flow-add-node" onClick={() => addNode(stage.id)}>Add node</button>
              </div>
            </section>)}
          </div>}
          {editorView === 'node' && <aside className="flow-inspector" aria-label="Node settings">
            {selected ? <NodeInspector key={selected.id} node={selected} stages={stages} stageIndex={selectedStage} catalog={catalog} catalogError={catalogError}
              retryCatalog={() => { setCatalog(null); setCatalogError(''); setCatalogRevision(value => value + 1); }}
              update={updateNode} changeType={type => changeType(selected, type)} changeRoute={(outcome, entry) => changeRoute(selected, outcome, entry)} />
              : <div className="inspector-empty"><span>⌘</span><h3>Select a node</h3><p>Select a node in the stage list or flow chart to set dependencies, coordinators and sub-agents.</p></div>}
          </aside>}
        </div>
        </div>
      </fieldset>
      {issues.length > 0 && <div className="inline-error" role="alert"><strong>The process cannot be saved yet</strong><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {conflict && onRefresh && <Button onClick={() => setConfirmation({ message: 'Rereading replaces currently unsaved modifications. Are you sure you want to read the latest version?', apply: onRefresh })}>Read the latest version and edit again</Button>}
      <div className="flow-savebar"><p>Verify dependencies and role permissions when saving, and retain independent process versions.</p>{canEdit && <button className="accent" disabled={mutation.pending || conflict || catalog === null}>{mutation.pending ? 'Saving…' : 'Save process'}</button>}</div>
    </form>
    {confirmation && <ConfirmDialog confirmation={confirmation} close={() => setConfirmation(null)} />}
  </section>;
}

function ConfirmDialog({ confirmation, close }: { confirmation: Confirmation; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="flow-confirm" ref={dialog} onCancel={close} aria-labelledby="flow-confirm-title">
    <h3 id="flow-confirm-title">Confirm modification process</h3><p>{confirmation.message}</p><div className="actions"><Button onClick={close}>Cancel</Button><Button variant="accent" onClick={() => { confirmation.apply(); close(); }}>Confirm changes</Button></div>
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

  return <div className="node-settings-content">
    <header className="node-settings-heading"><p className="eyebrow">STAGE {String(stageIndex + 1).padStart(2, '0')} / {stages[stageIndex]?.name}</p><h3>{node.name || 'Unnamed node'}</h3><p>Changes update this node in the network. Save the workflow to keep them.</p></header>
    <NodeSettingsSection number="01" title="Basics" description="Name this step and choose what it does." initiallyOpen>
    <Field label="Node name"><input value={node.name} onChange={event => update({ ...node, name: event.target.value })} required /></Field>
    <Field label="Node type"><Select aria-label="Node type" value={node.type} onChange={event => changeType(event.target.value as FlowNode['type'])}>
      <option value="work">Work node</option><option value="check">Check node</option><option value="end">End node</option>{node.type === 'publish' && <option value="publish">Publish node (not available yet)</option>}
    </Select></Field>
    </NodeSettingsSection>
    <NodeSettingsSection number="02" title="Dependencies" description="Choose what must finish before this node starts." badge={`${node.dependencies.length} linked`}><p className="field-help">Drag connections in the network or check nodes below. Uncheck to disconnect.</p>
      <div className="choice-list">{dependencies.map(value => {
        const checked = node.dependencies.includes(value.id);
        const issue = checked ? null : dependencyIssue(stages, value.id, node.id);
        return <label className="choice-row" key={value.id} title={issue ?? undefined}><input type="checkbox" aria-label={`Predecessor node ${value.name}`} checked={checked} disabled={Boolean(issue)} onChange={event => update({ ...node, dependencies: event.target.checked ? [...node.dependencies, value.id] : node.dependencies.filter(id => id !== value.id) })} /><span>{value.name}{issue && <small>{issue}</small>}</span></label>;
      })}
        {missingDependencies.map(id => <label className="choice-row missing-choice" key={id}><input type="checkbox" checked aria-label="Remove invalid preceding node" onChange={() => update({ ...node, dependencies: node.dependencies.filter(value => value !== id) })} /><span>Invalid or later stage predecessor node</span></label>)}
        {!dependencies.length && !missingDependencies.length && <p className="subtle">No earlier nodes available. This step can start without a dependency.</p>}</div>
    </NodeSettingsSection>
    {node.type === 'end' ? <p className="gate">The end node only marks the completion of the process. Please place it at the end of the final stage and connect the preceding nodes that need to be merged.</p> : <>
      <NodeSettingsSection number="03" title="Agent team" description="Assign a coordinator, then add supporting agents." badge={node.coordinatorId ? `${selectedAgents.length + 1} assigned` : 'Coordinator required'}>
        {catalogError && <div className="grid"><p role="alert" className="inline-error">{catalogError}</p><Button onClick={retryCatalog}>Retry loading agents</Button></div>}
        {!catalog && !catalogError && <p role="status">Loading available agents…</p>}
        <Field label="Coordinator"><Select aria-label="Coordinator" value={node.coordinatorId ?? ''} onChange={event => update({ ...node, coordinatorId: event.target.value, agentIds: selectedAgents.filter(id => id !== event.target.value) })}>
          <option value="">Please select the coordinator</option>{node.coordinatorId && !agentsById.has(node.coordinatorId) && <option value={node.coordinatorId}>The Agent is no longer authorized to be used. Please select again.</option>}
          {choices.map(agent => <option key={agent.id} value={agent.id} disabled={agent.availability === 'unavailable'}>{agent.name}{agent.availability === 'unavailable' ? '(not available)' : ''}</option>)}
        </Select></Field><p className="field-help">Required. The coordinator brings together this node’s results.</p>
        <div className="agent-select"><div className="row between"><label htmlFor={`agent-search-${node.id}`}>Supporting agents <small>Optional</small></label><span className="pill">Selected {selectedAgents.length}</span></div>
          <input id={`agent-search-${node.id}`} type="search" value={agentSearch} onChange={event => setAgentSearch(event.target.value)} placeholder="Search for role name or description" />
          <div className="choice-list">{displayedAgents.map(agent => <label className="choice-row" key={agent.id}><input type="checkbox" checked={selectedAgents.includes(agent.id)} disabled={agent.availability === 'unavailable'} onChange={event => update({ ...node, agentIds: event.target.checked ? [...selectedAgents, agent.id] : selectedAgents.filter(id => id !== agent.id) })} /><span>{agent.name}<small>{agent.availability === 'unavailable' ? 'Currently unavailable' : agent.description}</small></span></label>)}
            {catalog && !displayedAgents.length && <p className="subtle">There are no eligible optional roles.</p>}</div>
        </div>
        <Field label="Sub-agent execution mode"><Select aria-label="Sub-agent execution mode" value={node.agentOrder ?? 'parallel'} onChange={event => update({ ...node, agentOrder: event.target.value as FlowNode['agentOrder'] })}><option value="parallel">Parallel execution (default)</option><option value="serial">Execute in order</option></Select></Field>
        {selectedAgents.length > 0 && <ol className="selected-agents">{selectedAgents.map((id, index) => <li key={id}><span>{agentsById.get(id)?.name ?? 'Agent that no longer has permission to use'}</span><div className="flow-order">
          {node.agentOrder === 'serial' && <><button type="button" disabled={index === 0} aria-label={`move up ${agentsById.get(id)?.name ?? 'Unavailable role'}`} onClick={() => update({ ...node, agentIds: moveItem(selectedAgents, index, -1) })}>↑</button><button type="button" disabled={index === selectedAgents.length - 1} aria-label={`move down ${agentsById.get(id)?.name ?? 'Unavailable role'}`} onClick={() => update({ ...node, agentIds: moveItem(selectedAgents, index, 1) })}>↓</button></>}
          <button type="button" aria-label={`Remove sub-agent ${agentsById.get(id)?.name ?? 'Unavailable role'}`} onClick={() => update({ ...node, agentIds: selectedAgents.filter(value => value !== id) })}>×</button>
        </div></li>)}</ol>}
      </NodeSettingsSection>
      <NodeSettingsSection number="04" title="Workflow behavior" description="Choose whether this step gathers requirement details." badge={(node.collectRequirements ?? node.purpose === 'requirement') ? 'Gathering enabled' : 'Standard'}>
        <label className="choice-row"><input type="checkbox" checked={node.collectRequirements ?? node.purpose === 'requirement'} onChange={event => update({ ...node, collectRequirements: event.target.checked })} /><span>Gather requirement details<small>Allow a requirement to start without a description. This step must produce a description before it can finish.</small></span></label>
        <p className="field-help">File access is controlled by each agent’s Workspace access permission. Check coordinators always review in read-only mode.</p>
      </NodeSettingsSection>
      {node.type === 'check' && <NodeSettingsSection number="05" title="Check outcomes" description="Choose where work goes after a pass or a repair request." badge={route.passNodeId && route.repairNodeId ? 'Configured' : 'Routes required'}>
        <Field label="Pass destination"><Select aria-label="Pass destination" value={route.passNodeId} onChange={event => changeRoute('pass', event.target.value)}><option value="">Select the next node after a pass</option>{allNodes.filter(value => value.id !== node.id && value.type !== 'end').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</Select></Field>
        <Field label="Repair destination"><Select aria-label="Repair destination" value={route.repairNodeId} onChange={event => changeRoute('repair', event.target.value)}><option value="">Select the next node for repairs</option>{allNodes.filter(value => value.id !== node.id && value.type !== 'end').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</Select></Field>
        <Field label="Repair attempt limit"><input type="number" min="0" step="1" value={route.automaticRepairLimit} onChange={event => update({ ...node, checkRoutes: { ...route, automaticRepairLimit: event.target.value === '' ? -1 : Number(event.target.value) } })} /></Field>
        <small>The first repair counts as round 1. Wait for manual processing after reaching the upper limit.</small>
      </NodeSettingsSection>}
    </>}
    {node.type !== 'end' && <NodeSettingsSection number={node.type === 'check' ? '06' : '05'} title="Conditional routing" description="Limit this node to a check outcome." badge={node.route ? `${node.route.outcome === 'pass' ? 'Pass' : 'Repair'} branch` : 'Optional'}><p className="field-help">Use this only when the node belongs to a check node’s pass or repair branch.</p>
      <Field label="Branch check"><Select aria-label="Branch check" value={node.route?.checkNodeId ?? ''} onChange={event => {
        const next = { ...node };
        if (event.target.value) next.route = { checkNodeId: event.target.value, outcome: node.route?.outcome ?? 'pass' };
        else delete next.route;
        update(next);
      }}><option value="">No conditional branch</option>{allNodes.filter(value => value.type === 'check' && value.id !== node.id).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</Select></Field>
      {node.route && <Field label="Branch outcome"><Select aria-label="Branch outcome" value={node.route.outcome} onChange={event => update({ ...node, route: { ...node.route!, outcome: event.target.value as 'pass' | 'repair' } })}><option value="pass">Pass branch</option><option value="repair">Repair branch</option></Select></Field>}
    </NodeSettingsSection>}
  </div>;
}
