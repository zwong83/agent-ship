import { cloneElement, isValidElement, type FormEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Select } from './select';

const statuses: Record<string, string> = {
  preparing: 'Prepare warehouse', running: 'Executing', waiting: 'Waiting for reply', attention: 'Needs attention',
  offline: 'Waiting for the initiating computer to come online', completed: 'Completed', stopped: 'Stopped',
  pending: 'To be started', active: 'Executing', done: 'Finish', skipped: 'Didn’t take this route this time', blocked: 'Needs attention',
  queued: 'queue', leased: 'Executing', failed: 'Failed', answered: 'Replied', cancelled: 'Canceled',
};

export function Heading({ label, title, text, actions }: { label: string; title: string; text: string; actions?: ReactNode }) {
  return <header className="mast"><div><p className="eyebrow">{label}</p><h1>{title}</h1><p className="subtle">{text}</p></div>{actions}</header>;
}

export function Button({ children, onClick, variant = 'ghost', disabled }: {
  children: ReactNode; onClick: () => void; variant?: string; disabled?: boolean;
}) {
  return <button type="button" className={variant} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{isValidElement<SelectHTMLAttributes<HTMLSelectElement>>(children) && children.type === Select
    ? cloneElement(children, { 'aria-label': children.props['aria-label'] ?? label }) : children}</label>;
}

export function Choices({ entries }: { entries: Record<string, string> }) {
  return <>{Object.entries(entries).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</>;
}

export function Pill({ status }: { status: string }) {
  const tone = ['completed', 'done', 'pass'].includes(status) ? 'good' :
    ['failed', 'stopped'].includes(status) ? 'bad' :
    ['attention', 'offline', 'waiting', 'blocked'].includes(status) ? 'attn' : '';
  return <span className={'pill ' + tone}>{statuses[status] ?? status}</span>;
}

export function formData(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return { text: (name: string) => String(data.get(name) ?? ''), has: (name: string) => data.has(name) };
}
