// Replays the pre-fix local source with production reads. This harness rejects
// every mutation, so its timing excludes receipt writes and measures no emails.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const root=new URL('../../../',import.meta.url);
const token=JSON.parse(readFileSync('/tmp/ocean-owner-token.json'));
if(token.expires_at<Date.now()+60000)throw Error('Temporary app token unavailable or expired');
const calls=[],blockedWrites=[];
globalThis.shopify={query:async(query,{variables={},version='2026-10'}={})=>{
 const operation=query.match(/(?:query|mutation)\s+(\w+)/)?.[1];
 if(/^\s*mutation\b/.test(query)){blockedWrites.push(operation);throw Error('Read-only benchmark blocked mutation');}
 const start=performance.now();const res=await fetch('https://mrdvrf-6a.myshopify.com/admin/api/'+version+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':'pt-BR','X-Shopify-Access-Token':token.access_token},body:JSON.stringify({query,variables})});
 const body=await res.json();calls.push({operation,ms:Math.round(performance.now()-start),httpStatus:res.status,cost:body.extensions?.cost,errors:body.errors});if(!res.ok)throw Error('HTTP '+res.status);return body;
}};
const source=new URL('automacoes/shopify-flow/backups/performance-20261118/src/',root);
const {fetchAllLocations}=await import(new URL('api.mjs',source));
const {fetchReviewStatuses}=await import(new URL('reprovados-api.mjs',source));
const {ponteFlow}=await import(new URL('flow-bridge-app.mjs',source));
const start=performance.now();const [locations,decisions]=await Promise.all([fetchAllLocations(),fetchReviewStatuses()]);
const essentialsMs=Math.round(performance.now()-start),essentialRequests=calls.length;
const warnings=await ponteFlow.syncLoaded(locations,{fullInventory:true});
const result={at:new Date().toISOString(),essentialsMs,totalMs:Math.round(performance.now()-start),essentialRequests,locations:locations.length,calls,blockedWrites,warnings,readOnly:true,browserRenderingMeasured:false};
writeFileSync(new URL('automacoes/shopify-flow/reports/performance-before-repeat.json',root),JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify({essentialsMs,totalMs:result.totalMs,requests:calls.length,blockedWrites:blockedWrites.length}));
