import assert from 'node:assert/strict';
import {approveLocation,releaseAccess,lockAccess,validarTravamento} from './aprovar.mjs';
import {statusDoPainel,totaisDoPainel} from './status.mjs';

const ID='gid://shopify/CompanyLocation/10',CID='gid://shopify/CompanyContact/2',RID='gid://shopify/CompanyContactRole/3';
const role={id:RID,name:'Apenas pedidos'};
function mk({roleAssignments=[],contacts=1,mainContact=null,hasNext=false}={}) {
  return {id:ID,name:'Teste',createdAt:'2026-11-16T09:00:00Z',
    roleAssignments:{nodes:roleAssignments,pageInfo:{hasNextPage:hasNext}},
    company:{id:'gid://shopify/Company/4', name:'Teste',mainContact,
      contacts:{nodes:Array.from({length:contacts},(_,i)=>({id:i?`gid://shopify/CompanyContact/${i+20}`:CID, customer:{id:`customer${i}`}})),pageInfo:{hasNextPage:false}},
      contactRoles:{nodes:[role]}}};
}
const assignment={id:'gid://shopify/CompanyContactRoleAssignment/50',role,companyContact:{id:CID}};
const approved=mk({roleAssignments:[assignment]});
let tests=0; async function test(title,fn){await fn(); tests++;}
await test('Pendentes sem decisao',()=>assert.equal(statusDoPainel(mk()),'pendente'));
await test('Aprovado pendente depende da decisao',()=>assert.equal(statusDoPainel(mk(),{[ID]:'aprovado_pendente'}),'aprovado_pendente'));
await test('Permissao existente domina status interno',()=>assert.equal(statusDoPainel(approved,{[ID]:'reprovado'}),'aprovado_liberado'));
await test('Reprovados preservados',()=>assert.equal(statusDoPainel(mk(),{[ID]:'reprovado'}),'reprovado'));
await test('Incompletos preservados',()=>assert.equal(statusDoPainel(mk({contacts:0})),'incompleto'));
await test('Totais por novas abas',()=>assert.deepEqual(totaisDoPainel([mk(),approved,mk({contacts:0})],{[ID]:'reprovado'}), {pendente:0,aprovado_pendente:0,aprovado_liberado:1,incompleto:0,reprovado:2,erro:0}));
await test('Pode travar acesso exclusivo',()=>assert.equal(validarTravamento(approved).ok,true));
await test('Nao pode travar acesso admin',()=>assert.equal(validarTravamento(mk({roleAssignments:[{...assignment,role:{id:'admin',name:'Admin do local'}}]})).ok,false));
await test('Nao pode travar dois acessos',()=>assert.equal(validarTravamento(mk({roleAssignments:[assignment,{...assignment,id:'other'}]})).ok,false));
await test('Nao pode travar contatos ambiguos',()=>assert.equal(validarTravamento(mk({roleAssignments:[assignment],contacts:2})).ok,false));
await test('Nao pode travar papeis parcialmente carregados',()=>assert.equal(validarTravamento(mk({roleAssignments:[assignment],hasNext:true})).ok,false));

let current=mk(), decision=null, grants=0,revokes=0;
const deps={getLocation:async()=>structuredClone(current),readDecision:async()=>decision,saveDecision:async(id,value)=>{assert.equal(id,ID);decision=value},assignRole:async()=>{grants++;current=mk({roleAssignments:[assignment]});return {errorMessages:[]}},revokeRole:async()=>{revokes++;current=mk();return {revokedAssignmentId:assignment.id}}};
await test('Aprovar somente marca status',async()=>{const r=await approveLocation(ID,deps);assert.equal(r.status,'aprovado_pendente');assert.equal(grants,0);assert.equal(revokes,0);assert.equal(decision,'aprovado_pendente')});
await test('Nao pode aprovar duas vezes',async()=>assert.rejects(approveLocation(ID,deps)));
await test('Liberar atribui exatamente 1 role',async()=>{const r=await releaseAccess(ID,deps);assert.equal(r.status,'aprovado_liberado');assert.equal(grants,1)});
await test('Nao libera acesso novamente',async()=>assert.rejects(releaseAccess(ID,deps)));
await test('Travar revoga somente atribuicao elegivel',async()=>{const r=await lockAccess(ID,deps);assert.equal(r.status,'aprovado_pendente');assert.equal(revokes,1);assert.equal(grants,1);assert.equal(decision,'aprovado_pendente')});
await test('Depois de travar pode liberar novamente',async()=>{const r=await releaseAccess(ID,deps);assert.equal(r.status,'aprovado_liberado');assert.equal(grants,2)});
await test('Travar falha sem gravar status nao revoga',async()=>{const before=revokes;await assert.rejects(lockAccess(ID,{...deps,saveDecision:async()=>{throw Error('sem metaobjetos')}}));assert.equal(revokes,before)});
await test('Travar falha em atribuição insegura',async()=>{current=mk({roleAssignments:[{...assignment,role:{id:'admin',name:'Admin do local'}}]}); const before=revokes;await assert.rejects(lockAccess(ID,deps));assert.equal(revokes,before)});
await test('Aprovacao nao altera B2B para rejeitados',async()=>{current=mk();decision='reprovado';await assert.rejects(approveLocation(ID,deps));assert.equal(grants,2)});
await test('Liberacao nao altera B2B se sem aprovacao',async()=>{current=mk();decision=null;await assert.rejects(releaseAccess(ID,deps));assert.equal(grants,2)});
console.log(`OK: ${tests} testes do fluxo aprovado / liberar / travar. Nenhuma mutacao Shopify real.`);
