import { dispatchMirrorInput } from '../../chatgpt/session/mirror/input.mjs'

export function registerAgentSurfaceIPC({
  ipcMain, trustedSender, chatAgentBrowserSnapshot, workerEntryForAgentID,
  hideChatAgentInteractionEntry, openWorkerMonitor, BrowserWindow,
  publishChatAgentRuntimeState, closeWorkerMonitor, showChatAgentInteraction,
  setChatAgentInteractionBounds, closeChatAgentInteraction,
  presentBrowserInMonitor, resizeBrowserInMonitor, releaseBrowserMonitor,
}) {
  ipcMain.handle('wharness:agents:snapshot', async (event, request) => {
    trustedSender(event)
    return chatAgentBrowserSnapshot(request?.agentId)
  })
  ipcMain.handle('wharness:agents:monitor-open', (event, request) => {
    trustedSender(event)
    const entry = workerEntryForAgentID(request?.agentId)
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
  ipcMain.handle('wharness:agents:monitor-present', (event, request) =>
    presentBrowserInMonitor(request?.agentId, request?.bounds, trustedSender(event)))
  ipcMain.handle('wharness:agents:monitor-bounds', (event, request) =>
    resizeBrowserInMonitor(request?.agentId, request?.bounds, trustedSender(event)))
  ipcMain.handle('wharness:agents:monitor-release', (event, request) =>
    releaseBrowserMonitor(trustedSender(event), String(request?.agentId || '')))
  // The user's own input on the mirror of a Worker this window surfaced.
  ipcMain.handle('wharness:agents:mirror-input', (event, request) => {
    const windowState = trustedSender(event)
    const entry = workerEntryForAgentID(request?.agentId)
    if (entry.interactionWindowId !== windowState.id || windowState.activeAgentInteractionId !== entry.slotId) return { ok: false }
    return dispatchMirrorInput(entry, request?.input)
  })
}
