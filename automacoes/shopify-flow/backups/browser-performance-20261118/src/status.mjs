// A Shopify e a fonte de verdade da permissao B2B. A aprovacao comercial
// e gravada separadamente em um metaobjeto exclusivo do aplicativo.
import {classifyLocation} from './regras.mjs';

export const STATUS_REPROVADO = 'reprovado';
export const STATUS_REABERTO = 'reaberto';
export const STATUS_APROVADO_PENDENTE = 'aprovado_pendente';
export const STATUS_APROVADO_LIBERADO = 'aprovado_liberado';

export function statusDoPainel(location, decisoes = {}) {
  const original = classifyLocation(location);
  if (original === 'erro') return 'erro';
  // Permissao de compra existente sempre tem precedencia sobre status interno.
  if (original === 'aprovado') return STATUS_APROVADO_LIBERADO;
  const decisao = decisoes?.[location?.id];
  if (decisao === STATUS_REPROVADO) return STATUS_REPROVADO;
  if (original === 'incompleto') return 'incompleto';
  if (decisao === STATUS_APROVADO_PENDENTE) return STATUS_APROVADO_PENDENTE;
  return 'pendente';
}

export function totaisDoPainel(locais, decisoes = {}) {
  return locais.reduce((acc, local) => {
    acc[statusDoPainel(local, decisoes)] += 1;
    return acc;
  }, {pendente:0, aprovado_pendente:0, aprovado_liberado:0, incompleto:0, reprovado:0, erro:0});
}

export function podeReprovar(local, decisoes = {}) {
  const atual = statusDoPainel(local, decisoes);
  return atual === 'pendente' || atual === 'incompleto';
}

export function podeReabrir(local, decisoes = {}) {
  return statusDoPainel(local, decisoes) === STATUS_REPROVADO;
}

export function handleDoLocal(locationId) {
  const match = /^gid:\/\/shopify\/CompanyLocation\/(\d+)$/.exec(locationId || '');
  if (!match) throw new Error('ID do local invalido; nenhum status foi salvo.');
  return `local-${match[1]}`;
}
