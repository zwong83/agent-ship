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

const actionLabel: Record<Action, string> = { repair: 'One more round of practice', recheck: 'recheck', stop: 'Stop this run' };
const proof = (lease: Lease) => ({ tabId: lease.tabId, epoch: lease.epoch, leaseCredential: lease.credential });

export function RunRepairControls({ runId, csrf, navigate, onUnauthorized, embedded = false }: {
  embedded?: boolean; runId: string; csrf: string; navigate: (path: string) => void; onUnauthorized: () => void;
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
    setLeaseError('The operation right has expired, please obtain it again.');
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
        } else setLeaseError('The connection is temporarily interrupted. You can continue operations after the connection is restored.');
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
        setOccupied(typeof holder === 'string' ? `${holder} Using the run action page.` : 'The run action page is in use.');
      } else setLeaseError(errorText(err));
    } finally {
      acquiring.current = false;
      if (live.current) setLoadingLease(false);
    }
  }

  async function apply(target: Target, action: Action) {
    const value = current.current;
    if (!value || leaseError || command.pending) return;
    if (action === 'stop' && !window.confirm('Are you sure you want to stop this run?')) return;
    await submit(`${path}/actions`, { action, targetId: target.nodeId, wave: target.wave, ...proof(value) }, `Submitted: ${actionLabel[action]}.`);
  }

  async function chatAction(action: ChatCommand) {
    const value = current.current;
    if (!value || leaseError || command.pending) return false;
    return submit(`${path}/actions`, { ...action, ...proof(value) }, 'Action submitted.');
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
    <Heading label="AGENT CHANNEL" title="Agent chat" text="Collaborate with running Agents to handle open questions, failed roles, and checks."
      actions={embedded ? undefined : <Button onClick={() => navigate('/requirements')}>Back to requirements</Button>} />
    <section className="panel repair-control">
      <div className="row between"><h2>Chat session</h2><span className={'pill ' + (lease && !leaseError ? 'good' : 'attn')}>{lease && !leaseError ? 'Connected' : 'Not connected'}</span></div>
      <p className="subtle">Connect to chat with agents and manage execution. Only one operator can control a run at a time.</p>
      {leaseError && <p role="alert" className="inline-error">{leaseError}</p>}
      {!lease && <Button variant="accent" disabled={loadingLease} onClick={() => void acquire()}>{loadingLease ? 'Getting…' : 'Connect to agents'}</Button>}
      {lease && <Button disabled={command.pending} onClick={async () => {
        const value = current.current;
        if (!value) return;
        const result = await release(value);
        if (result?.ok || result && [403, 404, 409].includes(result.status)) { saveLease(undefined); setLeaseError(''); }
        else setLeaseError('The release has not been confirmed yet, please check the connection and try again.');
      }}>Disconnect chat</Button>}
    </section>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {lease && <RunChat key={lease.epoch} path={path} lease={lease} refresh={refresh} disabled={command.pending || !!leaseError}
      onAction={chatAction} onLeaseLost={loseLease} onUnauthorized={onUnauthorized} />}
    {lease && <section className="panel repair-control"><h2>Needs attention</h2>
      {!targets && <p role="status">Reading check status...</p>}
      {targets?.length === 0 && <p className="subtle">There are currently no checks to process.</p>}
      {targets?.map(target => <article className="run-node" key={target.nodeId}>
        <div className="row between"><h3>{target.name}</h3><span className="pill attn">{target.status === 'limit_reached' ? 'The repair limit has been reached' : 'Inspection conclusion to be confirmed'}</span></div>
        <p className="subtle">Check the section {target.wave} times · Automatic repair {target.automaticRepairCount} / {target.automaticRepairLimit} Wheel · Manual repair {target.manualRepairCount}</p>
        <div className="row">{target.actions.map(action => <Button key={action} variant={action === 'stop' ? undefined : 'accent'}
          disabled={command.pending || !!leaseError} onClick={() => void apply(target, action)}>{actionLabel[action]}</Button>)}</div>
      </article>)}
    </section>}
    {guests && <section className="panel repair-control"><h2>Action page visitors</h2>
      <form className="row" onSubmit={async event => {
        event.preventDefault();
        if (username.trim() && await submit(`${path}/chat/access`, { action: 'grant', username: username.trim() }, 'Visitor added.')) setUsername('');
      }}>
        <Field label="Register username"><input value={username} maxLength={100} onChange={event => setUsername(event.target.value)} /></Field>
        <button type="submit" className="ghost" disabled={command.pending || !username.trim()}>Add guest</button>
      </form>
      <ul>{guests.map(guest => <li key={guest.id} className="row between"><span>{guest.displayName} · @{guest.username}</span>
        <Button disabled={command.pending} onClick={() => void submit(`${path}/chat/access`, { action: 'revoke', userId: guest.id }, 'Guest privileges have been revoked.')}>Cancel</Button></li>)}</ul>
      <Field label="Action page link"><input readOnly value={window.location.origin + path + '/chat'} /></Field>
    </section>}
    {occupied && <OccupiedDialog message={occupied} close={() => setOccupied('')} />}
  </>;
}

function OccupiedDialog({ message, close }: { message: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="flow-confirm" ref={dialog} onCancel={close} aria-labelledby="repair-occupied-title">
    <h2 id="repair-occupied-title">The run operation page is already occupied</h2>
    <p role="alert">{message}</p>
    <Button onClick={close}>knew</Button>
  </dialog>;
}
