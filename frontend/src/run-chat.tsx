import { useEffect, useRef, useState } from 'react';
import { ApiError, errorText, queryPath, request } from './api';
import { Button, Field } from './ui';
import { ChatWorkControls, type ChatWorkCommand, type ChatWorkView } from './run-chat-actions';

export type ChatLease = { tabId: string; epoch: number; credential: string; heartbeatDueAt: string };
type Delivery = 'pending' | 'delivered' | 'unknown';
type Role = { roleId: string; roleDisplayName: string; availability: 'ready' | 'unavailable' };
type Target = { nodeId: string; wave: number; nodeName: string; coordinatorRoleId: string | null; roles: Role[] };
type Message = {
  id: string; text: string; createdAt: string; senderLabel?: string; senderRoleId?: string; targetRoleId?: string;
  direction: 'user_to_agent' | 'agent_to_user' | 'agent_to_agent' | 'system'; deliveryState?: Delivery;
};
type Question = {
  id: string; taskId: string; roleId: string; roleDisplayName?: string; text: string; createdAt: string;
  state: 'waiting' | 'answered' | 'canceled'; deliveryState?: Delivery; canReply?: boolean; canCancel?: boolean; answer?: string;
};
type ChatView = ChatWorkView & {
  messages: Message[]; questions: Question[]; targets: Target[]; nextCursor: string | null;
  deviceOnline?: boolean; runState?: string;
};
type History = { messages: Message[]; cursor: string | null };

export type ChatCommand = { action: 'message'; nodeId: string; wave: number; text: string; targetRoleId?: string }
  | { action: 'reply'; targetId: string; text: string }
  | { action: 'cancel-question'; targetId: string } | ChatWorkCommand;
type ChatProps = {
  path: string; lease: ChatLease; refresh: number; disabled: boolean;
  onAction: (action: ChatCommand) => Promise<boolean>; onLeaseLost: () => void; onUnauthorized: () => void;
};

const deliveryLabel: Record<Delivery, string> = { pending: '待投递', delivered: '已投递', unknown: '投递状态待确认' };
const questionLabel: Record<Question['state'], string> = { waiting: '待回复', answered: '已回复', canceled: '已取消' };
const senderLabel: Record<Message['direction'], string> = {
  user_to_agent: '操作者', agent_to_user: 'Agent', agent_to_agent: 'Agent', system: '系统',
};

function displayTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(time);
}

function latestHistory(previous: History, view: ChatView): History {
  const recentIds = new Set(view.messages.map(message => message.id));
  if (!previous.messages.some(message => recentIds.has(message.id))) return { messages: view.messages, cursor: view.nextCursor };
  return { messages: [...previous.messages.filter(message => !recentIds.has(message.id)), ...view.messages], cursor: previous.cursor };
}

export function RunChat({ path, lease, refresh, disabled, onAction, onLeaseLost, onUnauthorized }: ChatProps) {
  const { tabId, epoch, credential } = lease;
  const [view, setView] = useState<ChatView>();
  const [history, setHistory] = useState<History>({ messages: [], cursor: null });
  const [olderPending, setOlderPending] = useState(false);
  const olderRequest = useRef<AbortController | null>(null);
  const [historyRole, setHistoryRole] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const chat = await request<ChatView>(queryPath(`${path}/chat`, { tabId, epoch: String(epoch) }), {
          chatLease: credential, signal: control.signal,
        });
        if (!control.signal.aborted) { setView(chat); setHistory(previous => latestHistory(previous, chat)); setError(''); }
      } catch (err) {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else if (err instanceof ApiError && [403, 404, 409].includes(err.status)) onLeaseLost();
        else setError(errorText(err));
      } finally { loading = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 4_000);
    return () => { control.abort(); window.clearInterval(timer); };
  }, [path, tabId, epoch, credential, refresh, reload, onLeaseLost, onUnauthorized]);

  useEffect(() => () => olderRequest.current?.abort(), []);

  async function loadOlder() {
    const cursor = history.cursor;
    if (!cursor || olderRequest.current) return;
    const control = new AbortController();
    olderRequest.current = control;
    setOlderPending(true);
    try {
      const older = await request<ChatView>(queryPath(`${path}/chat`, { tabId, epoch: String(epoch), cursor }), {
        chatLease: credential, signal: control.signal,
      });
      if (!control.signal.aborted) setHistory(previous => {
        if (previous.cursor !== cursor) return previous;
        const known = new Set(previous.messages.map(message => message.id));
        return { messages: [...older.messages.filter(message => !known.has(message.id)), ...previous.messages], cursor: older.nextCursor };
      });
    } catch (err) {
      if (control.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else if (err instanceof ApiError && [403, 404, 409].includes(err.status)) onLeaseLost();
      else if (err instanceof ApiError && err.status === 410) {
        setHistory({ messages: [], cursor: null });
        setReload(value => value + 1);
      } else setError(errorText(err));
    } finally {
      olderRequest.current = null;
      if (!control.signal.aborted) setOlderPending(false);
    }
  }

  const roleNames = new Map(view?.targets.flatMap(target => target.roles.map(role => [role.roleId, role.roleDisplayName] as const)));
  for (const message of history.messages) {
    if (message.senderRoleId && !roleNames.has(message.senderRoleId)) roleNames.set(message.senderRoleId, message.senderLabel ?? message.senderRoleId);
    if (message.targetRoleId && !roleNames.has(message.targetRoleId)) roleNames.set(message.targetRoleId, message.targetRoleId);
  }
  const visible = historyRole ? history.messages.filter(message => [message.senderRoleId, message.targetRoleId].includes(historyRole)) : history.messages;
  const busy = disabled || !!error;
  return <section className="panel repair-control run-chat" aria-labelledby="run-chat-title">
    <div className="row between"><h2 id="run-chat-title">运行聊天</h2>
      {view?.runState === 'stopped' ? <span className="pill attn">运行已停止</span>
        : view?.runState === 'completed' ? <span className="pill good">运行已完成</span>
        : view?.deviceOnline === false && <span className="pill attn">发起电脑离线 · 消息等待投递</span>}</div>
    {error && <div className="row"><p role="alert" className="inline-error">{error}</p><Button onClick={() => setReload(value => value + 1)}>重试读取</Button></div>}
    {!view && !error && <p role="status">正在读取聊天和待答问题…</p>}
    {view && <>
      <div className="row between chat-history-tools">
        {roleNames.size > 0 && <Field label="筛选会话"><select value={historyRole} onChange={event => setHistoryRole(event.target.value)}>
          <option value="">所有角色</option>
          {[...roleNames].map(([roleId, name]) => <option key={roleId} value={roleId}>{name}</option>)}
        </select></Field>}
        {history.cursor && <Button disabled={olderPending} onClick={() => void loadOlder()}>{olderPending ? '读取中…' : '查看更早消息'}</Button>}
      </div>
      <div className="chat-history" role="log" aria-label="聊天记录" tabIndex={0}>
        {visible.length === 0 && <p className="subtle">{historyRole ? '此角色没有已加载的聊天记录。' : '本次运行还没有聊天记录。'}</p>}
        {visible.map(message => <article className={`chat-entry ${message.direction}`} key={message.id}>
          <div className="row between"><strong>{message.senderLabel || senderLabel[message.direction]}</strong>
            <time dateTime={message.createdAt}>{displayTime(message.createdAt)}</time></div>
          <p>{message.text}</p>
          {message.targetRoleId && <small className="subtle">发给 {roleNames.get(message.targetRoleId) ?? message.targetRoleId}</small>}
          {message.deliveryState && <small className="subtle">{deliveryLabel[message.deliveryState]}</small>}
        </article>)}
      </div>
      {view.allowedActions.includes('message') && <MessageComposer targets={view.targets} disabled={busy} onAction={onAction} />}
      {view.questions.length > 0 && <section className="chat-section" aria-labelledby="run-questions-title">
        <h3 id="run-questions-title">Agent 提问</h3>
        {view.questions.map(question => <QuestionCard key={question.id} question={question}
          roleName={question.roleDisplayName ?? roleNames.get(question.roleId) ?? question.roleId}
          canReply={view.allowedActions.includes('reply') && !!question.canReply}
          canCancel={view.allowedActions.includes('cancel-question') && !!question.canCancel}
          disabled={busy} onAction={onAction} />)}
      </section>}
      <ChatWorkControls view={view} disabled={busy} onAction={onAction} />
    </>}
  </section>;
}

const targetKey = (target: Target) => `${target.nodeId}:${target.wave}`;

function mention(text: string, roles: Role[]) {
  const matches = roles.flatMap(role => [...new Set([role.roleDisplayName, role.roleId])]
    .map(alias => ({ role, prefix: `@${alias}` })))
    .filter(({ prefix }) => text.startsWith(prefix) && /\s/.test(text[prefix.length] ?? ''));
  const longest = Math.max(0, ...matches.map(({ prefix }) => prefix.length));
  const candidates = matches.filter(({ prefix }) => prefix.length === longest);
  if (candidates.length !== 1 || candidates[0].role.availability !== 'ready') return null;
  return { targetRoleId: candidates[0].role.roleId, text: text.slice(longest).trim() };
}

function MessageComposer({ targets, disabled, onAction }: { targets: Target[]; disabled: boolean; onAction: ChatProps['onAction'] }) {
  const [selection, setSelection] = useState<string>();
  const [roleId, setRoleId] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const key = selection ?? (targets[0] ? targetKey(targets[0]) : '');
  const target = targets.find(item => targetKey(item) === key);
  const roles = target?.roles ?? [];
  const selectedRole = roles.find(role => role.roleId === (roleId || target?.coordinatorRoleId));
  const canSend = !!target && (draft.trimStart().startsWith('@') || selectedRole?.availability === 'ready');

  if (!targets.length) return <p className="subtle">当前没有可选的运行节点。已保存的消息仍可查看。</p>;
  return <form className="chat-composer" onSubmit={async event => {
    event.preventDefault();
    const text = draft.trim();
    if (disabled || !target || !text || !canSend) return;
    setError('');
    const route = text.startsWith('@') ? mention(text, roles) : { text, ...(roleId ? { targetRoleId: roleId } : {}) };
    if (!route) { setError('未找到唯一可接收消息的 @Agent，请从当前节点的角色中选择。'); return; }
    if (!route.text) { setError('请输入要发送的消息。'); return; }
    if (await onAction({ action: 'message', nodeId: target.nodeId, wave: target.wave, ...route })) setDraft('');
  }}>
    <div className="chat-fields">
      <Field label="运行节点"><select value={target ? key : ''} disabled={disabled} onChange={event => {
        setSelection(event.target.value); setRoleId(''); setError('');
      }}>
        {!target && <option value="" disabled>选择当前节点</option>}
        {targets.map(item => <option key={targetKey(item)} value={targetKey(item)}>{item.nodeName} · 第 {item.wave} 次</option>)}
      </select></Field>
      <Field label="发送给"><select value={roleId} disabled={disabled || !target} onChange={event => { setRoleId(event.target.value); setError(''); }}>
        <option value="">默认协调 Agent{target?.coordinatorRoleId ? '' : '（暂不可用）'}</option>
        {roleId && !roles.some(role => role.roleId === roleId) && <option value={roleId} disabled>原选角色已失效</option>}
        {roles.map(role => <option key={role.roleId} value={role.roleId} disabled={role.availability !== 'ready'}>@{role.roleDisplayName}</option>)}
      </select></Field>
    </div>
    <Field label="消息内容"><textarea rows={3} value={draft} maxLength={10000} placeholder="输入消息，也可在开头输入 @角色名"
      disabled={disabled} onChange={event => { if (target) setSelection(key); setDraft(event.target.value); setError(''); }} /></Field>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button type="submit" className="accent" disabled={disabled || !canSend || !draft.trim()}>发送消息</button>
  </form>;
}

function QuestionCard({ question, roleName, canReply, canCancel, disabled, onAction }: {
  question: Question; roleName: string; canReply: boolean; canCancel: boolean;
  disabled: boolean; onAction: ChatProps['onAction'];
}) {
  const [answer, setAnswer] = useState('');
  return <article className="run-node chat-question" aria-label={`${roleName}的提问`}>
    <div className="row between"><strong>{roleName}</strong><span className={'pill ' + (question.state === 'waiting' ? 'attn' : '')}>{questionLabel[question.state]}</span></div>
    <p className="chat-text">{question.text}</p>
    {question.answer && <p className="chat-text"><strong>回复</strong> {question.answer}</p>}
    {question.deliveryState && <p className="subtle">{deliveryLabel[question.deliveryState]}</p>}
    {question.state === 'waiting' && !canReply && !canCancel && <p className="subtle">此问题当前不可操作。</p>}
    {question.state === 'waiting' && <>
      {canReply && <form onSubmit={async event => {
        event.preventDefault();
        const text = answer.trim();
        if (!disabled && text && await onAction({ action: 'reply', targetId: question.id, text })) setAnswer('');
      }}>
        <Field label={`回复${roleName}`}><textarea rows={3} value={answer} maxLength={10000} disabled={disabled} onChange={event => setAnswer(event.target.value)} /></Field>
        <button type="submit" className="accent" disabled={disabled || !answer.trim()}>回复</button>
      </form>}
      {canCancel && <Button disabled={disabled} onClick={() => void onAction({ action: 'cancel-question', targetId: question.id })}>取消提问</Button>}
    </>}
  </article>;
}
