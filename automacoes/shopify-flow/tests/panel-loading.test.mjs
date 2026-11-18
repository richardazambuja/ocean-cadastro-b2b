import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelController} from '../../../extensions/app-home/src/panel-controller.mjs';
import {createRequestControl} from '../../../extensions/app-home/src/request-control.mjs';
import {withReadDeadline} from '../../../extensions/app-home/src/read-deadline.mjs';
import {fetchPanelSnapshot} from '../../../extensions/app-home/src/panel-data.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const snapshot={locations:[{id:'1'}],decisions:{},reviewDecisions:new Map(),loadedAt:Date.now()};

test('initial data and completed loading publish atomically before notification work completes',async()=>{
 const gate=deferred(),notifications=deferred(),states=[];
 const panel=createPanelController({read:()=>gate.promise,onChange:s=>states.push(s),onSnapshot:()=>notifications.promise});
 const promise=panel.load('initial');assert.equal(panel.getState().initialLoading,true);
 gate.resolve(snapshot);const result=await promise;assert.equal(result.ok,true);
 assert.equal(panel.getState().initialLoading,false);assert.equal(panel.getState().snapshot,snapshot);
 assert.ok(states.every(s=>!s.snapshot||!s.initialLoading));notifications.resolve();panel.dispose();
});
test('refresh retains snapshot and repeated clicks reuse a single request',async()=>{
 let calls=0;const gate=deferred();
 const panel=createPanelController({read:()=>++calls===1?Promise.resolve(snapshot):gate.promise});
 await panel.load();const promise=panel.load(),duplicate=panel.load();
 assert.equal(promise,duplicate);assert.equal(panel.getState().snapshot,snapshot);
 assert.equal(panel.getState().refreshing,true);assert.equal(panel.getState().initialLoading,false);
 gate.resolve({...snapshot,loadedAt:Date.now()+1});await promise;assert.equal(calls,2);assert.equal(panel.getState().refreshing,false);panel.dispose();
});
test('refresh failure preserves last snapshot, marks it stale and resets flags',async()=>{
 let fail=false;const panel=createPanelController({read:async()=>{if(fail)throw Error('503');return snapshot;}});
 await panel.load();fail=true;await panel.load();const state=panel.getState();
 assert.equal(state.snapshot,snapshot);assert.equal(state.stale,true);assert.equal(state.error,'503');assert.equal(state.refreshing,false);assert.equal(state.initialLoading,false);panel.dispose();
});
test('initial failure never invents a confirmed commercial snapshot',async()=>{
 const panel=createPanelController({read:async()=>{throw Error('private read failed');}});
 await panel.load();assert.equal(panel.getState().snapshot,null);assert.equal(panel.getState().initialLoading,false);assert.match(panel.getState().error,/private read/);panel.dispose();
});
test('hung read ends at deadline and its late response never replaces confirmed data',async()=>{
 const late=deferred();let calls=0;
 const panel=createPanelController({timeoutMs:15,read:()=>++calls===1?late.promise:Promise.resolve(snapshot)});
 const result=await panel.load();assert.equal(result.ok,false);assert.equal(result.error.code,'READ_TIMEOUT');assert.equal(panel.getState().initialLoading,false);
 await panel.load();late.resolve({...snapshot,locations:[{id:'obsolete'}]});await tick();assert.equal(panel.getState().snapshot,snapshot);panel.dispose();
});
test('dispose aborts the request and prevents late UI updates',async()=>{
 const gate=deferred();let updates=0;const panel=createPanelController({read:()=>gate.promise,onChange:()=>updates++});
 const promise=panel.load();panel.dispose();await promise;const count=updates;gate.resolve(snapshot);await tick();assert.equal(updates,count);
});
test('recovery clears stale marker only after both essential data sources succeed',async()=>{
 let fail=false;const panel=createPanelController({read:async()=>{if(fail)throw Error('essential failure');return snapshot;}});
 await panel.load();fail=true;await panel.load();assert.equal(panel.getState().stale,true);
 fail=false;const work=panel.load();assert.equal(panel.getState().stale,true);await work;assert.equal(panel.getState().stale,false);assert.equal(panel.getState().error,'');panel.dispose();
});
test('read deadline aborts its underlying fetch signal',async()=>{
 let aborted=false;
 await assert.rejects(()=>withReadDeadline(signal=>new Promise(()=>{signal.addEventListener('abort',()=>{aborted=true;});}),{timeoutMs:10}),{code:'READ_TIMEOUT'});
 assert.equal(aborted,true);
});
test('one stalled background SDK query cannot consume foreground capacity',async()=>{
 const gate=deferred(),calls=[];
 globalThis.shopify={query:async q=>{calls.push(q);if(q==='query Background')await gate.promise;return {data:{ok:true}};}};
 const request=createRequestControl({limit:2,intervalMs:0,readTimeoutMs:50});
 const bg=request('query Background',{}, {background:true});await tick();
 const foreground=await request('query Visible');assert.equal(foreground.ok,true);assert.equal(calls.length,2);gate.resolve();await bg;
});
test('aborted queue job never starts and late SDK result releases its physical slot',async()=>{
 const gate=deferred(),calls=[];
 globalThis.shopify={query:async q=>{calls.push(q);if(q==='query Hung')await gate.promise;return {data:{ok:true}};}};
 const request=createRequestControl({limit:1,intervalMs:0,readTimeoutMs:15});
 await assert.rejects(()=>request('query Hung'),{code:'READ_TIMEOUT'});
 const controller=new AbortController(),queued=request('query Queued',{}, {signal:controller.signal});
 controller.abort(Error('Cancelled'));await assert.rejects(()=>queued,/Cancelled/);assert.deepEqual(calls,['query Hung']);
 gate.resolve();await tick();assert.equal((await request('query Recovered')).ok,true);
});
test('fetch transport supports AbortSignal and does not retry a timeout',async()=>{
 const previous=globalThis.fetch;let calls=0,aborted=false;
 globalThis.fetch=async(_url,{signal})=>new Promise((_,reject)=>{calls++;signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);});});
 try{await assert.rejects(()=>createRequestControl({intervalMs:0,readTimeoutMs:10})('query Read',{}, {transport:'fetch'}),{code:'READ_TIMEOUT'});assert.equal(calls,1);assert.equal(aborted,true);}
 finally{globalThis.fetch=previous;}
});
test('combined essential query paginates both sources independently',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(_url,init)=>{
  const {variables}=JSON.parse(init.body);calls.push(variables);
  return {ok:true,json:async()=>({data:{companyLocations:{nodes:[{id:'gid://shopify/CompanyLocation/'+calls.length}],pageInfo:{hasNextPage:calls.length===1,endCursor:'location-page-1'}},...(variables.withReviews?{metaobjects:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}:{})}})};
 };
 try{const data=await fetchPanelSnapshot();assert.equal(data.locations.length,2);assert.equal(calls.length,2);assert.equal(calls[0].withReviews,true);assert.equal(calls[1].withReviews,false);assert.equal(calls[1].locationAfter,'location-page-1');}
 finally{globalThis.fetch=previous;}
});
test('partial essential query does not publish locations without decisions',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({data:{companyLocations:{nodes:[],pageInfo:{hasNextPage:false}}}})});
 try{await assert.rejects(()=>fetchPanelSnapshot(),/decisoes comerciais incompleta/);}finally{globalThis.fetch=previous;}
});
