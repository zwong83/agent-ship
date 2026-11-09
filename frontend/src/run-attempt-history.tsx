import { useEffect, useState } from 'react';
import { ApiError, errorText, queryPath, request, type Page } from './api';
import { statusText, type RunNode } from './run-api';
import { Button, Field } from './ui';

type Attempt = {
  taskId: string; attemptId: string; attemptNumber: number; kind: 'git' | 'agent' | 'coordinator' | 'publish' | 'reconcile';
  state: string; inputRequirementRevision?: number | null; basedOnOlderRequirementRevision: boolean;
  nodeId?: string; wave?: number; roleDisplayName?: string; reason?: string; disposition?: 'skipped'; artifactIds: string[];
  operatorActions?: { action: 'retry' | 'skip'; operatedAt: string; operatorDisplayName: string }[];
};
type Query = { nodeId: string; cursor?: string; serial: number };
const kindName: Record<Attempt['kind'], string> = {
  git: '仓库准备', agent: 'Agent', coordinator: '协调 Agent', publish: '正式交付', reconcile: '核对外部结果',
};

export function RunAttemptHistory({ runId, nodes, onUnauthorized }: {
  runId: string; nodes: RunNode[]; onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<Query>({ nodeId: '', serial: 0 });
  const [page, setPage] = useState<Page<Attempt>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  function reset(nodeId: string) {
    setPage(undefined);
    setQuery(previous => ({ nodeId, serial: previous.serial + 1 }));
  }

  useEffect(() => {
    if (!open) return;
    const control = new AbortController();
    setPending(true); setError('');
    request<Page<Attempt>>(queryPath(`/runs/${encodeURIComponent(runId)}/attempts`, {
      nodeId: query.nodeId, cursor: query.cursor, pageSize: '25',
    }), { signal: control.signal }).then(result => {
      if (control.signal.aborted) return;
      setPage(previous => {
        if (!query.cursor || !previous) return result;
        const known = new Set(previous.items.map(item => item.attemptId));
        return { items: [...previous.items, ...result.items.filter(item => !known.has(item.attemptId))], nextCursor: result.nextCursor };
      });
    }).catch(err => {
      if (control.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else if (err instanceof ApiError && err.status === 410 && query.cursor) reset(query.nodeId);
      else {
        if (err instanceof ApiError && [403, 404].includes(err.status)) setPage(undefined);
        setError(errorText(err));
      }
    }).finally(() => { if (!control.signal.aborted) setPending(false); });
    return () => control.abort();
  }, [open, query, runId, onUnauthorized]);

  const nodeNames = new Map(nodes.map(node => [node.nodeId, node.name]));
  return <section className="panel repair-control" aria-labelledby="attempt-history-title">
    <div className="row between"><h2 id="attempt-history-title">执行尝试历史</h2>
      <button type="button" className="ghost" aria-expanded={open} onClick={() => {
        if (open) { reset(query.nodeId); setError(''); }
        setOpen(value => !value);
      }}>{open ? '收起尝试历史' : '查看尝试历史'}</button></div>
    {open && <>
      <div className="row chat-history-tools">
        <Field label="筛选节点"><select aria-label="筛选节点" value={query.nodeId} onChange={event => reset(event.target.value)}>
          <option value="">全部节点</option>
          {nodes.map(node => <option key={node.nodeId} value={node.nodeId}>{node.name}</option>)}
        </select></Field>
        <Button disabled={pending} onClick={() => reset(query.nodeId)}>刷新尝试历史</Button>
      </div>
      {pending && !page && <p role="status">正在读取尝试记录…</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {page?.items.length === 0 && <p className="subtle">没有匹配的尝试记录。</p>}
      <div className="chat-section">
        {page?.items.map(item => <article key={item.attemptId} className="run-node">
          <div className="row between"><strong>{item.roleDisplayName ?? kindName[item.kind]}</strong>
            <span className={'pill ' + (item.state === 'succeeded' ? 'good' : item.state === 'failed' ? 'attn' : '')}>
              {statusText(item.state)}{item.disposition === 'skipped' ? ' · 已跳过' : ''}
            </span></div>
          <div className="row chat-actions"><span>第 {item.attemptNumber} 次尝试</span>
            {item.nodeId && <span className="subtle">{nodeNames.get(item.nodeId) ?? '节点'} · 第 {item.wave} 轮</span>}
            {item.inputRequirementRevision != null && <span className="subtle">需求版本 {item.inputRequirementRevision}</span>}
            {item.basedOnOlderRequirementRevision && <span className="pill attn">基于旧版本</span>}
            {item.artifactIds.length > 0 && <span className="subtle">{item.artifactIds.length} 份产物</span>}
          </div>
          {item.reason && <p className="chat-text">{item.reason}</p>}
          {item.operatorActions?.map(operation => <p key={operation.action} className="subtle">
            {operation.operatorDisplayName} · {operation.action === 'retry' ? '重试' : '跳过'} ·{' '}
            <time dateTime={operation.operatedAt}>{new Date(operation.operatedAt).toLocaleString('zh-CN')}</time>
          </p>)}
        </article>)}
      </div>
      {page?.nextCursor && <Button disabled={pending} onClick={() => setQuery(previous => ({ ...previous, cursor: page.nextCursor!, serial: previous.serial + 1 }))}>
        {pending ? '读取中…' : '加载更多尝试'}
      </Button>}
    </>}
  </section>;
}
