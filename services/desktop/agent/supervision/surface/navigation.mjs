export function createSupervisorSurfaceNavigation({
  navigationState, sanitizeChatCacheKey, supervisorEntry, supervisorKey,
  chatgptViews, reconcileChatGPTThrottle, chatGPTKeyForEntry,
  sendToWindowState, currentChatGPTState, supervisorSurfaceRoute,
  reusableSupervisor, getDesiredChatAgentSupervisorSlots,
  activateChatGPTView, requireTrustedChatGPTURL, CHATGPT_URL,
  sameConversationURL, loadOwnedChatGPTURL, chatGPTSurfaceShouldBeVisible,
  flushQueuedChatGPTComments, DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
}) {
  function clearDeferredSupervisorNavigation() {
    const pending = navigationState.pending
    navigationState.pending = undefined
    clearTimeout(navigationState.timer)
    navigationState.timer = undefined
    if (pending?.windowState) pending.windowState.desiredVisibleChatGPTKey = ''
  }

  function scheduleDeferredSupervisorNavigation() {
    if (!navigationState.pending || navigationState.timer) return
    navigationState.timer = setTimeout(() => {
      navigationState.timer = undefined
      void applyDeferredSupervisorNavigation()
    }, DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS)
  }

  function setDeferredSupervisorNavigation(cacheKey, windowState, request = {}, current = supervisorEntry(windowState)) {
    const key = sanitizeChatCacheKey(cacheKey)
    clearDeferredSupervisorNavigation()
    navigationState.pending = {
      key, windowState, bounds: request?.bounds, url: String(request?.url || ''),
      resetToHomeIfConversation: request?.resetToHomeIfConversation === true, visible: request?.visible !== false && windowState?.chatgptVisible !== false,
    }
    if (windowState) windowState.desiredVisibleChatGPTKey = key
    if (current && !current.view.webContents.isDestroyed()) {
      current.view.setVisible(false)
      reconcileChatGPTThrottle(chatGPTKeyForEntry(current), current)
    }
    if (windowState) sendToWindowState(windowState, 'wharness:chatgpt:state', currentChatGPTState(key, windowState))
    scheduleDeferredSupervisorNavigation()
  }

  function differentSupervisorTransport(cacheKey) {
    const key = sanitizeChatCacheKey(cacheKey)
    return [...chatgptViews.entries()].find(([candidateKey, entry]) => (
      candidateKey !== key && Number(entry.transportPreparationCount || 0) > 0
    ))
  }

  function currentSupervisorSurfaceRoute(cacheKey, windowState, activeTransport = differentSupervisorTransport(cacheKey)) {
    const key = sanitizeChatCacheKey(cacheKey)
    const reusable = reusableSupervisor(key, windowState)
    return supervisorSurfaceRoute({
      targetKey: key,
      supervisors: [...chatgptViews.entries()].map(([candidateKey, entry]) => ({ key: candidateKey, slotId: entry.slotId })),
      capacity: getDesiredChatAgentSupervisorSlots(),
      reusableKey: reusable?.[0] || '',
      activeTransportKey: activeTransport?.[0] || '',
      activeTransportSlotId: activeTransport?.[1]?.slotId || '',
    })
  }

  function deferSupervisorNavigationIfBusy(cacheKey, windowState, request = {}) {
    const key = sanitizeChatCacheKey(cacheKey)
    // Composer mutation is a physical-renderer lease. A resident target, a free
    // slot, or a proven-releasable slot is independent and may become visible
    // immediately; only a target that needs held physical capacity is covered
    // until a slot can be assigned safely.
    const activeTransport = differentSupervisorTransport(key)
    const route = currentSupervisorSurfaceRoute(key, windowState, activeTransport)
    if (activeTransport) {
      if (route.deferred) {
        const current = supervisorEntry(windowState)
        setDeferredSupervisorNavigation(key, windowState, request, current)
        console.log(`[chatgpt-supervisor] deferred-switch from=${activeTransport[0]} to=${key} request=${activeTransport[1].transportRequestId || '-'}`)
        return true
      }
    }
    if (!route.deferred) {
      clearDeferredSupervisorNavigation()
      return false
    }
    const currentKey = supervisorKey(windowState)
    const current = currentKey ? chatgptViews.get(currentKey) : undefined
    setDeferredSupervisorNavigation(key, windowState, request, current)
    console.log(`[chatgpt-supervisor] deferred-switch from=${currentKey || '-'} to=${key} request=${current?.transportRequestId || '-'}`)
    return true
  }

  async function applyDeferredSupervisorNavigation() {
    const pending = navigationState.pending
    if (!pending) return
    const state = pending.windowState
    if (!state?.window || state.window.isDestroyed()) {
      clearDeferredSupervisorNavigation()
      return
    }
    const activeTransport = differentSupervisorTransport(pending.key)
    const route = currentSupervisorSurfaceRoute(pending.key, state, activeTransport)
    if (differentSupervisorTransport(pending.key)) {
      if (route.deferred) {
        scheduleDeferredSupervisorNavigation()
        return
      }
    }
    if (route.deferred && !chatgptViews.has(pending.key) && chatgptViews.size >= getDesiredChatAgentSupervisorSlots() && !reusableSupervisor(pending.key, state)) {
      scheduleDeferredSupervisorNavigation()
      return
    }
    clearDeferredSupervisorNavigation()
    state.chatgptVisible = pending.visible
    const entry = activateChatGPTView(pending.key, pending.bounds, state)
    const target = pending.url ? requireTrustedChatGPTURL(pending.url) : CHATGPT_URL
    const currentURL = entry.view.webContents.getURL()
    if (!sameConversationURL(currentURL, target) && currentURL !== target) {
      await loadOwnedChatGPTURL(pending.key, entry, target, 'deferred-supervisor-switch')
    }
    if (state.chatgptVisible) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, state))
    void flushQueuedChatGPTComments()
  }
  return { clearDeferredSupervisorNavigation, scheduleDeferredSupervisorNavigation, setDeferredSupervisorNavigation, differentSupervisorTransport, currentSupervisorSurfaceRoute, deferSupervisorNavigationIfBusy, applyDeferredSupervisorNavigation }
}
