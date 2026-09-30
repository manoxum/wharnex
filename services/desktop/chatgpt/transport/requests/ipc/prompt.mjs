export function registerChatGPTPromptIPC({
  ipcMain, trustedSender, withChatGPTSupervisorTransport,
  submitPromptToChatGPT, queuePreparedPromptForWorker,
  preparePromptForChatGPT, retryPreparedChatGPTPrompt,
  attachContextToChatGPT, attachPromptToChatGPT,
  sanitizeChatCacheKey, preparedChatGPTDrafts,
  submitPreparedChatGPTDraft, queueChatGPTComment,
  cancelChatGPTRequestState,
}) {
  ipcMain.handle('wharness:chatgpt:submit-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (key, entry) => submitPromptToChatGPT(key, request?.text, request?.url, request?.requestId, request?.sessionId, entry))
  })
  ipcMain.handle('wharness:chatgpt:prepare-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    if (request?.background === true) return queuePreparedPromptForWorker(request)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (_key, entry) => preparePromptForChatGPT(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:retry-prepared-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.expectedRequestId, (_key, entry) => retryPreparedChatGPTPrompt(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:attach-context', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (_key, entry) => attachContextToChatGPT(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:attach-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (_key, entry) => attachPromptToChatGPT(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:submit-prepared', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    return withChatGPTSupervisorTransport(key, windowState, preparedChatGPTDrafts.get(key)?.requestId, (_key, entry) => submitPreparedChatGPTDraft(key, entry))
  })
  ipcMain.handle('wharness:chatgpt:queue-comment', async (event, request) => {
    trustedSender(event)
    return queueChatGPTComment(request)
  })
  ipcMain.handle('wharness:chatgpt:cancel-request', async (event, request) => {
    trustedSender(event)
    return cancelChatGPTRequestState(request?.cacheKey, request?.requestId)
  })
}
