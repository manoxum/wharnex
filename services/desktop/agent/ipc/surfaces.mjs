export function registerAgentSurfaceIPC({
  ipcMain, trustedSender, chatAgentBrowserSnapshot, workerEntryForAgentID,
  hideChatAgentInteractionEntry, openWorkerMonitor, BrowserWindow,
  publishChatAgentRuntimeState, closeWorkerMonitor, showChatAgentInteraction,
  setChatAgentInteractionBounds, closeChatAgentInteraction,
}) {
  ipcMain.handle('wharness:agents:snapshot', async (event, request) => {
    trustedSender(event)
    return chatAgentBrowserSnapshot(request?.agentId)
  })
  ipcMain.handle('wharness:agents:monitor-open', (event, request) => {
    trustedSender(event)
    const entry = workerEntryForAgentID(request?.agentId)
    if (entry.interactionWindowId) hideChatAgentInteractionEntry(entry)
    const result = openWorkerMonitor(entry, BrowserWindow, publishChatAgentRuntimeState)
    publishChatAgentRuntimeState()
    return result
  })
  ipcMain.handle('wharness:agents:monitor-close', (event, request) => {
    trustedSender(event)
    return closeWorkerMonitor(workerEntryForAgentID(request?.agentId))
  })
  ipcMain.handle('wharness:agents:open-devtools', (event, request) => {
    trustedSender(event)
    const entry = workerEntryForAgentID(request?.agentId)
    entry.view.webContents.openDevTools({ mode: 'detach', activate: true })
    return { ok: true, agentId: entry.slotId }
  })
  ipcMain.handle('wharness:agents:interaction-open', async (event, request) =>
    showChatAgentInteraction(request?.agentId, request?.bounds, trustedSender(event)))
  ipcMain.handle('wharness:agents:interaction-bounds', async (event, request) =>
    setChatAgentInteractionBounds(request?.agentId, request?.bounds, trustedSender(event)))
  ipcMain.handle('wharness:agents:interaction-close', async (event, request) =>
    closeChatAgentInteraction(request?.agentId, trustedSender(event)))
}
