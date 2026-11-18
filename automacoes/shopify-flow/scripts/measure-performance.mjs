import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const root=new URL('../../../',import.meta.url).pathname.replace(/\/$/,''),token=JSON.parse(readFileSync('/tmp/ocean-owner-token.json'));
if(token.expires_at<Date.now()+60000)throw Error('Token expired');
const calls=[];
globalThis.shopify={query:async(query,{variables={},version='2026-10'}={})=>{
 if(/^\s*mutation\b/.test(query))throw Error('Read-only performance validation blocks all mutations');
 const start=performance.now();
 const res=await fetch('https://mrdvrf-6a.myshopify.com/admin/api/'+version+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':'pt-BR','X-Shopify-Access-Token':token.access_token},body:JSON.stringify({query,variables})});
 const body=await res.json();calls.push({operation:query.match(/(?:query|mutation)\s+(\w+)/)?.[1],ms:Math.round(performance.now()-start),httpStatus:res.status,cost:body.extensions?.cost,errors:body.errors});if(!res.ok)throw Object.assign(Error('HTTP '+res.status),{status:res.status});return body;
}};
const {loadPanelData}=await import(root+'/extensions/app-home/src/panel-data.mjs');
const {ponteFlow}=await import(root+'/extensions/app-home/src/flow-bridge-app.mjs');
const {statusDoPainel}=await import(root+'/extensions/app-home/src/status.mjs');
const {requestMetrics}=await import(root+'/extensions/app-home/src/request-control.mjs');
const baseline=JSON.parse(readFileSync(root+'/automacoes/shopify-flow/reports/performance-store-before.json'));
const samples=[];
for(let n=0;n<3;n++){
 const start=performance.now(),before=calls.length;
 const snapshot=await loadPanelData();const foregroundEnd=calls.length;
 const essentialsMs=Math.round(performance.now()-start);
 const warnings=await ponteFlow.syncLoaded(snapshot.locations,{reviewDecisions:snapshot.reviewDecisions,loadedAt:snapshot.loadedAt,fullInventory:true});
 for(const l of snapshot.locations){const prior=baseline.rows.find(b=>b.id===l.id);assert.ok(prior,'Location added since baseline');assert.deepEqual(l.roleAssignments.nodes,prior.roles);assert.equal(statusDoPainel(l,snapshot.decisions),prior.status);}
 assert.deepEqual(warnings,[]);
 samples.push({kind:['open','refresh','reopen'][n],essentialsMs,totalWithBackgroundMs:Math.round(performance.now()-start),locations:snapshot.locations.length,foregroundRequests:foregroundEnd-before,backgroundRequests:calls.length-foregroundEnd,warnings});
}
const report={at:new Date().toISOString(),samples,calls,metrics:requestMetrics(),permissionsPreserved:true,commercialStatesPreserved:true,mutations:0,validation:'Production API with app identity; excludes browser render and App Bridge transport'};
writeFileSync(root+'/automacoes/shopify-flow/reports/performance-after.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({samples,permissionsPreserved:true,commercialStatesPreserved:true,mutations:0}));
