# Arquitetura do scraper ChatGPT: Supervisor + workers

- O runtime alvo usa **1 Supervisor Browser exclusivo e 3 Worker Browsers autónomos**, globais por perfil autenticado/processo Desktop. O Supervisor é a única superfície visível e nunca é escolhido para jobs de background.
- A afinidade durável é `chat_id -> conversation_id`; URLs `/c/<id>` e `/g/.../c/<id>` representam a mesma conversa. `chatgptViews` passa a representar apenas a superfície Supervisor; os três workers vivem num pool próprio e persistente.
- O backend persiste tarefas tipadas de chat-agent com prioridade, `not_before`, retries, dedupe, leases, parent/lineage, estado e payload. Claim/heartbeat/transição/cancelamento funcionam em memória e PostgreSQL, e um estado global do provider pausa workers perante CAPTCHA, login ou rate-limit.
- A fila cobre `BOT_WRITE`, `RECOVERY_WRITE`, `AWAIT_RESPONSE`, `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP`, `TITLE_AWAIT`, `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_BUNDLE` e `DELETE_TEMP_CHAT`. Writes nunca deduplicam; manutenção idempotente pode deduplicar.
- `AWAIT_RESPONSE` é um probe curto. Enquanto a resposta ainda está em curso, a task volta a `WAITING` com backoff e o worker fica livre. Um `BOT_WRITE` ou `RECOVERY_WRITE` só cria o await seguinte depois de upload/submit confirmados.
- O envio inicial e comentários do utilizador permanecem no Supervisor. Durante preparação/submit, mudanças de chat são coalescidas em `desired_visible_chat_id`; a navegação só ocorre depois da fase crítica. Comentários mantêm o `request_id` ativo e não criam um segundo await.
- A organização usa primeiro o título nativo estabilizado por duas leituras. Só depois de tentativas limitadas entra o fallback de chat temporário para gerar título; `ORGANIZE_CHAT` é idempotente e o chat temporário vira cleanup de baixa prioridade.
- Archive/delete esperam a lineage ativa ficar segura. `DELETE_BUNDLE` exige persistência local confirmada e nome canónico exato ou artifact id; não há fuzzy-delete de itens visualmente truncados na Biblioteca.
- O worker remoto nunca executa patches. Ele apenas descarrega o response bundle; filename/request id/protocolo continuam validados pelo backend e a pipeline Policy/Protected/Apply continua sendo a única autoridade de execução local.
- O gate de self-evolution do Desktop executa `npm run check`, incluindo todos os `*.test.mjs`. Depois de um cutover arquitetural, regressões baseadas em source strings do modelo antigo (por exemplo `main-regression.test.mjs`) precisam ser retargeted para o novo contrato; uma suite focal do scheduler não substitui o gate Desktop completo.
## Rechecagem pós-cutover (2026-09-10)

A infraestrutura nova está no runtime, mas o cutover de produção ainda é híbrido e não satisfaz integralmente o plano aprovado:

- O Desktop cria efetivamente 1 Supervisor e 3 workers, e o backend tem fila durável tipada, leases, prioridades, `not_before`, aging, locks e pausa de provider.
- O caminho Auto normal ainda chama `preparePromptForChatGPT(... autoSubmit=true)` no Supervisor. Esse caminho submete diretamente, arma `expectedChatGPTBundles` em memória e, no primeiro pedido, pode organizar/renomear imediatamente no Supervisor. A criação durável de `AWAIT_RESPONSE` depende depois do mecanismo de `resumeExpectedBundle`; `TITLE_DISCOVER` não é criado nesse caminho.
- As continuações automáticas continuam a chamar `preparePrompt(... autoSubmit=true)` diretamente no Supervisor; não existe produtor de produção para `BOT_WRITE`. `RENAME_CHAT`, `ARCHIVE_CHAT` e `DELETE_CHAT` também têm executores/tipos, mas não têm produtores normais no scheduler.
- O frontend ainda mantém manutenção periódica própria para archive/naming e chama operações de conta diretamente no Supervisor. Isso mantém um segundo controlador fora da fila e pode substituir/navegar a superfície visível.
- O poller periódico antigo de bundles foi desligado, mas `pollExpectedChatGPTDownloadKey()` continua alcançável pelo `did-stop-loading` do Supervisor e ainda contém recovery/continuation legado.
- O scheduler pode pôr uma task em `WAITING` no último `attempt`; o backend deixa de a reclamar quando `attempt >= max_attempts`, podendo deixá-la parada em `WAITING` indefinidamente.
- Pausa global é aplicada em `ATTENTION providerWide`, mas não há caminho de runtime/frontend que chame `setProviderPause(false)`. Uma pausa sem `paused_until` pode portanto congelar a fila até intervenção externa. HTTP 429 continua a usar backoff local do `expected` em vez de throttle global da fila.
- O endpoint de `cancelLineage` existe, porém o cancelamento corrente da UI limpa estado local e não o invoca; tasks duráveis da lineage podem sobreviver ao cancelamento.
- O `main` emite `wharness:chat-agent:state`, mas o preload/frontend não o expõe/consome; o painel de fila/workers previsto na fase Supervisor UX ainda não existe.
- O executor de archive/delete não persiste `remote_state` depois da confirmação. Já `ORGANIZE_CHAT` persiste `remote_title`, e o backend sincroniza esse título para o título local do chat.

Conclusão operacional: considerar o estado atual como **fundação implementada + cutover parcial**, e não como aceitação concluída da arquitetura Supervisor/Workers. Antes de declarar parity, os fluxos Auto, lifecycle/title, cancellation, provider pause/resume, retry terminal e observabilidade devem ser fechados por testes end-to-end de produção, não apenas por assertions estruturais de source.

## Fecho do cutover de lifecycle e runtime (2026-09-11)

- Archive, rename e delete iniciados pela UI passam a criar `ARCHIVE_CHAT`, `RENAME_CHAT` e `DELETE_CHAT` na fila durável. Os IPCs desses fluxos não criam nem navegam o Supervisor; fechar localmente acontece antes do enqueue remoto.
- `ARCHIVE_CHAT`, `RENAME_CHAT` e `DELETE_CHAT` persistem `remote_state` de conclusão; ao esgotar tentativas, o lifecycle persiste `attention` antes de falhar.
- O scheduler não devolve uma tarefa para `WAITING` quando o attempt atual já atingiu `max_attempts`; essa condição termina em `FAILED`, evitando tarefas inalcançáveis.
- Cancelar um Main Request chama também `cancelLineage(root_request_id)` no scheduler, eliminando trabalho durável órfão dessa lineage.
- A pausa global do provider ganhou uma ação explícita de retoma no runtime; o drawer mostra reachability do backend/scheduler, counts por estado, oldest/next `not_before`, estado do provider, e por worker último claim, lineage, conversa, attempt/max, lease e erro.
- O fallback `Runtime local` agora identifica explicitamente bridge/preload ausente, separando esse caso de backend indisponível, scheduler parado ou browser de Worker ainda não criado.

Estes ajustes fecham os gaps de lifecycle, retry terminal, cancelamento, pausa/retoma e observabilidade identificados na rechecagem anterior. O princípio permanece: o Supervisor serve interação humana; trabalho de conta em background pertence aos Workers e à fila durável.

## Worker claim SQL, runtime state and explicit browser interaction

The pooled worker claim path uses `UPDATE ... FROM candidate`. Because both the target table and the CTE expose `task_id`, every claim `RETURNING` column must stay qualified with the target alias; otherwise PostgreSQL rejects every claim and the queue remains pending. Keep a regression around the qualified return-column contract.

Worker activity shown in the runtime drawer must not depend only on transient scheduler callbacks. On refresh, reconcile `LEASED` and `RUNNING` durable tasks whose `lease_owner` matches the current Desktop instance and `worker-N`; this makes occupied/running status survive missed events and drawer reopening.

A Worker `WebContentsView` exists independently of whether it already has a page URL. Diagnostics may snapshot any created browser instance, and a trusted explicit interaction mode may temporarily surface one Worker inside bounded local Agent UI. Workers remain hidden by default, scheduler ownership is unchanged, no generic navigation/DOM/session IPC is granted, manual interaction can affect the active task, and the view must be hidden on interaction exit, frontend renderer failure, or window close. Hidden snapshots/layout automation may still park a zero-sized Worker into a real layout viewport, but must not overwrite bounds while the Worker is interactively visible.

## Robustez do commit point e upload (2026-09-11)

- A confirmação do POST da conversa é o commit point de `BOT_WRITE`/`RECOVERY_WRITE`. Depois dela, falhas de persistência remota ou de enqueue de `AWAIT_RESPONSE` não podem disparar outro write; o caminho seguro é best-effort para metadata e `ATTENTION` quando a supervisão durável não pode ser criada.
- A observação de upload deve seguir uma allowlist pequena de endpoints de upload ChatGPT sob `/backend-api`, com método mutável e sem headers/bodies. Fixar uma única rota literal transforma alterações legítimas do provider em falsos timeouts de 'upload não iniciado'.
