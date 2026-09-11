# ChatGPT Worker routing and response latency

## Confirmed current-state findings (2026-09-11)

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
- Inícios de navegação cross-chat dos Workers são serializados globalmente com intervalo mínimo de 2,5 s. Depois de cada load, o executor aguarda `waitForChatGPTSurfaceReady`, portanto a task só continua quando o documento deixou de carregar e a rede ficou quieta pelo settle window.
- HTTP 429 relevante (main frame ou transporte de conversa) aciona uma pausa global do provider por 60 s, não apenas backoff local de um `expected`. Tasks já reclamadas observam o gate local e voltam para `WAITING`; a ação explícita de retoma do provider limpa também esse gate local.
- O custo intencional é maior latência mínima no trabalho de background e em trocas cross-chat; a contrapartida é limitar burst por Worker e por perfil autenticado antes de chegar ao rate-limit do ChatGPT.
