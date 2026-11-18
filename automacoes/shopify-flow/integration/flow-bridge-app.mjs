// Prepared adapter for extensions/app-home/src. Not a Flow app extension.
import {graphql, fetchLocation} from './api.mjs';
import {statusDoPainel, handleDoLocal} from './status.mjs';
import {createBridge} from './flow-bridge/bridge.mjs';
import {REVIEW} from './flow-bridge/operations.mjs';

// No store writes until a separately approved rollout changes these flags.
export const FLOW_BRIDGE_ENABLED = false;
export const FLOW_SIGNALS_ENABLED = false;

async function readDecision(id) {
  const data = await graphql(REVIEW, {handle: {type: '$app:cadastro_decisao', handle: handleDoLocal(id)}});
  if (!Object.hasOwn(data, 'metaobjectByHandle')) throw Error('Resposta sem decisao comercial.');
  const record = data.metaobjectByHandle;
  if (!record) return {verified: true, localId: id, status: null, updatedAt: null};
  const fields = Object.fromEntries(record.fields.map(f => [f.key, f.value]));
  if (fields.local_id !== id || record.handle !== handleDoLocal(id)) throw Error('Decisao comercial de outro local.');
  return {verified: true, localId: id, status: fields.status, updatedAt: fields.alterado_em || null};
}

export const ponteFlow = createBridge({
  enabled: FLOW_BRIDGE_ENABLED,
  emitSignals: FLOW_SIGNALS_ENABLED,
  query: graphql,
  classify: statusDoPainel,
  loadAuthoritative: async id => {
    const [location, decision] = await Promise.all([fetchLocation(id), readDecision(id)]);
    return {location, decision};
  },
});
