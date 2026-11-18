import {graphql} from './api.mjs';
import {fetchReviewRecords} from './reprovados-api.mjs';
import {statusDoPainel} from './status.mjs';
import {project,metafieldValues,decisionVersion} from './flow-bridge/state.mjs';
import {newUuid} from './flow-bridge/uuid.mjs';
import {SET} from './flow-bridge/operations.mjs';
const Q=`query OceanMigrationMirrors($after:String){companyLocations(first:50,after:$after){nodes{id review:metafield(namespace:"ocean_b2b",key:"review"){value compareDigest}}pageInfo{hasNextPage endCursor}}}`;
const JOURNAL='gid://shopify/CompanyLocation/8622571620';
let running=null;
function parseDecision(id,node){
 if(!node)return {verified:true,localId:id,status:null,updatedAt:null};
 const f=Object.fromEntries(node.fields.map(x=>[x.key,x.value]));
 if(f.local_id!==id)throw Error('Decisao de outro local na migracao.');
 return {verified:true,localId:id,status:f.status,updatedAt:f.alterado_em};
}
function fingerprint(records){return JSON.stringify([...records].map(([id,r])=>[id,...r.fields.filter(f=>['status','alterado_em'].includes(f.key)).map(f=>[f.key,f.value]).sort()]).sort());}
async function mirrorMap(){const map=new Map();let after=null;for(let p=0;p<100;p++){const c=(await graphql(Q,{after})).companyLocations;if(!c?.nodes)throw Error('Inventario de espelhos incompleto.');c.nodes.forEach(x=>map.set(x.id,x.review));if(!c.pageInfo?.hasNextPage)return map;if(!c.pageInfo.endCursor||after===c.pageInfo.endCursor)throw Error('Paginacao invalida.');after=c.pageInfo.endCursor;}throw Error('Limite de inventario atingido.');}
export async function migrateHistory(locations,cfg){
 if(running)return running;
 if(cfg.mode!=='preparing'||!cfg.epoch)throw Error('Migracao exige modo de preparacao e epoch.');
 running=(async()=>{
  const report={schema:1,epoch:cfg.epoch,startedAt:new Date().toISOString(),total:0,written:0,unchanged:0,errors:[],complete:false,statusCounts:{}};
  try{
   for(let pass=0;pass<3;pass++){
    report.errors=[];const [records,mirrors]=await Promise.all([fetchReviewRecords(),mirrorMap()]);const initial=fingerprint(records);
    const work=[];report.total=0;report.statusCounts={};
    for(const location of locations){
     if(cfg.testLocationIds?.includes(location.id))continue;
     report.total++;
     try{
      const metafield=mirrors.get(location.id),previous=metafield?JSON.parse(metafield.value):null;
      if(previous&&(previous.schema!==1||previous.locationId!==location.id))throw Error('Espelho invalido, nao sobrescrito.');
      if(previous?.operationId)throw Error('Operacao ativa ou interrompida; migracao nao assume sua propriedade.');
      const decision=parseDecision(location.id,records.get(location.id));
      const actual=statusDoPainel(location,{[location.id]:decision.status});report.statusCounts[actual]=(report.statusCounts[actual]||0)+1;
      if(previous?.ready&&previous.projectionEpoch===cfg.epoch&&previous.sourceKind==='cadastro-b2b'&&previous.status===actual&&decisionVersion(previous.decisionVersion)===decisionVersion(decision.updatedAt)){report.unchanged++;continue;}
      const state=project({location,decision,previous,classify:statusDoPainel,now:new Date().toISOString(),uuid:newUuid,origin:'backfill'});
      Object.assign(state,{enrolled:false,signalPending:false,sourceKind:'cadastro-b2b',projectionEpoch:cfg.epoch,migratedAt:new Date().toISOString()});
      work.push({id:location.id,fields:metafieldValues(state,metafield?.compareDigest??null)});
     }catch(e){report.errors.push({id:location.id,error:e.message});}
    }
    let batch=[],ids=[];
    async function flush(){if(!batch.length)return;const r=(await graphql(SET,{metafields:batch})).metafieldsSet;if(r?.userErrors?.length||r?.metafields?.length!==batch.length){for(const id of ids)report.errors.push({id,error:r?.userErrors?.map(x=>x.code+': '+x.message).join('; ')||'Resposta incompleta.'});}else report.written+=ids.length;batch=[];ids=[];}
    for(const item of work){if(batch.length+item.fields.length>25)await flush();batch.push(...item.fields);ids.push(item.id);}await flush();
    const checked=await fetchReviewRecords();report.privateSnapshotStable=initial===fingerprint(checked);report.pass=pass+1;
    if(report.privateSnapshotStable&&!report.errors.length){report.complete=true;break;}
   }
  }catch(e){report.errors.push({error:e.message});}
  report.completedAt=new Date().toISOString();
  const r=(await graphql(SET,{metafields:[{ownerId:JOURNAL,namespace:'ocean_b2b',key:'migration',type:'json',value:JSON.stringify(report)}]})).metafieldsSet;
  if(r?.userErrors?.length||r?.metafields?.length!==1)throw Error('Nao foi possivel confirmar o registro da reconciliacao historica.');
  if(!report.complete)throw Error('Reconciliacao historica incompleta: '+JSON.stringify(report.errors.slice(0,5)));
  return report;
 })();
 try{return await running;}finally{running=null;}
}
