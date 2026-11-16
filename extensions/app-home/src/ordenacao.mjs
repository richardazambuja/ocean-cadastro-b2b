// Ordena por criacao do local B2B, nunca pela ultima atualizacao.
export function ordenarPorCadastro(registros, ordem = 'recentes') {
  const fator = ordem === 'antigos' ? 1 : -1;
  return [...registros].sort((a, b) => {
    const aData = Date.parse(a?.createdAt ?? '');
    const bData = Date.parse(b?.createdAt ?? '');
    const aOk = Number.isFinite(aData), bOk = Number.isFinite(bData);
    if (aOk !== bOk) return aOk ? -1 : 1;
    if (aOk && aData !== bData) return (aData - bData) * fator;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}
export function formatarDataCadastro(data) {
  if (!data || !Number.isFinite(Date.parse(data))) return 'Data nao informada';
  return new Date(data).toLocaleString('pt-BR', {
    timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
  });
}
