import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {statusDoPainel} from '../../../extensions/app-home/src/status.mjs';
import {project, canNotify, claimNotification, confirmNotification, eventFor, metafieldValues} from '../src/state.mjs';
import {createBridge} from '../../../extensions/app-home/src/flow-bridge/bridge.mjs';
import {bootstrapNative} from '../src/bootstrap.mjs';
import {READ, SET, SIGNAL, READ_SIGNAL} from '../../../extensions/app-home/src/flow-bridge/operations.mjs';

const ID = 'gid://shopify/CompanyLocation/1';
const START = '2026-11-17T12:00:00Z';
const REOPEN = '2026-11-17T13:00:00Z';
const decision = (status = null, updatedAt = null) => ({verified: true, localId: ID, status, updatedAt});
function location({contacts = 1, assignments = [], main = null} = {}) {
  return {id: ID, createdAt: '2026-11-17T11:00:00.000Z', roleAssignments: {nodes: assignments, pageInfo: {hasNextPage: false}}, company: {mainContact: main, contacts: {nodes: Array.from({length: contacts}, (_, i) => ({id: `contact-${i}`, customer: {id: `customer-${i}`}})), pageInfo: {hasNextPage: false}}}};
}
function projected(overrides = {}) { return project({location: location(), decision: decision(), classify: statusDoPainel, now: START, uuid: () => 'cycle-1', origin: 'mutation', ...overrides}); }
function event(state) { return {locationId: state.locationId, cycleId: state.cycleId, enteredAt: state.enteredAt}; }

function fixture(options = {}) {
  const values = new Map();
  const calls = [];
  let serial = 0;
  let time = START;
  let source = {location: location(), decision: decision()};
  let failSet = false;
  let failSignal = false;
  const signals = new Map();
  const query = async (operation, variables) => {
    calls.push({operation, variables: structuredClone(variables)});
    if (operation === READ) {
      return {companyLocation: {id: ID, ...Object.fromEntries([['review', 'review'], ['ready', 'ready'], ['status', 'status'], ['cycle', 'cycle_id'], ['entered', 'pending_since'], ['ledger', 'notifications'], ['signal','signal']].map(([alias, key]) => [alias, values.get(key) ?? null]))}};
    }
    if (operation === SET) {
      for (const f of variables.metafields) {
        const old = values.get(f.key);
        if ((Object.hasOwn(f, 'compareDigest') && f.compareDigest !== (old?.compareDigest ?? null)) || failSet) return {metafieldsSet: {metafields: [], userErrors: [{code: 'INVALID_COMPARE_DIGEST', message: 'Conflito CAS'}]}};
      }
      const result = variables.metafields.map(f => ({id: `mf-${f.key}`, namespace: f.namespace, key: f.key, type: f.type, value: f.value, compareDigest: createHash('sha256').update(f.value).digest('hex')}));
      for (const f of result) values.set(f.key, f);
      return {metafieldsSet: {metafields: result, userErrors: []}};
    }
    if(operation===READ_SIGNAL)return {metaobjectByHandle:signals.get(variables.handle.handle)||null};
    if (operation === SIGNAL) {
      if (failSignal) return {metaobjectUpsert: {metaobject: null, userErrors: [{message: 'write_metaobjects required'}]}};
      const key = variables.handle.handle;
      if (!signals.has(key)) signals.set(key, {...variables.handle, fields:variables.metaobject.fields, updatedAt:time, id: `event-${signals.size + 1}`});
      await options.onSignal?.({values,calls});
      return {metaobjectUpsert: {metaobject: signals.get(key), userErrors: []}};
    }
    throw Error('Unexpected operation');
  };
  const bridge = createBridge({query, loadAuthoritative: async () => structuredClone(source), classify: statusDoPainel, now: () => time, uuid: () => `id-${++serial}`, enabled: true, ...options});
  return {bridge, values, calls, signals, source: value => {source = value;}, time: value => {time = value;}, failSet: value => {failSet = value;}, failSignal: value => {failSignal = value;}};
}

for (const [name, local, dec, expected] of [
  ['pendente', location(), decision(), 'pendente'],
  ['aprovado_pendente', location(), decision('aprovado_pendente', START), 'aprovado_pendente'],
  ['aprovado_liberado', location({assignments: [{id: 'role'}]}), decision(), 'aprovado_liberado'],
  ['reprovado', location(), decision('reprovado', START), 'reprovado'],
  ['incompleto', location({contacts: 0}), decision(), 'incompleto'],
]) test('Preserva classificacao real: ' + name, () => {
  const state = projected({location: local, decision: dec});
  assert.equal(state.status, expected);
  assert.equal(state.status, statusDoPainel(local, {[ID]: dec.status}));
  assert.equal(canNotify(state, event(state), null, 'novo', START), expected === 'pendente');
});

test('Acesso B2B existente prevalece sobre reabertura', () => assert.equal(projected({location: location({assignments: [{id: 'role'}]}), decision: decision('reaberto', START)}).status, 'aprovado_liberado'));
test('Contatos ambiguos permanecem incompletos', () => assert.equal(projected({location: location({contacts: 2})}).status, 'incompleto'));
test('Leitura de decisao falhou: nao presume pendente', () => assert.throws(() => projected({decision: {...decision(), verified: false}})));
test('Decisao de outro local bloqueada', () => assert.throws(() => projected({decision: {...decision(), localId: 'other'}})));
test('Decisao desconhecida bloqueada', () => assert.throws(() => projected({decision: decision('unknown')})));
test('Paginacao de permissoes inconclusiva bloqueada', () => {const local = location(); local.roleAssignments.pageInfo.hasNextPage = true; assert.throws(() => projected({location: local}));});
test('Local sem permissoes carregadas bloqueado', () => {const local = location(); delete local.roleAssignments; assert.throws(() => projected({location: local}));});
test('Reabertura sem horario bloqueada', () => assert.throws(() => projected({decision: decision('reaberto')})));
test('Decisao no futuro bloqueada', () => assert.throws(() => projected({decision: decision('reaberto', REOPEN)})));
test('Leitura repetida conserva ciclo e inicio', () => {const a = projected(); const b = projected({previous: a, now: REOPEN, uuid: () => 'other'}); assert.equal(b.cycleId, a.cycleId); assert.equal(b.enteredAt, a.enteredAt);});
test('Horarios sao normalizados para precisao real da Shopify',()=>{const a=projected({now:'2026-11-17T12:00:00.178Z'});assert.equal(a.enteredAt,'2026-11-17T12:00:00Z');assert.equal(metafieldValues(a,null).find(f=>f.key==='pending_since').value,'2026-11-17T12:00:00Z');});
test('Reabertura inicia ciclo unico no horario confirmado', () => {const a = projected(); const b = projected({previous: a, decision: decision('reaberto', REOPEN), now: REOPEN, uuid: () => 'cycle-2'}); assert.equal(b.enteredAt, REOPEN); assert.equal(b.cycleId, 'cycle-2');});
test('Releitura da mesma reabertura nao reinicia prazo', () => {const a = projected({decision: decision('reaberto', START)}); const b = projected({previous: a, decision: decision('reaberto', START), now: REOPEN}); assert.equal(b.enteredAt, START);});
test('Reaberto incompleto nao cria ciclo notificavel', () => {const a = projected({location: location({contacts: 0}), decision: decision('reaberto', START)}); assert.equal(a.cycleId, null); assert.equal(eventFor(a), null);});
test('Completar cadastro inicia prazo na entrada real, nao createdAt', () => {const a = projected({location: location({contacts: 0}), decision: decision('reaberto', START)}); const b = projected({previous: a, decision: decision('reaberto', START), now: REOPEN}); assert.equal(b.enteredAt, REOPEN);});
test('Backfill nao envia notificacoes historicas', () => {const a = projected({origin: 'backfill'}); assert.equal(a.enrolled, false); assert.equal(a.signalPending, false); assert.equal(eventFor(a), null);});
test('Ciclo antigo rejeitado apos segunda reabertura', () => {const a = projected(); const b = projected({previous: a, now: REOPEN, decision: decision('reaberto', REOPEN), uuid: () => 'cycle-2'}); assert.equal(canNotify(b, event(a), null, 'novo', REOPEN), false);});
test('Evento idempotente por local e ciclo', () => {const a = projected(); assert.deepEqual(eventFor(a), eventFor(a)); assert.match(eventFor(a).handle.handle, /^local-1-cycle-1$/);});
test('Primeiro claim impede duplicata', () => {const a = projected(); const ledger = claimNotification(a, event(a), null, 'novo', 'request-1', START); assert.equal(canNotify(a, event(a), ledger, 'novo', START), false);});
test('Segundo aviso exige primeiro confirmado', () => {const a = projected(); assert.equal(canNotify(a, event(a), null, 'vencido', Date.parse(START)+600000), false);});
test('Limite antes e depois de 10 minutos', () => {const a = projected(); const ledger = confirmNotification(a, claimNotification(a, event(a), null, 'novo', 'req', START), 'novo', 'req', START); assert.equal(canNotify(a, event(a), ledger, 'vencido', Date.parse(START)+599999), false); assert.equal(canNotify(a, event(a), ledger, 'vencido', Date.parse(START)+600000), true);});
test('Claim sem confirmacao nunca expira automaticamente', () => {const a = projected(); const ledger = claimNotification(a, event(a), null, 'novo', 'req', START); assert.equal(canNotify(a, event(a), ledger, 'novo', Date.parse(START)+86400000), false);});
test('Ack de outro ciclo nao altera ledger novo', () => assert.throws(() => confirmNotification(projected(), {cycleId: 'old', novo: {state: 'claimed', requestId: 'req'}}, 'novo', 'req', START)));
test('Ack de outro executor bloqueado', () => {const a = projected(); assert.throws(() => confirmNotification(a, claimNotification(a, event(a), null, 'novo', 'req', START), 'novo', 'other', START));});
test('Metafields usam namespace compartilhado e CAS apenas como bundle', () => {const fields = metafieldValues(projected(), null); assert.ok(fields.every(f => f.namespace === 'ocean_b2b' && f.ownerId === ID)); assert.equal(fields.find(f => f.key === 'review').compareDigest, null); assert.equal(fields.find(f => f.key === 'pending_since').type, 'date_time');});

test('Flags desligadas fazem zero chamadas Shopify', async () => {const f = fixture({enabled: false}); let ran = 0; assert.equal(await f.bridge.run(ID, async () => ++ran), 1); await f.bridge.reconcile(ID); await f.bridge.claim(ID, {}, 'novo', 'req'); assert.equal(f.calls.length, 0);});
test('Invalida espelho antes da decisao e publica depois', async () => {const f = fixture(); await f.bridge.run(ID, async () => {assert.equal(JSON.parse(f.values.get('review').value).ready, false); f.source({location: location(), decision: decision('aprovado_pendente', START)});}); assert.equal(JSON.parse(f.values.get('review').value).status, 'aprovado_pendente'); assert.equal(f.signals.size, 0);});
test('Falha CAS impede alteracao comercial', async () => {const f = fixture(); f.failSet(true); let changes = 0; await assert.rejects(f.bridge.run(ID, async () => ++changes)); assert.equal(changes, 0);});
test('Falha comercial reconcilia fonte atual sem repetir a acao', async () => {const f = fixture(); await assert.rejects(f.bridge.run(ID, async () => {throw Error('save failed');}), {code:'ACTION_RECONCILED'}); assert.equal(JSON.parse(f.values.get('review').value).ready, true);});
test('Leitura comercial falha mantem avisos bloqueados', async () => {const f = fixture(); f.source({location: location(), decision: {...decision(), verified: false}}); await assert.rejects(f.bridge.run(ID, async () => {}), /Acao comercial executada/); assert.equal(JSON.parse(f.values.get('review').value).ready, false);});
test('Operacao interrompida exige recuperacao explicita', async () => {const f = fixture(); f.source({location:location(),decision:{...decision(),verified:false}}); await assert.rejects(f.bridge.run(ID, async () => {})); await assert.rejects(f.bridge.run(ID, async () => {}), {code: 'LOCKED'}); const state = JSON.parse(f.values.get('review').value); f.source({location:location(),decision:decision()}); const fixed = await f.bridge.reconcile(ID, {recoveryOperationId: state.operationId}); assert.equal(fixed.ready, true); assert.equal(fixed.enrolled, false);});
test('Falha de sinal e retomada nao refazem a decisao', async () => {const f = fixture({emitSignals: true}); f.source({location: location(), decision: decision('reaberto', START)}); f.failSignal(true); let writes = 0; await assert.rejects(f.bridge.run(ID, async () => ++writes), {code: 'SIGNAL_PENDING'}); assert.equal(JSON.parse(f.values.get('review').value).ready, true); assert.equal(JSON.parse(f.values.get('review').value).signalPending, false); const cycle = JSON.parse(f.values.get('review').value).cycleId; f.failSignal(false); await f.bridge.reconcile(ID); assert.equal(writes, 1); assert.equal(f.signals.size, 1); assert.equal(JSON.parse(f.values.get('review').value).cycleId, cycle);});
test('Sincronizacao repetida nao recria sinal', async () => {const f = fixture({emitSignals: true}); await f.bridge.run(ID, async () => {}); await f.bridge.reconcile(ID); assert.equal(f.signals.size, 1);});
test('Ledger tem disputa CAS entre execucoes paralelas', async () => {const f = fixture(); await f.bridge.run(ID, async () => {}); const state = JSON.parse(f.values.get('review').value); const claims = await Promise.allSettled([f.bridge.claim(ID, event(state), 'novo', 'run-a'), f.bridge.claim(ID, event(state), 'novo', 'run-b')]); assert.equal(claims.filter(r => r.status === 'fulfilled' && r.value).length, 1);});
test('Revalida aprovacao real antes de reservar aviso', async () => {const f = fixture(); await f.bridge.run(ID, async () => {}); const state = JSON.parse(f.values.get('review').value); f.source({location: location(), decision: decision('aprovado_pendente', START)}); assert.equal(await f.bridge.claim(ID, event(state), 'novo', 'run'), null);});
test('Revalida alteracao de decisao do mesmo status', async () => {const f = fixture(); f.source({location: location(), decision: decision('reaberto', START)}); await f.bridge.run(ID, async () => {}); const state = JSON.parse(f.values.get('review').value); f.time(REOPEN); f.source({location: location(), decision: decision('reaberto', REOPEN)}); assert.equal(await f.bridge.claim(ID, event(state), 'novo', 'run'), null);});
test('Espelho parcial nao e interpretado como pendente', async () => {const f = fixture(); f.values.set('status', {value: 'pendente'}); await assert.rejects(f.bridge.read(ID), /parcial/);});
test('JSON null nao e interpretado como espelho ausente', async () => {const f = fixture(); f.values.set('review', {value: 'null', type: 'json', compareDigest: 'a'}); await assert.rejects(f.bridge.read(ID), /invalido/);});
test('Ciclo incompleto no JSON bloqueia leitura', async () => {const f = fixture(); await f.bridge.run(ID, async () => {}); const r = f.values.get('review'); const state = JSON.parse(r.value); state.enteredAt = null; f.values.set('review', {...r, value: JSON.stringify(state)}); await assert.rejects(f.bridge.read(ID), /Ciclo/);});
test('Divergencia entre JSON e escalar bloqueia envio', async () => {const f = fixture(); await f.bridge.run(ID, async () => {}); f.values.set('status', {value: 'reprovado'}); await assert.rejects(f.bridge.read(ID), /divergentes/);});

function native(overrides = {}) { return bootstrapNative({location: location(), now: START, cutover: '2026-11-17T10:00:00Z', rolloutVerified: true, uuid: () => 'cycle-native', classify: statusDoPainel, ...overrides}); }
test('Bootstrap fechado requer rollout confirmado', () => assert.equal(native({rolloutVerified: false}).skipped, true));
test('Bootstrap nao presume ausencia de decisao historica', () => assert.equal(native({cutover: START}).skipped, true));
test('Bootstrap novo completo pode produzir ciclo sem painel', () => {const r = native(); assert.equal(r.skipped, false); assert.equal(r.state.status, 'pendente'); assert.equal(r.state.enrolled, true); assert.equal(r.expectedCompareDigest, null);});
test('Bootstrap incompleto nao emite sinal', () => assert.equal(eventFor(native({location: location({contacts: 0})}).state), null));
test('Bootstrap nao sobrescreve aprovacao comercial', () => assert.equal(native({existing: projected({decision: decision('aprovado_pendente', START)})}).skipped, true));
test('Bootstrap nao sobrescreve lock do aplicativo', () => assert.equal(native({existing: {...projected(), ready: false, operationId: 'lock'}}).skipped, true));
test('Contato tardio inicia novo prazo ao ficar completo', () => {const first = native({location: location({contacts: 0})}).state; const next = native({existing: first, now: REOPEN}).state; assert.equal(next.enteredAt, REOPEN);});
test('Regras, WhatsApp e contador preservados durante implantacao', () => {const manifest = JSON.parse(readFileSync(new URL('../reports/local-source-hashes.json', import.meta.url))); for (const [file, hash] of Object.entries(manifest.hashes)) {if(['AppHome.jsx','api.mjs','reprovados-api.mjs'].includes(file))continue;assert.equal(createHash('sha256').update(readFileSync(`${manifest.source}/${file}`)).digest('hex'), hash, file);}});

test('Evento publicado nao recebe ACK que invalida o digest visto pelo Flow',async()=>{let digest;const f=fixture({emitSignals:true,onSignal:({values})=>{digest=values.get('review').compareDigest;}});await f.bridge.run(ID,async()=>{});assert.equal(f.values.get('review').compareDigest,digest);});
test('Reaberturas no mesmo segundo preservam identidade distinta da decisao',()=>{const a=projected({decision:decision('reaberto','2026-11-17T12:00:00.100Z'),now:'2026-11-17T12:00:01Z'});const b=projected({previous:a,decision:decision('reaberto','2026-11-17T12:00:00.900Z'),now:'2026-11-17T12:00:01Z',uuid:()=> 'cycle-2'});assert.notEqual(b.cycleId,a.cycleId);assert.notEqual(b.reopenVersion,a.reopenVersion);assert.equal(b.decisionVersion,'2026-11-17T12:00:00.900Z');});

test('Sinal de ciclo nativo usa handle canonico e nao cria evento duplicado',async()=>{const f=fixture({emitSignals:true});await f.bridge.run(ID,async()=>{});const row=f.values.get('review');const state={...JSON.parse(row.value),cycleId:'native-1-UPPER',signalPending:true};const ev=eventFor(state);assert.equal(ev.handle.handle,'local-1-native-1-upper');f.values.set('review',{...row,value:JSON.stringify(state),compareDigest:'legacy'});f.values.set('cycle_id',{...f.values.get('cycle_id'),value:state.cycleId});f.signals.set(ev.handle.handle,{id:'existing-event',...ev.handle,fields:ev.metaobject.fields,updatedAt:START});await f.bridge.ensureSignal(state);assert.equal(f.signals.size,2);assert.equal(JSON.parse(f.values.get('signal').value).eventId,'existing-event');});
test('Recuperacao automatica de lease expirado usa decisao atual e conserva ciclo nas repeticoes',async()=>{const f=fixture({emitSignals:true});await f.bridge.run(ID,async()=>{});const old=JSON.parse(f.values.get('review').value);f.source({location:location(),decision:{...decision(),verified:false}});await assert.rejects(f.bridge.run(ID,async()=>{}));f.time(REOPEN);f.source({location:location(),decision:decision('reaberto',REOPEN)});const fixed=await f.bridge.reconcile(ID,{origin:'observation'});assert.equal(fixed.ready,true);assert.equal(fixed.operationId,null);assert.notEqual(fixed.cycleId,old.cycleId);assert.ok(fixed.lastSync.recoveredOperationId);const again=await f.bridge.reconcile(ID,{origin:'observation'});assert.equal(again.cycleId,fixed.cycleId);});
test('Falha apos decisao gravada recupera estado sem executar negocio novamente',async()=>{const f=fixture({emitSignals:true});let writes=0;await assert.rejects(f.bridge.run(ID,async()=>{writes++;f.source({location:location(),decision:decision('reaberto',START)});throw Error('confirmation lost');}),{code:'ACTION_RECONCILED'});const state=JSON.parse(f.values.get('review').value);assert.equal(state.status,'pendente');assert.equal(state.ready,true);assert.equal(writes,1);await f.bridge.reconcile(ID);assert.equal(writes,1);assert.equal(f.signals.size,1);});
