import { useEffect, useState } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type ConfigSummary, type Page } from './api';
import { Button, Field } from './ui';

export function StartPicker({ kind, label, purpose, requirementId, selected, disabled, onSelect, onUnauthorized }: {
  kind: 'requirements' | 'flows'; label: string; purpose: 'start' | 'use'; requirementId?: string;
  selected?: ConfigSummary; disabled: boolean; onSelect: (id: string) => void; onUnauthorized: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<Page<ConfigSummary> | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const control = new AbortController();
    setLoading(true); setError('');
    request<Page<ConfigSummary>>(queryPath(configPath(kind), { purpose, requirementId, q: query, cursor, pageSize: '30' }), { signal: control.signal })
      .then(value => { if (!control.signal.aborted) setPage(current => cursor && current ? { items: [...current.items, ...value.items], nextCursor: value.nextCursor } : value); })
      .catch(err => {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else { setPage(null); setError(errorText(err)); }
      }).finally(() => { if (!control.signal.aborted) setLoading(false); });
    return () => control.abort();
  }, [kind, purpose, requirementId, query, cursor, revision, onUnauthorized]);
  const items = page?.items ?? [];
  return <div className="start-picker">
    <Field label={'搜索' + label}><input type="search" value={query} disabled={disabled} placeholder={'输入' + label + '名称'}
      onChange={e => { setQuery(e.target.value); setCursor(undefined); setPage(null); }} /></Field>
    <Field label={'选择' + label}><select aria-label={'选择' + label} value={selected?.id ?? ''} disabled={disabled || loading} onChange={e => { if (e.target.value) onSelect(e.target.value); }}>
      <option value="">{loading ? '正在读取…' : '请从已有' + label + '中选择'}</option>
      {selected && !items.some(item => item.id === selected.id) && <option value={selected.id}>{selected.name}（已选择）</option>}
      {items.map(item => <option key={item.id} value={item.id}>{item.name}{kind === 'flows' ? ` · v${item.workflowVersion ?? '待完善'}` : ''}</option>)}
    </select></Field>
    {!loading && page?.items.length === 0 && <p className="subtle">没有匹配且可使用的{label}。</p>}
    {page?.nextCursor && <Button disabled={loading || disabled} onClick={() => setCursor(page.nextCursor!)}>加载更多{label}</Button>}
    {error && <div><p role="alert" className="inline-error">{error}</p><Button disabled={disabled} onClick={() => setRevision(n => n + 1)}>重新读取{label}</Button></div>}
  </div>;
}
