# Correção urgente da interface Ocean B2B — 18/11/2026

Publicado e ativo: **ocean-b2b-ui-20261118-urgent**, ID **1235951386625**. [Versão Shopify](https://dev.shopify.com/dashboard/243206031/apps/447943081985/versions/1235951386625).

O usuário informou que a primeira correção não resolveu a experiência no navegador. A medição anterior de 0,89–1,01 s era apenas da API e não comprova o tempo visual. Nesta etapa o usuário orientou: “faça as alterações necessárias na loja em produção, que eu testo aqui te trago os resultados”. **O tempo antes/depois dentro do Admin autenticado permanece pendente da validação do usuário.** Nenhum tempo de API ou de fixture foi apresentado como tempo real da loja.

No código anterior, os totais eram exibidos independentemente de loading; a lista inteira exigia !loading && !error. Toda atualização manual chamava setLoading(true), removendo as linhas existentes até a conclusão das empresas e decisões. As consultas do SDK e a espera por slots não tinham cancelamento nem deadline. A primeira correção já não aguardava notificações em loadLocations; não foi atribuída a elas uma espera direta que o código atual não possuía. A causa específica da demora do SDK no navegador autenticado não foi medida.

A correção publica snapshot e encerramento do carregamento atomicamente. Separa initialLoading, refreshing, syncStatus e busy. Atualizar dados mantém as mesmas linhas com key por local; erro e timeout mantêm a última leitura com aviso explícito de dados antigos e impedem ações comerciais até nova confirmação. Abertura sem dados confirmados nunca presume aprovação/reprovação. Um controller agrupa cliques repetidos, cancela consultas ao desmontar e ignora respostas tardias.

Empresas e decisões agora compartilham uma consulta GraphQL, com paginação independente. O caminho essencial usa fetch oficial shopify:admin/api/2026-10/graphql.json com AbortSignal. Há limite de 8 s por leitura e 12 s para a leitura essencial completa; não foi aumentado nenhum timeout anterior. Leituras 503 continuam limitadas a três tentativas com backoff. O transporte não repete mutações cegamente. A capacidade de consultas visuais é reservada quando há requisição de background marcada como tal; promessas SDK sem cancelamento conservam seu slot até realmente terminarem.

| Arquivo | Funções/alteração |
| --- | --- |
| AppHome.jsx | App, loadLocations, review e cinco ações: estados separados, dados atômicos, lista preservada, guardas de reentrada, indicador de notificações e marca da versão |
| panel-controller.mjs | createPanelController: snapshot, refresh, deadline, recuperação, single-flight e descarte de resposta tardia |
| panel-data.mjs | fetchPanelSnapshot e loadPanelData: consulta combinada e paginação |
| request-control.mjs | createRequestControl: transporte fetch, cancelamento de fila, deadline e reserva de capacidade |
| read-deadline.mjs | withReadDeadline: timeout e abort de leitura |
| panel-timing.mjs | APP_HOME_STARTED e recordPanelTiming: montagem/commit inicial e refresh no runtime |
| notification-sync.mjs | createSyncScheduler: status de execução independente |
| api.mjs | Exportação de LOCATION_FIELDS para reutilizar exatamente os campos já existentes |
| reprovados-api.mjs | reviewSnapshotFromNodes: reutiliza validação de decisões e recibos existentes na consulta combinada |

**164 testes aprovados**, oito validações oficiais do Toolkit, configuração válida e build concluído. No Chrome real com fixture local foram verificados: lista enquanto notificações executam, preservação da mesma linha DOM durante refresh, abas Pendentes/Vencidos/Aprovados/Reprovados, abertura e retorno dos detalhes, recuperação após um 503, erro após três 503 e timeout com lista antiga identificada. Esses testes usam dados sintéticos, não substituem a conferência no Admin. [Evidência visual local](browser-ui/list-after.png), [erro 503 com lista preservada](browser-ui/503-retained-list.png), [resultado do Chrome](browser-ui/result.json).

Auditoria de produção antes/depois: 55 locais, zero mutações de teste; permissões, decisões, ciclos, horários, notificações, sinais e compareDigest idênticos. Regras B2B, contador, WhatsApp, estado/ciclo da ponte e controle de duplicidade não foram modificados. Todos os sete workflows mantiveram a mesma configuração/versão; os dois avisos e as duas pontes técnicas continuam ativos. Destinatário: cadastros@oceanjoiasbr.com.

| Workflow | Versão ativa |
| --- | --- |
| OCEAN — CADASTRO VENCIDO | 01M7ND17GDZT14NQNC7Z8MT5PR |
| OCEAN — NOVO CADASTRO B2B | 01M7ND1053SFM395G569ZCH2MJ |

Para conferir, recarregar o Admin inteiro e abrir o aplicativo. No resumo deve aparecer Versao: ocean-b2b-ui-20261118-urgent. A lista deve continuar presente durante Atualizando..., e a mensagem de sincronização não deve impedir abas/detalhes após a confirmação essencial. Logs [ocean-b2b-panel] registram montagem e commit no runtime, mas não são rotulados como pintura física do host Shopify.

Referência: [acesso direto e fetch em extensões Admin](https://shopify.dev/docs/api/admin-extensions/2026-10). [Resultado estruturado](browser-performance-final.json), [testes](browser-performance-regression.json), [validação oficial](browser-performance-toolkit-validation.json), [auditoria pós-deploy](browser-performance-store-after.json), [workflows](browser-performance-workflows-after.json), [versão ativa](browser-performance-app-versions.json).
