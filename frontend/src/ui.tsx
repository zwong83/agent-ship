import type { FormEvent, ReactNode } from 'react';

const statuses: Record<string, string> = {
  preparing: '准备仓库', running: '执行中', waiting: '等待回复', attention: '待人工处理',
  offline: '等待发起电脑上线', completed: '已完成', stopped: '已停止',
  pending: '待开始', active: '执行中', done: '完成', skipped: '本次未走该路线', blocked: '待人工处理',
  queued: '排队', leased: '执行中', failed: '失败', answered: '已回复', cancelled: '已取消',
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
  return <label>{label}{children}</label>;
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
