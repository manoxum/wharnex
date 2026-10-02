export function createChatGPTThrottle({
  expectedChatGPTBundles, expectedChatGPTTranslations,
  expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications, expectedChatGPTUITestDiscoveries = new Map(),
  expectedChatGPTOrchestratorPlans, chatgptViews, pendingChatGPTComments,
  windowStateForEntry,
}) {
  function chatGPTArtifactExpectationArmed(key) {
    if (expectedChatGPTBundles.has(key)) return true
    for (const map of [expectedChatGPTTranslations, expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications, expectedChatGPTUITestDiscoveries, expectedChatGPTOrchestratorPlans]) {
      for (const expected of map.values()) if (expected?.key === key) return true
    }
    return false
  }

  // Arming or disarming an expectation changes the answer above, so the owning
  // renderer's throttle has to be reconciled at both edges - the predicate alone
  // only takes effect the next time something else happens to reconcile.
  function reconcileChatGPTThrottleForKey(key, entry) {
    // A Worker entry lives in the pool, never in `chatgptViews`, so resolving
    // through that map alone would silently skip exactly the pool that runs the
    // utility artifacts. The caller's own owned entry is the authority; the map
    // lookup only covers callers that hold none.
    const owned = entry || chatgptViews.get(key)
    if (owned) reconcileChatGPTThrottle(key, owned)
  }

  function chatGPTEntryNeedsSupervision(key, entry) {
    // An armed expected bundle keeps its Supervisor at full speed whether or not
    // that slot happens to be the visible one. A hidden Supervisor is the normal
    // case now: it stays bound to its chat for the whole request so the response
    // is collected without ever re-navigating the conversation.
    //
    // The same is required of the utility artifacts — TODO classification,
    // markdown translation, orchestrator plan — and used not to be, because this
    // predicate only knew about `expectedChatGPTBundles`. Those three run on a
    // hidden Worker with no transport preparation held across the response wait,
    // so Chromium background-throttled the very renderer that had to stream the
    // answer and reveal its download control. Live evidence: a TODO
    // classification whose assistant turn stayed frozen mid-stream at two
    // characters, still carrying `streaming-animation`, for 81 consecutive polls
    // until the task's four-minute timeout expired and burned an attempt.
    return Boolean(entry.loading || entry.humanAction?.active || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.conversationRequests.size > 0 || pendingChatGPTComments.has(key) || chatGPTArtifactExpectationArmed(key))
  }

  function chatGPTEntryIsActiveVisible(key, entry) {
    const windowState = windowStateForEntry(entry)
    return Boolean(windowState && windowState.activeChatGPTKey === key && windowState.chatgptVisible)
  }

  function reconcileChatGPTThrottle(key, entry) {
    const wc = entry?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    const fullSpeed = chatGPTEntryIsActiveVisible(key, entry) || chatGPTEntryNeedsSupervision(key, entry)
    if (entry.backgroundThrottled === !fullSpeed) return
    // setBackgroundThrottling's `allowed` parameter is "is throttling allowed",
    // the inverse of "stay full speed" — false keeps this view at full speed.
    wc.setBackgroundThrottling(!fullSpeed)
    entry.backgroundThrottled = !fullSpeed
  }
  return { chatGPTArtifactExpectationArmed, reconcileChatGPTThrottleForKey, chatGPTEntryNeedsSupervision, chatGPTEntryIsActiveVisible, reconcileChatGPTThrottle }
}
