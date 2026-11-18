# Correcao de reabertura Ocean B2B — teste real em andamento

Versao publicada: `ocean-b2b-reopen-fix-20261117-1745` — `gid://shopify/Version/1233353408513`.

## Causa confirmada no aplicativo

O teste executado com a autenticacao real do cadastro-b2b registrou `Cannot read properties of undefined (reading randomUUID)`. `globalThis.crypto` nao existe no runtime desta extensao. A falha acontecia ao gerar o identificador da operacao, antes de `metafieldsSet`.

A decisao privada real era `reprovado`, alterada em `2026-11-17T14:35:42.845Z`, metaobjeto `gid://shopify/Metaobject/695338172516`. O espelho ainda era `pendente`, ciclo `108ddf6e-bc65-430f-839a-27fd8674766b`, entrada `2026-11-17T14:02:37Z`, sem decisionVersion. Evidencia: [reopen-owner-crypto-failure.json](reopen-owner-crypto-failure.json).

## Correcao aplicada

- Geracao de UUID compativel com runtime sem Web Crypto, com contador monotono; teste com 20 mil geracoes sem repeticao e com o vetor UUIDv7 do RFC 9562.
- Releitura da decisao proprietaria na reconciliacao de um espelho existente. Nova versao de reabertura cria novo ciclo; mesma versao conserva ciclo e prazo.
- Precisao de milissegundos preservada na identidade da decisao; campo date_time compartilhado continua com a precisao de segundos da Shopify.
- Leitura apos escrita para confirmar o estado antes de publicar o sinal. Nenhuma escrita de ACK altera o digest do review depois que o Flow inicia.
- Teste restrito no painel registra snapshots privados e compartilhados em `ocean_b2b.reopen_test`, usando as mesmas acoes de reprovar/reabrir da interface.

Passaram 90 testes da integracao e 45 existentes. Build e deploy concluiram; GraphQL e adicoes de UI validados pelo Toolkit. Backup: `../backups/reopen-fix-20261117/source-before.tar.gz`.

Os sete workflows mantem as configuracoes e versoes anteriores; nenhuma mutacao de workflow foi executada. Nenhuma permissao B2B foi concedida ou revogada nesta correcao.

O teste real foi interrompido pelo erro do runtime na primeira tentativa. A correcao desse erro esta publicada; foi solicitado atualizar a pagina, confirmar o marcador `ocean-reopen-20261117-1745` e executar novamente o teste restrito. A espera real de dez minutos e as comprovacoes de envio/supressao ainda dependem dessa execucao. Cadastros reais continuam restritos.
