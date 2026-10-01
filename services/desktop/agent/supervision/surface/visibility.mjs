export function createSupervisorSurfaceVisibility({
  chatgptViews, sanitizeChatCacheKey, windowStateForEntry,
  ensureChatGPTView, activeChatGPTEntry, reconcileChatGPTThrottle,
  setChatGPTBounds, touchChatGPTEntry, evictIdleChatGPTViews,
  publishChatGPTState,
}) {
  // A parked view still carries the full-size layout bounds account automation
  // gave it. Showing it before the renderer reports the real pane geometry would
  // cover the whole Wharnex window for a frame, which reads exactly like the
  // project closing and reopening. Every path that makes an owned surface visible
  // shares this predicate, so a parked view cannot slip through one of them.
  function chatGPTSurfaceShouldBeVisible(entry, ownerState) {
    if (!entry || !ownerState) return false
    const parked = entry.parkedLayout === true && !ownerState.chatgptBounds
    return Boolean(ownerState.chatgptVisible) && !entry.externalAuthProvider && !parked
  }

  function activateChatGPTView(cacheKey, bounds, windowState) {
    const resolved = windowState || windowStateForEntry(chatgptViews.get(sanitizeChatCacheKey(cacheKey)))
    const { key, entry } = ensureChatGPTView(cacheKey, resolved)
    const ownerState = windowStateForEntry(entry)
    if (!ownerState) throw new Error('ChatGPT owner window is unavailable')
    const previousKey = ownerState.activeChatGPTKey
    const previous = activeChatGPTEntry(ownerState)
    if (previous && previous !== entry) { previous.view.setVisible(false); reconcileChatGPTThrottle(previousKey, previous) }
    ownerState.activeChatGPTKey = key
    if (bounds) setChatGPTBounds(bounds, ownerState)
    else if (ownerState.chatgptBounds) entry.view.setBounds(ownerState.chatgptBounds)
    entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, ownerState))
    reconcileChatGPTThrottle(key, entry)
    touchChatGPTEntry(entry)
    // Bound resident surfaces right after the newest one is established, so the
    // cap is enforced at the only moment the count can grow.
    evictIdleChatGPTViews(ownerState)
    publishChatGPTState(key)
    return entry
  }
  return { chatGPTSurfaceShouldBeVisible, activateChatGPTView }
}
