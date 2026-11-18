// Regras de negocio: funcoes puras, sem dependencia da Shopify.
export const ROLE_ORDERS_NAME = 'Apenas pedidos';

export function classifyLocation(location) {
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

export function selectBuyer(company) {
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

export function selectOrderRole(company) {
  const roles = company?.contactRoles?.nodes;
  if (!Array.isArray(roles)) return null;
  return roles.find(r => r.name?.trim() === ROLE_ORDERS_NAME && r.id) || null;
}

export function isRoleVerified(location, contactId, roleId) {
  return Boolean(location?.roleAssignments?.nodes?.some(a =>
    a?.companyContact?.id === contactId && a?.role?.id === roleId
  ));
}

export function formatCnpj(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : raw || 'Nao informado';
}

export function counts(locations) {
  return locations.reduce((acc, location) => {
    const status = classifyLocation(location);
    acc[status] += 1;
    return acc;
  }, {pendente:0, aprovado:0, incompleto:0, erro:0});
}
