import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const result = buildSync({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
import assert from 'node:assert/strict';
import { createDashboardStore } from './src/use-dashboard-snapshot';
import { ApiError } from './src/api';
const page = (items:any[]=[],nextCursor:string|null=null) => ({items,nextCursor});
const requirement = {id:'r',name:'Private requirement'};
const summary = (id:string,state='running',version=1) => ({id,state,version,deviceStatus:{id:'d',connectivity:'online'}});
const detail = (id:string,state='running',version=1) => ({...summary(id,state,version),requirementId:'r',stages:[]});
const deferred = () => { let resolve:any,reject:any; const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function main() {
  // F-D08: denial must outrank a simultaneous transport failure, regardless of request order.
  for (const status of [401,403]) {
    let mode='good',unauthorized=0;
    const store=createDashboardStore((async(path:string)=>{
      if(mode==='mixed') { if(path.startsWith('/runs')) throw new ApiError(status); throw new Error('offline'); }
      return page(path.startsWith('/runs') ? [] : [requirement]);
    }) as any,()=>unauthorized++);
    await store.refresh(); assert.equal(store.getSnapshot().data?.requirements.length,1);
    mode='mixed'; await store.refresh();
    assert.equal(store.getSnapshot().data,undefined,'An auth denial must clear data even when another request fails first');
    assert.equal(store.getSnapshot().accessLost,true);
    assert.equal(unauthorized,status===401?1:0);
    store.dispose();
  }
  // The same precedence applies to concurrent details, not only catalog reads.
  let deny=false;
  const deniedDetail=createDashboardStore((async(path:string)=>{
    if(path.startsWith('/runs?')) return page([summary('a'),summary('b')]);
    if(path==='/runs/a') { if(deny) throw new Error('offline'); return detail('a'); }
    if(path==='/runs/b') { if(deny) throw new ApiError(403); return detail('b'); }
    return page([requirement]);
  }) as any);
  await deniedDetail.refresh(); deny=true; await deniedDetail.refresh();
  assert.equal(deniedDetail.getSnapshot().data,undefined,'Concurrent detail denial cannot become stale protected data');
  deniedDetail.dispose();
  console.log('PASS snapshot authorization precedence');

  // Paged inventory, bounded fan-out, one in-flight snapshot, atomic publication.
  const gates=new Map<string,ReturnType<typeof deferred>>(); let active=0,peak=0,reads=0;
  const store=createDashboardStore((async(path:string)=>{
    if(path.startsWith('/objects/requirements')) return path.includes('cursor=next') ? page([{id:'r100',name:'Last'}]) : page(Array.from({length:100},(_,i)=>({id:'r'+i,name:'Requirement '+i})),'next');
    if(path.startsWith('/runs?')) return page(Array.from({length:6},(_,i)=>summary(String(i))));
    const id=path.split('/').at(-1)!; reads++; active++; peak=Math.max(peak,active);
    const gate=deferred(); gates.set(id,gate); await gate.promise; active--; return detail(id);
  }) as any);
  const first=store.refresh(); await tick(); await store.refresh();
  assert.equal(reads,4,'Refresh must not overlap and detail concurrency is bounded');
  assert.equal(store.getSnapshot().data,undefined,'Partial detail results must not publish');
  gates.get('0')!.resolve(); gates.get('1')!.resolve(); await tick();
  assert.equal(reads,6); assert.equal(peak,4);
  for(const gate of gates.values()) gate.resolve(); await first;
  assert.equal(store.getSnapshot().data?.requirements.length,101); assert.equal(store.getSnapshot().data?.runs.length,6); store.dispose();

  // Unchanged terminal details reuse cache; transient failures retain and recovery replaces the snapshot.
  let state='completed',version=1,detailReads=0,fail=false;
  const cached=createDashboardStore((async(path:string)=>{
    if(fail) throw new Error('offline');
    if(path.startsWith('/runs?')) return page([summary('a',state,version)]);
    if(path==='/runs/a') {detailReads++;return detail('a',state,version);}
    return page([requirement]);
  }) as any);
  await cached.refresh();
  await cached.refresh(); assert.equal(detailReads,1); const original=cached.getSnapshot().data;
  fail=true; await cached.refresh(); assert.equal(cached.getSnapshot().data?.requirements,original?.requirements); assert.ok(cached.getSnapshot().error); assert.equal(cached.getSnapshot().accessLost,false);
  fail=false;version++;await cached.refresh(); assert.equal(detailReads,2);assert.equal(cached.getSnapshot().error,'');
  state='running';await cached.refresh();await cached.refresh();assert.equal(detailReads,4,'Operational capabilities refresh on every snapshot');cached.dispose();

  // Cached terminal capability and data are invalidated after a denial, and summaries retain fresh device state.
  let denial=false,connectivity='online',terminalReads=0;
  const permissions=createDashboardStore((async(path:string)=>{
    if(denial) throw new ApiError(403);
    if(path.startsWith('/runs?')) return page([{...summary('terminal','completed'),deviceStatus:{id:'d',connectivity}}]);
    if(path==='/runs/terminal') {terminalReads++;return detail('terminal','completed');}
    return page([requirement]);
  }) as any);
  await permissions.refresh();connectivity='offline';await permissions.refresh();
  assert.equal(terminalReads,1);assert.equal(permissions.getSnapshot().data?.runs[0].deviceStatus.connectivity,'offline');
  denial=true;await permissions.refresh();assert.equal(permissions.getSnapshot().data,undefined);
  denial=false;await permissions.refresh();assert.equal(terminalReads,2,'Denied terminal cache cannot be reused after recovery');permissions.dispose();

  // Duplicate pagination is an error; first-load errors cannot fabricate an empty success.
  const duplicate=createDashboardStore((async(path:string)=>path.startsWith('/runs')?page():page([requirement],'same')) as any);
  await duplicate.refresh(); assert.equal(duplicate.getSnapshot().data,undefined);assert.ok(duplicate.getSnapshot().error);assert.equal(duplicate.getSnapshot().pending,false);duplicate.dispose();

  // Unmount aborts in-flight work and late responses cannot publish.
  const late=deferred();let signal:AbortSignal|undefined;let notifications=0;
  const disposed=createDashboardStore((async(_path:string,options:any)=>{signal=options.signal;return late.promise;}) as any);
  disposed.subscribe(()=>notifications++);const pending=disposed.refresh();const before=notifications;disposed.dispose();assert.equal(signal?.aborted,true);late.resolve(page([requirement]));await pending;assert.equal(notifications,before);assert.equal(disposed.getSnapshot().data,undefined);
  console.log('PASS snapshot paging, atomicity, max-four reads, cache, stale recovery, and disposal');
}
main().catch(error=>{console.error(error);process.exitCode=1});
`},bundle:true,platform:'node',format:'cjs',write:false});
new Function('require',result.outputFiles[0].text)(createRequire(import.meta.url));
