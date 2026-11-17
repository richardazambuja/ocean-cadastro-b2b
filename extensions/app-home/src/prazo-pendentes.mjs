// Prazo visual de atendimento dos cadastros PENDENTES (nao e prazo de acesso B2B).
// Sem escrita nem alteracao de permissoes na Shopify.
export const PRAZO_PENDENTE_MS = 10 * 60 * 1000;

export function inicioPendencia(local, decisoes={}) {
  if (!local?.id) return null;
  const criado = Date.parse(local.createdAt || '');
  const reabertura = decisoes?.[local.id] === 'reaberto'
    ? Date.parse(decisoes[`__reaberto_em__${local.id}`] || '')
    : NaN;
  // Ao reabrir a analise, o cliente volta a entrar na fila de Pendentes.
  // Metaobjetos antigos sem timestamp utilizam a criacao do local.
  const inicio = Number.isFinite(reabertura) && (!Number.isFinite(criado) || reabertura > criado)
    ? reabertura : criado;
  return Number.isFinite(inicio) ? inicio : null;
}

export function formatarDuracao(ms) {
  const segundos = Math.max(0, Math.floor(ms / 1000));
  const dias = Math.floor(segundos / 86400);
  const horas = Math.floor((segundos % 86400) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  const dois = n => String(n).padStart(2, '0');
  if (dias) return `${dias}d ${horas}h ${dois(minutos)}m ${dois(s)}s`;
  if (horas) return `${horas}h ${dois(minutos)}m ${dois(s)}s`;
  return `${minutos}m ${dois(s)}s`;
}

export function calcularPrazoPendente(local, decisoes={}, agora=Date.now()) {
  const inicio = inicioPendencia(local, decisoes);
  if (inicio === null || !Number.isFinite(agora)) {
    return {disponivel:false, vencido:false, texto:'Data de entrada indisponível'};
  }
  const fim = inicio + PRAZO_PENDENTE_MS;
  const resto = fim - agora;
  if (resto > 0) {
    const segundos = Math.ceil(resto / 1000);
    const minutos = Math.floor(segundos / 60);
    const s = String(segundos % 60).padStart(2,'0');
    return {disponivel:true, vencido:false, inicio, fim, texto:`Tempo restante para análise: ${String(minutos).padStart(2,'0')}:${s}`};
  }
  return {disponivel:true, vencido:true, inicio, fim, texto:`Prazo de análise vencido há ${formatarDuracao(agora - fim)}`};
}
