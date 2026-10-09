import { createDownloadDiagnosticRecorder } from './diagnostic.mjs'
import { observeGuardedResponseProgress } from './guarded-progress.mjs'
export function createExpectedBundlePoll(context) {
  const {
    pollingExpectedChatGPTBundles, expectedChatGPTBundles, hasPendingChatGPTComments, pendingChatGPTBundleDeliveries, chatgptTransportModes, EXPECTED_BUNDLE_TTL_MS, sendToChatGPTKey, chatgptViews, chatGPTSupervisorOwnsExpectedResponse, isTrustedChatGPTOrigin, chooseChatGPTRecoveryAction, performChatGPTRecoveryAction,
    noteChatGPTRecoveryFault, recentlyDeliveredChatGPTBundleRequestId, disarmExpectedChatGPTBundle, chatAgentKeepFlowingRequestActive, DOM_DOWNLOAD_RETRY_MS, captureChatGPTProcessingDuration, chatGPTExpectedDownloadScript, setRecentExpectedDownload, DOWNLOAD_INFLIGHT_TIMEOUT_MS, chatGPTResponseCompletionScript, noteChatGPTRecoveryAssistantCount, PROCESSING_SIGNAL_GRACE_MS,
    classifyChatGPTConversationTransport, CONVERSATION_TRANSPORT_STALE_MS, reconcileChatGPTConversationTransport, setChatGPTHumanAction, PROCESSING_STALE_ATTENTION_MS, BUNDLE_COMPLETION_GRACE_MS, isChatGPTAffinityAwaitingSettlement, CHATGPT_AFFINITY_RECOVERY_GRACE_MS, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, CHATGPT_DOM_PROBE_FAILURE_LIMIT, noteChatGPTRendererFault,
  } = context

  const recordDiagnostic = createDownloadDiagnosticRecorder(context.logDownloadDiagnostic)

  async function pollExpectedChatGPTDownloadKey(key) {
    if (pollingExpectedChatGPTBundles.has(key)) return
    pollingExpectedChatGPTBundles.add(key)
    const now = Date.now()
    try {
      const expected = expectedChatGPTBundles.get(key)
      if (!expected) return
      if (hasPendingChatGPTComments(key)) return recordDiagnostic(key, expected, undefined, 'queued-comment', now)
      // Once validated bytes are durable, the backend handoff/ACK is the only
      // remaining operation. Do not inspect the remote page or submit another
      // continuation while that local transaction is still settling.
      if (pendingChatGPTBundleDeliveries.has(expected.requestId)) return recordDiagnostic(key, expected, undefined, 'pending-delivery', now)
      if (chatgptTransportModes.get(key) === 'manual') { recordDiagnostic(key, expected, undefined, 'manual', now); expectedChatGPTBundles.delete(key); return }
      if (now - expected.armedAt > EXPECTED_BUNDLE_TTL_MS) {
        recordDiagnostic(key, expected, undefined, 'expired', now)
        expectedChatGPTBundles.delete(key)
        sendToChatGPTKey(key, 'wharness:chatgpt:bundle-download-error', { cacheKey: key, requestId: expected.requestId, error: 'Tempo limite excedido enquanto o Wharnex aguardava o bundle canónico.' })
        return
      }
      const entry = chatgptViews.get(key)
      // The Supervisor bound to this chat owns its response supervision, visible
      // or not. It is already on the conversation, so reading it here costs no
      // provider request at all — which is the whole point of binding a Supervisor
      // to a chat for the life of its request.
      if (!entry || !chatGPTSupervisorOwnsExpectedResponse(key, expected.requestId)) return recordDiagnostic(key, expected, undefined, 'ownership', now)
      // Suspension freezes provider-facing supervision too. In particular, do
      // not turn an already-armed continuation into reload/upload/download
      // traffic while the queue itself is stopped. The one resume probe owns the
      // only reload allowed after expiry.
      // Recovery reloads and DOM probes must not race the serialized upload or
      // prompt preparation currently owning this surface. The next main-process
      // sweep will resume supervision after the transport boundary is released.
      if (Number(entry?.transportPreparationCount || 0) > 0) { recordDiagnostic(key, expected, undefined, 'preparing', now); return }
      const wc = entry?.view.webContents
      if (!entry || wc?.isDestroyed() || !isTrustedChatGPTOrigin(wc.getURL())) { recordDiagnostic(key, expected, undefined, 'surface', now); return }
      const transportAttention = entry.humanAction?.active && ['transport', 'stalled'].includes(entry.humanAction.kind)
      if (entry.humanAction?.active && !transportAttention) { recordDiagnostic(key, expected, undefined, 'human-gate', now); return }
      if (Number(expected.backoffUntil || 0) > now) { recordDiagnostic(key, expected, undefined, 'backoff', now); return }
      try {
        const faultAction = !transportAttention && chooseChatGPTRecoveryAction(expected.recovery, {}, now, { faultOnly: true })
        if (faultAction) {
          recordDiagnostic(key, expected, undefined, 'recovery', now)
          await performChatGPTRecoveryAction(key, expected, entry, faultAction)
          return
        }
        if (entry.loading) {
          recordDiagnostic(key, expected, undefined, 'loading', now)
          if (!entry.loadingFaultNoted && entry.loadingSince && now - entry.loadingSince >= 30_000) {
            entry.loadingFaultNoted = true
            noteChatGPTRecoveryFault(expected.recovery, 'ChatGPT page load remained pending for more than 30 seconds', now)
          }
          return
        }

        // Validated delivery ends this expectation before any remote activation.
        if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId)) {
          recordDiagnostic(key, expected, undefined, 'delivered', now)
          console.log(`[chatgpt-bundle-dom] already-delivered key=${key} request=${expected.requestId}; releasing expectation`)
          disarmExpectedChatGPTBundle(key, expected.requestId)
          return
        }

        // Only one activation may be in flight; cooldown bounds a failed target.
        const keepFlowing = chatAgentKeepFlowingRequestActive(expected.requestId)
        if (!expected.downloadInFlight && (!keepFlowing || Number(expected.invalidBundleCount || 0) === 0) && (!expected.lastDOMClick || now - expected.lastDOMClick >= DOM_DOWNLOAD_RETRY_MS)) {
          await captureChatGPTProcessingDuration(entry, expected)
          const result = await wc.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, expected.assistantBaseline, false, Boolean(transportAttention || expected.rehydrating), { diagnostics: true }), true)
          const clickMode = typeof result === 'string' ? result : String(result?.mode || '')
          recordDiagnostic(key, expected, result?.diagnostic, 'observed', now)
          if (clickMode) {
            expected.lastDOMClick = now
            expected.downloadInFlight = true
            expected.progressAt = now
            setRecentExpectedDownload({ key, requestId: expected.requestId, at: now })
            console.log(`[chatgpt-bundle-dom] download-triggered key=${key} file=${expected.filename} mode=${clickMode}`)
            return
          }
        } else recordDiagnostic(key, expected, undefined, expected.downloadInFlight ? 'download-in-flight' : keepFlowing && Number(expected.invalidBundleCount || 0) > 0 ? 'invalid-bundle-held' : 'download-retry-delay', now)

        // Await will-download/done before considering missing-bundle recovery.
        if (expected.downloadInFlight) {
          const pendingMs = now - Number(expected.lastDOMClick || now)
          if (pendingMs < DOWNLOAD_INFLIGHT_TIMEOUT_MS) return
          expected.downloadInFlight = false
          console.warn(`[chatgpt-bundle-dom] download-stalled key=${key} file=${expected.filename} pendingMs=${pendingMs}`)
        }

        if (await observeGuardedResponseProgress({ expected, wc, now, attention: transportAttention, completionScript: chatGPTResponseCompletionScript })) return
        if (expected.rehydrating) return
        if (Number(expected.recoveryEligibleAt || 0) > now) return

        const completion = await wc.executeJavaScript(chatGPTResponseCompletionScript(expected.assistantBaseline), true)
        expected.domProbeFailures = 0
        noteChatGPTRecoveryAssistantCount(expected.recovery, completion?.assistantCount, now)
        // Structural evidence the page is alive. The durable supervision reads this
        // stamp to bound a passive observation that never spends an attempt, so the
        // clock has to be reset by any generating or completion signal — never by
        // the mere fact that a probe ran.
        if (completion?.thinking === true || completion?.complete === true) expected.progressAt = now
        if (completion?.thinking === true) {
          if (!expected.processingObservedAt) expected.processingObservedAt = now
          expected.processingAbsentSince = 0
        } else if (expected.processingObservedAt && !expected.processingAbsentSince) {
          expected.processingAbsentSince = now
        }
        if (completion?.complete === true) await captureChatGPTProcessingDuration(entry, expected)
        const processingSignalActive = completion?.thinking === true
          || Boolean(expected.processingAbsentSince && now - expected.processingAbsentSince < PROCESSING_SIGNAL_GRACE_MS)
        const transport = classifyChatGPTConversationTransport(entry.conversationRequests, {
          generation: entry.conversationTransportGeneration,
          loading: entry.loading,
          surfaceReady: completion?.composerReady === true,
          thinking: processingSignalActive,
          lastConversationActivity: entry.lastConversationActivity,
        }, now, { staleMs: CONVERSATION_TRANSPORT_STALE_MS })
        if (transport.state === 'stale') for (const requestId of transport.staleRequestIds) entry.staleConversationRequestIds.add(requestId)
        reconcileChatGPTConversationTransport(entry.conversationRequests, transport)
        const lastMeaningfulProgress = Math.max(Number(entry.lastConversationActivity || 0), Number(expected.recovery?.lastProgressAt || 0))
        if (transport.state === 'stale' && completion?.composerReady === true && processingSignalActive === false) {
          setChatGPTHumanAction(key, 'stalled', 'O transporte de conversa registado ficou sem atividade e a superfície está ociosa. Confirme a conversa ou use “Retomar pedido”.', 'stale-conversation-transport')
          return
        }
        if (completion?.thinking === true && completion?.composerReady === true && transport.state !== 'active' && now - lastMeaningfulProgress >= PROCESSING_STALE_ATTENTION_MS) {
          setChatGPTHumanAction(key, 'stalled', 'O controlo de processamento continua visível, mas não existe atividade de rede nem progresso estrutural recente. O Wharnex não interrompeu a tarefa; confirme a conversa ou use “Retomar pedido”.', 'ambiguous-processing-control')
          return
        }
        const responseStarted = Number(completion?.assistantCount || 0) > Number(expected.assistantBaseline || 0)
        const processingInterrupted = Boolean(
          expected.processingObservedAt
          && expected.processingAbsentSince
          && !responseStarted
          && completion?.composerReady === true
          && completion?.failed !== true
          && now - expected.processingAbsentSince >= PROCESSING_SIGNAL_GRACE_MS
        )
        if (!completion?.complete) expected.settledAt = 0
        else if (!expected.settledAt) expected.settledAt = now
        const completionSettled = completion?.complete === true
          && Boolean(expected.settledAt)
          && now - expected.settledAt >= BUNDLE_COMPLETION_GRACE_MS
        const recoveryAction = chooseChatGPTRecoveryAction(expected.recovery, {
          complete: completionSettled,
          thinking: processingSignalActive,
          failed: completion?.failed === true,
          responseStarted,
          processingInterrupted,
          surfaceReady: completion?.composerReady === true,
          humanActionRequired: entry.humanAction?.active === true,
          awaitingConversationAffinity: isChatGPTAffinityAwaitingSettlement(entry.affinity)
            && now - expected.armedAt < CHATGPT_AFFINITY_RECOVERY_GRACE_MS,
          transportActive: transport.state === 'active',
        }, now)
        if (recoveryAction) {
          await performChatGPTRecoveryAction(key, expected, entry, recoveryAction, completion)
          return
        }

        if (!completion?.complete || !completionSettled) return
        if (expected.automaticContinuationSent === true || Number(expected.continuationCount || 0) >= MAX_AUTOMATIC_BUNDLE_CONTINUATIONS || expected.recovery?.completionContinued === true) {
          setChatGPTHumanAction(key, 'stalled', `O ChatGPT terminou sem disponibilizar ${expected.filename} depois do wake-up automático único. Use “Retomar pedido” depois de verificar a conversa.`, 'recovery')
        }
        return
      } catch (error) {
        expected.domProbeFailures = Number(expected.domProbeFailures || 0) + 1
        const detail = error instanceof Error ? error.message : String(error)
        console.warn(`[chatgpt-bundle-dom] scan-failed key=${key} failures=${expected.domProbeFailures} error=${detail}`)
        if (expected.domProbeFailures >= CHATGPT_DOM_PROBE_FAILURE_LIMIT) noteChatGPTRendererFault(key, `bundle DOM probe failed ${expected.domProbeFailures} times: ${detail}`)
      }
    } finally {
      pollingExpectedChatGPTBundles.delete(key)
    }
  }

  return { pollExpectedChatGPTDownloadKey }
}
