// Apenas leitura/apresentação. Link de consulta pública; não altera o CNPJ na Shopify.
export function cnpjParaHref(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  // Aceita CNPJ com ou sem pontuação, não aceita texto arbitrário como URL.
  if (!texto || !/^[0-9.\/-\s]+$/.test(texto)) return null;
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length !== 14) return null;
  return `https://cnpj.biz/${digitos}`;
}
