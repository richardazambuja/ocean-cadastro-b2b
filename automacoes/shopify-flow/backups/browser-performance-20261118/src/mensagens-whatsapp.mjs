// Textos oficiais informados pela Ocean. Sem envio automatico.
// As mensagens devem manter exatamente a pontuacao, emojis e quebras de linha.
import {telefoneParaHref} from './contato-links.mjs';

export const MENSAGEM_REPROVACAO = `Olá! Tudo bem? 💙

Agradecemos seu interesse em fazer parte da Ocean Semijoias!

Após a análise das informações fornecidas, infelizmente, seu cadastro não atendeu aos critérios necessários para a liberação do nosso catálogo exclusivo de atacado.

Trabalhamos exclusivamente com empresas que possuem CNPJ ativo e atuação comprovada no segmento de semijoias, joias ou acessórios.

Caso suas informações precisem ser atualizadas ou você tenha documentação complementar, nossa equipe poderá realizar uma nova avaliação.

Agradecemos sua compreensão e esperamos ter a oportunidade de atender você futuramente! 💎

Equipe Ocean Semijoias`;

export const MENSAGEM_APROVACAO = `✅ Cadastro Aprovado!

Olá! Informamos que seu cadastro foi aprovado com sucesso no E-commerce da Ocean Jóias.

📌 Informações de acesso:
* Duração do acesso: 1 hora
* Necessário agendamento prévio

🎉 Benefícios após a primeira compra:
* Prioridade nas próximas compras
* Acesso antecipado a lançamentos
* Descontos exclusivos
* Liberação de crédito mediante a consulta

Agradecemos a sua confiança e ficamos à disposição para agendar sua visita ao nosso e-commerce!`;

export function mensagemWhatsAppDoStatus(status) {
  if (status === 'reprovado') return 'reprovacao';
  if (status === 'aprovado_pendente' || status === 'aprovado_liberado') return 'aprovacao';
  return null;
}

export function whatsappMensagemHref(numero, status) {
  const tipo = mensagemWhatsAppDoStatus(status);
  if (!tipo) return null;
  const base = telefoneParaHref(numero);
  if (!base) return null;
  const texto = tipo === 'reprovacao' ? MENSAGEM_REPROVACAO : MENSAGEM_APROVACAO;
  return `${base}?text=${encodeURIComponent(texto)}`;
}
