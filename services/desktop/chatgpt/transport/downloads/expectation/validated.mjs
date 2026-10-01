export function createValidatedBundleState({
  deliveredChatGPTBundleRequestIds, dedupTtlMs, pendingChatGPTBundleDeliveries,
  expectedChatGPTBundles, chatGPTExpectedKeyForRequest,
  abortChatGPTTransportPreparations, scheduler, refreshChatAgentRuntimeState,
  publishChatAgentRuntimeState, now = Date.now,
}) {
  function recentlyDeliveredChatGPTBundleRequestId(requestId) {
    const deliveredAt = deliveredChatGPTBundleRequestIds.get(requestId)
    return typeof deliveredAt === 'number' && now() - deliveredAt < dedupTtlMs
  }

  function markChatGPTBundleRequestDelivered(requestId) {
    const current = now()
    deliveredChatGPTBundleRequestIds.set(requestId, current)
    for (const [id, deliveredAt] of deliveredChatGPTBundleRequestIds) {
      if (current - deliveredAt >= dedupTtlMs) deliveredChatGPTBundleRequestIds.delete(id)
    }
  }

  function chatGPTBundleAlreadyValidated(requestId) {
    const id = String(requestId || '').trim()
    return Boolean(id && (pendingChatGPTBundleDeliveries.has(id) || recentlyDeliveredChatGPTBundleRequestId(id)))
  }

  function quiesceChatGPTRecoveryAfterValidatedBundle(requestId, preferredKey = '') {
    const id = String(requestId || '').trim()
    if (!id) return
    const key = chatGPTExpectedKeyForRequest(id, preferredKey)
    if (key) {
      abortChatGPTTransportPreparations(key, id)
      const expected = expectedChatGPTBundles.get(key)
      if (expected?.requestId === id) {
        expected.bundleCollectedAt = now()
        expected.downloadInFlight = false
      }
    }
    // Validated bytes end provider-facing recovery before local ingestion.
    const activeScheduler = scheduler()
    if (activeScheduler) {
      void activeScheduler.cancelLineage(id)
        .then(() => refreshChatAgentRuntimeState())
        .then(() => publishChatAgentRuntimeState())
        .catch((error) => console.warn(`[chat-agent] recovery quiesce after bundle validation failed request=${id}: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  return {
    recentlyDeliveredChatGPTBundleRequestId, markChatGPTBundleRequestDelivered,
    chatGPTBundleAlreadyValidated, quiesceChatGPTRecoveryAfterValidatedBundle,
  }
}
