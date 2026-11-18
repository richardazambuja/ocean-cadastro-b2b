// A Shopify injeta o objeto global `shopify` no App Home UI extension.
// Nao coloque chaves privadas, tokens ou CNPJs em codigo-fonte.
const FRAGMENT = `
  id
  name
  createdAt
  phone
  taxSettings { taxRegistrationId }
  billingAddress { address1 address2 city province country zip phone }
  shippingAddress { phone }
  company {
    id
    name
    instagram: metafield(namespace: "custom", key: "instagram") { value }
    cnpjCadastro: metafield(namespace: "custom", key: "cnpj") { value }
    segmento: metafield(namespace: "custom", key: "segmento_atuacao") { value }
    faturamento: metafield(namespace: "custom", key: "faturamento_mensal") { value }
    mainContact { id }
    contacts(first: 50) {
      nodes { id isMainContact customer { id displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } defaultAddress { phone } } }
      pageInfo { hasNextPage }
    }
    contactRoles(first: 50) { nodes { id name } }
  }
  roleAssignments(first: 50) {
    nodes { id role { id name } companyContact { id } }
    pageInfo { hasNextPage }
  }
`;

const LOCATIONS_QUERY = `query OceanLocations($after: String) {
  companyLocations(first: 50, after: $after) {
    nodes { ${FRAGMENT} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const LOCATION_QUERY = `query OceanLocation($id: ID!) {
  companyLocation(id: $id) { ${FRAGMENT} }
}`;

const ASSIGN_ROLE_MUTATION = `mutation OceanApprove(
  $companyContactId: ID!, $companyContactRoleId: ID!, $companyLocationId: ID!
) {
  companyContactAssignRole(
    companyContactId: $companyContactId,
    companyContactRoleId: $companyContactRoleId,
    companyLocationId: $companyLocationId
  ) {
    companyContactRoleAssignment { id companyContact { id } companyLocation { id } role { id name } }
    userErrors { field message code }
  }
}`;

let querySequence=0;const querySession=Date.now().toString(36);
export async function graphql(query, variables={}) {
  // Read-after-write checks must not reuse a cached response from this session.
  query=query.replace(/^(\s*query\s+)([A-Za-z_][A-Za-z0-9_]*)/,(_,prefix,name)=>prefix+name+'_'+querySession+'_'+ ++querySequence);
  const result = await shopify.query(query, {variables, version:'2026-10'});
  if (result?.errors?.length) {
    throw new Error(result.errors.map(x => x.message).join('; '));
  }
  if (!result?.data) throw new Error('Resposta GraphQL sem dados. Confira os escopos do app.');
  return result.data;
}

export async function fetchAllLocations() {
  const result = [];
  let cursor = null;
  const seen = new Set();
  for (let page=0; page<100; page++) {
    const data = await graphql(LOCATIONS_QUERY, {after:cursor});
    const conn = data.companyLocations;
    if (!conn || !Array.isArray(conn.nodes)) throw new Error('Nao foi possivel listar locais da loja.');
    for (const node of conn.nodes) {
      if (!seen.has(node.id)) { seen.add(node.id); result.push(node); }
    }
    if (!conn.pageInfo?.hasNextPage) return result;
    if (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === cursor) throw new Error('Paginacao da Shopify inconsistente.');
    cursor = conn.pageInfo.endCursor;
  }
  throw new Error('Limite de paginacao atingido. A consulta foi interrompida por seguranca.');
}

export async function fetchLocation(locationId) {
  const data = await graphql(LOCATION_QUERY, {id:locationId});
  if (!data.companyLocation) throw new Error('O local nao existe mais ou voce nao possui permissao para consulta-lo.');
  return data.companyLocation;
}

export async function assignOrderRole(contactId, roleId, locationId) {
  const data = await graphql(ASSIGN_ROLE_MUTATION, {
    companyContactId:contactId,
    companyContactRoleId:roleId,
    companyLocationId:locationId,
  });
  const payload = data.companyContactAssignRole;
  if (!payload) throw new Error('A Shopify nao retornou o resultado da atribuicao.');
  const errorMessages = (payload.userErrors || []).map(e=>e.message);
  return {
    assignment: payload.companyContactRoleAssignment || null,
    errorMessages,
  };
}

// Revoga SOMENTE a atribuicao especifica, nunca todos os papeis do cliente.
const REVOKE_ROLE_MUTATION = `mutation OceanTravarAcesso(
  $companyContactId: ID!, $companyContactRoleAssignmentId: ID!
) {
  companyContactRevokeRole(
    companyContactId: $companyContactId,
    companyContactRoleAssignmentId: $companyContactRoleAssignmentId
  ) {
    revokedCompanyContactRoleAssignmentId
    userErrors { field message code }
  }
}`;

export async function revokeOrderRole(contactId, assignmentId) {
  const data = await graphql(REVOKE_ROLE_MUTATION, {
    companyContactId:contactId, companyContactRoleAssignmentId:assignmentId,
  });
  const payload = data.companyContactRevokeRole;
  const errors = payload?.userErrors?.map(e=>e.message).filter(Boolean) ?? [];
  if (errors.length || payload?.revokedCompanyContactRoleAssignmentId !== assignmentId) {
    throw new Error(errors.join('; ') || 'A Shopify nao confirmou a revogacao da funcao do comprador.');
  }
  return {revokedAssignmentId:assignmentId};
}
