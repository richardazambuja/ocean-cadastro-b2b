import assert from 'node:assert/strict';
import {statusDoPainel, totaisDoPainel, handleDoLocal, podeReprovar, podeReabrir} from './status.mjs';
import {ordenarPorCadastro,formatarDataCadastro} from './ordenacao.mjs';
import {fetchReviewStatuses,lerReviewStatus,salvarReviewStatus} from './reprovados-api.mjs';

const mk=(id,authorized=false, contacts=1)=>({
  id:`gid://shopify/CompanyLocation/${id}`,
  createdAt: `2026-11-${id==='123'?'10':id==='124'?'12':'16'}T10:00:00Z`,
  roleAssignments:{nodes:authorized?[{id:'role'}]:[],pageInfo:{hasNextPage:false}},
  company:{mainContact:null,contacts:{nodes:Array.from({length:contacts},(_,i)=>({id:`contact${i}`,customer:{id:`customer${i}`}})),pageInfo:{hasNextPage:false}}}
});
let tests=0;async function check(fn){await fn();tests++}
const a=mk('123'),b=mk('124',true),c=mk('125',false,0),d=mk('126');
const decisions={[a.id]:'reprovado',[b.id]:'reprovado',[c.id]:'reprovado'};
await check(()=>assert.equal(statusDoPainel(a,decisions),'reprovado'));
await check(()=>assert.equal(statusDoPainel(b,decisions),'aprovado'));
await check(()=>assert.equal(statusDoPainel(c,decisions),'reprovado'));
await check(()=>assert.equal(statusDoPainel(d,decisions),'pendente'));
await check(()=>assert.deepEqual(totaisDoPainel([a,b,c,d],decisions),{pendente:1,aprovado:1,incompleto:0,reprovado:2,erro:0}));
await check(()=>assert.ok(podeReabrir(a,decisions)));
await check(()=>assert.equal(podeReprovar(b,decisions),false));
await check(()=>assert.equal(podeReprovar(d,decisions),true));
await check(()=>assert.equal(handleDoLocal(a.id),'local-123'));
await check(()=>assert.throws(()=>handleDoLocal('invalid')));
await check(()=>assert.deepEqual(ordenarPorCadastro([a,d,b]).map(x=>x.id),[d.id,b.id,a.id]));
await check(()=>assert.deepEqual(ordenarPorCadastro([d,a,b],'antigos').map(x=>x.id),[a.id,b.id,d.id]));
await check(()=>assert.match(formatarDataCadastro(a.createdAt),/10\/11\/2026/));

const stored=new Map();let observed=[];
function fieldsToRecord(fields){return {handle:'local-123',fields:Object.entries(fields).map(([key,value])=>({key,value}))}}
globalThis.shopify={query:async (query,{variables})=>{
  observed.push(query.match(/(?:query|mutation)\s+(\w+)/)?.[1]||'unknown');
  if(query.includes('metaobjectUpsert(')) {
    const handle=variables.handle.handle;
    const record=Object.fromEntries(variables.metaobject.fields.map(f=>[f.key,f.value]));
    stored.set(handle,record);
    return {data:{metaobjectUpsert:{metaobject:{handle},userErrors:[]}}};
  }
  if(query.includes('metaobjectByHandle(')) {
    const record=stored.get(variables.handle.handle);
    return {data:{metaobjectByHandle:record?fieldsToRecord(record):null}};
  }
  if(query.includes('metaobjects(')) {
    return {data:{metaobjects:{nodes:Array.from(stored.values()).map(fieldsToRecord),pageInfo:{hasNextPage:false,endCursor:null}}}};
  }
  throw Error('Mutation/Query nao permitida pelo teste: '+query);
}};

await check(async ()=>assert.equal(await lerReviewStatus(a.id),null));
await check(async ()=>assert.equal(await salvarReviewStatus(a.id,'reprovado'),'reprovado'));
await check(async ()=>assert.equal(await lerReviewStatus(a.id),'reprovado'));
await check(async ()=>assert.equal((await fetchReviewStatuses())[a.id],'reprovado'));
await check(async ()=>assert.equal(await salvarReviewStatus(a.id,'reaberto'),'reaberto'));
await check(async ()=>assert.equal((await fetchReviewStatuses())[a.id],'reaberto'));
await check(()=>assert.deepEqual([...new Set(observed)].sort(),['OceanSalvarDecisao','OceanStatusLocal','OceanStatusReprovados']));

console.log(`OK: ${tests} verificacoes automatizadas; Shopify B2B nao foi modificada.`);
