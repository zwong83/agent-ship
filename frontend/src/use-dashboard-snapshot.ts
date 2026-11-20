import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, configPath, errorText, queryPath, request, type ConfigSummary, type Page } from './api';
import type { RunDetail, RunSummary } from './run-api';

export type DashboardSnapshot = { requirements: ConfigSummary[]; runs: RunDetail[]; updated: Date };
export type DashboardSnapshotState = { data?: DashboardSnapshot; error: string; pending: boolean; accessLost: boolean };
type Reader = <T>(path: string, options: { signal: AbortSignal }) => Promise<T>;

const isAccessFailure = (error: unknown): error is ApiError => error instanceof ApiError && [401, 403].includes(error.status);
// A denial must never be masked by another request's earlier network failure.
const preferredFailure = (errors: unknown[]) => errors.find(error => error instanceof ApiError && error.status === 401)
  ?? errors.find(isAccessFailure) ?? errors[0];

async function allPages<T>(read: Reader, path: string, signal: AbortSignal): Promise<T[]> {
  const items: T[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await read<Page<T>>(queryPath(path, { pageSize: '100', cursor }), { signal });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Repeated dashboard page cursor');
    if (cursor) seen.add(cursor);
  } while (cursor && !signal.aborted);
  return items;
}

/** One snapshot owner keeps partial reads and old permission results out of the view. */
export function createDashboardStore(read: Reader = request, unauthorized: () => void = () => {}, now = () => new Date()) {
  let state: DashboardSnapshotState = { error: '', pending: true, accessLost: false };
  let cache = new Map<string, RunDetail>();
  let loading = false, disposed = false;
  const control = new AbortController();
  const listeners = new Set<() => void>();
  const publish = (next: DashboardSnapshotState) => {
    if (disposed) return;
    state = next;
    listeners.forEach(listener => listener());
  };
  async function refresh() {
    if (loading || disposed) return;
    loading = true;
    publish({ ...state, pending: true });
    try {
      const result = await Promise.allSettled([
        allPages<ConfigSummary>(read, configPath('requirements'), control.signal),
        allPages<RunSummary>(read, '/runs', control.signal),
      ]);
      const failures = result.flatMap(item => item.status === 'rejected' ? [item.reason] : []);
      if (failures.length) throw preferredFailure(failures);
      if (disposed) return;
      const requirements = (result[0] as PromiseFulfilledResult<ConfigSummary[]>).value;
      const summaries = (result[1] as PromiseFulfilledResult<RunSummary[]>).value;
      const nextCache = new Map<string, RunDetail>();
      let next = 0;
      const detailFailures: unknown[] = [];
      await Promise.all(Array.from({ length: Math.min(4, summaries.length) }, async () => {
        while (next < summaries.length && !disposed && !detailFailures.length) {
          const summary = summaries[next++];
          try {
            const previous = cache.get(summary.id);
            const detail = previous?.version === summary.version && ['completed', 'stopped', 'failed'].includes(summary.state)
              ? previous : await read<RunDetail>('/runs/' + summary.id, { signal: control.signal });
            nextCache.set(summary.id, { ...detail, deviceStatus: summary.deviceStatus });
          } catch (error) { detailFailures.push(error); }
        }
      }));
      if (detailFailures.length) throw preferredFailure(detailFailures);
      if (disposed) return;
      cache = nextCache;
      publish({ data: { requirements, runs: summaries.map(run => nextCache.get(run.id)!), updated: now() }, error: '', pending: false, accessLost: false });
    } catch (error) {
      if (disposed) return;
      const denied = isAccessFailure(error);
      if (denied) cache.clear();
      publish({ data: denied ? undefined : state.data, error: errorText(error), pending: false, accessLost: denied });
      if (error instanceof ApiError && error.status === 401) unauthorized();
    } finally { loading = false; }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    dispose: () => { disposed = true; control.abort(); cache.clear(); listeners.clear(); },
  };
}

export function useDashboardSnapshot(onUnauthorized: () => void) {
  const [store] = useState(() => createDashboardStore(request, onUnauthorized));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void store.refresh(); }, 5000);
    const visible = () => { if (!document.hidden) void store.refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { store.dispose(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [store]);
  return { ...state, refresh: store.refresh };
}
