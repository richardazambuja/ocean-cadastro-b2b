# Ocean B2B — execução definitiva de 17/11/2026

Loja `mrdvrf-6a.myshopify.com`. Destinatário exclusivo `cadastros@oceanjoiasbr.com`.

## Publicação e correções

Versão publicada e ativa: `ocean-b2b-production-20261117-1900`, `gid://shopify/Version/1233627316225`.
https://dev.shopify.com/dashboard/243206031/apps/447943081985/versions/1233627316225

Backup: `backups/definitive-20261117/source-before.tar.gz`. Os arquivos locais atuais foram preservados como origem; nenhum painel antigo foi restaurado.

O bloqueio persistente era consequência do protocolo anterior: a ação comercial executava depois da reserva e fora do tratamento de falhas. Uma decisão já persistida, seguida de erro de confirmação, mantinha `ready=false` e não havia lease nem recuperação automática. A publicação também dependia de uma releitura para obter a propriedade da operação e comparava JSON textual. Esses caminhos foram substituídos por confirmação do recibo de escrita, comparação semântica, operação com lease e recuperação por CAS a partir da decisão privada atual, sem repetir a decisão comercial. O erro de transporte específico da operação antiga não foi registrado pela versão anterior; o estado persistido comprova a interrupção depois da gravação privada.

O erro do sinal nativo foi confirmado diretamente na Shopify: os handles de metaobjetos são normalizados para minúsculas, enquanto o ciclo nativo continha ULID em maiúsculas. A comparação textual anterior rejeitava um sinal já existente. A correção usa handle canônico, valida seus três campos, consulta antes de criar e registra um recibo separado em `ocean_b2b.signal`. O sinal antigo `695339155556` foi reconhecido sem recriação.

A recuperação preserva `compareDigest`, reservas de notificações e a decisão privada `$app:cadastro_decisao`. Falhas de confirmação deixam registro recuperável; uma reserva de e-mail com resultado incerto não expira automaticamente.

## Reconciliação efetiva

A autenticação oficial por client credentials confirmou o app `gid://shopify/App/447943081985`, client ID `cbdf3320e1517c8e9006c806a882be25`, e acesso ao seu metaobjeto privado. Credenciais não foram incluídas no aplicativo nem nos relatórios.

Foram inventariados 54 locais. Os 51 locais fora do escopo sintético foram reconciliados em uma passagem, com snapshot privado estável e zero erros: 5 incompletos, 12 aprovados/liberados, 1 reprovado, 31 aprovados/acesso pendente e 2 pendentes históricos. Todos receberam `enrolled=false`; nenhum sinal histórico foi criado. A ativação geral exige essa conferência novamente.

`reports/definitive-owner-reconciliation.json` registra a recuperação da operação `01a1eaab-e5f1-7031-b8bb-75fb541522f8`, preservando a decisão privada `reaberto` de 18:01:37.319 UTC e gerando o ciclo `58e1a583-f8a8-4569-a0d8-57a4143ef28d`. O segundo local conservou seu ciclo nativo e recebeu a confirmação correta do sinal.

## Teste comercial e de notificações

Evidência detalhada: `reports/definitive-owner-test-result.json`, com snapshots privados, review, sinal, ledger e papéis B2B em cada etapa.

- Local `8622571620`: reabertura A `7342c505-7261-47bb-97e1-99f6a8b73c95`, seguida de reprovação e reabertura B `4dd50967-11cf-4403-a0ad-a0f4a11c392e` às 18:55:31 UTC. A atualização dos dados conservou UUID e horário. O Flow confirmou os avisos imediatos nos respectivos ciclos.
- Local `8622702692`: reabertura C `b479b806-a659-4357-ac1f-42fd024036ed` às 18:55:45 UTC, aviso imediato confirmado e aprovação comercial às 18:56:53.659 UTC, com espelho `aprovado_pendente` às 18:56:55 UTC. Nenhuma liberação de compra foi executada.
- O teste automatizado externo inicialmente consultou os nomes dos papéis em inglês. A aprovação foi bloqueada por sua validação original; a ponte reconciliou esse erro real sem deixar operação presa. O executor foi alinhado ao idioma `pt-BR` do painel e a aprovação foi concluída antes do prazo. Os nomes dos papéis, as regras de aprovação e as atribuições não foram alterados.

O resultado após a espera real de dez minutos e a configuração de produção são registrados em `reports/definitive-production-gate.json` e `reports/definitive-production-enabled.json` quando concluídos. O ledger é atualizado somente depois da ação de envio da Shopify. Isso comprova execução do envio; confirmação de caixa postal depende do destinatário.

## Workflows e regressão

Os workflows de notificações conservaram os IDs:

| Nome | ID | Versão ativa validada |
| --- | --- | --- |
| OCEAN — NOVO CADASTRO B2B | `01a1e9c5-8412-721a-9a5e-2e545f827eee` | `01M7ND1053SFM395G569ZCH2MJ` |
| OCEAN — CADASTRO VENCIDO | `01a1e9c5-a198-7078-8e9a-35b205098189` | `01M7ND17GDZT14NQNC7Z8MT5PR` |

As pontes nativas de novo local e novo contato também foram atualizadas no mesmo ID, sem servidor externo. Elas permitem a entrada inicial mesmo com o painel fechado. A reserva do aviso usa CAS no review e no ledger, seguida de nova consulta antes do e-mail. Eventos de outro ciclo e estados aprovados, reprovados ou incompletos são recusados.

As três automações anteriores mantêm configuração, nome, versão e versão ativa: `reports/definitive-originals-preserved.json`. O erro `CONNECTOR_ERROR` do workflow antigo Recover abandoned checkout já existia e não foi alterado.

Passaram 93 testes da integração, 21 testes originais de aprovação/liberação/travamento e 24 testes originais de persistência/reprovação/ordenação: **138 testes, zero falhas**. `shopify app build` passou; o deploy recompilou e validou as extensões antes da publicação. As operações GraphQL foram verificadas pelo Shopify AI Toolkit. O painel final conserva seus cinco comandos comerciais, abas, contador, filtro de vencidos, WhatsApp e controle manual de compra. O executor automático de diagnóstico foi retirado do bundle final.

A comparação de atribuições B2B de todos os 54 locais faz parte da barreira de ativação; o executor dos testes proíbe mutations de clientes e permissões B2B. Somente os metafields de integração históricos e as decisões das empresas sintéticas foram escritos.


## Conclusão efetiva de produção

A barreira final passou às 19:08:04 UTC. A configuração foi escrita por CAS e confirmada pela API com `mode=production`, `productionApproved=true`, `cutover=2026-11-17T19:08:04Z`, destinatário interno e epoch preservada. Foram retirados `testLocationIds`, `bootstrapTestCompanyIds` e `verificationRequest`. Os dois workflows de notificações e as duas pontes nativas estão ativos; nenhum workflow foi recriado.

O usuário confirmou nesta rodada: **“Recebi os dois”**, para os assuntos NOVO CADASTRO PENDENTE e CADASTRO VENCIDO da empresa de reabertura. O aviso vencido desse ciclo foi confirmado no ledger às 19:05:35 UTC. A evidência de caixa postal está em `definitive-inbox-confirmation.json`.

Foi criado somente um novo local sintético, `gid://shopify/CompanyLocation/8625356900`, na empresa de teste `7442399332`, às 19:08:17 UTC. Nenhum contato ou cliente foi alterado e o local ficou sem atribuições B2B. A ponte nativa iniciou Pendentes às 19:08:19 UTC, com ciclo `native-8625356900-01M7NEHWY5JRVVJVCFDGZAW5SP`, sem depender do painel. O envio imediato foi confirmado às **19:08:22 UTC / 16:08:22 Brasília** e o vencido às **19:18:23 UTC / 16:18:23 Brasília**. A releitura pela ponte do próprio aplicativo conservou review, digest e ledger e reconheceu o sinal existente `695433461860`, sem novo evento.

- [Execução do aviso imediato em produção](https://admin.shopify.com/store/mrdvrf-6a/apps/flow/activity/01a1e9c5-8412-721a-9a5e-2e545f827eee:01M7NEHZ2TDW09RD61P9WHX4QE:63c4a583f0e8cc65:v2).
- [Execução do aviso vencido em produção](https://admin.shopify.com/store/mrdvrf-6a/apps/flow/activity/01a1e9c5-a198-7078-8e9a-35b205098189:01M7NEHZ2TDW09RD61P9WHX4QE:97f57220d5314e9e:v2).

A auditoria final, somente por leitura, terminou às **19:18:52 UTC**: todos os 55 espelhos correspondem às decisões comerciais privadas e aos campos escalares, todos estão `ready=true` e sem operação pendente, os 51 históricos continuam excluídos de notificações retroativas, os 54 locais preexistentes mantêm suas atribuições exatas e o novo local sintético também está sem acesso. A consulta final dos sete workflows manteve as três configurações anteriores, as quatro versões Ocean ativas e zero erros de validação nos workflows Ocean.

| Local anteriormente afetado | Estado privado atual | Estado compartilhado | Ciclo atual | Entrada em Pendentes UTC |
| --- | --- | --- | --- | --- |
| `8622571620` | `reaberto` | `pendente` | `4dd50967-11cf-4403-a0ad-a0f4a11c392e` | `2026-11-17T18:55:31Z` |
| `8622702692` | `aprovado_pendente` | `aprovado_pendente` | `b479b806-a659-4357-ac1f-42fd024036ed` | `2026-11-17T18:55:45Z` |

Nos dois locais: `ready=true`, `operationId=null`, `signalPending=false`. O primeiro recebeu os dois avisos do ciclo B; o segundo conserva somente o primeiro aviso, mesmo depois do prazo, devido à aprovação comercial. O UUID anterior A não foi reaproveitado; as condições do Flow exigem o ciclo atual antes de reservar e novamente antes de enviar.

`definitive-final-audit.json` contém os campos e recibos atuais, identidade do aplicativo, configuração de produção, URLs dos envios, contagens e os doze controles finais aprovados. `definitive-before.json` e `definitive-owner-reconciliation.json` permitem comparar os valores antigos, a recuperação e os novos valores. `definitive-source-preservation.json` comprova a preservação dos arquivos de regras, permissões, WhatsApp, prazo e ordenação; as alterações do painel ficaram nas ligações da ponte e na persistência confirmada da decisão.

Não permanece bloqueio de implantação ou erro nos novos avisos. O erro de conector do workflow antigo Recover abandoned checkout permanece preexistente e foi preservado. Os testes sintéticos identificados continuam na loja como evidência; não foram concedidas permissões de compra. As credenciais temporárias de validação foram removidas do ambiente de trabalho e não integram o aplicativo, repositório ou relatórios.
