function selectBuyer(company) {
  const contacts = company?.contacts;
  if (!Array.isArray(contacts?.nodes)) return {ok:false, reason:'Contatos da empresa indisponiveis.'};
  const all = contacts.nodes.filter(c => c?.id && c?.customer?.id);
  const mainId = company?.mainContact?.id;
  if (mainId) {
    const main = all.find(c => c.id === mainId);
    if (main) return {ok:true, contact:main};
    return {ok:false, reason:'Contato principal nao confirmado entre os contatos da empresa.'};
  }
  if (contacts.pageInfo?.hasNextPage) return {ok:false, reason:'Ha contatos adicionais nao carregados; revise antes de aprovar.'};
  if (all.length === 1) return {ok:true, contact:all[0]};
  if (all.length === 0) return {ok:false, reason:'Empresa sem contato vinculado. Vincule o cliente antes de aprovar.'};
  return {ok:false, reason:'Empresa com multiplos contatos e sem contato principal; selecione um principal na Shopify.'};
}
function classifyLocation(location) {
  const roleConnection = location?.roleAssignments;
  if (!roleConnection || !Array.isArray(roleConnection.nodes)) return 'erro';
  if (roleConnection.nodes.length > 0) return 'aprovado';
  if (roleConnection.pageInfo?.hasNextPage) return 'erro';
  const contacts = location.company?.contacts;
  if (!contacts || !Array.isArray(contacts.nodes)) return 'erro';
  if (contacts.nodes.length === 0 && !contacts.pageInfo?.hasNextPage) return 'incompleto';
  if (selectBuyer(location.company).ok) return 'pendente';
  return 'incompleto';
}
export default function main(input){
 const out={eligible:false,inputs:'{}',numericId:'',locationId:'',cycleId:'',enteredAt:''};
 const loc=input.getCompanyLocationDataForeachitem;if(!loc||!/^gid:\/\/shopify\/CompanyLocation\/\d+$/.test(loc.id||''))return out;
 let config;try{config=JSON.parse(input.shop?.oceanRollout?.value||'{}');}catch{return out;}
 const existingReview=(loc.metafields||[]).find(f=>f.namespace==='ocean_b2b'&&f.key==='review');let baseline;try{baseline=JSON.parse(existingReview?.value||'null');}catch{return out;}
 const oldIncompleteVerified=baseline?.sourceKind==='cadastro-b2b'&&baseline?.projectionEpoch===config.epoch&&baseline?.status==='incompleto'&&!baseline?.decisionVersion;
 const allowed=['test','preparing'].includes(config.mode)&&(config.testLocationIds?.includes(loc.id)||config.bootstrapTestCompanyIds?.includes(loc.company?.id))||config.mode==='production'&&config.productionApproved===true&&(Date.parse(loc.createdAt)>=Date.parse(config.cutover)||oldIncompleteVerified);
 if(!allowed)return out;
 const fields=(loc.metafields||[]).filter(f=>f.namespace==='ocean_b2b');const review=fields.find(f=>f.key==='review');let prev=null;
 if(review){try{prev=JSON.parse(review.value);}catch{return out;}
 if(prev.schema!==1||prev.locationId!==loc.id||!prev.ready||prev.operationId||prev.decisionVersion||!(['incompleto'].includes(prev.status)||prev.status==='pendente'&&prev.cycleId?.startsWith('native-'))||!review.compareDigest)return out;
 }else if(fields.some(f=>['ready','status','cycle_id','pending_since'].includes(f.key)))return out;
 const current={...loc,roleAssignments:{nodes:loc.roleAssignments||[],pageInfo:{hasNextPage:false}},company:{...loc.company,contacts:{nodes:loc.company?.contacts||[],pageInfo:{hasNextPage:(loc.company?.contacts||[]).length>=50}}}};
 if(classifyLocation(current)!=='pendente')return out;
 const enteredAt=input.getWorkflowRunData?.startedAt;if(!Number.isFinite(Date.parse(enteredAt))||Date.parse(enteredAt)<Date.parse(loc.createdAt))return out;
 const numericId=loc.id.split('/').pop(),runToken=(input.getWorkflowRunData?.id||'').split('/').pop().split(':')[1];if(!/^[a-zA-Z0-9-]{1,30}$/.test(runToken||''))return out;const cycleId=prev?.status==='pendente'?prev.cycleId:'native-'+numericId+'-'+runToken;
 const state={schema:1,locationId:loc.id,ready:true,operationId:null,status:'pendente',cycleId,enteredAt:prev?.status==='pendente'?prev.enteredAt:enteredAt,enrolled:true,reopenVersion:null,decisionVersion:null,updatedAt:enteredAt,signalPending:false,sourceKind:'native-new-location'};
 const values=[['review','json',JSON.stringify(state)],['ready','boolean','true'],['status','single_line_text_field','pendente'],['cycle_id','single_line_text_field',cycleId],['pending_since','date_time',state.enteredAt]];
 const metafields=prev?.status==='pendente'?[{ownerId:loc.id,namespace:'ocean_b2b',key:'review',type:'json',value:review.value,compareDigest:review.compareDigest}]:values.map(([key,type,value])=>({ownerId:loc.id,namespace:'ocean_b2b',key,type,value,...(key==='review'?{compareDigest:review?.compareDigest||null}:{})}));
 return {eligible:true,inputs:JSON.stringify({metafields}),numericId,locationId:loc.id,cycleId,enteredAt:state.enteredAt};
}