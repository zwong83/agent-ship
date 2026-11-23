import { useEffect, useId, useState } from 'react';
import { request } from './api';
import { Select } from './select';

export type LocalSkill = { name: string; description: string; kind: 'agent' | 'skill'; source: string };
type Catalog = { status: 'available' | 'unavailable'; source: string; items: LocalSkill[]; skipped: number; truncated: boolean };
type Props = { value: string; onChange: (value: string, selected?: LocalSkill) => void };

/** Discovery is optional: a saved or manually entered reference always remains usable. */
export function LocalSkillPicker({ value, onChange }: Props) {
  const id = useId();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    request<Catalog>('/local-skills', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCatalog(result); })
      .catch(() => { if (!controller.signal.aborted) { setCatalog(null); setFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const items = catalog?.items ?? [];
  const selected = items.find(item => item.name === value);
  const agents = items.filter(item => item.kind === 'agent');
  const skills = items.filter(item => item.kind === 'skill');

  return <div className="local-skill-picker">
    <label htmlFor={id + '-select'}>Local agents &amp; skills</label>
    <div className="local-skill-controls">
      <Select id={id + '-select'} aria-label="Local agents and skills" aria-describedby={id + '-status'}
        value={selected?.name ?? ''} disabled={loading || !items.length}
        onChange={event => {
          const item = items.find(candidate => candidate.name === event.target.value);
          if (item) onChange(item.name, item);
        }}>
        <option value="" disabled>{loading ? 'Reading local library…' : 'Search installed agents and skills…'}</option>
        {agents.length > 0 && <optgroup label="Agent workflows">{agents.map(item => <option key={item.name} value={item.name}>Agent · {item.name}</option>)}</optgroup>}
        {skills.length > 0 && <optgroup label="Skills">{skills.map(item => <option key={item.name} value={item.name}>Skill · {item.name}</option>)}</optgroup>}
      </Select>
      <button type="button" className="ghost" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh library</button>
    </div>
    <p id={id + '-status'} className="agent-field-help" role="status">
      {loading ? 'Reading installed skills on the AgentShip computer…' : failed
        ? 'Could not read the local library. Retry or enter a skill name below.'
        : catalog?.status === 'unavailable'
          ? 'Local discovery is unavailable here. Enter the skill name used by your worker below.'
          : !items.length ? 'No local agents or skills found. You can still enter a skill name below.'
            : `${agents.length} agent workflows and ${skills.length} skills found on the AgentShip computer.`}
      {!loading && catalog?.truncated && ' The library is large; this is a partial list.'}
      {!loading && !!catalog?.skipped && ' Some unreadable or invalid entries were omitted.'}
    </p>
    {selected && <div className="local-skill-preview"><strong>{selected.name}</strong><p>{selected.description}</p><span>{selected.source} · Installed metadata</span></div>}
    <label htmlFor={id + '-reference'}>Connected skill name or path</label>
    <input id={id + '-reference'} name="skillRef" value={value} onChange={event => onChange(event.target.value)}
      placeholder="Choose above or enter a skill name" maxLength={150} spellCheck={false} aria-describedby={id + '-help'} />
    <p className="agent-field-help" id={id + '-help'}>Choose a local entry or type a reference for another worker. The selected worker checks that the skill is enabled when it runs. Leave blank to use only role instructions.</p>
  </div>;
}
