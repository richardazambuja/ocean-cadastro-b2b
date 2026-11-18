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
 const out={eligible:false,signal:'{}'};const plan=input.runCode1;const rows=(input.getCompanyLocationData1||[]).filter(x=>x.id===plan.locationId);if(rows.length!==1)return out;const loc=rows[0];
 const fields=Object.fromEntries((loc.metafields||[]).filter(f=>f.namespace==='ocean_b2b').map(f=>[f.key,f]));let state;try{state=JSON.parse(fields.review?.value||'null');}catch{return out;}
 if(!state||!state.ready||state.operationId||!state.enrolled||state.status!=='pendente'||state.cycleId!==plan.cycleId||Date.parse(state.enteredAt)!==Date.parse(plan.enteredAt)||state.decisionVersion)return out;
 if(fields.ready?.value!=='true'||fields.status?.value!=='pendente'||fields.cycle_id?.value!==plan.cycleId||Date.parse(fields.pending_since?.value)!==Date.parse(plan.enteredAt))return out;
 const current={...loc,roleAssignments:{nodes:loc.roleAssignments||[],pageInfo:{hasNextPage:false}},company:{...loc.company,contacts:{nodes:loc.company?.contacts||[],pageInfo:{hasNextPage:(loc.company?.contacts||[]).length>=50}}}};if(classifyLocation(current)!=='pendente')return out;
 return {eligible:true,signal:JSON.stringify({handle:{type:'ocean_b2b_pending_cycle',handle:('local-'+plan.numericId+'-'+plan.cycleId).toLowerCase()},metaobject:{fields:[{key:'local_id',value:plan.locationId},{key:'cycle_id',value:plan.cycleId},{key:'entered_at',value:plan.enteredAt}]}})};
}