import {classifyLocation, selectBuyer, selectOrderRole, isRoleVerified} from './regras.mjs';
import {statusDoPainel, STATUS_APROVADO_PENDENTE, STATUS_APROVADO_LIBERADO} from './status.mjs';

// Aprovacao comercial: somente status interno. NUNCA altera permissoes B2B.
export async function approveLocation(locationId,{getLocation,readDecision,saveDecision}) {
  const [current, decision] = await Promise.all([getLocation(locationId),readDecision(locationId)]);
  if (statusDoPainel(current,{[locationId]:decision})!=='pendente') {
    throw new Error('O cadastro nao esta mais pendente. Atualize o painel antes de aprovar.');
  }
  const buyer = selectBuyer(current.company);
  if (!buyer.ok) throw new Error(buyer.reason);
  if (!selectOrderRole(current.company)) throw new Error('Funcao Apenas pedidos indisponivel.');
  await saveDecision(locationId,STATUS_APROVADO_PENDENTE);
  // Conferencia: a aprovacao comercial nao libera pedidos.
  const verified = await getLocation(locationId);
  if (classifyLocation(verified)==='aprovado') {
    throw new Error('A permissao B2B foi alterada externamente. Atualize o painel.');
  }
  return {status:STATUS_APROVADO_PENDENTE,location:verified};
}

// Liberacao explicita, apenas depois de aprovar comercialmente.
export async function releaseAccess(locationId,{getLocation,readDecision,assignRole}) {
  const [current,decision] = await Promise.all([getLocation(locationId),readDecision(locationId)]);
  if (statusDoPainel(current,{[locationId]:decision})!==STATUS_APROVADO_PENDENTE || classifyLocation(current)!=='pendente') {
    throw new Error('Acesso nao esta pendente de liberacao. Atualize os dados.');
  }
  const buyer=selectBuyer(current.company);
  if (!buyer.ok) throw new Error(buyer.reason);
  const role=selectOrderRole(current.company);
  if (!role) throw new Error('Funcao Apenas pedidos indisponivel.');
  const result=await assignRole(buyer.contact.id,role.id,current.id);
  const verified=await getLocation(locationId);
  if (!isRoleVerified(verified,buyer.contact.id,role.id)) {
    throw new Error(result?.errorMessages?.join('; ') || 'A Shopify nao confirmou o acesso de compra.');
  }
  return {status:STATUS_APROVADO_LIBERADO,location:verified};
}

// Falha fechada: somente um papel de "Apenas pedidos" para o unico contato
// identificado. Qualquer outra atribuicao impede prometer bloqueio total.
export function validarTravamento(location) {
  if (classifyLocation(location)!=='aprovado') return {ok:false,reason:'O local nao possui permissao ativa para travar.'};
  const roles=location?.roleAssignments;
  if (roles?.pageInfo?.hasNextPage) return {ok:false,reason:'Ha outras permissoes nao carregadas. Revise no admin.'};
  const buyer=selectBuyer(location.company);
  if (!buyer.ok) return {ok:false,reason:buyer.reason};
  const role=selectOrderRole(location.company);
  if (!role) return {ok:false,reason:'Funcao Apenas pedidos nao encontrada.'};
  const items=roles?.nodes||[];
  if (items.length !== 1) {
    return {ok:false,reason:'O local possui multiplas atribuicoes. Confira os acessos na Shopify antes de travar.'};
  }
  const assignment=items[0];
  if (!assignment?.id || assignment?.role?.id!==role.id || assignment?.companyContact?.id!==buyer.contact.id) {
    return {ok:false,reason:'Este acesso nao e exclusivamente Apenas pedidos do contato responsavel. Revise-o na Shopify.'};
  }
  return {ok:true,contactId:buyer.contact.id,assignmentId:assignment.id};
}

export async function lockAccess(locationId,{getLocation,readDecision,saveDecision,revokeRole}) {
  const [current,decision]=await Promise.all([getLocation(locationId),readDecision(locationId)]);
  if (statusDoPainel(current,{[locationId]:decision})!==STATUS_APROVADO_LIBERADO) {
    throw new Error('O acesso nao esta liberado. Atualize os dados.');
  }
  const valid=validarTravamento(current);
  if (!valid.ok) throw new Error(valid.reason);
  // Registra a aprovacao comercial ANTES de revogar. Se a escrita falhar,
  // nenhum acesso e alterado. Enquanto o papel existir, o painel mostrara
  // Acesso liberado por consultar a Shopify diretamente.
  await saveDecision(locationId,STATUS_APROVADO_PENDENTE);
  await revokeRole(valid.contactId,valid.assignmentId);
  const verified=await getLocation(locationId);
  if (classifyLocation(verified)!=='pendente' || (verified.roleAssignments?.nodes?.length??0)>0) {
    throw new Error('O acesso nao foi confirmado como travado. Revise as permissoes na Shopify.');
  }
  return {status:STATUS_APROVADO_PENDENTE,location:verified};
}
