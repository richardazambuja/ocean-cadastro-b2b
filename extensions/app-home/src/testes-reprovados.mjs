import assert from 'node:assert/strict';
import {statusDoPainel, totaisDoPainel, handleDoLocal, podeReprovar, podeReabrir} from './status.mjs';
import {ordenarPorCadastro,formatarDataCadastro} from './ordenacao.mjs';
import {fetchReviewStatuses,lerReviewStatus,salvarReviewStatus} from './reprovados-api.mjs';

let tests=0;async function check(fn){await fn();tests++}
function mk(id,authorized=false,contacts=1){return {
  id:`gid://shopify/CompanyLocation/${id}`,
  createdAt:`2026-11-${id==='123'?'10':id==='124'?'12':'16'}T10:00:00Z`,
  roleAssignments:{nodes:authorized?[{id:'role'}]:[],pageInfo:{hasNextPage:false}},
  company:{mainContact:null,contacts:{nodes:Array.from({length:contacts},(_,i)=>({id:`c${i}`,customer:{id:`u${i}`}})),pageInfo:{hasNextPage:false}}}
}}
const a=mk('123'),b=mk('124',true),c=mk('125',false,0),d=mk('126');
const decisions={[a.id]:'reprovado',[b.id]:'reprovado',[c.id]:'reprovado'};
await check(()=>assert.equal(statusDoPainel(a,decisions),'reprovado'));
await check(()=>assert.equal(statusDoPainel(b,decisions),'aprovado_liberado'));
await check(()=>assert.equal(statusDoPainel(c,decisions),'reprovado'));
await check(()=>assert.equal(statusDoPainel(d,decisions),'pendente'));
await check(()=>assert.equal(statusDoPainel(d,{[d.id]:'aprovado_pendente'}),'aprovado_pendente'));
await check(()=>assert.deepEqual(totaisDoPainel([a,b,c,d],decisions),{pendente:1,aprovado_pendente:0,aprovado_liberado:1,incompleto:0,reprovado:2,erro:0}));
await check(()=>assert.equal(podeReabrir(a,decisions),true));
await check(()=>assert.equal(podeReprovar(b,decisions),false));
await check(()=>assert.equal(podeReprovar(d,decisions),true));
await check(()=>assert.equal(podeReprovar(d,{[d.id]:'aprovado_pendente'}),false));
await check(()=>assert.equal(handleDoLocal(a.id),'local-123'));
await check(()=>assert.throws(()=>handleDoLocal('invalid')));
await check(()=>assert.deepEqual(ordenarPorCadastro([a,d,b]).map(x=>x.id),[d.id,b.id,a.id]));
await check(()=>assert.deepEqual(ordenarPorCadastro([d,a,b],'antigos').map(x=>x.id),[a.id,b.id,d.id]));
await check(()=>assert.match(formatarDataCadastro(a.createdAt),/10\/11\/2026/));

const stored=new Map();const observed=[];
function fieldsToRecord(handle,fields){return {handle,fields:Object.entries(fields).map(([key,value])=>({key,value}))}}
globalThis.shopify={query:async (query,{variables})=>{
  observed.push(query.match(/(?:query|mutation)\s+(\w+)/)?.[1]||'unknown');
  if(query.includes('metaobjectUpsert(')) {
    const handle=variables.handle.handle;
    const record=Object.fromEntries(variables.metaobject.fields.map(f=>[f.key,f.value]));
    stored.set(handle,record);
    return {data:{metaobjectUpsert:{metaobject:{handle},userErrors:[]}}};
  }
  if(query.includes('metaobjectByHandle(')) {
    const h=variables.handle.handle;
    return {data:{metaobjectByHandle:stored.has(h)?fieldsToRecord(h,stored.get(h)):null}};
  }
  if(query.includes('metaobjects(')) {
    return {data:{metaobjects:{nodes:Array.from(stored,([handle,fields])=>fieldsToRecord(handle,fields)),pageInfo:{hasNextPage:false,endCursor:null}}}};
  }
  throw Error('API nao permitida no teste: '+query);
}};
await check(async()=>assert.equal(await lerReviewStatus(a.id),null));
await check(async()=>assert.equal(await salvarReviewStatus(a.id,'reprovado'),'reprovado'));
await check(async()=>assert.equal((await fetchReviewStatuses())[a.id],'reprovado'));
await check(async()=>assert.equal(await salvarReviewStatus(a.id,'reaberto'),'reaberto'));
await check(async()=>assert.equal((await fetchReviewStatuses())[a.id],'reaberto'));
await check(async()=>assert.equal(await salvarReviewStatus(a.id,'aprovado_pendente'),'aprovado_pendente'));
await check(async()=>assert.equal((await fetchReviewStatuses())[a.id],'aprovado_pendente'));
await check(async()=>assert.equal(await lerReviewStatus(a.id),'aprovado_pendente'));
await check(()=>assert.deepEqual([...new Set(observed)].sort(),['OceanSalvarDecisao','OceanStatusLocal','OceanStatusReprovados']));
console.log(`OK: ${tests} testes de persistencia, reprovação e ordenação. Nenhuma mutacao Shopify real.`);
