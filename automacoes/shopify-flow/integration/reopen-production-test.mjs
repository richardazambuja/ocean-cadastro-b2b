import {graphql,fetchLocation} from './api.mjs';
import {lerReviewStatus,salvarReviewStatus} from './reprovados-api.mjs';
import {statusDoPainel} from './status.mjs';
import {classifyLocation} from './regras.mjs';
import {approveLocation} from './aprovar.mjs';
import {rejectLocation,reopenLocation} from './review-actions.mjs';
import {ponteFlow,FLOW_BRIDGE_BUILD} from './flow-bridge-app.mjs';
import {SET} from './flow-bridge/operations.mjs';

export const REOPEN_TEST_IDS=Object.freeze(['gid://shopify/CompanyLocation/8622571620','gid://shopify/CompanyLocation/8622702692']);
const COMPANIES=['gid://shopify/Company/7442366564','gid://shopify/Company/7442399332'];
const deps={getLocation:fetchLocation,readDecision:lerReviewStatus,saveDecision:salvarReviewStatus,classify:classifyLocation,status:statusDoPainel};
const assert=(value,message)=>{if(!value)throw Error(message);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function runReopenProductionTest(progress=()=>{},{requestId=null}={}) {
  assert(await ponteFlow.testing(),'Teste exige rollout restrito.');
  const trace={schema:1,build:FLOW_BRIDGE_BUILD,requestId,testId:'reopen-'+Date.now(),startedAt:new Date().toISOString(),steps:[]};
  async function record(phase,id) {
    const snapshot=await ponteFlow.inspect(id);
    assert(COMPANIES[REOPEN_TEST_IDS.indexOf(id)]===snapshot.companyId,'Empresa fora do cadastro sintetico autorizado.');
    const step={phase,at:new Date().toISOString(),...snapshot};trace.steps.push(step);
    const value=JSON.stringify(trace);
    const {metafieldsSet:r}=await graphql(SET,{metafields:[{ownerId:REOPEN_TEST_IDS[0],namespace:'ocean_b2b',key:'reopen_test',type:'json',value}]});
    assert(r?.metafields?.[0]?.value===value&&!r.userErrors?.length,r?.userErrors?.map(x=>x.message).join('; ')||'Falha na gravacao da evidencia do teste.');
    progress(phase);
    return snapshot;
  }
  async function transition(id,action,expected) {
    await ponteFlow.run(id,()=>action(id,deps));
    const s=await record(expected,id);
    assert(s.mirror?.ready&&!s.mirror.operationId,'Espelho nao confirmado.');
    assert(s.roleAssignmentIds.length===0,'Teste interrompido: permissao B2B existente; nenhum acesso sera alterado.');
    assert(s.decision.status===(expected.includes('rejected')?'reprovado':'reaberto'),'Decisao privada divergente.');
    assert(s.mirror.status===(expected.includes('rejected')?'reprovado':'pendente'),'Status compartilhado divergente.');
    return s;
  }
  async function waitImmediate(id,cycleId,phase) {
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){
      const s=await ponteFlow.inspect(id);
      if(s.ledger?.cycleId===cycleId&&s.ledger.novo?.state==='sent')return record(phase,id);
      await sleep(1500);
    }
    throw Error('Aviso imediato nao confirmado em 45 segundos; escopo real permanece bloqueado.');
  }
  try {
    const primary=REOPEN_TEST_IDS[0],approval=REOPEN_TEST_IDS[1];
    for(const id of REOPEN_TEST_IDS){const s=await record('before',id);assert(s.roleAssignmentIds.length===0,'Teste nao altera cadastros com acesso B2B.');assert(['pendente','reprovado'].includes(statusDoPainel(await fetchLocation(id),{[id]:s.decision.status})),'Cadastro de teste nao esta pendente/reprovado.');}
    const initial=await ponteFlow.inspect(primary);
    if(initial.decision.status!=='reprovado')await transition(primary,rejectLocation,'primary_rejected');
    else await record('primary_already_rejected',primary);
    const a=await transition(primary,reopenLocation,'old_cycle_reopened');
    assert(a.mirror.cycleId!==initial.mirror?.cycleId,'Reabertura conservou o ciclo antigo.');
    await waitImmediate(primary,a.mirror.cycleId,'old_cycle_immediate');
    await transition(primary,rejectLocation,'old_cycle_rejected');
    const b=await transition(primary,reopenLocation,'current_cycle_reopened');
    assert(b.mirror.cycleId!==a.mirror.cycleId,'Segunda reabertura nao gerou novo UUID.');
    await ponteFlow.syncLoaded([await fetchLocation(primary)]);
    const refreshed=await record('refresh_confirmed',primary);
    assert(refreshed.mirror.cycleId===b.mirror.cycleId&&refreshed.mirror.enteredAt===b.mirror.enteredAt,'Atualizar dados duplicou o ciclo.');
    await waitImmediate(primary,b.mirror.cycleId,'current_cycle_immediate');
    const prior=await ponteFlow.inspect(approval);
    if(prior.decision.status!=='reprovado')await transition(approval,rejectLocation,'approval_rejected');
    else await record('approval_already_rejected',approval);
    const c=await transition(approval,reopenLocation,'approval_reopened');
    await waitImmediate(approval,c.mirror.cycleId,'approval_immediate');
    await ponteFlow.run(approval,()=>approveLocation(approval,deps));
    const approved=await record('approved_before_deadline',approval);
    assert(approved.decision.status==='aprovado_pendente'&&approved.mirror.status==='aprovado_pendente','Aprovacao comercial sem acesso nao sincronizou.');
    assert(approved.roleAssignmentIds.length===0,'Permissoes B2B foram alteradas.');
    assert(Date.now()<Date.parse(c.mirror.enteredAt)+600000,'Aprovacao ocorreu depois do prazo.');
    await record('waiting_flow',primary);
    return {trace,primaryCycle:b.mirror.cycleId,oldCycle:a.mirror.cycleId,approvalCycle:c.mirror.cycleId,deadline:Math.max(Date.parse(b.mirror.enteredAt),Date.parse(c.mirror.enteredAt))+600000};
  } catch(error) {
    trace.error={message:error.message,at:new Date().toISOString()};
    try {await graphql(SET,{metafields:[{ownerId:REOPEN_TEST_IDS[0],namespace:'ocean_b2b',key:'reopen_test',type:'json',value:JSON.stringify(trace)}]});}catch{}
    throw error;
  }
}

let requestedRunning=null;
export async function runRequestedVerification(progress=()=>{}){
 const cfg=await ponteFlow.rollout();const request=cfg.verificationRequest;
 if(cfg.mode!=='preparing'||!request?.id)return null;
 if(requestedRunning)return requestedRunning;
 const data=await graphql(`query OceanVerificationJournal($id:ID!){companyLocation(id:$id){metafield(namespace:"ocean_b2b",key:"reopen_test"){value}}}`,{id:REOPEN_TEST_IDS[0]});
 const value=data.companyLocation?.metafield?.value;
 const previous=value?JSON.parse(value):null;
 if(previous?.requestId===request.id)return previous;
 requestedRunning=runReopenProductionTest(progress,{requestId:request.id});
 try{return await requestedRunning;}finally{requestedRunning=null;}
}
