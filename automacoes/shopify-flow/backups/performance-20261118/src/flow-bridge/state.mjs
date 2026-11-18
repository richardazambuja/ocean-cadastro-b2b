export const NAMESPACE = 'ocean_b2b';
export const EVENT_TYPE = 'ocean_b2b_pending_cycle';
export const STATUSES = Object.freeze(['pendente', 'aprovado_pendente', 'aprovado_liberado', 'reprovado', 'incompleto']);
export const DEADLINE_MS = 600_000;

export function locationId(value) {
  if (!/^gid:\/\/shopify\/CompanyLocation\/\d+$/.test(value || '')) throw Error('Local B2B invalido.');
  return value;
}

function instant(value) {
  const n = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(n)) throw Error('Horario de analise invalido.');
  // Shopify date_time values have second precision in persisted responses.
  return new Date(n).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// A decision version is an identity, not a date_time metafield. Keep milliseconds
// so two commercial decisions in the same second remain distinct.
export function decisionVersion(value) {
  if (!value) return null;
  const n=Date.parse(value);
  if(!Number.isFinite(n)) throw Error('Versao da decisao comercial invalida.');
  return new Date(n).toISOString();
}

function unique(value) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(value || '')) throw Error('Identificador de ciclo invalido.');
  return value;
}

export function authoritativeStatus(location, decision, classify) {
  locationId(location?.id);
  if (!decision?.verified || decision.localId !== location.id) throw Error('Decisao comercial nao verificada.');
  if (![null, 'reaberto', 'reprovado', 'aprovado_pendente'].includes(decision.status)) throw Error('Decisao comercial desconhecida.');
  if (decision.status === 'reaberto') instant(decision.updatedAt);
  const status = classify(location, {[location.id]: decision.status});
  if (!STATUSES.includes(status)) throw Error('Cadastro sem dados suficientes para sincronizar.');
  return status;
}

// classify is the current application's statusDoPainel, injected without duplicating it.
export function project({location, decision, previous = null, classify, now, uuid, origin = 'backfill'}) {
  const at = instant(now);
  const status = authoritativeStatus(location, decision, classify);
  if (decision.updatedAt && Date.parse(instant(decision.updatedAt)) > Date.parse(at)) throw Error('Decisao comercial no futuro.');
  const reopenVersion = decision.status === 'reaberto' ? decisionVersion(decision.updatedAt) : null;
  const newReopening = Boolean(reopenVersion && reopenVersion !== decisionVersion(previous?.reopenVersion));
  const newCycle = status === 'pendente' && (previous?.status !== 'pendente' || !previous?.cycleId || newReopening);
  let cycleId = previous?.cycleId ?? null;
  let enteredAt = previous?.enteredAt ?? null;
  let enrolled = previous?.enrolled ?? false;
  if (newCycle) {
    cycleId = unique(uuid());
    // Observation time is used for incomplete -> pending. Never reuse location.createdAt.
    enteredAt = newReopening && previous?.status !== 'incompleto' ? instant(reopenVersion) : at;
    enrolled = origin !== 'backfill';
  }
  return {
    schema: 1, locationId: location.id, ready: true, operationId: null,
    status, cycleId, enteredAt, enrolled, reopenVersion,
    decisionVersion: decisionVersion(decision.updatedAt), decisionStatus: decision.status,
    updatedAt: at,
    signalPending: status === 'pendente' && enrolled && (newCycle || previous?.signalPending === true),
  };
}

export function eventFor(state) {
  if (!state.ready || state.status !== 'pendente' || !state.enrolled || !state.cycleId || !state.enteredAt) return null;
  const suffix = locationId(state.locationId).split('/').at(-1);
  return {
    handle: {type: EVENT_TYPE, handle: `local-${suffix}-${unique(state.cycleId)}`.toLowerCase()},
    metaobject: {fields: [
      {key: 'local_id', value: state.locationId},
      {key: 'cycle_id', value: state.cycleId},
      {key: 'entered_at', value: instant(state.enteredAt)},
    ]},
  };
}

export function canNotify(state, event, ledger, kind, now) {
  if (!['novo', 'vencido'].includes(kind)) return false;
  if (!state?.ready || !state.enrolled || state.operationId || state.status !== 'pendente') return false;
  if (!event || !state.cycleId || event.locationId !== state.locationId || event.cycleId !== state.cycleId || Date.parse(event.enteredAt) !== Date.parse(state.enteredAt)) return false;
  const at = typeof now === 'number' ? now : Date.parse(now);
  const entry = Date.parse(state.enteredAt);
  if (!Number.isFinite(at) || !Number.isFinite(entry) || at < entry) return false;
  if (ledger && ledger.cycleId !== state.cycleId) ledger = null;
  if (ledger?.[kind]) return false; // Claims never expire automatically: avoid retry duplicates.
  return kind === 'novo' || (at - entry >= DEADLINE_MS && ledger?.novo?.state === 'sent');
}

export function claimNotification(state, event, ledger, kind, requestId, now) {
  if (!canNotify(state, event, ledger, kind, now)) return null;
  return {
    ...(ledger?.cycleId === state.cycleId ? ledger : {schema: 1, cycleId: state.cycleId}),
    [kind]: {state: 'claimed', requestId: unique(requestId), claimedAt: instant(now)},
  };
}

export function confirmNotification(state, ledger, kind, requestId, now) {
  if (ledger?.cycleId !== state?.cycleId || ledger?.[kind]?.state !== 'claimed' || ledger[kind].requestId !== requestId) throw Error('Confirmacao de outro ciclo ou execucao.');
  return {...ledger, [kind]: {...ledger[kind], state: 'sent', sentAt: instant(now)}};
}

export function metafieldValues(state, compareDigest) {
  locationId(state.locationId);
  const entries = [
    ['review', 'json', JSON.stringify(state)],
    ['ready', 'boolean', String(state.ready === true)],
    ['status', 'single_line_text_field', state.status || 'incompleto'],
    ['cycle_id', 'single_line_text_field', state.cycleId || 'none'],
  ];
  if (state.enteredAt) entries.push(['pending_since', 'date_time', instant(state.enteredAt)]);
  return entries.map(([key, type, value]) => ({ownerId: state.locationId, namespace: NAMESPACE, key, type, value, ...(key === 'review' ? {compareDigest: compareDigest ?? null} : {})}));
}
