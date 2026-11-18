import {graphql, fetchLocation} from './api.mjs';
import {statusDoPainel, handleDoLocal} from './status.mjs';
import {createBridge,expiredOperation} from './flow-bridge/bridge.mjs';
import {REVIEW} from './flow-bridge/operations.mjs';
import {decisionVersion, authoritativeStatus} from './flow-bridge/state.mjs';
import {latestDecision} from './commercial-receipts.mjs';
import {migrateHistory} from './history-migration.mjs';

export const FLOW_BRIDGE_BUILD='ocean-production-20261117-1830';

const ROLLOUT = `query OceanBridgeRollout { shop { myshopifyDomain metafield(namespace:"ocean_b2b",key:"rollout") { value } } }`;
const STORE = 'mrdvrf-6a.myshopify.com';
let freshSequence=0;const freshSession=Date.now().toString(36);
function freshGraphql(query,variables){return graphql(query.replace(/^(\s*query\s+)([A-Za-z_][A-Za-z0-9_]*)/,(_,prefix,name)=>prefix+name+'_'+freshSession+'_'+ ++freshSequence),variables);}

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
  async syncLoaded(locations,{fullInventory=false}={}) {
    const config=await configuration();
    const warnings=[];
    if(config.mode==='preparing'&&fullInventory){
      try{await migrateHistory(locations,config);}catch(e){warnings.push(e.message);}
    }
    for (const location of locations) {
      if (!allowed(config,location.id)) continue;
      if(config.mode==='preparing'&&!config.testLocationIds?.includes(location.id))continue;
      try {
        const current=await bridge.read(location.id);
        if (current.state) {
          if(current.state.operationId){
            if(!expiredOperation(current.state))throw Error('Operacao ainda em andamento: '+current.state.operationId);
            await bridge.reconcile(location.id,{origin:'observation',recoveryOperationId:current.state.operationId});
            continue;
          }
          if(!current.state.ready)throw Error('Espelho bloqueado sem identificador de operacao; requer revisao.');
          const [freshLocation,decision]=await Promise.all([fetchLocation(location.id),readDecision(location.id)]);
          const actual=authoritativeStatus(freshLocation,decision,statusDoPainel);
          if(current.state.status!==actual||decisionVersion(current.state.decisionVersion)!==decisionVersion(decision.updatedAt)||(current.state.decisionStatus!==undefined&&current.state.decisionStatus!==decision.status)) {
            await bridge.reconcile(location.id,{origin:'observation'});
          } else await bridge.ensureSignal(current.state);
          continue;
        }
        if (config.mode==='production' && Date.parse(location.createdAt)<Date.parse(config.cutover)) continue;
        const origin=config.mode==='production' && Date.parse(location.createdAt)>=Date.parse(config.cutover) ? 'observation' : 'backfill';
        await bridge.reconcile(location.id,{origin});
      } catch(e) {warnings.push(`${location.id}: ${e.message}`);}
    }
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
