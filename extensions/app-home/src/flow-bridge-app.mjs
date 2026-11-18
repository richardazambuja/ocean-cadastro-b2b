import {graphql, fetchLocation} from './api.mjs';
import {statusDoPainel, handleDoLocal} from './status.mjs';
import {createBridge,expiredOperation,parseBridgeRecord} from './flow-bridge/bridge.mjs';
import {REVIEW,READ_MANY} from './flow-bridge/operations.mjs';
import {decisionVersion, authoritativeStatus} from './flow-bridge/state.mjs';
import {latestDecision} from './commercial-receipts.mjs';
import {migrateHistory} from './history-migration.mjs';
import {fetchReviewSnapshot} from './reprovados-api.mjs';
import {synchronizeLocations} from './notification-sync.mjs';

export const FLOW_BRIDGE_BUILD='ocean-performance-20261118';

const ROLLOUT = `query OceanBridgeRollout { shop { myshopifyDomain metafield(namespace:"ocean_b2b",key:"rollout") { value } } }`;
const STORE = 'mrdvrf-6a.myshopify.com';
let freshSequence=0;const freshSession=Date.now().toString(36);
function freshGraphql(query,variables,options){return graphql(query.replace(/^(\s*query\s+)([A-Za-z_][A-Za-z0-9_]*)/,(_,prefix,name)=>prefix+name+'_'+freshSession+'_'+ ++freshSequence),variables,options);}

async function configuration() {
  const data = await freshGraphql(ROLLOUT);
  if (data.shop?.myshopifyDomain !== STORE) return {mode:'disabled'};
  const value = data.shop.metafield?.value;
  if (!value) return {mode:'disabled'};
  const parsed = JSON.parse(value);
  return ['test','preparing','production'].includes(parsed.mode) ? parsed : {mode:'disabled'};
}

async function readDecision(id) {
  const data = await freshGraphql(REVIEW,{handle:{type:'$app:cadastro_decisao',handle:handleDoLocal(id)}});
  if (!Object.hasOwn(data,'metaobjectByHandle')) throw Error('Resposta sem decisao comercial.');
  const record=latestDecision(id,data.metaobjectByHandle);
  if (!record) return {verified:true,localId:id,status:null,updatedAt:null};
  const fields=Object.fromEntries(record.fields.map(f=>[f.key,f.value]));
  if (fields.local_id!==id || record.handle!==handleDoLocal(id)) throw Error('Decisao comercial de outro local.');
  return {verified:true,localId:id,status:fields.status,updatedAt:fields.alterado_em||null,metaobjectId:record.id,metaobjectUpdatedAt:record.updatedAt};
}

const bridge=createBridge({enabled:true,emitSignals:true,query:freshGraphql,classify:statusDoPainel,loadAuthoritative:async id=>{
  const [location,decision,cfg]=await Promise.all([fetchLocation(id),readDecision(id),configuration()]);
  return {location,decision,projectionEpoch:cfg.epoch||null};
}});

function allowed(config,id) {
  return ['preparing','production'].includes(config.mode) || (config.mode==='test' && Array.isArray(config.testLocationIds) && config.testLocationIds.includes(id));
}

export const ponteFlow={
  async testing() {const config=await configuration();return ['test','preparing'].includes(config.mode)&&config.productionApproved!==true;},
  async run(id,operation) {
    // Missing rollout disables the bridge. A failed configuration read stops the
    // operation rather than changing a decision without invalidating its mirror.
    const config=await configuration();
    return allowed(config,id) ? bridge.run(id,operation) : operation();
  },
  async syncLoaded(locations,{fullInventory=false,reviewDecisions,loadedAt=Date.now()}={}) {
    // Listing passes the verified decision snapshot; other callers read it once.
    const [config,snapshot]=await Promise.all([configuration(),reviewDecisions?Promise.resolve({decisions:reviewDecisions}):fetchReviewSnapshot()]);
    const warnings=[];
    if(config.mode==='disabled')return warnings;
    if(Date.now()-loadedAt>30000)return ['Dados antigos; sincronizacao adiada ate a proxima atualizacao.'];
    if(config.mode==='preparing'&&fullInventory){
      try{await migrateHistory(locations,config);}catch(e){warnings.push(e.message);return warnings;}
    }
    const eligible=locations.filter(l=>allowed(config,l.id)&&(config.mode!=='preparing'||config.testLocationIds?.includes(l.id)));
    const mirrors=new Map();
    for(let offset=0;offset<eligible.length;offset+=50){
      const ids=eligible.slice(offset,offset+50).map(l=>l.id);
      const data=await freshGraphql(READ_MANY,{ids},{background:true});
      if(!Array.isArray(data.nodes)||data.nodes.length!==ids.length)throw Error('Inventario de avisos incompleto.');
      data.nodes.forEach((local,i)=>{
        try{mirrors.set(ids[i],parseBridgeRecord(ids[i],local));}
        catch(e){warnings.push(`${ids[i]}: ${e.message}`);}
      });
    }
    const candidates=[];
    for(const location of eligible){
      const current=mirrors.get(location.id);if(!current)continue;
      try{
        const state=current.state;
        if(state?.operationId){
          if(!expiredOperation(state))continue;
          candidates.push({id:location.id,recoveryOperationId:state.operationId});continue;
        }
        if(state&&!state.ready)throw Error('Espelho bloqueado sem identificador de operacao; requer revisao.');
        const decision=snapshot.decisions.get(location.id)||{verified:true,localId:location.id,status:null,updatedAt:null};
        const actual=authoritativeStatus(location,decision,statusDoPainel);
        if(state){
          const changed=state.status!==actual||decisionVersion(state.decisionVersion)!==decisionVersion(decision.updatedAt)||(state.decisionStatus!==undefined&&state.decisionStatus!==decision.status);
          const retrySignal=state.signalPending===true||(current.signal?.cycleId===state.cycleId&&current.signal?.status==='retry_pending');
          if(changed)candidates.push({id:location.id});
          else if(retrySignal)candidates.push({id:location.id,signalOnly:true});
          // ready=true, no operation, no pending signal: zero per-location calls.
          continue;
        }
        if(config.mode==='production'&&Date.parse(location.createdAt)<Date.parse(config.cutover))continue;
        candidates.push({id:location.id,origin:config.mode==='production'?'observation':'backfill'});
      }catch(e){warnings.push(`${location.id}: ${e.message}`);}
    }
    warnings.push(...await synchronizeLocations(candidates,async job=>{
      if(bridge.busy(job.id))return;
      if(job.signalOnly){
        // Re-read under the worker; never emit from an old listing snapshot.
        const current=await bridge.read(job.id);
        if(current.state?.ready&&!current.state.operationId&&(current.state.signalPending||(current.signal?.cycleId===current.state.cycleId&&current.signal?.status==='retry_pending')))await bridge.ensureSignal(current.state);
      }else await bridge.reconcile(job.id,{origin:job.origin||'observation',recoveryOperationId:job.recoveryOperationId,onlyIfChanged:true});
    }));
    return warnings;
  },
  async reconcile(id,options) {
    const config=await configuration();
    if (!allowed(config,id)) throw Error('Local fora do escopo de implantacao.');
    return bridge.reconcile(id,options);
  },
  async inspect(id) {
    const config=await configuration();
    if(!['test','preparing'].includes(config.mode)||!config.testLocationIds?.includes(id)) throw Error('Diagnostico permitido somente em cadastro de teste autorizado.');
    const [location,decision,mirror]=await Promise.all([fetchLocation(id),readDecision(id),bridge.read(id)]);
    return {build:FLOW_BRIDGE_BUILD,locationId:id,decision,mirror:mirror.state,ledger:mirror.ledger,signal:mirror.signal,roleAssignmentIds:location.roleAssignments.nodes.map(x=>x.id),companyId:location.company.id};
  },
  async rollout(){return configuration();},
  async synchronize(id,origin='observation'){const cfg=await configuration();if(!allowed(cfg,id))throw Error('Local fora da implantacao.');return bridge.reconcile(id,{origin});},
};
