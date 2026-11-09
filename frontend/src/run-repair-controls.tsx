import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorText, request, type User } from './api';
import { Button, Field, Heading } from './ui';
import { useCommand } from './use-command';
import { RunChat, type ChatCommand, type ChatLease } from './run-chat';

type Lease = ChatLease;
type Action = 'repair' | 'recheck' | 'stop';
type Target = {
  nodeId: string;
  name: string;
  wave: number;
  status: 'limit_reached' | 'unresolved';
  automaticRepairCount: number;
  automaticRepairLimit: number;
  manualRepairCount: number;
  actions: Action[];
};

const actionLabel: Record<Action, string> = { repair: '再修一轮', recheck: '重新检查', stop: '停止本次运行' };
const proof = (lease: Lease) => ({ tabId: lease.tabId, epoch: lease.epoch, leaseCredential: lease.credential });

export function RunRepairControls({ runId, csrf, navigate, onUnauthorized }: {
  runId: string; csrf: string; navigate: (path: string) => void; onUnauthorized: () => void;
}) {
  const path = `/runs/${runId}`;
  const [tab] = useState(() => crypto.randomUUID());
  const [lease, setLease] = useState<Lease>();
  const current = useRef<Lease | undefined>(undefined);
  const live = useRef(false);
  const acquiring = useRef(false);
  const [loadingLease, setLoadingLease] = useState(false);
  const [leaseError, setLeaseError] = useState('');
  const [occupied, setOccupied] = useState('');
  const [targets, setTargets] = useState<Target[]>();
  const [guests, setGuests] = useState<User[]>();
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const command = useCommand(csrf);

  const saveLease = useCallback((value: Lease | undefined) => {
    current.current = value;
    setLease(value);
  }, []);

  const loseLease = useCallback(() => {
    saveLease(undefined);
    setLeaseError('操作权已失效，请重新获取。');
  }, [saveLease]);

  function release(value: Lease) {
    return fetch(`/api${path}/chat`, {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ action: 'release', ...proof(value) }),
    }).catch(() => undefined);
  }

  useEffect(() => {
    live.current = true;
    let sending = false;
    const leave = () => {
      const value = current.current;
      current.current = undefined;
      if (value) void release(value);
    };
    const restore = () => {
      if (!current.current) setLease(undefined);
    };
    const timer = window.setInterval(async () => {
      const value = current.current;
      if (!value || sending) return;
      sending = true;
      try {
        const updated = await request<Lease>(`${path}/chat`, { method: 'POST', csrf, body: { action: 'heartbeat', ...proof(value) } });
        if (live.current && current.current === value) { saveLease(updated); setLeaseError(''); }
      } catch (err) {
        if (!live.current || current.current !== value) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else if (err instanceof ApiError && [403, 404, 409].includes(err.status)) {
          loseLease();
        } else setLeaseError('连接暂时中断，恢复连接后可继续操作。');
      } finally { sending = false; }
    }, 10_000);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      live.current = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
      leave();
    };
  }, [path, csrf, loseLease, onUnauthorized, saveLease]);

  const hasLease = !!lease;
  useEffect(() => {
    if (!hasLease) { setTargets(undefined); return; }
    const control = new AbortController();
    async function load() {
      try {
        const data = await request<{ targets: Target[] }>(`${path}/repair-control`, { signal: control.signal });
        if (!control.signal.aborted) setTargets(data.targets);
      } catch (err) {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else setError(errorText(err));
      }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 4_000);
    return () => { control.abort(); window.clearInterval(timer); };
  }, [hasLease, path, refresh, onUnauthorized]);

  useEffect(() => {
    const control = new AbortController();
    request<{ guests: User[] }>(`${path}/chat/access`, { signal: control.signal })
      .then(value => { if (!control.signal.aborted) setGuests(value.guests); })
      .catch(err => {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else if (!(err instanceof ApiError && err.status === 404)) setError(errorText(err));
      });
    return () => control.abort();
  }, [path, refresh, onUnauthorized]);

  async function acquire() {
    if (acquiring.current) return;
    acquiring.current = true;
    setLoadingLease(true);
    setLeaseError('');
    try {
      const value = await request<Lease>(`${path}/chat`, { method: 'POST', csrf, body: { action: 'acquire', tabId: tab } });
      if (live.current) saveLease(value);
      else void release(value);
    } catch (err) {
      if (!live.current) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else if (err instanceof ApiError && err.problem?.code === 'CHAT_OCCUPIED') {
        const holder = err.problem.details?.holderName;
        setOccupied(typeof holder === 'string' ? `${holder} 正在使用运行操作页。` : '运行操作页正在使用中。');
      } else setLeaseError(errorText(err));
    } finally {
      acquiring.current = false;
      if (live.current) setLoadingLease(false);
    }
  }

  async function apply(target: Target, action: Action) {
    const value = current.current;
    if (!value || leaseError || command.pending) return;
    if (action === 'stop' && !window.confirm('确定停止本次运行？')) return;
    await submit(`${path}/actions`, { action, targetId: target.nodeId, wave: target.wave, ...proof(value) }, `已提交${actionLabel[action]}。`);
  }

  async function chatAction(action: ChatCommand) {
    const value = current.current;
    if (!value || leaseError || command.pending) return false;
    return submit(`${path}/actions`, { ...action, ...proof(value) }, '已提交操作。');
  }

  async function submit(url: string, body: object, success: string) {
    setError(''); setMessage('');
    try {
      await command.send(url, 'POST', body);
      setMessage(success);
      setRefresh(value => value + 1);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else {
        if (err instanceof ApiError && err.problem?.code === 'CHAT_LEASE_LOST') loseLease();
        setError(errorText(err));
        if (err instanceof ApiError && err.status === 409) setRefresh(value => value + 1);
      }
      return false;
    }
  }

  return <>
    <Heading label="RUN CONTROL" title="运行操作" text="与运行中的 Agent 协作，处理待答问题、失败角色和检查。"
      actions={<Button onClick={() => navigate('/runs')}>返回运行看板</Button>} />
    <section className="panel repair-control">
      <div className="row between"><h2>本页操作权</h2><span className={'pill ' + (lease && !leaseError ? 'good' : 'attn')}>{lease && !leaseError ? '当前页持有' : '待获取'}</span></div>
      <p className="subtle">同一运行同一时间只允许一个标签页操作。</p>
      {leaseError && <p role="alert" className="inline-error">{leaseError}</p>}
      {!lease && <Button variant="accent" disabled={loadingLease} onClick={() => void acquire()}>{loadingLease ? '正在获取…' : '获取操作权'}</Button>}
      {lease && <Button disabled={command.pending} onClick={async () => {
        const value = current.current;
        if (!value) return;
        const result = await release(value);
        if (result?.ok || result && [403, 404, 409].includes(result.status)) { saveLease(undefined); setLeaseError(''); }
        else setLeaseError('暂未确认释放，请检查连接后重试。');
      }}>释放操作权</Button>}
    </section>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {lease && <RunChat key={lease.epoch} path={path} lease={lease} refresh={refresh} disabled={command.pending || !!leaseError}
      onAction={chatAction} onLeaseLost={loseLease} onUnauthorized={onUnauthorized} />}
    {lease && <section className="panel repair-control"><h2>待人工处理</h2>
      {!targets && <p role="status">正在读取检查状态…</p>}
      {targets?.length === 0 && <p className="subtle">当前没有需要处理的检查。</p>}
      {targets?.map(target => <article className="run-node" key={target.nodeId}>
        <div className="row between"><h3>{target.name}</h3><span className="pill attn">{target.status === 'limit_reached' ? '已达修复上限' : '检查结论待确认'}</span></div>
        <p className="subtle">检查第 {target.wave} 次 · 自动修复 {target.automaticRepairCount} / {target.automaticRepairLimit} 轮 · 人工修复 {target.manualRepairCount} 轮</p>
        <div className="row">{target.actions.map(action => <Button key={action} variant={action === 'stop' ? undefined : 'accent'}
          disabled={command.pending || !!leaseError} onClick={() => void apply(target, action)}>{actionLabel[action]}</Button>)}</div>
      </article>)}
    </section>}
    {guests && <section className="panel repair-control"><h2>操作页访客</h2>
      <form className="row" onSubmit={async event => {
        event.preventDefault();
        if (username.trim() && await submit(`${path}/chat/access`, { action: 'grant', username: username.trim() }, '已添加访客。')) setUsername('');
      }}>
        <Field label="注册用户名"><input value={username} maxLength={100} onChange={event => setUsername(event.target.value)} /></Field>
        <button type="submit" className="ghost" disabled={command.pending || !username.trim()}>添加访客</button>
      </form>
      <ul>{guests.map(guest => <li key={guest.id} className="row between"><span>{guest.displayName} · @{guest.username}</span>
        <Button disabled={command.pending} onClick={() => void submit(`${path}/chat/access`, { action: 'revoke', userId: guest.id }, '已撤销访客权限。')}>撤销</Button></li>)}</ul>
      <Field label="操作页链接"><input readOnly value={window.location.origin + path + '/chat'} /></Field>
    </section>}
    {occupied && <OccupiedDialog message={occupied} close={() => setOccupied('')} />}
  </>;
}

function OccupiedDialog({ message, close }: { message: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="flow-confirm" ref={dialog} onCancel={close} aria-labelledby="repair-occupied-title">
    <h2 id="repair-occupied-title">运行操作页已被占用</h2>
    <p role="alert">{message}</p>
    <Button onClick={close}>知道了</Button>
  </dialog>;
}
