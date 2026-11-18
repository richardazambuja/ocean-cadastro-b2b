# Ponte local cadastro-b2b → Shopify Flow

Loja: `mrdvrf-6a.myshopify.com`. Plano confirmado: **Advanced**. Destinatário planejado: `cadastros@oceanjoiasbr.com`.

Implementação local preparada e testada. Nenhuma mutação foi enviada à loja; nenhum workflow foi criado, editado ou ativado; nenhum e-mail foi enviado. Não há servidor externo, webhook receptor nem extensão Flow de aplicativo customizado neste pacote.

## Resultado da investigação

**Compartilhar o status por metafields de CompanyLocation é viável.** O tipo tem suporte a `metafield`/`metafields`, e uma consulta somente de leitura ao metafield `ocean_b2b.review` funcionou na loja Advanced, retornando `null` porque não está preenchido no local consultado.

O aplicativo **cadastro-b2b instalado** possui `read_companies`, `write_companies` e `read_customers`. A permissão de escrita sobre o recurso cobre seus metafields; não existe necessidade de um suposto escopo genérico `write_metafields`. `metafieldsSet` foi validado contra o schema Admin `2026-10`, a versão que o painel atual utiliza. Uma gravação real **não foi testada**, por determinação do usuário; escopo suficiente não substitui um teste autorizado com a sessão online e as permissões do usuário que opera o painel.

O token do Shopify CLI Connector App é diferente da autenticação do cadastro-b2b. Esta investigação não usa o token do CLI como prova de permissão do aplicativo.

**Metafields, isoladamente, não disparam um workflow de reabertura.** O catálogo nativo consultado expõe Company location created e Metaobject entry created, mas não expõe um acionador nativo de atualização dos metafields de CompanyLocation. Por isso, a arquitetura proposta usa um registro nativo por ciclo como sinal, mantendo os metafields como estado atual.

Extensões `flow_trigger` e `flow_action` de aplicativos customizados são limitadas ao Plus. Foram excluídas da solução Advanced. A criação de um metaobjeto e o gatilho **nativo** Metaobject entry created são mecanismos diferentes de uma extensão Flow customizada.

## Dados compartilhados

As definições propostas são **da loja**, no namespace não reservado `ocean_b2b`, para permitir o acesso tanto do cadastro-b2b quanto das ações nativas do Flow. Essa necessidade entre aplicativos é o motivo para preparar definições GraphQL em vez de definições `$app` em TOML. Elas ainda não foram criadas.

| Metafield em CompanyLocation | Tipo | Uso |
| --- | --- | --- |
| `ocean_b2b.review` | json | Snapshot completo, versão, sincronização e metadados de ciclo |
| `ocean_b2b.ready` | boolean | Somente `true` permite avaliar alertas |
| `ocean_b2b.status` | single_line_text_field | Um dos cinco estados comerciais |
| `ocean_b2b.cycle_id` | single_line_text_field | UUID do ciclo; `none` quando nunca houve um ciclo |
| `ocean_b2b.pending_since` | date_time | Horário da entrada efetiva em Pendentes |
| `ocean_b2b.notifications` | json | Reservas e confirmações de aviso, por ciclo e tipo |

Estados: `pendente`, `aprovado_pendente`, `aprovado_liberado`, `reprovado` e `incompleto`. O estado `erro` do painel não é convertido em pendência: a publicação falha e os alertas permanecem bloqueados.

`review` e os campos escalares são gravados em **uma única chamada atômica** `metafieldsSet`. O `compareDigest` do JSON protege o conjunto contra sobrescrita concorrente. O Flow deve usar o mesmo protocolo, e não atualizar os escalares individualmente com ações independentes. Leituras que encontrem JSON/escalares divergentes são recusadas.

O valor de `pending_since` pode permanecer como histórico ao sair de Pendentes. Isso nunca autoriza envio: `ready`, status, ciclo e elegibilidade são obrigatórios em conjunto.

## Fonte de verdade preservada

O metaobjeto **`$app:cadastro_decisao` continua sendo a fonte da decisão comercial**. Não houve mudança em sua definição, nos valores existentes, nas regras `statusDoPainel`/`classifyLocation` nem nas permissões B2B.

A ponte recebe a função `statusDoPainel` do aplicativo local por injeção; não implementa outra classificação. O adapter lê a decisão no contexto do aplicativo proprietário, verifica o local e só então calcula a projeção. Uma decisão desconhecida, falha de leitura ou cadastro ambíguo bloqueia a publicação.

O script `scripts/prepare-panel.mjs` parte dos arquivos atuais em `../../extensions/app-home/src`. Ele cria uma cópia de validação, registra os SHA-256 e prepara o patch mínimo de cinco comandos: aprovar, liberar, travar, reprovar e reabrir. Não consulta o GitHub e não restaura versões do Git.

Os arquivos originais do painel **não foram alterados**. A cópia integrada está em `validation/app-home/src` e o patch revisável em `integration/panel.patch`. Os novos módulos estão em `src/` e o adapter em `integration/flow-bridge-app.mjs`. O patch exige copiar o adapter e `src/{state,operations,bridge}.mjs` para os destinos mostrados na cópia de validação. Não é um patch autossuficiente para publicação.

`FLOW_BRIDGE_ENABLED` e `FLOW_SIGNALS_ENABLED` começam em `false`. A cópia preparada preserva o comportamento atual e não grava os novos dados enquanto esses flags permanecerem desligados.

## Ordem segura das mudanças comerciais

1. Ler o snapshot atual e adquirir uma operação com CAS, publicando `ready=false` **antes** da ação comercial.
2. Executar o comando original do painel, que mantém sua decisão e suas verificações atuais.
3. Consultar novamente o local e a decisão privada pelo aplicativo proprietário.
4. Publicar o estado e o ciclo atuais atomicamente, com `ready=true`.
5. Se houver um novo ciclo pendente, emitir o sinal nativo e confirmar sua publicação no snapshot.

Um conflito CAS impede iniciar a ação. Falha ou fechamento do navegador depois da invalidação deixa `ready=false`. Se a ação comercial já terminou e a projeção falhar, a mensagem orienta sincronizar o espelho, **sem repetir a aprovação, reprovação ou reabertura**. A recuperação exige o identificador da operação interrompida e nova leitura autorizada; não há desbloqueio automático por tempo.

Como a decisão privada e os metafields são recursos diferentes, não há transação única entre ambos. O protocolo favorece bloquear alertas diante de falha. Sem serviço externo, uma operação abandonada pode exigir recuperação pelo painel; não foi prometida recuperação automática irrestrita com ele fechado.

## Ciclos e entrada na fila

Uma transição efetiva para `pendente` recebe um novo UUID e `pending_since`. Releituras do mesmo estado ou do mesmo registro `reaberto` não reiniciam o prazo.

Uma reabertura usa `alterado_em` confirmado. Se o cadastro reaberto ainda estiver incompleto, não há ciclo notificável. Quando ele ficar completo, o início será o horário em que a entrada efetiva foi observada, sem reutilizar a criação antiga do local.

Sincronização inicial de cadastros históricos (`backfill`) cria espelhos **sem inscrever os ciclos antigos em notificações**. Isso evita disparar uma fila de avisos antigos ao instalar a integração.

O relógio visual atual do painel utiliza `createdAt` inicialmente e `alterado_em` nas reaberturas. Ele foi preservado. Para fazer o relógio visual coincidir com a entrada efetiva de um cadastro inicialmente incompleto, será necessária uma alteração posterior explícita no cálculo visual; ela não foi aplicada neste pacote.

## Sinal nativo sem servidor

O registro proposto tem tipo **da loja** `ocean_b2b_pending_cycle`, com `local_id`, `cycle_id` e `entered_at`. Não substitui nem altera `$app:cadastro_decisao`. Seu handle é determinístico: `local-<id>-<uuid-do-ciclo>`.

O aplicativo ou um workflow técnico usa `metaobjectUpsert` para criar esse registro uma vez. Repetir a emissão atualiza o mesmo handle, em vez de criar outro evento. O gatilho **Metaobject entry created** inicia os dois workflows de notificação; reabrir a análise produz outro ciclo e, portanto, outro registro.

As permissões atuais bastam para a ponte de **metafields**, mas a emissão desse sinal compartilhado exige consentimento para `write_metaobjects` e sua leitura correspondente (`read_metaobjects`, apontada pelo validador). A criação inicial da definição exige `write_metaobject_definitions`/`read_metaobject_definitions` do operador de configuração. Esses escopos não foram solicitados nem adicionados. Os arquivos `config/` e `graphql/create-*.graphql` apenas preparam as definições.

## Entrada inicial com o painel fechado

O gatilho nativo **Company location created** independe de o painel estar aberto. Um workflow técnico futuro deve:

1. Consultar novamente o local por ID com **Get company location data**, para obter contatos, permissões e metafields atuais. O retorno é uma lista: conferir ID e cardinalidade; não usar automaticamente o primeiro item.
2. Se os contatos ainda estiverem sendo vinculados, aguardar a consolidação dos dados e consultar novamente. Não classificar um cadastro incompleto como pendente.
3. Inicializar o snapshot com CAS `compareDigest: null` somente para locais realmente novos, posteriores ao corte de migração aprovado, e sem espelho já criado pelo aplicativo.
4. Criar o sinal do ciclo somente se o cadastro completo estiver pendente. Um comando do app que ganhe a corrida publica/invalida o mesmo JSON e faz a inicialização concorrente falhar por CAS.

`src/bootstrap.mjs` implementa e testa essa política como função pura. O corte de migração e `rolloutVerified` são pré-condições obrigatórias; não se deduz ausência de decisão comercial a partir de um metafield ausente em cadastros históricos.

Antes de confirmar o corte, é necessário sincronizar os históricos pelo aplicativo proprietário e garantir que os vendedores não estejam usando versões antigas do painel que escrevam decisões sem a ponte. Sem essa garantia, a inicialização é recusada.

O evento de criação de local **não cobre todas as futuras entradas na fila**. Um segundo workflow técnico com **Company contact created** pode reavaliar locais da empresa quando o contato chega depois. Alterações externas posteriores, sem um gatilho correspondente, precisam de reconciliação agendada dos locais conhecidos. O agendamento nativo tem intervalo mínimo de 10 minutos; esses casos não podem ser anunciados como detecção instantânea.

A versão executável dessas topologias ainda precisa ser montada e validada no Flow, com os campos de entrada e caminhos reais. As funções JavaScript do pacote são bibliotecas e referências de comportamento; o Flow não importa módulos do projeto ou chama o adapter do navegador. A lógica pura deverá ser incorporada a Run code e as escritas feitas por ações nativas, com os contratos de entrada/saída verificados. Nenhuma configuração `.flow` incompleta foi produzida ou criada.

## Dois workflows de notificação planejados

**Novo cadastro pendente:** Metaobject entry created → Get company location data por ID → conferir `ready=true`, status exatamente `pendente`, ID/ciclo/horário coincidentes e dados B2B atuais → reservar aviso `novo` com CAS → revalidar → Send internal email para `cadastros@oceanjoiasbr.com` → confirmar o aviso do ciclo.

**Cadastro vencido:** mesmo sinal → **Wait 10 minutos** → **nova** chamada Get company location data → conferir que ainda é `pendente` e é o mesmo ciclo → exigir primeiro aviso confirmado → reservar aviso `vencido` com CAS → revalidar → enviar segundo e-mail ao mesmo destinatário → confirmar.

O prazo decorre da entrada do ciclo. Uma execução antiga não pode enviar depois de outra reabertura. O Wait começa quando a execução alcança a etapa; filas e retries podem atrasar a entrega. Não se usa `Date.now()` de Run code como relógio atual, pois o ambiente do Flow tem relógio fixo.

São duas notificações, mas a solução completa exige workflows técnicos adicionais de entrada/reconciliação. Apenas dois workflows com gatilhos de criação de local não cobririam corretamente reaberturas e complementações tardias.

## Duplicatas, falhas e revalidação

O ledger usa a chave lógica `(local, ciclo, tipo-do-aviso)` e CAS. Duas execuções concorrentes não podem reservar o mesmo aviso. A reserva guarda o identificador da execução; confirmação por outra execução ou outro ciclo é recusada.

Um ciclo novo não herda o cronômetro nem a reserva do anterior. Depois da espera, dados anteriores de Get data não são reutilizados: o local e o espelho precisam ser consultados outra vez. Qualquer estado aprovado, reprovado, incompleto, desconhecido, parcialmente sincronizado ou com ciclo divergente encerra o ramo de e-mail.

E-mail e atualização do ledger não são uma transação. Para priorizar a prevenção de duplicatas, uma reserva não expira automaticamente. Uma falha entre reserva e confirmação precisa de investigação; não se promete entrega exatamente uma vez. Também existe uma janela entre a última revalidação e a ação de e-mail, que a Shopify não torna atômica com uma aprovação concorrente.

Se o primeiro envio estiver atrasado quando a espera de 10 minutos terminar, o segundo não deve ser enviado. A topologia final precisará de espera/reconciliação explícita para esse caso, em vez de descartar o lembrete ou enviá-lo antes do primeiro. Esse comportamento de entrega ainda depende de validação no Flow.

## Testes e limites da validação

- **54 testes novos passaram:** cinco estados, preservação das regras reais, leituras inválidas, reaberturas, complementação tardia, ausência de novos avisos no backfill, cronômetro de 10 minutos, idempotência, conflitos CAS, falhas parciais, recuperação explícita, JSX e flags desabilitados.
- **45 testes existentes passaram:** 21 de aprovação/liberação/travamento e 24 de persistência/reprovação/ordenação.
- **6 operações GraphQL válidas** no schema Admin `2026-10`, incluindo as mutações preparadas. Nenhuma dessas mutações foi executada.
- O JSX da cópia integrada foi transpilado para verificar sintaxe. Não foi feita uma sessão `shopify app dev`, que publicaria uma versão de desenvolvimento e ultrapassaria a autorização atual de validação local.
- Os arquivos atuais do painel foram registrados por SHA-256 e verificados como preservados. As alterações preexistentes em `shopify.d.ts` e os arquivos não rastreados do usuário não foram sobrescritos.
- As três configurações e versões ativas de workflows retornadas pela leitura são iguais às do diagnóstico anterior. Todos os três estavam ativos na consulta; nenhum foi alterado.
- Não houve prova de gravação com o token real do cadastro-b2b nem execução dos novos fluxos no Flow. A criação de definições e o acesso do Flow aos novos campos só poderão ser comprovados após autorização para a etapa controlada na loja.

Para reproduzir localmente:

```bash
npm run prepare:panel
npm run prepare:definitions
npm run validate:graphql
npm test
```

Os subprocessos de validação/teste exigiram execução fora do sandbox deste ambiente (`EPERM` dentro dele), mas continuaram sendo locais e simulados. Nenhuma aprovação de teste equivale a autorização de gravação na loja.

## Antes de qualquer publicação

1. Revisar a ponte, os casos de falha e o patch sobre os arquivos locais atuais.
2. Autorizar separadamente a configuração controlada das definições/escopos e um teste real de escrita/leitura sem enviar e-mail.
3. Validar o acesso nativo aos novos campos, a entrada por criação de local/contato e a criação do sinal, inclusive em corridas com aprovação.
4. Incorporar o patch e publicar a versão com todos os caminhos de escrita comercial cobertos; sincronizar históricos sem avisar e confirmar o corte de migração.
5. Preparar e validar as topologias nativas e seus caminhos de dados. Preservar integralmente os três workflows existentes.
6. Só criar/ativar workflows ou habilitar envios após autorização específica.

## Fontes oficiais

- [metafieldsSet e compareDigest](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/metafieldsSet)
- [Company location created](https://help.shopify.com/en/manual/shopify-flow/reference/triggers/company-location-created)
- [Get company location data](https://help.shopify.com/en/manual/shopify-flow/reference/actions/get-company-location-data)
- [Update company location metafield](https://help.shopify.com/en/manual/shopify-flow/reference/actions/update-company-location-metafield)
- [Metaobject entry created](https://help.shopify.com/en/manual/shopify-flow/reference/triggers/metaobject-entry-created)
- [Custom Flow triggers: restrição ao Plus](https://shopify.dev/docs/apps/build/flow/triggers/create)
- [Custom Flow actions: restrição ao Plus](https://shopify.dev/docs/apps/build/flow/actions/create)
- [Agendamento, consultas e loops](https://help.shopify.com/en/manual/shopify-flow/getting-started/concepts/advanced-workflows)
- [Send Admin API request](https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-admin-api-request)
