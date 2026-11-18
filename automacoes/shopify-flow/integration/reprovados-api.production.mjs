import {graphql} from './api.mjs';
import {rememberDecision,latestDecision,decisionReceipts} from './commercial-receipts.mjs';
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
  metaobjectByHandle(handle: $handle) { id handle updatedAt fields { key value } }
}`;
const M_SALVAR = `mutation OceanSalvarDecisao($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { id handle updatedAt fields { key value } }
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
  const observed = new Map();
  let cursor = null;
  const vistos = new Set();
  for (let pagina=0; pagina<100; pagina++) {
    const data = await graphql(Q_LISTAR, {after:cursor});
    const conn = data.metaobjects;
    if (!Array.isArray(conn?.nodes)) throw new Error('Falha ao ler decisoes internas do aplicativo.');
    for (const node of conn.nodes) {
      if (vistos.has(node.handle)) continue;
      vistos.add(node.handle);
      const original=registroEmStatus(node);
      const selected=latestDecision(original?.id,node);
      const r = registroEmStatus(selected);
      if(r)observed.set(r.id,r.updatedAt);
      if (r && (r.status===STATUS_REPROVADO || r.status===STATUS_REABERTO || r.status===STATUS_APROVADO_PENDENTE)) decisoes[r.id]=r.status;
      // OCEAN_REABERTURA_PENDENTES_10M_V1
      if (r?.status===STATUS_REABERTO && Number.isFinite(Date.parse(r.updatedAt))) decisoes[`__reaberto_em__${r.id}`]=r.updatedAt;
    }
    if (!conn.pageInfo?.hasNextPage) {
      for(const node of decisionReceipts()){
        const r=registroEmStatus(node);if(!r||Date.parse(observed.get(r.id)||'')>=Date.parse(r.updatedAt))continue;
        decisoes[r.id]=r.status;
        if(r.status===STATUS_REABERTO)decisoes[`__reaberto_em__${r.id}`]=r.updatedAt;
      }
      return decisoes;
    }
    if (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === cursor) throw new Error('Paginacao de decisoes inconsistente.');
    cursor = conn.pageInfo.endCursor;
  }
  throw new Error('Paginacao de decisoes atingiu o limite; nada foi alterado.');
}

export async function lerReviewStatus(localId) {
  const data = await graphql(Q_UM, {handle:{type:TIPO, handle:handleDoLocal(localId)}});
  const r = registroEmStatus(latestDecision(localId,data.metaobjectByHandle));
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
  if(result.metaobject.fields){
    const committed=registroEmStatus(result.metaobject);
    if(committed?.id!==localId||committed.status!==status||committed.updatedAt!==metaobject.fields.find(f=>f.key==='alterado_em').value)throw Error('Recibo da decisao comercial divergente.');
    rememberDecision(result.metaobject);
  }
  const persisted = await lerReviewStatus(localId);
  if (persisted !== status) throw new Error('A decisao foi enviada, mas nao foi confirmada na leitura seguinte. Atualize os dados.');
  return status;
}

export async function fetchReviewRecords(){
 const records=new Map();let after=null;
 for(let page=0;page<100;page++){
  const data=await graphql(Q_LISTAR,{after});const c=data.metaobjects;if(!c||!Array.isArray(c.nodes))throw Error('Leitura das decisoes incompleta.');
  for(const node of c.nodes){const r=registroEmStatus(node);if(r)records.set(r.id,latestDecision(r.id,node));}
  if(!c.pageInfo?.hasNextPage){for(const record of decisionReceipts()){const r=registroEmStatus(record);if(r)records.set(r.id,latestDecision(r.id,records.get(r.id)));}return records;}
  if(!c.pageInfo.endCursor||c.pageInfo.endCursor===after)throw Error('Cursor de decisoes invalido.');after=c.pageInfo.endCursor;
 }
 throw Error('Limite da leitura das decisoes atingido.');
}
