export function createSupervisorPool({
  desktopWindows, chatgptViews, touchChatGPTEntry,
  desiredSupervisorSlots, reusableSupervisor, chatGPTEntryIsActiveVisible,
  ensureChatGPTView, chatSupervisorStates, chatAgentLane,
  sanitizeOptionalChatCacheKey, supervisorBindingHeld,
  chatAgentTaskPayload, sanitizeChatCacheKey, chatAgentConversationURL,
  CHAT_SUPERVISOR_SLOT_WAIT_MS, sameConversationURL, loadOwnedChatGPTURL,
  waitForChatGPTSurfaceReady, isTrustedChatGPTOrigin, CHATGPT_URL,
  superviseChatAgentResponse, executeChatAgentWrite,
}) {
  function chatSupervisorHostWindow() {
    const live = [...desktopWindows.values()].filter((state) => state.window && !state.window.isDestroyed())
    return live.find((state) => !state.transientSurface) || live[0]
  }

  // Keep an assigned conversation resident; reclaim only an unheld, hidden slot.
  function bindChatSupervisor(key) {
    const existing = chatgptViews.get(key)
    if (existing && !existing.view.webContents.isDestroyed()) {
      touchChatGPTEntry(existing)
      return existing
    }
    if (!chatSupervisorHostWindow()) return undefined
    if (chatgptViews.size >= desiredSupervisorSlots()) {
      const reusable = reusableSupervisor(key)
      if (!reusable || chatGPTEntryIsActiveVisible(reusable[0], reusable[1])) {
        throw new Error('Todos os slots de Supervisor estão vinculados a pedidos em curso')
      }
    }
    return ensureChatGPTView(key, undefined).entry
  }

  function noteChatSupervisorLane(index, task) {
    const runtime = chatSupervisorStates.get(index) || {}
    chatSupervisorStates.set(index, {
      ...runtime,
      lane: chatAgentLane(task) || runtime.lane || '',
      key: sanitizeOptionalChatCacheKey(task?.chat_id) || runtime.key || '',
    })
  }

  function chatSupervisorLanesHeldByOthers(index) {
    const lanes = new Set()
    for (const [slot, runtime] of chatSupervisorStates) {
      if (slot === index) continue
      const lane = String(runtime?.lane || '')
      const key = sanitizeOptionalChatCacheKey(runtime?.key)
      if (!lane) continue
      if (runtime?.task || (key && supervisorBindingHeld(key, chatgptViews.get(key)))) lanes.add(lane)
    }
    return lanes
  }

  async function executeChatSupervisorTask(task, { worker, owner }) {
    const index = Math.max(1, Number(worker) || 1)
    const payload = chatAgentTaskPayload(task)
    const key = sanitizeChatCacheKey(task?.chat_id || task?.chatId)
    if (!key) return { status: 'failed', error: 'Supervisor task has no chat binding' }
    const conversationURL = chatAgentConversationURL(task, payload)
    noteChatSupervisorLane(index, task)
    let entry
    try {
      entry = bindChatSupervisor(key)
    } catch (error) {
      return {
        status: 'waiting', delayMs: CHAT_SUPERVISOR_SLOT_WAIT_MS, observation: true,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (!entry) {
      return { status: 'waiting', delayMs: CHAT_SUPERVISOR_SLOT_WAIT_MS, observation: true, error: 'nenhuma janela do Wharnex aloja supervisores neste momento' }
    }
    const reason = `chat-supervisor-${String(task.type || '').toLowerCase()}`
    const current = entry.view.webContents.getURL()
    // A bound Supervisor normally submits and observes without navigation.
    if (conversationURL && !sameConversationURL(current, conversationURL)) {
      await loadOwnedChatGPTURL(key, entry, conversationURL, reason)
      await waitForChatGPTSurfaceReady(key, entry)
    } else if (!conversationURL && !isTrustedChatGPTOrigin(current)) {
      await loadOwnedChatGPTURL(key, entry, CHATGPT_URL, `${reason}-bootstrap`)
      await waitForChatGPTSurfaceReady(key, entry)
    }
    switch (task.type) {
      case 'AWAIT_RESPONSE': return superviseChatAgentResponse(task, entry, key, payload)
      case 'BOT_WRITE':
      case 'RECOVERY_WRITE': return executeChatAgentWrite(task, entry, key, payload, conversationURL, { pacedWorker: false })
      default: return { status: 'failed', error: `O pool de Supervisores não executa ${task.type}` }
    }
  }

  return { chatSupervisorHostWindow, bindChatSupervisor, noteChatSupervisorLane, chatSupervisorLanesHeldByOthers, executeChatSupervisorTask }
}
