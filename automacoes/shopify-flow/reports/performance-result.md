# Correção de performance Ocean B2B — 18/11/2026

Publicado e ativo: **ocean-b2b-performance-20261118-1150**, ID **1235870842881**.

[Versão publicada](https://dev.shopify.com/dashboard/243206031/apps/447943081985/versions/1235870842881). Loja: mrdvrf-6a.myshopify.com. Aplicativo: cadastro-b2b. Destinatário mantido: cadastros@oceanjoiasbr.com.

A causa era a espera de AppHome por syncLoaded antes de remover o estado de carregamento. A sincronização percorria 55 locais sequencialmente; para cada local consultava novamente o espelho, a ficha e a decisão privada. Em ciclos pendentes já confirmados também consultava o evento e regravava o recibo. A falha 503 entrava no mesmo caminho que bloqueava a listagem.

| Medida | Antes | Depois |
| --- | --- | --- |
| Dados essenciais | 0.98 s, seguidos de espera pela ponte | 0.892–1.011 s; sem esperar a ponte |
| Caminho aguardado | 31.18 s | Somente dados essenciais |
| GraphQL | 175 leituras executadas | 3 essenciais + 3 em segundo plano |
| Escritas em locais estáveis | Recibos eram regravados | Zero |

O tempo de aproximadamente 2 minutos foi relatado pelo usuário. As medições acima executam o código local contra a API real, com a identidade do próprio app; **não incluem transporte do App Bridge nem renderização do navegador**. O ensaio anterior foi somente leitura e bloqueou tentativas de regravar recibos, portanto o tempo antigo é conservador. Não foram enviados e-mails de teste nem alteradas permissões B2B reais.

A listagem publica um snapshot completo somente quando locais e decisões essenciais são confirmados. A sincronização começa em outra tarefa após essa publicação, consulta espelhos em lotes de 50 e compara status e versão da decisão já lidos. Um local pronto, sem operação e sem sinal pendente não faz consultas individuais nem escritas sem mudança de estado. Falhas de sincronização usam um aviso separado e não ocultam a lista.

Leituras com 503/502/504/429 ou throttling têm no máximo três tentativas, com backoff de 500 e 1.000 ms e jitter de até 199 ms. A camada de transporte não repete mutações. Se uma escrita de metafields retorna erro transitório, o código relê os valores: aceita um resultado já concluído; só permite uma nova tentativa se os digests de comparação ainda permitem a mesma operação. Se a leitura de verificação falha ou o digest mudou, interrompe. A criação de sinal com resposta incerta é consultada pelo handle do ciclo, sem recriação cega. A decisão comercial nunca é executada novamente automaticamente.

Há no máximo duas requisições simultâneas, intervalo mínimo de 100 ms entre inícios, prioridade para leituras visuais e respeito ao custo/throttle retornado pela API. A fila de sincronização agrupa atualizações concorrentes, usa dois trabalhadores, limita 20 candidatos por passagem e não mantém temporizador de repetição infinita. Itens restantes são informados para nova passagem. Atualizações estáveis apenas verificam os lotes; os quatro workflows nativos continuam responsáveis pelas notificações com o painel fechado.

**151 testes aprovados**, zero falhas; build, configuração e sete validações do Toolkit aprovados. Inclui regressão de aprovação, reprovação, acesso, reabertura, ciclo, UUID, digest, duplicidade, contador, vencidos e WhatsApp; novos testes de 503, resposta perdida após commit, prioridade e limite da fila, falha essencial e independência da renderização.

Auditoria pós-deploy: os 55 locais mantiveram exatamente permissões, decisões, ciclos, horários, ledgers, sinais e compareDigest. O local 8606646372 permanece ready=true, operationId=null e signalPending=false, e agora é ignorado para reconciliação enquanto não houver mudança real.

| Workflow | ID | Versão ativa | Resultado |
| --- | --- | --- | --- |
| OCEAN — CADASTRO VENCIDO | 01a1e9c5-a198-7078-8e9a-35b205098189 | 01M7ND17GDZT14NQNC7Z8MT5PR | Ativo, sem alterações |
| OCEAN — NOVO CADASTRO B2B | 01a1e9c5-8412-721a-9a5e-2e545f827eee | 01M7ND1053SFM395G569ZCH2MJ | Ativo, sem alterações |

As duas pontes técnicas de novo local/novo contato também permanecem ativas. Todos os sete workflows têm a mesma configuração e versão anterior ao deploy; o erro CONNECTOR_ERROR preexistente em Recover abandoned checkout permanece fora do escopo. Aprovação/reprovação, as duas abas de aprovados, liberação/travamento manual, contador, aviso vermelho, filtro de vencidos, WhatsApp e notificações imediata/vencida foram preservados.

Evidências: [resultado estruturado](performance-final.json), [antes](performance-before.json), [depois](performance-after.json), [regressão](performance-regression.json), [auditoria](performance-store-after.json), [workflows](performance-workflows-after.json), [validação oficial](performance-toolkit-validation.json), [versão ativa](performance-app-versions.json), [manifesto de fontes](performance-source-manifest.json). O código canônico é extensions/app-home/src; as cópias antigas em integration não devem ser reaplicadas sobre esta correção.

Referência técnica: [limites por custo da API GraphQL](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits).
