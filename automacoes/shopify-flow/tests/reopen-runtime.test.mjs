import test from 'node:test';
import assert from 'node:assert/strict';
import {ponteFlow} from '../../../extensions/app-home/src/flow-bridge-app.mjs';
const id='gid://shopify/CompanyLocation/8622571620';
function fixture(){
 const oldTime=new Date(Date.now()-120000).toISOString().replace(/\.\d{3}Z$/,'Z');
 const reopenedAt=new Date(Date.now()-1000).toISOString();
 let privateStatus='reaberto';let privateTime=reopenedAt;let serial=0;
 const values=new Map();const signals=new Map();
 const state={schema:1,locationId:id,ready:true,operationId:null,status:'pendente',cycleId:'old-cycle',enteredAt:oldTime,enrolled:true,reopenVersion:null,decisionVersion:null,updatedAt:oldTime,signalPending:false};
 for(const[key,type,value]of[['review','json',JSON.stringify(state)],['ready','boolean','true'],['status','single_line_text_field','pendente'],['cycle_id','single_line_text_field','old-cycle'],['pending_since','date_time',oldTime]])values.set(key,{key,type,value,namespace:'ocean_b2b',compareDigest:'hash-'+value});
 const loc={id,createdAt:oldTime,roleAssignments:{nodes:[],pageInfo:{hasNextPage:false}},company:{id:'gid://shopify/Company/7442366564',name:'OCEAN B2B TESTE FLOW 20261117',mainContact:{id:'c'},contacts:{nodes:[{id:'c',customer:{id:'u'}}],pageInfo:{hasNextPage:false}},contactRoles:{nodes:[]}}};
 const calls=[];
 globalThis.shopify={query:async(q,{variables:v})=>{
  calls.push(q);
  if(q.includes('query OceanBridgeRollout'))return {data:{shop:{myshopifyDomain:'mrdvrf-6a.myshopify.com',metafield:{value:JSON.stringify({mode:'test',testLocationIds:[id]})}}}};
  if(q.includes('query OceanStatusReprovados'))return {data:{metaobjects:{nodes:[{id:'gid://shopify/Metaobject/1',handle:'local-8622571620',updatedAt:privateTime,fields:[{key:'local_id',value:id},{key:'status',value:privateStatus},{key:'alterado_em',value:privateTime}]}].filter(()=>privateStatus),pageInfo:{hasNextPage:false}}}};
  if(q.includes('query OceanReadBridgeBatch'))return {data:{nodes:[{id,...Object.fromEntries([['review','review'],['ready','ready'],['status','status'],['cycle','cycle_id'],['entered','pending_since'],['ledger','notifications'],['signal','signal']].map(([a,k])=>[a,values.get(k)||null]))}]}};
  if(q.includes('query OceanReadBridge'))return {data:{companyLocation:{id,...Object.fromEntries([['review','review'],['ready','ready'],['status','status'],['cycle','cycle_id'],['entered','pending_since'],['ledger','notifications'],['signal','signal']].map(([a,k])=>[a,values.get(k)||null]))}}};
  if(q.includes('query OceanReadCommercialDecision'))return {data:{metaobjectByHandle:{id:'gid://shopify/Metaobject/1',handle:'local-8622571620',updatedAt:privateTime,fields:[{key:'local_id',value:id},{key:'status',value:privateStatus},{key:'alterado_em',value:privateTime}]}}};
  if(q.includes('query OceanLocation('))return {data:{companyLocation:loc}};
  if(q.includes('mutation OceanSetBridge')){
   for(const f of v.metafields)if(Object.hasOwn(f,'compareDigest')&&f.compareDigest!==(values.get(f.key)?.compareDigest??null))return {data:{metafieldsSet:{metafields:[],userErrors:[{code:'INVALID_COMPARE_DIGEST',message:'CAS'}]}}};
   const written=v.metafields.map(f=>({...f,id:'mf-'+f.key,compareDigest:'hash-'+f.value}));written.forEach(f=>values.set(f.key,f));return {data:{metafieldsSet:{metafields:written,userErrors:[]}}};
  }
  if(q.includes('query OceanReadSignal'))return {data:{metaobjectByHandle:signals.get(v.handle.handle)||null}};
  if(q.includes('mutation OceanSignalCycle')){const handle=v.handle.handle;if(!signals.has(handle))signals.set(handle,{id:'event-'+signals.size,...v.handle,fields:v.metaobject.fields,updatedAt:new Date().toISOString()});return {data:{metaobjectUpsert:{metaobject:signals.get(handle),userErrors:[]}}};}
  throw Error('Unexpected GraphQL: '+q.slice(0,80));
 }};
 return {id,loc,state,reopenedAt,values,signals,calls,setPrivate:(s,t)=>{privateStatus=s;privateTime=t;}};
}
test('Reconciliacao consulta decisao privada mesmo quando o espelho pronto ja existe',async()=>{
 const f=fixture();await ponteFlow.syncLoaded([f.loc]);const state=JSON.parse(f.values.get('review').value);
 assert.notEqual(state.cycleId,'old-cycle','Reabertura privada nova nao pode ficar no ciclo antigo');
 assert.equal(state.status,'pendente');assert.equal(state.decisionStatus,'reaberto');assert.equal(f.signals.size,1);
 const cycle=state.cycleId,since=state.enteredAt;await ponteFlow.syncLoaded([f.loc]);
 const reload=JSON.parse(f.values.get('review').value);assert.equal(reload.cycleId,cycle);assert.equal(reload.enteredAt,since);assert.equal(f.signals.size,1);
});
test('Carregamento de espelho estavel nao disputa o digest com o Flow',async()=>{
 const f=fixture();f.setPrivate(null,null);const original=f.values.get('review');original.value=JSON.stringify({...f.state,signalPending:true});original.compareDigest='hash-'+original.value;
 await ponteFlow.syncLoaded([f.loc]);
 assert.ok(f.calls.filter(q=>q.includes('mutation OceanSetBridge')).length<=1);
 assert.equal(f.values.get('review').compareDigest,original.compareDigest);
});
test('Reabertura completa nao depende de globalThis.crypto no painel Shopify',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
 try{const f=fixture();const warnings=await ponteFlow.syncLoaded([f.loc]);assert.deepEqual(warnings,[]);const state=JSON.parse(f.values.get('review').value);assert.match(state.cycleId,/^[0-9a-f]{8}-[0-9a-f]{4}-7/);assert.notEqual(state.cycleId,'old-cycle');assert.equal(f.signals.size,1);}
 finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});
test('Espelho pronto, sem operacao e sinal pendente nao relê nem regrava o local estavel',async()=>{
 const f=fixture();f.setPrivate(null,null);
 const before=f.values.get('review').value;
 const warnings=await ponteFlow.syncLoaded([f.loc]);assert.deepEqual(warnings,[]);
 assert.equal(f.values.get('review').value,before);
 assert.equal(f.calls.filter(q=>q.includes('mutation')).length,0);
 assert.equal(f.calls.filter(q=>q.includes('query OceanLocation(')).length,0);
 assert.equal(f.calls.filter(q=>q.includes('query OceanReadCommercialDecision')).length,0);
 assert.equal(f.calls.filter(q=>q.includes('query OceanReadSignal')).length,0);
});
