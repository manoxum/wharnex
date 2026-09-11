# ChatGPT Worker routing and response latency

## Historical findings before the residency cutover (2026-09-11)

- Response supervision is durable through `AWAIT_RESPONSE`, but a healthy “still thinking/not complete” result currently uses the generic exponential `chatAgentBackoff`: about 2s, 4s, 8s, 16s, 32s, then 60s with ±20% jitter.
- The Desktop timer named `chatGPTDownloadPoller` runs every `DOM_DOWNLOAD_POLL_MS` but no longer invokes `pollExpectedChatGPTDownloads()`. Therefore the nominal 2s constant is not a low-latency bundle-detection SLA for autonomous Workers.
- A normal automatic send from the frontend passes `preferCurrentConversation: true`. `targetChatGPTComposer()` then keeps any current conversation instead of navigating to a different requested conversation URL. This is a direct wrong-chat routing hazard.
- Worker tasks are claimed globally by numbered scheduler loops. `selectSlotForJob()` can prefer conversation/chat affinity, but the current Desktop dispatch does not use that selector.
- Worker ownership is represented by mutable `ownerKey`; there is no task assignment epoch. Navigation callbacks read the current `ownerKey`, so late events from an older assignment can be attributed to a newer owner.
- Transport preparation is serialized by chat key rather than by the physical Worker slot, and there is no final exact `conversation_id` guard immediately before submit.
- `recentExpectedDownload` is a single process-global fallback, which is fragile when several Workers start downloads close together.

## Correction principles

1. Give `AWAIT_RESPONSE` a dedicated low-latency healthy-poll cadence; reserve exponential backoff for actual faults.
2. Automated sends must target the bound conversation exactly. Validate the current conversation before fill/upload and again before submit; mismatch means abort/requeue, never fallback to current.
3. Add a monotonic assignment epoch to each Worker and make stale async callbacks no-op.
4. Serialize browser mutation per physical Worker slot; chat/lineage locks can remain as an additional constraint.
5. Prefer affinity-aware slot selection to reduce rebinding, without relying on affinity as the correctness boundary.
6. Track download intents per request/Worker or source WebContents instead of one global fallback.
7. Regression tests should cover response-completion latency, stale navigation events, cross-chat routing, redirect between fill and submit, and simultaneous downloads.

## Anti-burst e rate-limit dos Workers (2026-09-11)

- Cada loop do scheduler espera 2,5 s depois de concluir/assentar uma task antes de reclamar a próxima. O objetivo é evitar que probes curtos liberem o mesmo Worker para trocar de chat imediatamente.
- Inícios de navegação cross-chat dos Workers são serializados globalmente; o intervalo mínimo atual é 30 s. O cooldown de 2,5 s permanece apenas entre claims consecutivos do mesmo loop. Depois de cada load, o executor aguarda `waitForChatGPTSurfaceReady`, portanto a task só continua quando o documento deixou de carregar e a rede ficou quieta pelo settle window.
- HTTP 429 relevante (main frame ou transporte de conversa) aciona uma pausa global do provider por 60 s, não apenas backoff local de um `expected`. Tasks já reclamadas observam o gate local e voltam para `WAITING`; a ação explícita de retoma do provider limpa também esse gate local.
- O custo intencional é maior latência mínima no trabalho de background e em trocas cross-chat; a contrapartida é limitar burst por Worker e por perfil autenticado antes de chegar ao rate-limit do ChatGPT.

## Investigação de latência de bundle e wrong-chat routing (2026-09-11, req_20260911T133056_f9b063e4ff598748)

A revisão da versão atual confirmou estes gaps adicionais como diretamente acionáveis:

- `probeChatAgentResponse()` trata o estado saudável “ainda a gerar” com `chatAgentBackoff(task.attempt)`. Como cada claim incrementa `attempt`, observação saudável e falha partilham o mesmo budget; com `max_attempts=30` uma resposta longa pode esgotar o supervisor sem erro real. O cooldown global de 2,5 s do worker também se aplica a `AWAIT_RESPONSE`.
- O timer `chatGPTDownloadPoller` de 2 s já não chama `pollExpectedChatGPTDownloads()`. A deteção autónoma depende do próximo claim de `AWAIT_RESPONSE`; por isso a disponibilidade do bundle pode preceder o próximo probe em dezenas de segundos quando o backoff atingiu 60 s.
- `expectedChatGPTBundleForDownload()` tem boas correlações por filename e source WebContents, mas o fallback `recentExpectedDownload` continua global ao processo. Em concorrência, a intenção deve ser por WebContents/slot + request id + assignment epoch.
- O envio Auto normal do frontend passa `preferCurrentConversation: true`. `targetChatGPTComposer()` aceita então a conversa corrente mesmo quando a conversa vinculada é diferente. Para automação, uma `conversation_id` conhecida deve ser destino obrigatório.
- No Worker, `submitPromptToChatGPT()` faz targeting exato inicialmente, mas `submitChatGPTDraft()` volta a entrar no composer sem expected URL. Falta um guard final de `conversation_id` entre fill/upload e o commit point do POST.
- `selectSlotForJob()` existe e implementa preferência por afinidade, mas os loops reais do scheduler fazem claims globais por worker numérico e não o usam. Isto aumenta rebinds e races, embora afinidade deva continuar apenas como otimização.
- `ownerKey` é mutável e callbacks de navegação/renderer consultam o valor atual. Sem `assignmentEpoch`, um evento tardio da atribuição anterior pode contaminar a nova. O transporte deve carregar um token imutável `{slot, epoch, task, chat, conversation}` e callbacks stale devem ser no-op.
- A serialização principal de preparação é por `cacheKey`; adicionar um lock por slot físico/WebContents fecha a fronteira do recurso realmente mutável.
- Workers escondidos devem garantir um viewport de layout antes de probes que dependem de geometria/visibilidade (`chatGPTExpectedDownloadScript`).

Ordem recomendada: (1) exact conversation guard e remover `preferCurrentConversation` em Auto; (2) cadência `AWAIT_RESPONSE` de baixa latência, separada de retry/failure budget; (3) download intent por Worker/request; (4) assignment epoch + slot lock; (5) affinity-aware dispatch; (6) métricas e testes de races. Meta sugerida: p95 <= 2 s e p99 <= 5 s do aparecimento do bundle no DOM até ao primeiro click, fora de pausas reais do provider.

## Current routing envelope after supervisor-flow consolidation (2026-09-11)

- Default topology is **2 fixed Supervisor slots + 6 Workers**. Only one Supervisor is visible; the spare Supervisor is the cooperative handoff buffer for chat switches.
- Worker churn is intentionally bounded by a **60 s default residence** (`30 s <= dwell <= 120 s`), a profile-global **30 s cross-chat navigation gate**, and a **30 s healthy `AWAIT_RESPONSE` probe cadence**. The existing 2.5 s per-worker post-task cooldown remains as a secondary anti-burst guard.
- Switching selected chats does not tear down a Supervisor that is still writing. That slot completes its current transport and becomes standby while an idle Supervisor loads the new chat; only when both Supervisor slots are busy is the switch deferred.
- `Seguir (flow)` is observability, not scheduling: it surfaces the exact Worker `WebContentsView` inside the normal Engine viewport using the already-bounded interaction capability. Assignment epoch, task lease, scheduler ownership and non-preemptive execution remain unchanged.
