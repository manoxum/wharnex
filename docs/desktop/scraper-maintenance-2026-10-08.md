# Manutenção do transporte ChatGPT — 2026-10-08

## Problema e correções

O scheduler repetia toda a seleção do ZIP depois de falhas estruturais do
compositor/esforço. A atenção de transporte também bloqueava a captura de um
ficheiro que aparecesse depois da falha. A página atual já não expõe sempre os
marcadores antigos de autor/turno.

- Verificar esforço antes de preencher o compositor ou selecionar ficheiros,
  mantendo a verificação imediatamente anterior ao submit.
- Manter viewport 1280 × 900 durante a preparação, inclusive no monitor, com
  restauração da geometria humana e libertação em erro/cancelamento.
- Ler folhas e texto direto de wrappers visíveis do único controle de esforço:
  `Elevada` acompanhado de ícone era excluído pelo filtro de folhas. Modelo
  `5.6` e título genérico continuam a ser evidência insuficiente.
- Respeitar `retryTransport=false` e `retryFileSelection=false` no scheduler:
  falhas estruturais/ambíguas entram em atenção, sem repetir o upload inteiro.
  O wrapper de upload preserva estes atributos ao acrescentar contexto ao erro;
  regressão integrada upload → scheduler falhou antes da correção e passou depois.
- Antes de um retry normal ou de entrada persistida, procurar o nome exato do
  ZIP no turno do utilizador da conversa vinculada. Prova positiva adota
  supervisão durável, sem upload/submit; falha da fila desarma a expectativa.
- Capturar o ficheiro exato em atenção de transporte/paragem, sem recovery,
  reload ou continuação. Autenticação, verificação, acesso e Manual ficam fechados.
- Usar `data-chatgpt-agent-turn-start` e ordem estrutural dos turnos quando os
  wrappers de autor estão ausentes. Stop/streaming impede conclusão.
- Excluir compositor e turno do utilizador da procura de downloads: o nome do
  resultado no bootstrap não é um ficheiro de resposta.

Nenhuma destas operações lê resposta gerada, cookies, storage ou corpos de rede.
O diagnóstico opcional usa scripts constantes, controles nomeados e resultados
limitados; a falha do diagnóstico não altera a classificação de liveness.

## Pedido real e coordenação

Chat: `5cf6288b-b066-4344-939e-891f8e15015f`.
Sessão: `ses_20261008T114918_2d2921bfec9bec90`.
Conversa: `6ac78349-37fc-83ea-a7ce-bae4519c9b94`.

O ZIP anterior foi recuperado às 15:40:58 UTC. O `host.applied` das 15:46:40
foi um falso sucesso: o backend antigo não confirmou o HEAD do submódulo após
`index.lock`. Esse incidente pertence à correção do engine/ADR-0096 da sessão
paralela; transporte entregue não comprova integração ou comportamento DRCAE.

O pedido real atual foi retomado sem chamar `messages` ou criar outro request:
`req_20261008T155922_b5b7c0c48f5e145c`, retry
`cat_2f810a99713f9913da25` do payload de
`cat_9c05173e5080ad1614e4`, que estava em atenção.

| Evidência UTC | Resultado |
|---|---|
| 16:12:46.120 | esforço `high` provado antes da seleção |
| 16:12:51.485 | único ZIP de entrada confirmado |
| 16:12:54.143 | esforço `high` novamente provado |
| 16:12:54.615 | POST de conversa aceito |
| 16:12:55.225 | submit confirmado na conversa original |
| 16:13:55 | `AWAIT_RESPONSE cat_c338e2f5d92d6587bb53` elegível |
| 16:20:33.150 | ZIP exato capturado, 17.077 bytes |
| 16:20:33.422 | artefacto persistido pelo backend |
| 16:20:34.822 | plano importado no mesmo pedido |
| 16:27:39 | sessão `verified/manual`, sem execução em curso |
| 16:34:02 | integração recuperada pela sessão backend, `host.applied` |

A sessão foi temporariamente colocada em `automation_mode=manual` antes do
submit para bloquear execução/apply no engine antigo. A resposta foi
capturada e importada; o sandbox chegou a `verified`. A sessão do backend controla a ativação
do engine corrigido e a validação real de Realtime, URL eliminada e visita ativa.
Leitura local posterior confirma HEAD backend
`4c8302127a4782949285d7de74695cbf11fe9bd7`; isto ainda não comprova runtime.
Estado atual e avisos de reinício ficam em
`.harness/logs/coordination-soft-delete.md`.

A sessão backend enviou um turno distinto de aceitação runtime,
`req_20261008T163510_9b3f855eacb164a4`, na mesma conversa às 16:35:40 UTC.
O transporte confirmou um upload, esforço high antes/depois e submit aceito;
`AWAIT_RESPONSE cat_14d5aa83f28d0c5b7621` observa sem gastar tentativas.
Este turno não é reenvio do pedido anterior. O ZIP exato chegou às 16:44:54 UTC,
com 14.395 bytes, foi importado e produziu o plano
`plan_20261008T163510_soft_delete_runtime_api_probe`. A etapa seguinte exige
aprovação de diagnóstico pelo engine (`debug_approval_required`); captura
concluída não equivale a teste runtime executado.

## Verificação e refactoring

`npm run build` do Desktop passou com **1.053 testes**, incluindo regressões
que falharam antes das correções de esforço com ícone, seleção em user-turn,
turno atual, rollback da adoção, progresso passivo da adoção e viewport no monitor. Assertions anteriores
foram mantidas; a expectativa exata de revisão passou para `2026-10-08.1`.

O passe de refactoring ficou restrito ao transporte: observador de esforço,
observador de resposta e normalização do probe foram separados em módulos de
domínio; preflight e submit reutilizam a mesma validação de esforço. Todos os
ficheiros Desktop tocados e novos têm no máximo 200 linhas. `git diff --check`
e o gate de domínio com base HEAD passaram. O gate global de layout já acusa
diretórios backend antigos acima de 20 ficheiros; este trabalho não os amplia.

Foram criados chats temporários para observar upload/submit/conclusão. O chat
`7dc7fc86-36f0-47cd-bab1-844e7aba4be7` teve um upload e um submit confirmados
em cada pedido distinto. Esse teste não entregou ZIP
válido e foi cancelado/arquivado após observação, sem o descrever como sucesso.
A captura positiva e ingestão foram confirmadas no pedido real acima.

Compatibilidade: namespaces de protocolos/IPC e nomes persistidos são mantidos;
não há alteração de execução, Policy ou autoridade de host no Desktop. O novo
probe `composer-transport` continua fechado e desativado por defeito.
O Desktop foi relançado diretamente às 16:30 UTC para carregar a versão final,
com o probe desligado e sem ativar/reiniciar serviços Compose.

## Retoma em 2026-10-09

A interrupção deixou Desktop e stack indisponíveis. O último bundle do turno
`req_20261008T165529_67647b0aab3c3fdb` foi capturado às 17:00:31 UTC
(16.876 bytes), mas o ACK/backend falhou antes de o Desktop terminar.
O frontend antigo confirmou ACK sem importação quando uma janela não possuía o
pedido, eliminando o inbox. A sessão frontend reproduziu e corrigiu essa
fronteira com regressão async, ativou a imagem `c438c7` e reiniciou somente o
Desktop às 08:37 UTC. A observação retomou o mesmo pedido: ZIP exato capturado
às **08:37:55.654**, com os mesmos 16.876 bytes, sem upload ou submit.
O backend confirmou importação às 08:37:56 e passou para
`debug_approval_required`; a reconciliação de transporte está concluída.
Execução do novo diagnóstico e aceitação runtime permanecem com a sessão
backend. Não reenviar o pedido.
O fixture criar/eliminar continua sem prova de criação e com atenção; o turno
eliminar ainda não foi enviado. Build local repetido: 1.053/1.053 testes passaram.

A retoma passiva agora persiste `observation_only=true` no `AWAIT_RESPONSE`
adotado. A regressão percorre adoção, serialização da fila e um mapa novo que
representa o Desktop reiniciado; falhou antes da correção. O Worker também
respeita captura exata, sem recovery, e distingue completion histórica de
progresso de download. Regressões incluem expiração passiva, captura positiva
e compatibilidade com tarefas antigas sem flag. Build final: **1.055/1.055**.
Módulos tocados continuam abaixo de 200 linhas e o gate de domínio passou.
Esta evolução aguarda ativação coordenada após os pedidos atuais assentarem.

O turno seguinte do chat original, preparado pela sessão backend,
`req_20261009T083938_dc922438db26c173`, foi enviado uma vez às 08:40:14.
O ZIP exato foi capturado às 08:46:08, com 19.562 bytes, e importado no backend
(`debug_approval_required`). O erro de rede do streaming ao terminar não
impediu a captura. O fixture de 8Out foi cancelado/arquivado após falha;
o [novo teste de 9Out](new-chat-file-test-2026-10-09.md) continua sem ZIP e sem
prova de criação. Não foi enviado pedido de eliminação nem feita escrita manual.

### Seguimento de 9Out, 09:26 UTC

As continuações do chat original entregaram ZIPs canónicos às 09:03:24
(22.621 bytes) e 09:13:28 (25.682 bytes), ambos importados. O turno
`req_20261009T091713_38a6f4aceeb10275` foi enviado uma vez às 09:18:29 e
continua sob observação. A validação real de DRCAE permanece com a sessão
backend; a captura não constitui prova de correção de RLS.

O novo fixture recebeu um ZIP válido de 15.016 bytes às 09:22:20, depois
da correção intencional da saída no mesmo pedido. O backend aceitou
`plan_20261009T084320_smoke_fixture_create` e iniciou execução Protected.
Ainda falta comprovar a integração do ficheiro no host e só depois pedir
a eliminação. Nenhum ficheiro de teste foi criado manualmente.

A correção enviada revelou uma janela de progresso herdada da atenção
anterior e metadata ausente no AWAIT sucessor. Regressões reproduziram ambas
as falhas. Depois de um novo envio confirmado, a janela é renovada sem
repor TTL, tentativas ou continuação automática; bloqueios de verificação
não são removidos. O AWAIT preserva metadata e o seu ID é vinculado à
expectativa. A preflight do repair confirma também modelo e esforço antes
do upload. Build integrado final: **1.077/1.077 testes**, incluindo catálogo
dinâmico de modelos. Fonte pronta, ainda sem ativação runtime.

Relato humano posterior corrigiu a atribuição do fixture: o ZIP estava pronto
antes da importação e só começou a descarregar quando o utilizador clicou
nele. As provas de importação e execução são válidas; **o download automático
do fixture não passou**. O instante exato de disponibilidade remota é
desconhecido. Investigação separada segue os controlos estruturais permitidos,
sem reenviar o pedido original. A criação no host foi confirmada às 09:26:02
(66 bytes exatos); a fase de eliminação foi enviada uma vez às 09:27:00 no
mesmo chat, `req_20261009T092629_a19fba3bbfc8484b`.
