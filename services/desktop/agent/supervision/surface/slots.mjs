export function createSupervisorSurfaceSlots({
  sanitizeChatCacheKey, chatgptViews, cancelExternalAuthentication,
  windowStateForEntry, desktopWindows, getDesiredChatAgentSupervisorSlots,
  supervisorBindingHeld, createChatGPTView, requireOwnedChatGPTEntry,
  touchChatGPTEntry, chatGPTEntryIsActiveVisible,
}) {
  function retireChatGPTSupervisorSurface(cacheKey) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = chatgptViews.get(key)
    if (!entry) return false
    clearTimeout(entry.authProbeTimer)
    clearTimeout(entry.affinitySettleTimer)
    cancelExternalAuthentication(key)
    chatgptViews.delete(key)
    const state = windowStateForEntry(entry)
    if (state?.activeChatGPTKey === key) {
      state.activeChatGPTKey = ''
      state.chatgptVisible = false
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    console.log(`[chatgpt-supervisor] retired key=${key}`)
    return true
  }

  function supervisorKey(windowState) {
    const active = String(windowState?.activeChatGPTKey || '')
    if (active && chatgptViews.has(active)) return active
    for (const state of desktopWindows.values()) {
      const key = String(state.activeChatGPTKey || '')
      if (key && chatgptViews.has(key)) return key
    }
    return [...chatgptViews.keys()][0] || ''
  }

  function supervisorEntry(windowState) {
    const key = supervisorKey(windowState)
    return key ? chatgptViews.get(key) : undefined
  }

  function supervisorSlotID() {
    const used = new Set([...chatgptViews.values()].map((entry) => String(entry.slotId || '')))
    for (let index = 1; index <= getDesiredChatAgentSupervisorSlots(); index += 1) {
      const id = `supervisor-${index}`
      if (!used.has(id)) return id
    }
    return 'supervisor-1'
  }

  // Which bound Supervisor may release its chat so this chat can have a slot.
  //
  // Only a Supervisor with nothing left to finish is eligible, and it is released
  // only because another chat is waiting — never on a timer. A held Supervisor is
  // mid-request: retiring its renderer would force the conversation to be loaded
  // again, and reloading conversations across a small pool is what produced the
  // sustained rate limiting this binding exists to stop.
  function reusableSupervisor(cacheKey, windowState) {
    const key = sanitizeChatCacheKey(cacheKey)
    const active = String(windowState?.activeChatGPTKey || '')
    const candidates = [...chatgptViews.entries()]
      .filter(([candidateKey, entry]) => candidateKey !== key && !supervisorBindingHeld(candidateKey, entry))
      .sort(([leftKey, left], [rightKey, right]) => {
        const leftActive = leftKey === active ? 1 : 0
        const rightActive = rightKey === active ? 1 : 0
        if (leftActive !== rightActive) return leftActive - rightActive
        return Number(left.lastUsed || 0) - Number(right.lastUsed || 0)
      })
    return candidates[0]
  }

  function ensureChatGPTView(cacheKey, windowState) {
    const key = sanitizeChatCacheKey(cacheKey)
    let entry = chatgptViews.get(key)
    if (!entry) {
      const resolved = windowState || [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
      if (chatgptViews.size >= getDesiredChatAgentSupervisorSlots()) {
        const reusable = reusableSupervisor(key, resolved)
        if (!reusable) throw new Error('Todos os slots de Supervisor estão vinculados a pedidos em curso')
        const preserveVisibleIntent = resolved?.chatgptVisible === true
        retireChatGPTSupervisorSurface(reusable[0])
        if (preserveVisibleIntent && resolved) resolved.chatgptVisible = true
      }
      entry = createChatGPTView(key, resolved)
      entry.role = 'supervisor'
      entry.slotId = supervisorSlotID()
    }
    if (windowState && entry.ownerWindowId !== windowState.id) {
      const previousState = windowStateForEntry(entry)
      try { previousState?.window?.contentView?.removeChildView?.(entry.view) } catch { /* already detached */ }
      windowState.window.contentView.addChildView(entry.view)
      if (previousState?.activeChatGPTKey === key) { previousState.activeChatGPTKey = ''; previousState.chatgptVisible = false }
      entry.ownerWindowId = windowState.id
    }
    requireOwnedChatGPTEntry(key, entry)
    touchChatGPTEntry(entry)
    return { key, entry }
  }

  // One Supervisor slot per chat, up to getDesiredChatAgentSupervisorSlots() chats resident at once.
  // Exactly one is visible; the rest stay bound to their own conversation so that
  // switching chats is a visibility change rather than a provider navigation. The
  // bounded autonomous Worker pool lives outside chatgptViews.

  // Retire only as many unheld Supervisors as the cap actually requires, oldest
  // first. A held Supervisor is never retired here: if every slot is busy the
  // newest chat waits for one to finish rather than interrupting a live request.
  function evictIdleChatGPTViews() {
    const excess = chatgptViews.size - getDesiredChatAgentSupervisorSlots()
    if (excess <= 0) return 0
    const releasable = [...chatgptViews.entries()]
      .filter(([key, entry]) => !supervisorBindingHeld(key, entry) && !chatGPTEntryIsActiveVisible(key, entry))
      .sort(([, left], [, right]) => Number(left.lastUsed || 0) - Number(right.lastUsed || 0))
    let released = 0
    for (const [key] of releasable) {
      if (released >= excess) break
      if (retireChatGPTSupervisorSurface(key)) released += 1
    }
    return released
  }
  return { retireChatGPTSupervisorSurface, supervisorKey, supervisorEntry, supervisorSlotID, reusableSupervisor, ensureChatGPTView, evictIdleChatGPTViews }
}
