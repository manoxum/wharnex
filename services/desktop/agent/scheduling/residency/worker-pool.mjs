export function createChatAgentWorkerPool({
  state, desktopWindows, chatGPTWorkerEntries,
  createChatGPTWorkerView, retireChatGPTWorkerView,
  chatAgentWorkerStates, wait, CHAT_AGENT_WORKER_SPAWN_GAP_MS,
  sanitizeChatCacheKey, chatAgentLane, chatAgentResidency,
  canonicalChatGPTConversationURL, createChatGPTAffinityTracker,
  syncChatGPTAffinity, touchChatGPTEntry,
  chatAgentLiveBundlePending,
}) {
  function reconcileChatGPTWorkerPool(windowState) {
    const host = windowState?.window && !windowState.window.isDestroyed()
      ? windowState
      : [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
    if (!host) return
    for (let index = 1; index <= state.desiredChatAgentWorkerSlots; index += 1) {
      if (!chatGPTWorkerEntries.some((entry) => entry.slotId === `worker-${index}`)) createChatGPTWorkerView(`worker-${index}`, host)
    }
    for (;;) {
      const persistent = chatGPTWorkerEntries.filter((entry) => /^worker-[1-9][0-9]?$/.test(entry.slotId))
      if (persistent.length <= state.desiredChatAgentWorkerSlots) break
      const candidate = persistent.sort((left, right) => Number(right.slotId.slice(7)) - Number(left.slotId.slice(7)))[0]
      const index = Number(candidate.slotId.slice(7))
      const runtime = chatAgentWorkerStates.get(index)
      if (candidate?.interactionWindowId || candidate?.monitorWindowId || runtime?.task || runtime?.active !== false) break
      const position = chatGPTWorkerEntries.indexOf(candidate)
      if (position >= 0) chatGPTWorkerEntries.splice(position, 1)
      retireChatGPTWorkerView(candidate)
      chatAgentWorkerStates.delete(index)
    }
  }

  function ensureChatGPTWorkerPool(windowState) {
    reconcileChatGPTWorkerPool(windowState)
  }

  async function primeChatGPTWorkerPool(windowState) {
    while (!state.quitting && chatGPTWorkerEntries.filter((entry) => /^worker-[1-9][0-9]?$/.test(entry.slotId)).length < state.desiredChatAgentWorkerSlots) {
      const host = windowState?.window && !windowState.window.isDestroyed()
        ? windowState
        : [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
      if (!host) return
      const index = Array.from({ length: state.desiredChatAgentWorkerSlots }, (_unused, offset) => offset + 1)
        .find((candidate) => !chatGPTWorkerEntries.some((entry) => entry.slotId === `worker-${candidate}`))
      if (!index) return
      createChatGPTWorkerView(`worker-${index}`, host)
      if (chatGPTWorkerEntries.filter((entry) => /^worker-[1-9][0-9]?$/.test(entry.slotId)).length < state.desiredChatAgentWorkerSlots) await wait(CHAT_AGENT_WORKER_SPAWN_GAP_MS)
    }
  }

  function assignChatGPTWorker(entry, task) {
    if (!entry || entry.role !== 'worker') throw new Error('Chat-agent worker slot is unavailable')
    const chatId = task?.chat_id || task?.chatId
    if (!chatId) throw new Error('Chat-agent task has no chat id')
    const key = sanitizeChatCacheKey(chatId)
    const lane = chatAgentLane(task)
    if (!lane) throw new Error('Chat-agent task has no resident lane')
    const assignment = chatAgentResidency.beginAssignment(entry.slotId, lane)
    const rawConversation = String(task?.payload?.conversation_url || task?.conversation_url || '').trim()
    const rawID = String(task?.conversation_id || task?.conversationId || '').trim()
    const conversationURL = canonicalChatGPTConversationURL(rawConversation) || (/^[A-Za-z0-9-]{1,128}$/.test(rawID) ? `https://chatgpt.com/c/${rawID}` : '')
    if (entry.ownerKey !== key) {
      clearTimeout(entry.affinitySettleTimer)
      entry.affinity = createChatGPTAffinityTracker()
      entry.conversationRequests.clear()
      entry.staleConversationRequestIds.clear()
      entry.conversationTransportGeneration = 0
      entry.humanAction = undefined
      entry.ownerKey = key
    }
    if (conversationURL) syncChatGPTAffinity(entry.affinity, conversationURL, false)
    touchChatGPTEntry(entry)
    return { key, conversationURL, lane, assignment }
  }

  function workerEntryForIndex(worker) {
    return chatGPTWorkerEntries.find((entry) => entry.slotId === `worker-${Math.max(1, Number(worker) || 1)}`)
  }

  /**
   * Whether this slot is mid-supervision of a response that is still being written.
   *
   * The evidence is the slot's own last settled task: an `AWAIT_RESPONSE` that
   * asked to be retried is, by construction, a supervision that has not concluded.
   * That is exactly the state in which the slot must keep its conversation, and it
   * clears itself the moment the supervision completes, fails, or the slot runs
   * anything else.
   */
  function chatAgentSupervisingLiveResponse(worker) {
    return chatAgentLiveBundlePending(chatAgentWorkerStates.get(Number(worker) || 0))
  }

  return { reconcileChatGPTWorkerPool, ensureChatGPTWorkerPool, primeChatGPTWorkerPool, assignChatGPTWorker, workerEntryForIndex, chatAgentSupervisingLiveResponse }
}
