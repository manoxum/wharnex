// Background account lifecycle work belongs to durable workers. These handlers
// never create a Supervisor view merely to archive, rename, or delete a chat.
export function registerChatGPTLifecycleIPC({
  ipcMain, trustedSender, enqueueChatAgentLifecycleTask,
  ensureChatGPTView, requireOwnedChatGPTEntry,
  stopChatGPTConversation, publishChatGPTAccountAction,
  suggestChatGPTConversationTitle, hideChatGPTSidebar,
}) {
  for (const [channel, taskType] of [
    ['queue-archive', 'ARCHIVE_CHAT'],
    ['queue-rename', 'RENAME_CHAT'],
    ['queue-delete', 'DELETE_CHAT'],
  ]) {
    ipcMain.handle(`wharness:chatgpt:${channel}`, async (event, request) => {
      trustedSender(event)
      return enqueueChatAgentLifecycleTask(taskType, request)
    })
  }
  ipcMain.handle('wharness:chatgpt:stop-conversation', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    const result = await stopChatGPTConversation(key)
    publishChatGPTAccountAction(key, 'stop', result)
    return result
  })
  ipcMain.handle('wharness:chatgpt:suggest-title', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    return suggestChatGPTConversationTitle(key, request?.url || '')
  })
  ipcMain.handle('wharness:chatgpt:hide-sidebar', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    return hideChatGPTSidebar(key, entry)
  })
}
