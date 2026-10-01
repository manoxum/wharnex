export function createChatAgentRuntimeControls({
  getRuntimeState, desktopWindows, sendToWindowState, refreshDesktopTray,
  broadcastDelayMs, state, normalizeChatAgentPolicies, persistChatAgentPolicies,
}) {
  let broadcastTimer
  let broadcastPending = false
  let latestState

  function publishChatAgentRuntimeState() {
    const current = getRuntimeState()
    latestState = current
    if (!broadcastTimer) {
      for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', current)
      refreshDesktopTray()
      broadcastTimer = setTimeout(() => {
        broadcastTimer = undefined
        if (!broadcastPending) return
        broadcastPending = false
        for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', latestState)
        refreshDesktopTray()
      }, broadcastDelayMs)
    } else {
      broadcastPending = true
    }
    return current
  }

  function pauseChatAgentWorkers(request = {}) {
    const rawUntil = String(request?.pausedUntil || '').trim()
    let pausedUntil = ''
    if (rawUntil) {
      const deadline = Date.parse(rawUntil)
      if (!Number.isFinite(deadline)) throw new Error('Worker suspension deadline is invalid')
      if (deadline <= Date.now()) throw new Error('Worker suspension deadline must be in the future')
      pausedUntil = new Date(deadline).toISOString()
    }
    state.policies = normalizeChatAgentPolicies({
      ...state.policies,
      workers_suspended: true,
      workers_suspended_until: pausedUntil,
      workers_suspended_types: Array.isArray(request?.taskTypes) ? request.taskTypes : [],
    })
    persistChatAgentPolicies()
    state.scheduler?.wake()
    return publishChatAgentRuntimeState()
  }

  function resumeChatAgentWorkers() {
    state.policies = normalizeChatAgentPolicies({
      ...state.policies, workers_suspended: false, workers_suspended_until: '', workers_suspended_types: [],
    })
    persistChatAgentPolicies()
    state.scheduler?.wake()
    return publishChatAgentRuntimeState()
  }

  return { publishChatAgentRuntimeState, pauseChatAgentWorkers, resumeChatAgentWorkers }
}
