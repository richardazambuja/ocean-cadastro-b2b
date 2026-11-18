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
export default function main(input) {
 const result={eligible:false,claimInputs:'{}',ackInputs:'{}',companyName:'',cnpj:'',enteredAt:'',locationId:'',cycleId:'',debug:'initial'};
 const ev=input.runCode;const rows=input.getCompanyLocationData||[];
 const matches=rows.filter(x=>x.id===ev.locationId);if(matches.length!==1||!ev.requestId)return result;
 const loc=matches[0];result.debug=JSON.stringify({phase:'row',keys:Object.keys(loc),event:ev,rawFields:(loc.metafields||[]).map(x=>({namespace:x.namespace,key:x.key,hasDigest:Boolean(x.compareDigest)}))});for(const f of loc.metafields||[]){if(f.namespace==='ocean_b2b'&&f.key==='review')loc.oceanReview=f;if(f.namespace==='ocean_b2b'&&f.key==='notifications')loc.oceanNotifications=f;}let state,ledger;
 try{state=JSON.parse(loc.oceanReview?.value||'null');ledger=loc.oceanNotifications?JSON.parse(loc.oceanNotifications.value):null;}catch{return result;}
 result.debug=JSON.stringify({phase:'parsed',state,event:ev,reviewDigest:Boolean(loc.oceanReview?.compareDigest),ready:loc.oceanReady?.value,status:loc.oceanStatus?.value,cycle:loc.oceanCycle?.value,since:loc.oceanSince?.value});
 if(!state||state.schema!==1||state.locationId!==ev.locationId||!state.ready||!state.enrolled||state.operationId||state.status!=='pendente'||state.cycleId!==ev.cycleId||Date.parse(state.enteredAt)!==Date.parse(ev.enteredAt))return result;
 if((loc.oceanReady?.value!==true&&loc.oceanReady?.value!=='true')||loc.oceanStatus?.value!=='pendente'||loc.oceanCycle?.value!==ev.cycleId||Date.parse(loc.oceanSince?.value)!==Date.parse(ev.enteredAt))return result;
 const live={...loc,roleAssignments:{nodes:loc.roleAssignments||[],pageInfo:{hasNextPage:false}},company:{...loc.company,contacts:{nodes:loc.company?.contacts||[],pageInfo:{hasNextPage:(loc.company?.contacts||[]).length>=50}}}};
 if(classifyLocation(live)!=='pendente'||!loc.oceanReview?.compareDigest)return result;
 if(ledger&&ledger.schema!==1)return result;
 if(ledger?.cycleId!==ev.cycleId)ledger={schema:1,cycleId:ev.cycleId};
 const kind='vencido';
 if(ledger[kind])return result;
 if(ledger.novo?.state!=='sent'||!Number.isFinite(Date.parse(ev.clock))||Date.parse(ev.clock)+600000<Date.parse(ev.enteredAt)+600000)return result;
 const base={ownerId:loc.id,namespace:'ocean_b2b',type:'json'};
 const review={...base,key:'review',value:loc.oceanReview.value,compareDigest:loc.oceanReview.compareDigest};
 const claimed={...ledger,[kind]:{state:'claimed',requestId:ev.requestId,runUrl:ev.runUrl}};
 const confirmed={...ledger,[kind]:{...ledger[kind],state:'sent',requestId:ev.requestId,runUrl:ev.runUrl}};
 result.claimInputs=JSON.stringify({metafields:[review,{...base,key:'notifications',value:JSON.stringify(claimed),compareDigest:loc.oceanNotifications?.compareDigest||null}]});
 result.ackInputs=JSON.stringify({metafields:[review,{...base,key:'notifications',value:JSON.stringify(confirmed),compareDigest:loc.oceanNotifications?.compareDigest||null}]});
 return {...result,eligible:true,companyName:loc.company?.name||loc.name||'',cnpj:loc.company?.oceanCnpj?.value||loc.taxSettings?.taxRegistrationId||'Nao informado',enteredAt:ev.enteredAt,locationId:loc.id,cycleId:ev.cycleId};
}