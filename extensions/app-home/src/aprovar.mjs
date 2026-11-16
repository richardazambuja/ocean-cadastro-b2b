import {classifyLocation, selectBuyer, selectOrderRole, isRoleVerified} from './regras.mjs';

// Fluxo com dependencias injetaveis: testavel sem chamar a loja de producao.
export async function approveLocation(locationId, {getLocation, assignRole}) {
  const current = await getLocation(locationId);
  const status = classifyLocation(current);
  if (status === 'aprovado') return {status:'ja_aprovado', location:current};
  if (status !== 'pendente') throw new Error('O cadastro nao esta elegivel. Revise o contato vinculado.');

  const buyer = selectBuyer(current.company);
  if (!buyer.ok) throw new Error(buyer.reason);
  const role = selectOrderRole(current.company);
  if (!role) throw new Error('Funcao "Apenas pedidos" nao encontrada. Nenhuma permissao foi concedida.');

  const mutation = await assignRole(buyer.contact.id, role.id, current.id);
  const verified = await getLocation(locationId);
  if (!isRoleVerified(verified, buyer.contact.id, role.id)) {
    throw new Error(mutation.errorMessages?.join('; ') || 'A permissao nao foi confirmada na Shopify.');
  }
  return {status:'aprovado', location:verified, buyer:buyer.contact, role};
}
