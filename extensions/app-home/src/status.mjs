// Status exibido no app: a Shopify continua sendo a fonte de verdade sobre permissões B2B.
import {classifyLocation} from './regras.mjs';

export const STATUS_REPROVADO = 'reprovado';
export const STATUS_REABERTO = 'reaberto';

export function statusDoPainel(location, decisoes = {}) {
  const original = classifyLocation(location);
  // Um comprador realmente autorizado nunca pode parecer "reprovado".
  if (original === 'aprovado' || original === 'erro') return original;
  if (decisoes?.[location?.id] === STATUS_REPROVADO) return STATUS_REPROVADO;
  return original;
}

export function totaisDoPainel(locais, decisoes = {}) {
  return locais.reduce((acc, local) => {
    acc[statusDoPainel(local, decisoes)] += 1;
    return acc;
  }, {pendente:0, aprovado:0, incompleto:0, reprovado:0, erro:0});
}

export function podeReprovar(local, decisoes = {}) {
  const atual = statusDoPainel(local, decisoes);
  return atual === 'pendente' || atual === 'incompleto';
}

export function podeReabrir(local, decisoes = {}) {
  return statusDoPainel(local, decisoes) === 'reprovado';
}

export function handleDoLocal(locationId) {
  const match = /^gid:\/\/shopify\/CompanyLocation\/(\d+)$/.exec(locationId || '');
  if (!match) throw new Error('ID do local invalido; nao foi salvo nenhum status.');
  return `local-${match[1]}`;
}
