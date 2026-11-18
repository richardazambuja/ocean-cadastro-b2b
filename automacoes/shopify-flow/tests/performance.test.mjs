import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestControl} from '../../../extensions/app-home/src/request-control.mjs';
import {loadPanelData} from '../../../extensions/app-home/src/panel-data.mjs';
import {createSyncScheduler,synchronizeLocations} from '../../../extensions/app-home/src/notification-sync.mjs';
import {createBridge} from '../../../extensions/app-home/src/flow-bridge/bridge.mjs';
import {READ,SET,SIGNAL,READ_SIGNAL} from '../../../extensions/app-home/src/flow-bridge/operations.mjs';
import {metafieldValues} from '../../../extensions/app-home/src/flow-bridge/state.mjs';
import {statusDoPainel} from '../../../extensions/app-home/src/status.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));

test('503 reads retry at most three times with exponential backoff',async()=>{
 let calls=0,clock=0;const waits=[];
 globalThis.shopify={query:async()=>{calls++;throw Error('Failed to query Admin API: 503');}};
 const request=createRequestControl({intervalMs:0,clock:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;},random:()=>0});
 await assert.rejects(()=>request('query Retry { shop { id } }'),/503/);
 assert.equal(calls,3);assert.deepEqual(waits,[500,1000]);
});

test('503 mutation is never blindly retried by the transport',async()=>{
 let calls=0;globalThis.shopify={query:async()=>{calls++;throw Error('503');}};
 const request=createRequestControl({intervalMs:0});
 await assert.rejects(()=>request('mutation Write { metafieldsSet { userErrors { message } } }'),/503/);assert.equal(calls,1);
});

test('GraphQL partial-data errors do not return commercial data',async()=>{
 globalThis.shopify={query:async()=>({data:{companyLocations:{nodes:[]}},errors:[{message:'Access denied'}]})};
 await assert.rejects(()=>createRequestControl({intervalMs:0})('query Partial { shop { id } }'),/Access denied/);
});

test('Essential decision failure prevents publishing a mixed snapshot',async()=>{
 const reviews=deferred();let settled=false;
 const result=loadPanelData({locations:async()=>[{id:'1'}],reviews:()=>reviews.promise});
 result.then(()=>{settled=true;},()=>{});await tick();assert.equal(settled,false);
 reviews.reject(Error('private decision unavailable'));await assert.rejects(()=>result,/private decision unavailable/);assert.equal(settled,false);
});

test('background synchronization cannot delay the visual data promise',async()=>{
 const synchronization=deferred(),scheduled=[];let called=false;
 const scheduler=createSyncScheduler(async()=>{called=true;return synchronization.promise;},{schedule:fn=>scheduled.push(fn)});
 const snapshot=await loadPanelData({locations:async()=>[{id:'1'}],reviews:async()=>({statuses:{},decisions:new Map()})});
 scheduler.enqueue(snapshot);assert.equal(snapshot.locations.length,1);assert.equal(called,false);
 scheduled.shift()();await tick();assert.equal(called,true);scheduler.dispose();synchronization.resolve([]);
});

test('overlapping refreshes coalesce to the newest snapshot and dispose ignores callbacks',async()=>{
 const scheduled=[],gate=deferred(),calls=[],callbacks=[];
 const scheduler=createSyncScheduler(async snapshot=>{calls.push(snapshot);if(snapshot===1)await gate.promise;return [];},{schedule:fn=>scheduled.push(fn)});
 scheduler.enqueue(1,r=>callbacks.push(r));scheduled.shift()();await tick();
 scheduler.enqueue(2);scheduler.enqueue(3);gate.resolve();await tick();await tick();
 assert.deepEqual(calls,[1,3]);assert.equal(callbacks.length,1);
 scheduler.dispose();scheduler.enqueue(4);assert.deepEqual(calls,[1,3]);
});

test('synchronization bounds concurrency, isolates failures and caps a pass',async()=>{
 let active=0,peak=0,calls=0;
 const warnings=await synchronizeLocations(Array.from({length:30},(_,i)=>({id:String(i)})),async l=>{calls++;active++;peak=Math.max(peak,active);await tick();active--;if(l.id==='1')throw Error('503');},{maxJobs:20});
 assert.equal(calls,20);assert.equal(peak,2);assert.equal(warnings.length,2);
});

test('foreground queued work has priority over pending background work',async()=>{
 const gate=deferred(),operations=[];
 globalThis.shopify={query:async q=>{operations.push(q);if(q==='query A')await gate.promise;return {data:{ok:true}};}};
 const request=createRequestControl({limit:1,intervalMs:0});
 const a=request('query A',{}, {background:true});await tick();
 const b=request('query B',{}, {background:true});const c=request('query C');
 gate.resolve();await Promise.all([a,b,c]);assert.deepEqual(operations,['query A','query C','query B']);
});

function bridgeFixture({loseSet=false,loseSignal=false,failBeforeSet=false}={}){
 const id='gid://shopify/CompanyLocation/1';
 const at='2026-11-18T12:00:00Z';
 const location={id,createdAt:at,roleAssignments:{nodes:[],pageInfo:{hasNextPage:false}},company:{contacts:{nodes:[{id:'c',customer:{id:'u'}}],pageInfo:{hasNextPage:false}}}};
 const decision={verified:true,localId:id,status:null,updatedAt:null};
 const values=new Map(),signals=new Map(),calls=[];let sequence=0,sets=0,signalWrites=0;
 const aliases={review:'review',ready:'ready',status:'status',cycle:'cycle_id',entered:'pending_since',ledger:'notifications',signal:'signal'};
 const query=async(q,v)=>{
  calls.push(q);
  if(q===READ)return {companyLocation:{id,...Object.fromEntries(Object.entries(aliases).map(([a,k])=>[a,values.get(k)||null]))}};
  if(q===SET){
   sets++;
   if(failBeforeSet){failBeforeSet=false;throw Error('503');}
   const result=v.metafields.map(f=>({...f,compareDigest:'digest-'+ ++sequence}));
   for(const f of v.metafields)assert.equal(f.compareDigest??null,Object.hasOwn(f,'compareDigest')?values.get(f.key)?.compareDigest??null:null);
   result.forEach(f=>values.set(f.key,f));
   if(loseSet){loseSet=false;throw Error('503 committed but response lost');}
   return {metafieldsSet:{metafields:result,userErrors:[]}};
  }
  if(q===READ_SIGNAL)return {metaobjectByHandle:signals.get(v.handle.handle)||null};
  if(q===SIGNAL){signalWrites++;const record={id:'gid://shopify/Metaobject/1',type:v.handle.type,handle:v.handle.handle,fields:v.metaobject.fields};signals.set(v.handle.handle,record);if(loseSignal){loseSignal=false;throw Error('503 signal committed');}return {metaobjectUpsert:{metaobject:record,userErrors:[]}};}
  throw Error('Unexpected query');
 };
 const bridge=createBridge({query,loadAuthoritative:async()=>({location,decision}),classify:statusDoPainel,enabled:true,emitSignals:true,now:()=>at,uuid:()=>`cycle-${++sequence}`});
 return {id,bridge,calls,values,signals,sets:()=>sets,signalWrites:()=>signalWrites};
}

test('503 after committed CAS write verifies it without replaying commercial operation or lock',async()=>{
 const f=bridgeFixture({loseSet:true});let actions=0;
 await f.bridge.run(f.id,async()=>{actions++;});
 assert.equal(actions,1);assert.equal(f.sets(),3); // acquire, publish, signal receipt
 assert.equal(f.signalWrites(),1);assert.equal(JSON.parse(f.values.get('review').value).ready,true);
});

test('503 before CAS commit rereads digest before one bounded retry',async()=>{
 const f=bridgeFixture({failBeforeSet:true});let actions=0;
 await f.bridge.run(f.id,async()=>{actions++;});assert.equal(actions,1);assert.equal(f.sets(),4);
 assert.equal(f.calls[0],READ);assert.ok(f.calls.slice(1).includes(READ));
});

test('lost signal response reuses the committed cycle handle',async()=>{
 const f=bridgeFixture({loseSignal:true});await f.bridge.run(f.id,async()=>{});
 assert.equal(f.signalWrites(),1);assert.equal(f.signals.size,1);assert.equal(JSON.parse(f.values.get('signal').value).status,'confirmed');
});

test('a candidate that became stable before its worker does not acquire another lease',async()=>{
 const f=bridgeFixture();await f.bridge.run(f.id,async()=>{});const sets=f.sets(),state=JSON.parse(f.values.get('review').value);
 await f.bridge.reconcile(f.id,{origin:'observation',onlyIfChanged:true});assert.equal(f.sets(),sets);assert.equal(JSON.parse(f.values.get('review').value).cycleId,state.cycleId);
});
