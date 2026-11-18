# Ocean B2B — notificações ativas em produção

Loja: `mrdvrf-6a.myshopify.com`. Destinatário exclusivo: `cadastros@oceanjoiasbr.com`.

**Produção liberada em 17/11/2026 às 16:08:04 de Brasília (19:08:04 UTC).** A configuração `ocean_b2b.rollout` está em `mode=production`, `productionApproved=true`, com corte nesse horário, sem lista de empresas de teste nem executor de diagnóstico no painel.

Versão ativa: **ocean-b2b-ui-20261118-urgent**, ID `1235951386625`.
[Versão na Shopify](https://dev.shopify.com/dashboard/243206031/apps/447943081985/versions/1235951386625).


Correção urgente da interface publicada: estados de abertura, atualização, sincronização e ações separados; refresh conserva as linhas; leitura essencial combinada e cancelável; falha/timeout identifica dados antigos e permite nova tentativa. 164 testes e sete cenários de Chrome local aprovados. O usuário fará a conferência no Admin autenticado; não há medição de pintura real de produção nesta etapa. [Relatório atual](reports/browser-performance-result.md).

A primeira correção e suas medições abaixo são históricas e não comprovaram a experiência no navegador.

Correção de performance publicada em 18/11/2026: dados essenciais em 0,89–1,01 s nas três medições pós-deploy, com 3 consultas visuais e 3 em segundo plano, contra 175 leituras e 31,18 s no ensaio anterior. Medição via API da loja, sem incluir renderização/App Bridge. A listagem não espera reconciliações. Os 151 testes passaram; os 55 locais conservaram permissões, decisões, ciclos, ledgers e digests; todos os workflows permaneceram ativos e inalterados. [Relatório da correção](reports/performance-result.md).

O código canônico desta versão está em `../../extensions/app-home/src`. As cópias anteriores em `integration/` são históricas e não devem sobrescrever a correção.

## Resultado efetivo

- Operação interrompida de `8622571620` recuperada pela autenticação do próprio cadastro-b2b, preservando a decisão privada já gravada. Reaberturas posteriores geraram UUIDs e horários novos; atualizar os dados conservou o ciclo.
- Sinal de `8622702692` confirmado sem recriação: a Shopify normaliza handles para minúsculas. O ciclo continua preservando a sua identificação original nos campos do evento.
- Reabertura real: dois avisos confirmados no ciclo `4dd50967-11cf-4403-a0ad-a0f4a11c392e`, após a espera real de dez minutos.
- Aprovação comercial antes do prazo: `8622702692` permaneceu `aprovado_pendente`, sem alerta vencido e sem liberação de compra.
- 51 cadastros históricos reconciliados, com snapshot privado estável, zero erros e `enrolled=false`; nenhum disparo retroativo em massa.
- 138 testes passaram (93 integração + 45 originais); build e deploy passaram.
- Os três workflows anteriores foram preservados, assim como as atribuições B2B dos 54 locais existentes antes do teste final.
- Novo local sintético `8625356900`, criado depois da liberação geral, entrou automaticamente em Pendentes pela ponte nativa e teve aviso imediato confirmado às 19:08:22 UTC. O aviso vencido foi confirmado às 19:18:23 UTC, em modo de produção. A auditoria final dos 55 locais passou sem divergências.

[Relatório da execução](reports/definitive-result.md), [barreira de ativação](reports/definitive-production-gate.json), [configuração de produção confirmada](reports/definitive-production-enabled.json), [preservação dos workflows anteriores](reports/definitive-originals-preserved.json).

## Arquitetura implantada

A decisão comercial continua em `$app:cadastro_decisao`. O painel original mantém suas abas, WhatsApp, contador, filtro de vencidos, aprovação comercial separada de compra e travamento manual. Não foi restaurado código do GitHub.

A ponte compartilha o estado em CompanyLocation por `ocean_b2b.review`, `ready`, `status`, `cycle_id` e `pending_since`. O JSON protegido usa `compareDigest`; a escrita dos campos é atômica. `ocean_b2b.notifications` reserva cada tipo de aviso por ciclo. `ocean_b2b.signal` guarda a confirmação do metaobjeto nativo; não altera o digest do review depois de publicar o evento. `ocean_b2b.migration` conserva a evidência de reconciliação histórica na empresa de teste.

Os cinco estados são `pendente`, `aprovado_pendente`, `aprovado_liberado`, `reprovado` e `incompleto`. Somente `pendente`, completo e sem acesso B2B, pode enviar. Uma reabertura válida produz novo UUID e horário; atualização da página conserva a identidade da decisão já processada.

Antes da ação comercial, a ponte adquire uma operação por CAS, com lease de cinco minutos, e bloqueia o espelho. Depois usa os recibos de escrita e a fonte privada atual para confirmar o estado. Operação expirada é recuperada no carregamento ou antes de uma nova ação, sem repetir a decisão anterior. Falha na fonte mantém o envio bloqueado e deixa erro registrado.

O evento público é um registro `ocean_b2b_pending_cycle` por local/ciclo. A emissão consulta primeiro o handle canônico e valida todos os campos. Os workflows nativos Company location created e Company contact created cobrem a entrada inicial mesmo com o painel fechado. Não há servidor externo nem extensão Flow customizada.

## Workflows existentes atualizados

| Workflow | ID | Versão ativa |
| --- | --- | --- |
| OCEAN — NOVO CADASTRO B2B | `01a1e9c5-8412-721a-9a5e-2e545f827eee` | `01M7ND1053SFM395G569ZCH2MJ` |
| OCEAN — CADASTRO VENCIDO | `01a1e9c5-a198-7078-8e9a-35b205098189` | `01M7ND17GDZT14NQNC7Z8MT5PR` |
| Ponte técnica — novo local | `01a1e9e0-fb18-7796-96df-1f4d86f80bac` | `01M7ND1F014GWZV5WG0AHSWR9Y` |
| Ponte técnica — novo contato | `01a1e9e3-4bea-70f3-8e80-b18d8c984f89` | `01M7ND1MNKGG38VAEZJ9R0ETZ5` |

Os dois avisos consultam o estado atual, conferem ciclo/horário/consistência e os dados reais do local, reservam o aviso por CAS e reconsultam antes do envio. O segundo começa com Wait de dez minutos, seguido de Get company location data, e exige o primeiro envio confirmado. Eventos de ciclos antigos não reservam avisos do ciclo novo.

A confirmação `sent` no ledger ocorre depois da ação de envio da Shopify e inclui a URL da execução. Não equivale à confirmação na caixa postal. Reservas com resultado incerto não expiram automaticamente; devem ser investigadas pela URL antes de qualquer recuperação de envio. Não apague reservas para tentar reenviar.

O workflow antigo Recover abandoned checkout conserva seu erro preexistente `CONNECTOR_ERROR`; suas configurações não foram alteradas.

## Código e reprodução

O código efetivamente publicado está em `../../extensions/app-home/src`. As cópias preparadas atuais estão em `integration/` e `src/`. O backup inicial desta correção está em `backups/definitive-20261117/source-before.tar.gz`. O antigo `integration/panel.patch` documenta a integração inicial e **não deve ser reaplicado** sobre o painel já integrado.

```bash
npm test
node ../../extensions/app-home/src/testes-acesso.mjs
node ../../extensions/app-home/src/testes-reprovados.mjs
shopify app build --path ../..
```

Os escopos do app incluem `read_companies`, `write_companies`, `read_customers`, `read_metaobjects` e `write_metaobjects`; a CLI usa `write_automations` com API `unstable` para gerenciar o Flow. Nenhuma credencial privada foi adicionada ao código ou ao bundle. Os arquivos `production-*` e `reopen-*` anteriores em reports são evidências históricas; os arquivos `definitive-*` registram esta execução.
