// Leitura e links de contato do painel Ocean. Nenhuma escrita em cadastros.
export function telefoneDoCadastro(location, customer) {
  const candidates = [
    customer?.defaultPhoneNumber?.phoneNumber,
    location?.billingAddress?.phone,
    location?.phone,
    location?.shippingAddress?.phone,
    customer?.defaultAddress?.phone,
  ];
  return candidates.find(v => typeof v === 'string' && v.trim())?.trim() || '';
}

// Converte um telefone brasileiro a 55 + DDD + numero (apenas algarismos).
// Evita criar links incorretos a partir de dados malformados ou numeros estrangeiros.
export function whatsappDigitos(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/[^\d\s()+.\-/]/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) {
    if (!digits.startsWith('0055')) return null;
    digits = digits.slice(2);
  }
  if (raw.startsWith('+') && !digits.startsWith('55')) return null;
  if (digits.startsWith('55') && [12,13].includes(digits.length)) {
    digits = digits.slice(2);
  }
  // DDD (2) + telefone fixo (8) ou celular (9).
  if (![10,11].includes(digits.length)) return null;
  if (digits[0] === '0' || digits[2] === '0') return null;
  return '55' + digits;
}

export function formatarTelefone(value) {
  if (!value) return 'Não informado';
  const normalized = whatsappDigitos(value);
  if (!normalized) return String(value).trim();
  const br = normalized.slice(2);
  if (br.length === 11) return `(${br.slice(0,2)}) ${br.slice(2,7)}-${br.slice(7)}`;
  return `(${br.slice(0,2)}) ${br.slice(2,6)}-${br.slice(6)}`;
}

// Mantem nome para compatibilidade com AppHome.jsx ja instalado.
export function telefoneParaHref(value) {
  const digits = whatsappDigitos(value);
  return digits ? `https://wa.me/${digits}` : null;
}

// Somente dominios Instagram verificados ou handles validos se tornam links.
export function instagramParaHref(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  let handle = '';
  if (/^@[a-zA-Z0-9._]{1,30}$/.test(raw)) handle = raw.slice(1);
  else {
    const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})\/?(?:\?[^#]*)?$/i);
    if (m) handle = m[1];
    else if (/^[a-zA-Z0-9._]{1,30}$/.test(raw)) handle = raw;
  }
  if (!handle) return null;
  return `https://www.instagram.com/${handle}/`;
}
