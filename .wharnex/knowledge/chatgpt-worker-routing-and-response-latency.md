# ChatGPT Worker routing and response latency

## Estado atual revalidado (2026-09-11, req_20260911T200324_314a8fefb8a1bbf7)

Esta entrada consolida o comportamento observado no snapshot atual e substitui conclusões antigas que já não correspondem ao código.

### Melhorias já presentes e válidas

- O `AWAIT_RESPONSE` saudável já não usa o backoff exponencial antigo; existe uma cadência passiva fixa.
- O transporte dos Workers é serializado por slot físico (`slot:<slotId>`).
- O scheduler usa opções de claim por Worker com afinidade de lane.
- `ChatAgentResidency` mantém `assignmentEpoch`, `residentLane`, `pendingLane`, `nonPreemptive` e estado de navegação; o executor valida o epoch em transições principais.
- Antes da escrita do Worker existe um guard contra conversa corrente diferente da esperada.
- O backend possui pacing de provider/429 e amostras de duração.
- Observações explicitamente marcadas com `observation:true` já não gastam `attempt`: `Store.WaitChatAgentTask(... observation bool)` devolve o incremento da claim e o scheduler propaga esse estado. A conclusão antiga de que toda observação saudável consumia retry budget está obsoleta.

### Causa atual do atraso de deteção/download

1. `chat_agent_pacing.go` mantém bootstrap/initial wait mínimo de 1 minuto e máximo de 15 minutos.
2. `enqueueChatAgentFollowups()` agenda `AWAIT_RESPONSE` e `TITLE_DISCOVER` com `not_before = now + chatAgentInitialRequestWaitMs()`. O primeiro probe do Worker não pode ocorrer antes de ~60 s, mesmo que a resposta termine em poucos segundos.
3. `CHAT_AGENT_AWAIT_PROBE_MS = 30_000`; após o primeiro probe há até ~30 s adicionais de latência residual.
4. O timer de 2 s (`DOM_DOWNLOAD_POLL_MS`) chama atividade/comentários, mas não chama `pollExpectedChatGPTDownloads()`. Ele não oferece SLA de 2 s aos Workers autónomos.
5. `probeChatAgentResponse()` marca o ramo thinking como `observation:true`, mas um ramo simplesmente “not complete” pode re-agendar sem esse marcador; falsas negativas transitórias ainda podem consumir attempts.
6. Workers são `WebContentsView` escondidos e `probeChatAgentResponse()` não garante `ensureChatGPTLayoutViewport()` antes do detector geométrico. `chatGPTExpectedDownloadScript()` usa `offsetWidth/offsetHeight/getClientRects()`, portanto viewport zero pode ocultar um bundle já presente no DOM.

A correção correta é separar pacing de mutação (navegação/POST/provider) da observação DOM: primeiro `AWAIT_RESPONSE` imediato/sub-segundo, probes de 1–2 s ou observer event-driven com watchdog, viewport parked não-zero e estados saudáveis sempre como observação.

### Causa atual de prompt na conversa/instância errada

- O fluxo Auto do frontend ainda chama `preparePrompt(... preferCurrentConversation:true)`. Em `targetChatGPTComposer()`, se o WebContents já estiver numa conversa concreta, esse flag pode preservar a conversa atual mesmo quando existe uma `chatgpt_url` vinculada diferente. Para chats bound, isso viola a afinidade persistida e é uma causa direta de envio errado.
- `submitPromptToChatGPT()` faz targeting inicial exato, mas `submitChatGPTDraft()` volta a chamar `targetChatGPTComposer(key, '', false, entry)`, perdendo a expected URL. Falta um guard de `conversation_id` no commit point imediatamente antes de cada tentativa de submit/POST.
- Callbacks `did-stop-loading`, `did-navigate` e `did-navigate-in-page` consultam `entry.ownerKey` mutável quando disparam. Como não carregam o `assignmentEpoch`/lane/generation que originou a navegação, eventos stale de uma atribuição anterior podem contaminar affinity/settlement da nova.
- O filename canónico com `request_id` é uma autoridade boa para download, mas o fallback `recentExpectedDownload` é process-global. Em concorrência com nomes genéricos deve ser substituído por intenção `{slotId, webContentsId, assignmentEpoch, requestId, expectedFilename}` e falhar fechado quando ambígua.

### Correções recomendadas

1. Excluir `AWAIT_RESPONSE` do initial wait adaptativo; torná-lo imediatamente elegível depois do POST confirmado.
2. Probe de 1–2 s ou `MutationObserver` + watchdog curto; manter pacing longo apenas para operações mutáveis.
3. Garantir viewport parked não-zero desde criação/rebind e defensivamente antes de probes geométricos.
4. Marcar todos os estados saudáveis não-terminais como `observation:true` e manter `failure_attempt` separado de liveness/probe count.
5. Quando existe binding, remover `preferCurrentConversation:true`; conversa esperada é mandatória.
6. Passar `expectedConversationURL`, `ownerKey`, `assignmentEpoch` e lane até `submitChatGPTDraft()` e revalidar imediatamente antes de cada submit/retry; mismatch aborta sem POST.
7. Tornar callbacks de navegação epoch/generation-aware; callback stale deve ser no-op.
8. Correlacionar download por request/slot/WebContents/epoch, preservando o request_id canónico como primeira chave.
9. Preservar slot lock, non-preemptive transport, affinity-aware claim e os guards já integrados.

### Telemetria e regressões

Registar por request: `worker_slot`, `assignment_epoch`, `owner_key`, `expected_conversation_id`, `actual_conversation_id`, `submit_targeted_at`, `submit_committed_at`, `response_complete_observed_at`, `file_affordance_seen_at`, `download_click_at`, `will_download_at`, `bundle_validated_at`.

Cobrir em testes: resposta concluída logo após POST; resposta concluída logo após um probe; geração longa sem consumir attempts; Worker oculto/viewport zero; chat bound A com view em B; redirect entre upload e submit; callback stale após rebind; dois Workers com downloads simultâneos e nome genérico.

Meta operacional recomendada: p95 <= 2 s e p99 <= 5 s entre o bundle ficar disponível no DOM e o primeiro click, excluindo pausas reais do provider. A configuração atual de primeiro wait >=60 s e probe de 30 s torna essa meta impossível por construção.

## Nota de validação

Conclusões baseadas em análise estática do snapshot anexado. Nenhuma suite foi executada e nenhuma mutação foi aplicada nesta ronda de investigação.
