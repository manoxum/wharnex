export function createChatGPTRequestCancellation({
  sanitizeChatCacheKey, abortChatGPTTransportPreparations,
  expectedChatGPTBundles, retryableChatGPTPrompts, preparedChatGPTDrafts,
  manualChatGPTTransport, pendingChatGPTComments, chatgptViews,
  clearChatGPTHumanAction, reconcileChatGPTThrottle, scheduler,
  refreshChatAgentRuntimeState, publishChatAgentRuntimeState,
}) {
  async function cancelChatGPTRequestState(cacheKey, requestId) {
    const key = sanitizeChatCacheKey(cacheKey)
    const id = String(requestId || '').trim()
    if (!id) throw new Error('ChatGPT request cancellation requires a request id')
    const abortedPreparations = abortChatGPTTransportPreparations(key, id)
    let cleared = abortedPreparations > 0
    const expected = expectedChatGPTBundles.get(key)
    if (expected?.requestId === id) { expectedChatGPTBundles.delete(key); cleared = true }
    const retryable = retryableChatGPTPrompts.get(key)
    if (String(retryable?.request?.requestId || '') === id) { retryableChatGPTPrompts.delete(key); cleared = true }
    const prepared = preparedChatGPTDrafts.get(key)
    if (String(prepared?.requestId || '') === id) { preparedChatGPTDrafts.delete(key); cleared = true }
    if (await manualChatGPTTransport.clear(key, id)) cleared = true
    const comments = pendingChatGPTComments.get(key) || []
    const retainedComments = comments.filter((comment) => String(comment?.requestId || '') !== id)
    if (retainedComments.length !== comments.length) {
      cleared = true
      if (retainedComments.length) pendingChatGPTComments.set(key, retainedComments)
      else pendingChatGPTComments.delete(key)
    }
    const entry = chatgptViews.get(key)
    if (entry?.humanAction?.active && (!entry.humanAction.requestId || entry.humanAction.requestId === id)) {
      clearChatGPTHumanAction(key, 'pedido cancelado')
      cleared = true
    }
    if (entry) reconcileChatGPTThrottle(key, entry)
    let cancelledTasks = 0
    const activeScheduler = scheduler()
    if (activeScheduler) {
      const lineage = await activeScheduler.cancelLineage(id)
      cancelledTasks = Math.max(0, Number(lineage?.cancelled || 0))
      // Projection failure cannot undo the durable cancellation.
      try {
        await refreshChatAgentRuntimeState()
        publishChatAgentRuntimeState()
      } catch (error) {
        console.warn(`[chat-agent] runtime refresh after request cancellation failed request=${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { ok: true, cacheKey: key, requestId: id, cleared, cancelledTasks, abortedPreparations }
  }

  return { cancelChatGPTRequestState }
}
