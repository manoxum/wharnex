export function registerAgentRuntimeIPC({
  ipcMain, trustedSender, state, normalizeSupervisorSlotCount, normalizeWorkerSlotCount,
  setChatAgentSupervisorTarget, setChatAgentWorkerTarget, chatAgentKeepFlowingFloor,
  refreshChatAgentRuntimeState, publishChatAgentRuntimeState, reconcileChatAgentAutoScale,
  normalizeChatAgentPolicies, persistChatAgentPolicies, pauseChatAgentWorkers,
  resumeChatAgentWorkers,
}) {
  ipcMain.handle('wharness:agents:state', async (event) => {
    trustedSender(event)
    return refreshChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-supervisor-count', async (event, request) => {
    trustedSender(event)
    state.supervisorSlots = normalizeSupervisorSlotCount(request?.count)
    setChatAgentSupervisorTarget(state.supervisorSlots)
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-worker-count', async (event, request) => {
    const windowState = trustedSender(event)
    state.workerSlots = normalizeWorkerSlotCount(request?.count)
    setChatAgentWorkerTarget(Math.max(state.workerSlots, chatAgentKeepFlowingFloor()), windowState)
    await refreshChatAgentRuntimeState()
    if (state.policies.auto_scale === true) await reconcileChatAgentAutoScale()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-policies', async (event, request) => {
    const windowState = trustedSender(event)
    state.policies = normalizeChatAgentPolicies({ ...state.policies, ...(request || {}) })
    persistChatAgentPolicies()
    if (state.policies.auto_scale !== true) {
      setChatAgentWorkerTarget(Math.max(state.workerSlots, chatAgentKeepFlowingFloor()), windowState)
    } else {
      await reconcileChatAgentAutoScale()
    }
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-worker-keep-flowing', async (event, request) => {
    trustedSender(event)
    const agentID = String(request?.agentId || '').trim()
    if (!/^worker-[1-6]$/.test(agentID)) throw new Error('Keep flowing requires a valid Worker id')
    const selected = new Set(state.policies.keep_flowing_workers)
    if (request?.enabled === true) selected.add(agentID)
    else selected.delete(agentID)
    state.policies = normalizeChatAgentPolicies({ ...state.policies, keep_flowing_workers: [...selected] })
    persistChatAgentPolicies()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:pause-workers', async (event, request) => {
    trustedSender(event)
    return pauseChatAgentWorkers(request)
  })
  ipcMain.handle('wharness:agents:resume-workers', async (event) => {
    trustedSender(event)
    return resumeChatAgentWorkers()
  })
  ipcMain.handle('wharness:agents:pause-provider', async (event, request) => {
    trustedSender(event)
    if (!state.scheduler) throw new Error('Chat-agent scheduler is not ready')
    const rawUntil = String(request?.pausedUntil || '').trim()
    let pausedUntil = null
    if (rawUntil) {
      const deadline = Date.parse(rawUntil)
      if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('Agent resume deadline must be in the future')
      pausedUntil = new Date(deadline).toISOString()
    }
    const reason = pausedUntil
      ? 'Suspenso pelo utilizador até ' + pausedUntil
      : 'Suspenso pelo utilizador até retoma manual'
    await state.scheduler.setProviderPause(true, { pausedUntil, reason })
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:resume-provider', async (event) => {
    trustedSender(event)
    if (!state.scheduler) throw new Error('Chat-agent scheduler is not ready')
    // A manual resume must also discard the burst window, otherwise stale hits
    // immediately reclassify the next refusal as a gate.
    state.clearRateLimit()
    await state.scheduler.setProviderPause(false)
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
}
