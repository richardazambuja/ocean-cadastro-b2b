import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {loadPanelData} from '../../../extensions/app-home/src/panel-data.mjs';
import {graphql} from '../../../extensions/app-home/src/api.mjs';
import {READ_MANY} from '../../../extensions/app-home/src/flow-bridge/operations.mjs';
import {parseBridgeRecord} from '../../../extensions/app-home/src/flow-bridge/bridge.mjs';
import {authoritativeStatus,decisionVersion} from '../../../extensions/app-home/src/flow-bridge/state.mjs';
import {statusDoPainel} from '../../../extensions/app-home/src/status.mjs';
const root=new URL('../../../',import.meta.url),mode=process.argv[2];
if(!['before','after'].includes(mode))throw Error('Use before or after');
const token=JSON.parse(readFileSync('/tmp/ocean-owner-token.json'));
if(token.expires_at<Date.now()+60000)throw Error('Token expired');
globalThis.shopify={query:async(query,{variables={},version='2026-10'}={})=>{
 if(/^\s*mutation\b/.test(query))throw Error('Audit rejects every mutation');
 const response=await fetch('https://mrdvrf-6a.myshopify.com/admin/api/'+version+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':'pt-BR','X-Shopify-Access-Token':token.access_token},body:JSON.stringify({query,variables})});
 const body=await response.json();if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{status:response.status});return body;
}};
const snapshot=await loadPanelData(),rows=[];
for(let start=0;start<snapshot.locations.length;start+=50){
 const items=snapshot.locations.slice(start,start+50);
 const {nodes}=await graphql(READ_MANY,{ids:items.map(l=>l.id)});
 for(let i=0;i<items.length;i++){
  const location=items[i],mirror=parseBridgeRecord(location.id,nodes[i]);
  const decision=snapshot.reviewDecisions.get(location.id)||{verified:true,localId:location.id,status:null,updatedAt:null};
  const status=authoritativeStatus(location,decision,statusDoPainel);
  assert.equal(mirror.state.status,status);assert.equal(mirror.state.ready,true);assert.equal(mirror.state.operationId,null);
  assert.equal(decisionVersion(mirror.state.decisionVersion),decisionVersion(decision.updatedAt));
  rows.push({id:location.id,status,roles:location.roleAssignments.nodes,review:mirror.state,digest:mirror.digest,ledger:mirror.ledger,ledgerDigest:mirror.ledgerDigest,signal:mirror.signal});
 }
}
const {shop,currentAppInstallation}=await graphql('query OceanPerformanceIdentity {shop{myshopifyDomain metafield(namespace:"ocean_b2b",key:"rollout"){value}}currentAppInstallation{app{id title apiKey}}}');
assert.equal(shop.myshopifyDomain,'mrdvrf-6a.myshopify.com');assert.equal(currentAppInstallation.app.apiKey,'cbdf3320e1517c8e9006c806a882be25');
const config=JSON.parse(shop.metafield.value);assert.equal(config.mode,'production');assert.equal(config.productionApproved,true);assert.equal(config.recipient,'cadastros@oceanjoiasbr.com');
let preserved=null;
if(mode==='after'){
 const baseline=JSON.parse(readFileSync(new URL('automacoes/shopify-flow/reports/performance-store-before.json',root)));
 assert.deepEqual(rows,baseline.rows,'A production state changed during release; investigate before reporting preservation');
 assert.deepEqual(config,baseline.config);preserved=true;
}
const report={at:new Date().toISOString(),mode,shop:shop.myshopifyDomain,app:currentAppInstallation.app,config,rows,allCommercialStatesMatch:true,allLocationsReady:true,permissionsCyclesLedgersDigestsPreserved:preserved,mutations:0};
writeFileSync(new URL(`automacoes/shopify-flow/reports/performance-store-${mode}.json`,root),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({mode,locations:rows.length,allCommercialStatesMatch:true,allLocationsReady:true,preserved,affected:rows.find(x=>x.id==='gid://shopify/CompanyLocation/8606646372')?.review}));
