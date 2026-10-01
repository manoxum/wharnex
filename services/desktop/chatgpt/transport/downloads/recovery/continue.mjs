export function registerContinueExpectedBundleIPC({
  ipcMain, trustedSender, sanitizeChatCacheKey, expectedChatGPTBundles,
  getChatAgentScheduler, classifyChatGPTRequestDelivery,
  disarmExpectedChatGPTBundle, ensureChatGPTView,
  requireOwnedChatGPTEntry, withChatGPTTransportPreparation,
  canonicalChatGPTConversationURL, setChatGPTHumanAction,
  targetChatGPTComposer, waitForChatGPTSurfaceReady,
  executeChatGPTDOMScript, chatGPTResponseCompletionScript,
  classifyChatGPTConversationTransport, CONVERSATION_TRANSPORT_STALE_MS,
  reconcileChatGPTConversationTransport, chatGPTSubmittedRequestEvidenceScript,
  chatInputArchiveFilename, refreshChatAgentRuntimeState,
  publishChatAgentRuntimeState, submitChatGPTContinuation,
  ChatGPTRateLimitDeferral, escalateChatGPTContinuationFailure,
  createChatGPTRecoveryState, clearChatGPTHumanAction,
  recordChatGPTContinuationSent,
}) {
  ipcMain.handle('wharness:chatgpt:continue-expected-bundle', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.requestId || '').trim()
    let expected = expectedChatGPTBundles.get(key)
    if (!expected || expected.requestId !== requestId) {
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
    }
    const chatAgentScheduler = getChatAgentScheduler()
    if (!chatAgentScheduler) throw new Error('ChatGPT task scheduler is not ready')
    const listed = await chatAgentScheduler.list({ request_id: requestId })
    const delivery = classifyChatGPTRequestDelivery(listed?.tasks, key)
    if (delivery === 'writing') {
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'write_in_progress' }
    }
    if (delivery === 'not_submitted') {
      disarmExpectedChatGPTBundle(key, requestId)
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
    }
    const { entry } = ensureChatGPTView(key, windowState)
    requireOwnedChatGPTEntry(key, entry)
    return withChatGPTTransportPreparation(key, entry, requestId, async () => {
    expected = expectedChatGPTBundles.get(key)
    if (!expected || expected.requestId !== requestId) return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
    if (expected.manualContinuationInFlight) return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'continuation_in_flight' }
    const affinityURL = canonicalChatGPTConversationURL(entry.affinity.boundURL || '')
    if (!affinityURL) {
      setChatGPTHumanAction(key, 'surface', 'A continuação não possui uma conversa ChatGPT vinculada e não será enviada noutra conversa.', 'manual-continuation-affinity')
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'affinity_unavailable' }
    }
    let targeted
    try { targeted = await targetChatGPTComposer(key, affinityURL, false) }
    catch { return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'surface_unavailable' } }
    const { wc } = targeted

    if (entry.loading || wc.isLoading()) {
      try {
        await waitForChatGPTSurfaceReady(key, entry)
      } catch {
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'surface_loading' }
      }
      expected = expectedChatGPTBundles.get(key)
      if (!expected || expected.requestId !== requestId) {
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
      }
    }

    const completion = await executeChatGPTDOMScript(key, entry, 'manual-continuation-state', chatGPTResponseCompletionScript(expected.assistantBaseline))
    const transport = classifyChatGPTConversationTransport(entry.conversationRequests, {
      generation: entry.conversationTransportGeneration,
      loading: entry.loading,
      surfaceReady: completion?.composerReady === true,
      thinking: completion?.thinking === true,
      lastConversationActivity: entry.lastConversationActivity,
    }, Date.now(), { staleMs: CONVERSATION_TRANSPORT_STALE_MS })
    if (transport.state === 'stale') for (const staleRequestId of transport.staleRequestIds) entry.staleConversationRequestIds.add(staleRequestId)
    reconcileChatGPTConversationTransport(entry.conversationRequests, transport)
    const staleTransport = transport.state === 'stale' || entry.staleConversationRequestIds.size > 0

    if (entry.loading) return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'surface_loading' }
    if (transport.state === 'active') return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'transport_active' }
    if ((staleTransport || completion?.thinking === true) && request?.force !== true) {
      return {
        ok: false,
        cacheKey: key,
        requestId,
        confirmationRequired: true,
        reason: staleTransport ? 'transport_stale' : 'processing_ambiguous',
      }
    }

    const submissionEvidence = await executeChatGPTDOMScript(
      key,
      entry,
      'manual-continuation-original-request',
      chatGPTSubmittedRequestEvidenceScript(chatInputArchiveFilename(key, requestId)),
    )
    if (submissionEvidence?.submitted !== true) {
      const latest = await chatAgentScheduler.list({ request_id: requestId })
      const currentDelivery = classifyChatGPTRequestDelivery(latest?.tasks, key)
      if (currentDelivery === 'writing' || currentDelivery === 'submitted') {
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'write_in_progress' }
      }
      disarmExpectedChatGPTBundle(key, requestId)
      void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'resend_required' }
    }

    expected.manualContinuationInFlight = true
    try {
      let continuation
      try {
        continuation = await submitChatGPTContinuation(key, affinityURL, requestId, entry, { manual: true })
      } catch (error) {
        if (error instanceof ChatGPTRateLimitDeferral) {
          return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'provider_cooldown' }
        }
        escalateChatGPTContinuationFailure(key, expected, error, 'manual-continuation')
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'continuation_failed' }
      }
      if (continuation?.skipped) {
        const reason = continuation.reason === 'request_not_supervised' ? 'not_supervised' : continuation.reason
        return { ok: continuation.reason === 'bundle_already_validated', cacheKey: key, requestId, confirmationRequired: false, reason }
      }
      expected.assistantBaseline = Math.max(expected.assistantBaseline, Number(completion?.assistantCount) || 0)
      expected.settledAt = 0
      expected.lastDOMClick = 0
      expected.recovery = createChatGPTRecoveryState(Date.now())
      entry.staleConversationRequestIds.clear()
      clearChatGPTHumanAction(key, 'continuação manual enviada')
      recordChatGPTContinuationSent(expected, 'manual', staleTransport ? 'transport_stale' : 'operator_requested')
      return { ok: true, cacheKey: key, requestId, confirmationRequired: false, reason: 'submitted' }
    } finally {
      expected.manualContinuationInFlight = false
    }
    })
  })
}
