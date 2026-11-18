import {locationId, project, eventFor, authoritativeStatus, metafieldValues, claimNotification, confirmNotification, decisionVersion, NAMESPACE, STATUSES} from './state.mjs';
import {READ, SET, SIGNAL, READ_SIGNAL} from './operations.mjs';
import {newUuid} from './uuid.mjs';

function error(message, code) { return Object.assign(new Error(message), {code}); }
const LEASE_MS=300000;
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function equalValue(type,a,b){if(type==='date_time')return Math.floor(Date.parse(a)/1000)===Math.floor(Date.parse(b)/1000);if(type==='json'){try{return canonical(JSON.parse(a))===canonical(JSON.parse(b));}catch{return false;}}return a===b;}
export function expiredOperation(state,at=Date.now()){return Boolean(state?.operationId)&&at>=Date.parse(state.operationLeaseUntil||new Date(Date.parse(state.operationStartedAt||state.updatedAt)+LEASE_MS).toISOString());}


export function createBridge({query, loadAuthoritative, classify, enabled = false, emitSignals = false, now = () => new Date().toISOString(), uuid = newUuid}) {
  const active=new Set();
  async function exclusive(id,fn){if(active.has(id))throw error('Sincronizacao deste local em andamento nesta sessao.','BUSY');active.add(id);try{return await fn();}finally{active.delete(id);}}
  async function read(id,{allowDivergent=false}={}) {
    locationId(id);
    const {companyLocation: local} = await query(READ, {id});
    if (!local || local.id !== id) throw Error('Local indisponivel para sincronizacao.');
    const state = local.review ? JSON.parse(local.review.value) : null;
    if (local.review && (!state || typeof state !== 'object' || Array.isArray(state) || local.review.type !== 'json' || state.schema !== 1 || state.locationId !== id || !local.review.compareDigest || typeof state.ready !== 'boolean' || (!STATUSES.includes(state.status) && !(state.status === null && !state.ready)))) throw Error('Espelho invalido.');
    if (state?.cycleId && (!/^[a-zA-Z0-9-]{1,80}$/.test(state.cycleId) || !Number.isFinite(Date.parse(state.enteredAt)))) throw Error('Ciclo de analise invalido.');
    if (state?.ready && state.status === 'pendente' && !state.cycleId) throw Error('Cadastro pendente sem ciclo verificavel.');
    if (!state && [local.ready, local.status, local.cycle, local.entered].some(Boolean)) throw Error('Espelho parcial; sincronizacao requer revisao.');
    if (!allowDivergent && state?.ready && (local.ready?.value !== 'true' || local.status?.value !== state.status || local.cycle?.value !== (state.cycleId || 'none') || (state.enteredAt && Date.parse(local.entered?.value) !== Date.parse(state.enteredAt)))) throw Error('Metafields divergentes; notificacao bloqueada.');
    const ledger = local.ledger ? JSON.parse(local.ledger.value) : null;
    if (local.ledger && (local.ledger.type !== 'json' || !local.ledger.compareDigest || ledger.schema !== 1)) throw Error('Controle de notificacoes invalido.');
    return {state,reviewValue:local.review?.value??null, digest: local.review?.compareDigest ?? null, ledger, ledgerDigest: local.ledger?.compareDigest ?? null, signal:local.signal?JSON.parse(local.signal.value):null};
  }

  async function set(fields) {
    const {metafieldsSet: result} = await query(SET, {metafields: fields});
    if (!result || !Array.isArray(result.metafields) || result.userErrors?.length || result.metafields.length !== fields.length) throw error(result?.userErrors?.map(e => e.message).join('; ') || 'A Shopify nao confirmou os metafields.', result?.userErrors?.[0]?.code);
    const indexed = new Map(result.metafields.map(m => [m.key, m]));
    for (const field of fields) {
      const stored = indexed.get(field.key);
      const valueMatches=equalValue(field.type,stored?.value,field.value);
      if (!stored || stored.namespace !== NAMESPACE || stored.type !== field.type || !valueMatches) throw Error('Resposta de gravacao incompleta ou divergente.');
    }
    return indexed;
  }

  async function publish(id, previous, receipt, origin, context={}) {
    const source=await loadAuthoritative(id);
    if(source.location?.id!==id)throw Error('Decisao de outro local.');
    if(origin==='action_failure')origin=source.decision.status?'mutation':'backfill';
    const state=project({...source,previous,classify,now:now(),uuid,origin});
    state.signalPending=false;
    state.sourceKind='cadastro-b2b';
    state.projectionEpoch=source.projectionEpoch||null;
    state.lastSync={operationId:receipt.operationId,at:now(),recoveredOperationId:receipt.recoveredOperationId||null,...context};
    const written=await set(metafieldValues(state,receipt.digest));
    receipt.committed=true;
    receipt.finalDigest=written.get('review')?.compareDigest;
    if(!receipt.finalDigest)throw Error('Digest da gravacao final ausente.');
    // Check semantic values: Shopify may canonicalize JSON property order.
    let confirmed;
    for(let attempt=0;attempt<3;attempt++){
      confirmed=await read(id);
      if(canonical(confirmed.state)===canonical(state))break;
      if(attempt===2)throw error('Gravacao confirmada pela mutacao, mas releitura divergente. Sincronize novamente.','READ_AFTER_WRITE');
    }
    await ensureSignal(state);
    return state;
  }

  function validSignal(record,event){
    if(!record||record.type!==event.handle.type||record.handle.toLowerCase()!==event.handle.handle)return false;
    const f=Object.fromEntries((record.fields||[]).map(x=>[x.key,x.value]));
    const expected=Object.fromEntries(event.metaobject.fields.map(x=>[x.key,x.value]));
    return f.local_id===expected.local_id&&f.cycle_id===expected.cycle_id&&Date.parse(f.entered_at)===Date.parse(expected.entered_at);
  }
  async function signalReceipt(state,result){
    const current=await read(state.locationId,{allowDivergent:true});
    if(!current.state?.ready||current.state.operationId||current.state.cycleId!==state.cycleId||current.state.status!=='pendente')return;
    const value=JSON.stringify({schema:1,cycleId:state.cycleId,at:now(),...result});
    await set([{ownerId:state.locationId,namespace:NAMESPACE,key:'review',type:'json',value:current.reviewValue,compareDigest:current.digest},{ownerId:state.locationId,namespace:NAMESPACE,key:'signal',type:'json',value}]);
  }
  async function ensureSignal(state) {
    if(!emitSignals)return null;
    const event=eventFor(state);if(!event)return null;
    let record,details=[];
    try{
      record=(await query(READ_SIGNAL,{handle:event.handle})).metaobjectByHandle;
      if(!record){
        const {metaobjectUpsert:r}=await query(SIGNAL,event);
        details=(r?.userErrors||[]).map(e=>`${e.code||'ERROR'} ${e.field?.join('.')||''}: ${e.message}`);
        record=r?.metaobject;
      }
      // A lost response or a normalized handle must not cause a second signal.
      if(!validSignal(record,event))record=(await query(READ_SIGNAL,{handle:event.handle})).metaobjectByHandle;
      if(!validSignal(record,event))throw Error(details.join('; ')||'Sinal ausente ou campos do ciclo divergentes.');
      await signalReceipt(state,{status:'confirmed',eventId:record.id,handle:record.handle});
      // Legacy native projections used signalPending=true. Only normalize old
      // entries or an acknowledged first email; do not disturb a fresh claim.
      if(state.signalPending){
        const current=await read(state.locationId);
        if(current.state?.cycleId===state.cycleId&&current.state.ready&&!current.state.operationId&&(current.ledger?.novo?.state==='sent'||Date.parse(now())-Date.parse(state.enteredAt)>=LEASE_MS)){
          await set(metafieldValues({...current.state,signalPending:false},current.digest));
        }
      }
      return record;
    }catch(cause){
      try{await signalReceipt(state,{status:'retry_pending',handle:event.handle.handle,error:details.join('; ')||cause.message});}catch{}
      throw error('Estado comercial confirmado; emissao/confirmacao do sinal pendente: '+(details.join('; ')||cause.message),'SIGNAL_PENDING');
    }
  }
  async function acquire(id,recoveryOperationId){
    const before=await read(id,{allowDivergent:true});
    const old=before.state?.operationId;
    if(old&&old!==recoveryOperationId&&!expiredOperation(before.state,Date.parse(now())))throw error('Operacao ativa ate '+(before.state.operationLeaseUntil||new Date(Date.parse(before.state.updatedAt)+LEASE_MS).toISOString())+'. Atualize apos esse horario.','LOCKED');
    if(old&&old!==recoveryOperationId)throw error('Operacao expirada requer reconciliacao antes de uma nova acao.','RECOVERY_REQUIRED');
    const operationId=uuid(),startedAt=now();
    const blocked={...(before.state||{schema:1,locationId:id,status:null,cycleId:null,enteredAt:null,enrolled:false}),ready:false,operationId,operationStartedAt:startedAt,operationLeaseUntil:new Date(Date.parse(startedAt)+LEASE_MS).toISOString(),updatedAt:startedAt};
    const written=await set(metafieldValues(blocked,before.digest));
    const digest=written.get('review')?.compareDigest;if(!digest)throw Error('Digest da reserva ausente.');
    return {before,operationId,digest,blocked,recoveredOperationId:old||null};
  }
  async function failure(id,receipt,cause){
    if(receipt.committed)return;
    try{await set(metafieldValues({...receipt.blocked,lastError:{at:now(),code:cause.code||'SYNC_FAILED',message:cause.message}},receipt.digest));}catch{}
  }
  async function run(id,operation){
    if(!enabled)return operation();
    return exclusive(id,async()=>{
      const initial=await read(id,{allowDivergent:true});
      if(initial.state?.operationId&&expiredOperation(initial.state,Date.parse(now()))){
        const repair=await acquire(id,initial.state.operationId);
        try{await publish(id,repair.before.state,repair,'observation',{outcome:'lease_recovered'});}catch(cause){await failure(id,repair,cause);throw cause;}
      }
      const receipt=await acquire(id);
      let result;
      try{result=await operation();}
      catch(cause){
        try{await publish(id,receipt.before.state,receipt,receipt.before.state?'mutation':'action_failure',{outcome:'action_failed_state_reconciled',error:cause.message});}
        catch(recovery){await failure(id,receipt,recovery);throw error('Acao interrompida; avisos bloqueados ate recuperacao: '+recovery.message,recovery.code||'SYNC_FAILED');}
        throw error('A acao retornou erro; o estado atual foi reconciliado sem repetir a decisao. '+cause.message,'ACTION_RECONCILED');
      }
      try{await publish(id,receipt.before.state,receipt,'mutation',{outcome:'committed'});}
      catch(cause){await failure(id,receipt,cause);throw error('Acao comercial executada; sincronizacao requer recuperacao. Nao repita a decisao. '+cause.message,cause.code||'PROJECTION_FAILED');}
      return result;
    });
  }
  async function reconcile(id,{origin='backfill',recoveryOperationId}={}){
    if(!enabled)return {skipped:true,reason:'disabled'};
    if(!['backfill','observation'].includes(origin))throw Error('Origem invalida.');
    return exclusive(id,async()=>{
      const current=await read(id,{allowDivergent:true});
      const recovery=recoveryOperationId||(expiredOperation(current.state,Date.parse(now()))?current.state.operationId:undefined);
      const receipt=await acquire(id,recovery);
      try{return await publish(id,receipt.before.state,receipt,origin,{outcome:receipt.recoveredOperationId?'operation_recovered':'reconciled'});}
      catch(cause){await failure(id,receipt,cause);throw cause;}
    });
  }

  async function claim(id, event, kind, requestId) {
    if (!enabled) return null;
    const current = await read(id);
    const source = await loadAuthoritative(id);
    if (source.location?.id !== id || authoritativeStatus(source.location, source.decision, classify) !== current.state?.status) return null;
    const version = decisionVersion(source.decision.updatedAt);
    if (version !== current.state.decisionVersion) return null;
    const ledger = claimNotification(current.state, event, current.ledger, kind, requestId, now());
    if (!ledger) return null;
    await set([
      {ownerId: id, namespace: NAMESPACE, key: 'review', type: 'json', value: JSON.stringify(current.state), compareDigest: current.digest},
      {ownerId: id, namespace: NAMESPACE, key: 'notifications', type: 'json', value: JSON.stringify(ledger), compareDigest: current.ledgerDigest},
    ]);
    return ledger;
  }

  async function confirm(id, kind, requestId) {
    if (!enabled) return null;
    const current = await read(id);
    const ledger = confirmNotification(current.state, current.ledger, kind, requestId, now());
    await set([
      {ownerId: id, namespace: NAMESPACE, key: 'review', type: 'json', value: JSON.stringify(current.state), compareDigest: current.digest},
      {ownerId: id, namespace: NAMESPACE, key: 'notifications', type: 'json', value: JSON.stringify(ledger), compareDigest: current.ledgerDigest},
    ]);
    return ledger;
  }

  return {run,reconcile,read,claim,confirm,ensureSignal,busy:id=>active.has(id)};
}
