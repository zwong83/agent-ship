import type { WorkspaceAccess } from './api';
import { Select } from './select';
import { useId, useRef, useState } from 'react';

type Props = { name?: string; roleKey?: string; description?: string; skillRef?: string; workspaceAccess?: WorkspaceAccess };

export function AgentFields({ name, roleKey, description = '', skillRef, workspaceAccess = 'read_only' }: Props) {
  const id = useId();
  const [access, setAccess] = useState<WorkspaceAccess>(workspaceAccess);
  const [instructions, setInstructions] = useState(description);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  return <div className="agent-field-grid">
    <section className="agent-config-card agent-identity" aria-labelledby={id + '-identity'}>
      <header><span className="agent-step" aria-hidden="true">01</span><div><h3 id={id + '-identity'}>Identity & role</h3><p>Give this agent a recognizable name and a unique role.</p></div><span className="agent-field-tag">Required</span></header>
      <div className="agent-identity-fields">
        <div><label htmlFor={id + '-name'}>Agent name</label><input id={id + '-name'} name="name" defaultValue={name} placeholder="e.g. Frontend engineer" maxLength={120} required aria-describedby={id + '-name-help'} />
          <p className="agent-field-help" id={id + '-name-help'}>Shown in workflows and agent selection.</p></div>
        <div><label htmlFor={id + '-role'}>Role ID {roleKey && <span className="agent-field-tag">Locked</span>}</label><input id={id + '-role'} name="roleKey" defaultValue={roleKey} placeholder="e.g. frontend-engineer" maxLength={150} readOnly={roleKey !== undefined} required spellCheck={false} aria-describedby={id + '-role-help'} />
          <p className="agent-field-help" id={id + '-role-help'}>{roleKey ? 'This identifier stays fixed. You can update the name and instructions.' : 'A unique identifier. It cannot be changed after creation.'}</p></div>
      </div>
    </section>
    <section className="agent-config-card" aria-labelledby={id + '-instructions'}>
      <header><span className="agent-step" aria-hidden="true">02</span><div><h3 id={id + '-instructions'}>Role instructions</h3><p>Describe the work this agent should own.</p></div></header>
      <label htmlFor={id + '-description'}>Responsibilities & expected output</label>
      <textarea ref={instructionInput} id={id + '-description'} name="description" value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={8000} rows={9}
        placeholder={'Example: Build responsive, accessible interfaces.\n\nFollow the project’s design system, handle loading and error states, and verify changes with relevant tests.\n\nReturn the implementation and a concise validation summary.'} aria-describedby={id + '-description-help'} />
      <div className="agent-instruction-footer"><button type="button" className="ghost" disabled={Boolean(instructions.trim())} onClick={() => { setInstructions('Role:\n\nResponsibilities:\n\nExpected output:\n'); instructionInput.current?.focus(); }}>Insert outline</button><span>{instructions.length.toLocaleString()} / 8,000</span></div>
      <p className="agent-field-help" id={id + '-description-help'}>Include responsibilities, boundaries and the result you expect.</p>
    </section>
    <section className="agent-config-card agent-skills" aria-labelledby={id + '-skills'}>
      <header><span className="agent-step" aria-hidden="true">03</span><div><h3 id={id + '-skills'}>Skill connection</h3><p>Add a reusable set of instructions.</p></div><span className="agent-field-tag">Optional</span></header>
      <label htmlFor={id + '-skill'}>Skill name or path</label><input id={id + '-skill'} name="skillRef" defaultValue={skillRef} placeholder="e.g. ui-ux-pro-max" maxLength={150} spellCheck={false} aria-describedby={id + '-skill-help'} />
      <p className="agent-field-help" id={id + '-skill-help'}>Use the exact name or path of an enabled skill on the local device that runs this agent.</p>
      <div className="agent-skill-note"><span className="signal-dot" aria-hidden="true" /><div><strong>One skill per agent</strong><p>Leave this blank to use only the role instructions. Adding a reference does not install a skill.</p></div></div>
    </section>
    <section className="agent-config-card agent-identity" aria-labelledby={id + '-permissions'}>
      <header><span className="agent-step" aria-hidden="true">04</span><div><h3 id={id + '-permissions'}>Agent permissions</h3><p>Control what this agent can change in the workspace.</p></div></header>
      <label htmlFor={id + '-access'}>Workspace access</label>
      <Select aria-label="Workspace access" id={id + '-access'} name="workspaceAccess" value={access} onChange={event => setAccess(event.target.value as WorkspaceAccess)} aria-describedby={id + '-access-help'}>
        <option value="read_only">Read only — inspect and advise</option>
        <option value="write">Read & write — implement changes</option>
        {workspaceAccess === 'legacy' && <option value="legacy">Preserve existing assignments</option>}
      </Select>
      <p className="agent-field-help" id={id + '-access-help'}>{access === 'legacy' ? 'Keeps the access saved for each existing workflow assignment. New assignments use read-only access for supporting agents and write access for coordinators.' : access === 'write' ? 'Can edit files in its assigned workspace. Check coordinators remain read-only.' : 'Can inspect files and provide analysis. Workspace file changes are disabled.'}</p>
      <p className="agent-field-help">Permission changes apply when you save a new workflow version. Existing runs keep their saved permissions.</p>
    </section>
  </div>;
}
