export function registerAgentDomainIPC(common, context) {
  const { ipcMain, trustedSender } = common
  const {
    registerAgentIPC, normalizeSupervisorSlotCount, normalizeWorkerSlotCount, setChatAgentSupervisorTarget,
    setChatAgentWorkerTarget, chatAgentKeepFlowingFloor, refreshChatAgentRuntimeState, publishChatAgentRuntimeState,
    reconcileChatAgentAutoScale, normalizeChatAgentPolicies, persistChatAgentPolicies, pauseChatAgentWorkers,
    resumeChatAgentWorkers, chatAgentBrowserSnapshot, workerEntryForAgentID, hideChatAgentInteractionEntry,
    openWorkerMonitor, BrowserWindow, closeWorkerMonitor, showChatAgentInteraction,
    setChatAgentInteractionBounds, closeChatAgentInteraction, state,
    presentBrowserInMonitor, resizeBrowserInMonitor, releaseBrowserMonitor,
  } = context
  registerAgentIPC({
    ipcMain, trustedSender,
    state,
    normalizeSupervisorSlotCount, normalizeWorkerSlotCount,
    setChatAgentSupervisorTarget, setChatAgentWorkerTarget,
    chatAgentKeepFlowingFloor, refreshChatAgentRuntimeState,
    publishChatAgentRuntimeState, reconcileChatAgentAutoScale,
    normalizeChatAgentPolicies, persistChatAgentPolicies,
    pauseChatAgentWorkers, resumeChatAgentWorkers,
    chatAgentBrowserSnapshot, workerEntryForAgentID,
    hideChatAgentInteractionEntry, openWorkerMonitor, BrowserWindow,
    closeWorkerMonitor, showChatAgentInteraction,
    setChatAgentInteractionBounds, closeChatAgentInteraction,
    presentBrowserInMonitor, resizeBrowserInMonitor, releaseBrowserMonitor,
  })
}
