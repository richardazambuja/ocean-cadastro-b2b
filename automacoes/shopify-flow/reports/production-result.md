# Resultado da implantação Ocean B2B — 17/11/2026

Aplicativo publicado. Workflows ativos com restrição de teste. Liberação geral bloqueada pela ausência de sincronização observada após reprovação/reabertura no app.

Versão: `ocean-b2b-notifications-20261117-1427` — `gid://shopify/Version/1232262725633`.

[Versão no painel de desenvolvimento](https://dev.shopify.com/dashboard/243206031/apps/447943081985/versions/1232262725633)

| Workflow | ID | Versão ativa | Estado |
| --- | --- | --- | --- |
| OCEAN — PONTE TÉCNICA B2B (novo contato) | `gid://shopify/AutomationWorkflow/01a1e9e3-4bea-70f3-8e80-b18d8c984f89` | `01M7MZ5EDWCX5PJCY044BDK2Z3` | Ativo, restrito a teste |
| OCEAN — PONTE TÉCNICA B2B (novo local) | `gid://shopify/AutomationWorkflow/01a1e9e0-fb18-7796-96df-1f4d86f80bac` | `01M7MZ58C596TBKN4M2FTJS639` | Ativo, restrito a teste |
| OCEAN — CADASTRO VENCIDO | `gid://shopify/AutomationWorkflow/01a1e9c5-a198-7078-8e9a-35b205098189` | `01M7MYKSWJBGDBKJ3B01JWZEYS` | Ativo, restrito a teste |
| OCEAN — NOVO CADASTRO B2B | `gid://shopify/AutomationWorkflow/01a1e9c5-8412-721a-9a5e-2e545f827eee` | `01M7MYJX5HKQBPV8G41RQSVZR0` | Ativo, restrito a teste |

- 124 testes aprovados e `shopify app build` concluído.
- Backup anterior preservado em `../backups/20261117T133747Z/cadastro-b2b-before.tar.gz`.
- Leitura/escrita real dos metafields, sinais nativos, captura por criação de local e criação de contato comprovadas.
- Aviso imediato e aviso após espera real de 10 minutos executados; usuário confirmou recebimento dos dois.
- Repetições do mesmo ciclo não duplicaram os avisos.
- Acesso B2B concedido ao comprador sintético antes do prazo: nova consulta às 14:33:49 UTC bloqueou o vencimento.
- Três workflows anteriores preservados, com as mesmas configurações e versões ativas.

## Evidências Shopify

- [Aviso imediato](https://admin.shopify.com/store/mrdvrf-6a/apps/flow/activity/01a1e9c5-8412-721a-9a5e-2e545f827eee:01M7MXHDMER7DWWW4QVKRNJNSA:63c4a583f0e8cc65:v2)
- [Aviso após 10 minutos](https://admin.shopify.com/store/mrdvrf-6a/apps/flow/activity/01a1e9c5-a198-7078-8e9a-35b205098189:01M7MX2TH0FKTZB066974GH5JZ:97f57220d5314e9e:v2)

## Bloqueio restante

O usuário informou reprovação e reabertura de OCEAN B2B TESTE FLOW 20261117, mas a leitura posterior continuou com ciclo `108ddf6e-bc65-430f-839a-27fd8674766b`, decisionVersion nulo e review atualizado às 14:02:44 UTC. A instalação e a publicação pertencem ao mesmo API key. Foi solicitada atualização completa da página e repetição para descartar uma aba com versão anterior; ainda não houve retorno desse teste. A causa não está confirmada. Não foi alterado o metaobjeto privado por outro aplicativo para simular sucesso.

`rollout.mode=test`, `productionApproved=false`, `cutover=null`. Os novos e-mails permanecem limitados aos locais sintéticos `8622571620` e `8622604388`.

O workflow antigo Recover abandoned checkout já apresentava CONNECTOR_ERROR antes da implantação; foi preservado.

Detalhes completos e arquivos de evidência: [production-result.json](production-result.json).
