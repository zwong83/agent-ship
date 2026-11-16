import { Select } from './select';
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
  const canDefer = stages.some(stage => stage.nodes.some(node => node.collectRequirements ?? node.purpose === 'requirement'));
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
    setError(err instanceof ApiError ? errorText(err) : err instanceof Error ? err.message : 'The operation is not completed yet, please try again.');
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
    if (!newName.trim() || !projectId) { setError('Please fill in the requirement name and select the project.'); return; }
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
        setError('Please select a requirement, work type, and saved process first.'); return;
      }
      if (!requirement.allowedActions.includes('start') || !flow.allowedActions.includes('use')) {
        setError('The current account does not have the permission to initiate this request or use this process, please choose again.'); return;
      }
      if (!canDefer && !description.trim()) { setError('The selected process does not have a requirement node. Please complete the requirement description before starting.'); return; }
      if (!linked && !namespace.trim()) { setError('Please fill in the GitHub username or organization name used to automatically create the repository.'); return; }
      if (description.trim() !== (requirementData.description ?? '').trim() && !canEdit) {
        setError('If you do not have permission to edit this requirement, please contact the person in charge to complete the instructions.'); return;
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
      if (unknownOutcome) setError('Startup results have not been received yet, the run may have already been created. Please click "Retry to confirm startup" and the system will check the same request to avoid repeated creation.');
      else { prepared.current = null; onDirtyChange(false); showError(err); }
    } finally { inFlight.current = false; setPending(false); }
  }

  return <>
    <Heading label="LAUNCH A MISSION" title="Start a run" text="Select the delivery target and process, and the current computer will take over the operation." />
    <div className="launch-layout">
      <div className="launch-steps">
        <section className="panel launch-step"><div className="step-heading"><span>01</span><h2>Select a requirement</h2></div>
          <div className="row"><Button disabled={locked} variant={!creating ? 'accent' : 'ghost'} onClick={() => setCreating(false)}>Select an existing requirement</Button>
            <Button disabled={locked} variant={creating ? 'accent' : 'ghost'} onClick={() => setCreating(true)}>Create a requirement</Button></div>
          {creating ? <div className="form launch-form">
            <Field label="New requirement name"><input value={newName} maxLength={200} disabled={locked} onChange={e => setNewName(e.target.value)} /></Field>
            <Field label="Project"><Select aria-label="Project" value={projectId} disabled={locked} onChange={e => setProjectId(e.target.value)}><option value="">Select a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></Field>
            {projectError && <div><p role="alert" className="inline-error">{projectError}</p><Button onClick={() => setProjectRevision(n => n + 1)}>Reload projects</Button></div>}
            <Button disabled={locked} onClick={() => void createRequirement()}>Create and select requirement</Button>
            {existingId && <Button disabled={locked} onClick={() => void select('requirements', existingId)}>Select an existing requirement with the same name</Button>}
          </div> : <StartPicker kind="requirements" label="Requirements" purpose="start" selected={requirement} disabled={locked} onSelect={id => void select('requirements', id)} onUnauthorized={onUnauthorized} />}
          {requirement && <p className="selection-note">Selected:<strong>{requirement.name}</strong> · {linked ? requirement.repository!.displayName : 'No linked repository · New requirement'}</p>}
        </section>
        <section className="panel launch-step"><div className="step-heading"><span>02</span><h2>Choose a work type</h2></div>
          <Field label="Work type"><Select aria-label="Work type" value={workType} disabled={locked || !requirement || !linked} onChange={e => setWorkType(e.target.value as WorkType | '')}>
            <option value="">Please select Work type</option>{Object.entries(workTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select></Field>
          {requirement && !linked && <p className="subtle">Requirements without a repository start as new features. Git preparation will create and link the repository.</p>}
          {linked && <p className="subtle">The linked repository will be reused. Features, refactors, and fixes branch from dev; hotfixes branch from the repository default branch.</p>}
        </section>
        <section className="panel launch-step"><div className="step-heading"><span>03</span><h2>Select a workflow</h2></div>
          {requirement ? <StartPicker key={requirement.id} kind="flows" label="process" purpose="use" requirementId={requirement.id} selected={flow} disabled={locked} onSelect={id => void select('flows', id)} onUnauthorized={onUnauthorized} /> : <p className="subtle">Select a requirement to see available workflows.</p>}
          <p className="subtle">Select a saved workflow here. Create and edit workflows on the Workflows page.</p>
          {flow && <div className="launch-flow-preview" aria-label="Selected workflow stages">{stages.map((stage, i) => <div key={stage.id}><small>STAGE {String(i + 1).padStart(2, '0')}</small><strong>{stage.name}</strong><span>{stage.nodes.length} nodes</span></div>)}</div>}
        </section>
        {requirement && flow && <section className="panel launch-step"><div className="step-heading"><span>04</span><h2>Complete startup information</h2></div>
          <Field label={'Requirement description' + (canDefer ? '(can be added at the demand node)' : '(required before starting)')}><textarea rows={5} value={description} disabled={locked || !canEdit} onChange={e => setDescription(e.target.value)} /></Field>
          <p className="subtle">{canDefer ? 'The process contains a demand node. You can fill in the name first, and then refine the demand when running to this node.' : 'The process does not contain demand nodes, and the description needs to be completed first. Your changes will be saved on startup.'}</p>
          {!linked && <Field label="GitHub username or organization name"><input value={namespace} disabled={locked} autoComplete="off" placeholder="For example your-team" onChange={e => setNamespace(e.target.value)} /></Field>}
          {!linked && <p className="subtle">The new warehouse is set to public; the warehouse name and work branch are generated by the system according to fixed rules.</p>}
        </section>}
      </div>
      <aside className="panel launch-summary"><p className="eyebrow">MISSION BRIEF</p><h2>Start preview</h2>
        <dl><div><dt>Requirements</dt><dd>{requirement?.name ?? 'To be selected'}</dd></div><div><dt>Work type</dt><dd>{workType ? workTypeLabels[workType] : 'To be selected'}</dd></div><div><dt>process</dt><dd>{flow ? `${flow.name} · v${flow.workflowVersion ?? 'Incomplete'}` : 'To be selected'}</dd></div><div><dt>Execution device</dt><dd>This computer is currently</dd></div></dl>
        <p className="subtle">Pairing of the unit will be verified before starting. After creating and running, wait for the device to prepare the Git warehouse and branch.</p>
        <p className="subtle">After confirmation of startup, the native program that has enabled Git execution will prepare the warehouse and branches according to the above plan; the real GitHub mode will create or modify the remote warehouse.</p>
        <Button disabled={pending || mutation.pending || selecting || !requirement || !flow || !workType || creating} variant="accent" onClick={() => void start()}>{pending ? 'Confirming startup...' : uncertain ? 'Retry to confirm startup' : 'Confirm and initiate the run'}</Button>
        {error && <p role="alert" className="inline-error">{error}</p>}
        {!uncertain && <Button disabled={pending} onClick={() => navigate('/devices')}>Go to local device</Button>}
        {!uncertain && requirement && <Button disabled={pending || selecting} onClick={() => void select('requirements', requirement.id)}>Reread requirements and permissions</Button>}
      </aside>
    </div>
  </>;
}
