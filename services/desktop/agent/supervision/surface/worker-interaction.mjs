export function createWorkerInteraction({
  chatGPTWorkerEntries, isEphemeralAgentID, desktopWindows,
  grantChatGPTLayoutViewport, publishChatAgentRuntimeState,
  normalizeBounds, reconcileChatGPTWorkerPool,
}) {
  function workerEntryForAgentID(agentID) {
    const id = String(agentID || '').trim()
    if (!/^worker-[1-9][0-9]?$/.test(id) && !isEphemeralAgentID(id)) throw new Error('Only Worker browser instances can enter interaction mode')
    const entry = chatGPTWorkerEntries.find((candidate) => candidate.slotId === id)
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error('Worker browser instance is not available')
    return entry
  }

  function hideChatAgentInteractionEntry(entry) {
    if (!entry || entry.role !== 'worker') return false
    const state = desktopWindows.get(entry.interactionWindowId)
    if (state?.activeAgentInteractionId === entry.slotId) state.activeAgentInteractionId = ''
    const surfaced = Boolean(entry.interactionWindowId)
    entry.interactionWindowId = ''
    entry.parkedLayout = true
    try {
      entry.view.setVisible(false)
      // Back to the automation viewport the pane had replaced.
      if (surfaced && !entry.view.webContents.isDestroyed()) grantChatGPTLayoutViewport(entry.view)
    } catch { /* renderer may already be gone */ }
    return true
  }

  function hideChatAgentInteractionsForWindow(windowState) {
    let changed = false
    for (const entry of chatGPTWorkerEntries) {
      if (entry.interactionWindowId !== windowState?.id) continue
      changed = hideChatAgentInteractionEntry(entry) || changed
    }
    if (windowState) windowState.activeAgentInteractionId = ''
    if (changed) publishChatAgentRuntimeState()
    return changed
  }

  function showChatAgentInteraction(agentID, rawBounds, windowState) {
    const entry = workerEntryForAgentID(agentID)
    const bounds = normalizeBounds(rawBounds, windowState?.window?.getContentBounds?.())
    if (!bounds) throw new Error('Worker interaction bounds are invalid')
    const active = String(windowState.activeAgentInteractionId || '')
    if (active && active !== entry.slotId) {
      const previous = chatGPTWorkerEntries.find((candidate) => candidate.slotId === active)
      hideChatAgentInteractionEntry(previous)
    }
    if (entry.interactionWindowId && entry.interactionWindowId !== windowState.id) {
      const previousState = desktopWindows.get(entry.interactionWindowId)
      if (previousState?.activeAgentInteractionId === entry.slotId) previousState.activeAgentInteractionId = ''
    }
    // The real view stays in the browser monitor; this window mirrors it.
    entry.ownerWindowId = windowState.id
    entry.interactionWindowId = windowState.id
    windowState.activeAgentInteractionId = entry.slotId
    entry.view.setBounds(bounds)
    entry.parkedLayout = false
    entry.view.setVisible(true)
    entry.layoutViewportGranted = true
    publishChatAgentRuntimeState()
    return { ok: true, agentId: entry.slotId, bounds }
  }

  function setChatAgentInteractionBounds(agentID, rawBounds, windowState) {
    const entry = workerEntryForAgentID(agentID)
    const windowID = String(windowState?.id || '')
    if (!windowID
      || entry.interactionWindowId !== windowID
      || entry.ownerWindowId !== windowID
      || windowState.activeAgentInteractionId !== entry.slotId) {
      return { ok: false, agentId: entry.slotId }
    }
    const bounds = normalizeBounds(rawBounds, windowState.window.getContentBounds())
    if (!bounds) throw new Error('Worker interaction bounds are invalid')
    entry.view.setBounds(bounds)
    entry.parkedLayout = false
    return { ok: true, agentId: entry.slotId, bounds }
  }

  function closeChatAgentInteraction(agentID, windowState) {
    const entry = workerEntryForAgentID(agentID)
    if (entry.interactionWindowId !== windowState?.id) return { ok: true, agentId: entry.slotId, closed: false }
    hideChatAgentInteractionEntry(entry)
    reconcileChatGPTWorkerPool(windowState)
    publishChatAgentRuntimeState()
    return { ok: true, agentId: entry.slotId, closed: true }
  }

  return {
    workerEntryForAgentID, hideChatAgentInteractionEntry,
    hideChatAgentInteractionsForWindow, showChatAgentInteraction,
    setChatAgentInteractionBounds, closeChatAgentInteraction,
  }
}
