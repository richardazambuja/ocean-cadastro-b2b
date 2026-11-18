import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import eventGuard from '../workflows/event-guard.mjs';
import newGuard from '../workflows/novo-guard.mjs';
import overdueGuard from '../workflows/vencido-guard.mjs';
const id='gid://shopify/CompanyLocation/8622571620';
const since='2026-11-17T14:00:00Z';
const ev={locationId:id,cycleId:'test-cycle',enteredAt:since,requestId:'run1',clock:since,runUrl:'test-url'};
function fixture(status='pendente') {
 const state={schema:1,locationId:id,ready:true,enrolled:true,operationId:null,status,cycleId:ev.cycleId,enteredAt:since};
 const row={id,name:'Test',createdAt:since,taxSettings:{taxRegistrationId:'TESTE'},company:{name:'Test',mainContact:{id:'c1'},contacts:[{id:'c1',customer:{id:'u1'}}]},roleAssignments:[],oceanReview:{value:JSON.stringify(state),compareDigest:'review-digest'},oceanReady:{value:'true'},oceanStatus:{value:status},oceanCycle:{value:ev.cycleId},oceanSince:{value:since},oceanNotifications:null};
 return {runCode:ev,getCompanyLocationData:[row]};
}
function signal(config){return{metaobject:{system:{fields:[{key:'local_id',value:id},{key:'cycle_id',value:ev.cycleId},{key:'entered_at',value:since}]}},shop:{oceanRollout:{value:JSON.stringify(config)}},getWorkflowRunData:{id:'gid://shopify/WorkflowRun/run1',url:'test-url',startedAt:since}};}
test('Workflow permite apenas ID de teste autorizado',()=>{assert.equal(eventGuard(signal({mode:'test',testLocationIds:[id]})).allowed,true);assert.equal(eventGuard(signal({mode:'test',testLocationIds:[]})).allowed,false);});
test('Workflow bloqueia liberacao real sem validacao',()=>assert.equal(eventGuard(signal({mode:'production',productionApproved:false,cutover:since})).allowed,false));
test('Workflow le campos camelCase efetivos do metaobjeto Flow',()=>{const x=signal({mode:'test',testLocationIds:[id]});x.metaobject={localId:id,cycleId:ev.cycleId,enteredAt:since};assert.equal(eventGuard(x).allowed,true);});
test('Workflow rejeita aprovados, reprovados e incompletos',()=>{for(const s of['aprovado_pendente','aprovado_liberado','reprovado','incompleto'])assert.equal(newGuard(fixture(s)).eligible,false);});
test('Workflow revalida acessos B2B existentes',()=>{const x=fixture();x.getCompanyLocationData[0].roleAssignments=[{id:'role'}];assert.equal(newGuard(x).eligible,false);});
test('Workflow exige contato valido',()=>{const x=fixture();x.getCompanyLocationData[0].company.contacts=[];assert.equal(newGuard(x).eligible,false);});
test('Workflow monta reserva atomica com dois digests',()=>{const x=newGuard(fixture());assert.equal(x.eligible,true);const json=JSON.parse(x.claimInputs);assert.equal(json.metafields[0].compareDigest,'review-digest');assert.equal(json.metafields[1].compareDigest,null);});
test('Workflow obtem digests dos metafields genericos Flow',()=>{const x=fixture();const row=x.getCompanyLocationData[0];row.metafields=[{namespace:'ocean_b2b',key:'review',value:row.oceanReview.value,compareDigest:'raw-digest'}];row.oceanReview={value:row.oceanReview.value};assert.equal(JSON.parse(newGuard(x).claimInputs).metafields[0].compareDigest,'raw-digest');});
test('Workflow bloqueia repeticao do mesmo ciclo',()=>{const x=fixture();x.getCompanyLocationData[0].oceanNotifications={value:JSON.stringify({schema:1,cycleId:ev.cycleId,novo:{state:'claimed'}}),compareDigest:'ledger'};assert.equal(newGuard(x).eligible,false);});
test('Workflow vencido exige primeiro confirmado',()=>assert.equal(overdueGuard(fixture()).eligible,false));
test('Workflow vencido aceita ciclo atual com primeiro confirmado',()=>{const x=fixture();x.getCompanyLocationData[0].oceanNotifications={value:JSON.stringify({schema:1,cycleId:ev.cycleId,novo:{state:'sent'}}),compareDigest:'ledger'};assert.equal(overdueGuard(x).eligible,true);});
test('Workflow bloqueia evento de ciclo antigo',()=>{const x=fixture();x.runCode={...ev,cycleId:'old'};assert.equal(newGuard(x).eligible,false);});
test('Workflows possuem destinatario exclusivamente interno',()=>{for(const k of['novo','vencido']){const x=JSON.parse(readFileSync(new URL(`../workflows/${k}.variables.json`,import.meta.url)));const emails=x.configuration.root.steps.filter(s=>s.task_id==='shopify::flow::send_email');assert.equal(emails.length,1);assert.equal(emails[0].config_field_values.find(f=>f.config_field_id==='address').value,'cadastros@oceanjoiasbr.com');}});
test('Workflow usa CNPJ do cadastro enquanto o fluxo legado copia o campo fiscal',()=>{const x=fixture();x.getCompanyLocationData[0].company.oceanCnpj={value:'CNPJ-CADASTRO'};assert.equal(newGuard(x).cnpj,'CNPJ-CADASTRO');});
test('Configuracao final remove gravacoes de diagnostico',()=>{for(const k of['novo','vencido']){const x=JSON.parse(readFileSync(new URL(`../workflows/${k}.variables.json`,import.meta.url)));assert.equal(x.configuration.root.steps.some(s=>s.step_id.startsWith('debug_')),false);}});
