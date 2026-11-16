import {graphql} from './api.mjs';
import {handleDoLocal, STATUS_REPROVADO, STATUS_REABERTO, STATUS_APROVADO_PENDENTE} from './status.mjs';

// Declarado em shopify.app.toml. Somente o app cadastra os metadados de revisão.
const TIPO = '$app:cadastro_decisao';
const Q_LISTAR = `query OceanStatusReprovados($after: String) {
  metaobjects(type: "$app:cadastro_decisao", first: 50, after: $after) {
    nodes { handle fields { key value } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const Q_UM = `query OceanStatusLocal($handle: MetaobjectHandleInput!) {
  metaobjectByHandle(handle: $handle) { handle fields { key value } }
}`;
const M_SALVAR = `mutation OceanSalvarDecisao($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { handle }
    userErrors { field message code }
  }
}`;

function registroEmStatus(node) {
  const props = Object.fromEntries((node?.fields || []).map(({key,value})=>[key,value]));
  const id = props.local_id;
  if (!/^gid:\/\/shopify\/CompanyLocation\/\d+$/.test(id || '')) return null;
  return {id, status:props.status, updatedAt:props.alterado_em};
}

export async function fetchReviewStatuses() {
  const decisoes = {};
  let cursor = null;
  const vistos = new Set();
  for (let pagina=0; pagina<100; pagina++) {
    const data = await graphql(Q_LISTAR, {after:cursor});
    const conn = data.metaobjects;
    if (!Array.isArray(conn?.nodes)) throw new Error('Falha ao ler decisoes internas do aplicativo.');
    for (const node of conn.nodes) {
      if (vistos.has(node.handle)) continue;
      vistos.add(node.handle);
      const r = registroEmStatus(node);
      if (r && (r.status===STATUS_REPROVADO || r.status===STATUS_REABERTO || r.status===STATUS_APROVADO_PENDENTE)) decisoes[r.id]=r.status;
    }
    if (!conn.pageInfo?.hasNextPage) return decisoes;
    if (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === cursor) throw new Error('Paginacao de decisoes inconsistente.');
    cursor = conn.pageInfo.endCursor;
  }
  throw new Error('Paginacao de decisoes atingiu o limite; nada foi alterado.');
}

export async function lerReviewStatus(localId) {
  const data = await graphql(Q_UM, {handle:{type:TIPO, handle:handleDoLocal(localId)}});
  const r = registroEmStatus(data.metaobjectByHandle);
  if (r && r.id !== localId) throw new Error('Status nao corresponde ao local consultado.');
  return r?.status ?? null;
}

export async function salvarReviewStatus(localId, status) {
  if (![STATUS_REPROVADO, STATUS_REABERTO, STATUS_APROVADO_PENDENTE].includes(status)) throw new Error('Status interno invalido.');
  const handle = {type:TIPO, handle:handleDoLocal(localId)};
  const metaobject = {fields:[
    {key:'local_id',value:localId},
    {key:'status',value:status},
    {key:'alterado_em',value:new Date().toISOString()}
  ]};
  const data = await graphql(M_SALVAR, {handle,metaobject});
  const result = data.metaobjectUpsert;
  const errors = result?.userErrors?.map(e=>e.message).filter(Boolean) ?? [];
  if (!result?.metaobject?.handle || errors.length) {
    throw new Error(errors.join('; ') || 'A Shopify nao confirmou o registro da decisao.');
  }
  const persisted = await lerReviewStatus(localId);
  if (persisted !== status) throw new Error('A decisao foi enviada, mas nao foi confirmada na leitura seguinte. Atualize os dados.');
  return status;
}
