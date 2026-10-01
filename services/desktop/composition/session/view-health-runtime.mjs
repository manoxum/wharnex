import {
  createChatGPTViewCleanup, createChatGPTNetworkActivity,
  createChatGPTViewOwnership, createChatGPTViewState,
  createChatGPTAffinityRuntime, createChatGPTHumanAttention,
  createChatGPTRateLimit, createChatGPTHTTPHealth,
} from '../../chatgpt/session/index.mjs'

export function createDesktopChatViewHealthRuntime(d) {
  const {
    closeInternalChatGPTBrowserForWindow, closeAllInternalChatGPTBrowsers,
    rehomeChatGPTWorkers, closeChatGPTViewsForWindow, closeAllChatGPTViews,
  } = createChatGPTViewCleanup({
    internalChatGPTBrowsers: d.internalChatGPTBrowsers,
    chatGPTAuthBrowsers: d.chatGPTAuthBrowsers,
    chatgptViews: d.chatgptViews, chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    desktopWindows: d.desktopWindows,
    hideChatAgentInteractionsForWindow: d.hideChatAgentInteractionsForWindow,
    grantChatGPTLayoutViewport: d.grantChatGPTLayoutViewport,
    retireChatGPTSupervisorSurface: d.retireChatGPTSupervisorSurface,
    closeManagedBrowserAuth: d.closeManagedBrowserAuth,
  })

  const {
    chatGPTEntryForWebContentsID, noteChatGPTNetworkActivity,
    noteChatGPTNetworkFailure,
  } = createChatGPTNetworkActivity({
    chatgptViews: d.chatgptViews, chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
    isChatGPTConversationTransportURL: d.isChatGPTConversationTransportURL,
    recordChatGPTConversationTransport: d.recordChatGPTConversationTransport,
    noteChatGPTRecoveryProgress: d.noteChatGPTRecoveryProgress,
    isRecoverableChatGPTNetworkError: d.isRecoverableChatGPTNetworkError,
    noteChatGPTRecoveryFault: d.noteChatGPTRecoveryFault,
  })

  const { requireOwnedChatGPTEntry, releaseChatGPTView } = createChatGPTViewOwnership({
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    chatgptViews: d.chatgptViews, chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    supervisorBindingHeld: d.supervisorBindingHeld,
    sendToChatGPTKey: d.sendToChatGPTKey,
    cancelExternalAuthentication: d.cancelExternalAuthentication,
    preparedChatGPTDrafts: d.preparedChatGPTDrafts,
    retryableChatGPTPrompts: d.retryableChatGPTPrompts,
    pendingChatGPTComments: d.pendingChatGPTComments,
    flushingChatGPTComments: d.flushingChatGPTComments,
    chatGPTActivityFingerprints: d.chatGPTActivityFingerprints,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
    chatGPTTransportTails: d.chatGPTTransportTails,
    manualChatGPTTransport: d.manualChatGPTTransport,
    windowStateForEntry: d.windowStateForEntry,
  })

  const { setChatGPTBounds, currentChatGPTState, publishChatGPTState } = createChatGPTViewState({
    chatgptViews: d.chatgptViews, desktopWindows: d.desktopWindows,
    chatGPTAuthBrowsers: d.chatGPTAuthBrowsers,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey, normalizeBounds: d.normalizeBounds,
    activeChatGPTEntry: d.activeChatGPTEntry,
    getDeferredSupervisorNavigation: d.getDeferredSupervisorNavigation,
    publicSupervisorId: d.publicSupervisorId,
    manualChatGPTTransport: d.manualChatGPTTransport,
    publicChatGPTAffinity: d.publicChatGPTAffinity,
    windowStateForEntry: d.windowStateForEntry,
    sendToWindowState: d.sendToWindowState, homeURL: d.CHATGPT_URL,
  })

  const {
    observeChatGPTAffinityURL, syncChatGPTAffinityURL,
    proposeCurrentChatGPTAffinity, settleChatGPTAffinityAfterSubmit,
    scheduleChatGPTAffinitySettlement,
  } = createChatGPTAffinityRuntime({
    requireTrustedChatGPTURL: d.requireTrustedChatGPTURL,
    observeChatGPTAffinity: d.observeChatGPTAffinity,
    canonicalChatGPTConversationURL: d.canonicalChatGPTConversationURL,
    syncChatGPTAffinity: d.syncChatGPTAffinity, homeURL: d.CHATGPT_URL,
    sanitizeDiagnosticURL: d.sanitizeDiagnosticURL,
    proposeChatGPTAffinity: d.proposeChatGPTAffinity,
    publishChatGPTState, settleChatGPTAffinity: d.settleChatGPTAffinity,
    isChatGPTAffinityAwaitingSettlement: d.isChatGPTAffinityAwaitingSettlement,
    chatGPTKeyForEntry: d.chatGPTKeyForEntry,
    waitForConcreteChatGPTConversation: d.waitForConcreteChatGPTConversation,
  })

  function noteChatGPTRendererFault(cacheKey, reason) {
    const expected = d.expectedChatGPTBundles.get(cacheKey)
    if (!expected?.recovery) return false
    d.noteChatGPTRecoveryFault(expected.recovery, reason, Date.now())
    console.warn(`[chatgpt-recovery] renderer-fault key=${cacheKey} request=${expected.requestId} error=${reason}`)
    return true
  }

  const {
    chatGPTHumanActionMessage, setChatGPTHumanAction, clearChatGPTHumanAction,
  } = createChatGPTHumanAttention({
    chatgptViews: d.chatgptViews, expectedChatGPTBundles: d.expectedChatGPTBundles,
    retryableChatGPTPrompts: d.retryableChatGPTPrompts,
    windowStateForEntry: d.windowStateForEntry,
    sendToChatGPTKey: d.sendToChatGPTKey, sendToWindowState: d.sendToWindowState,
    Notification: d.Notification, recordChatGPTTaskEvent: d.recordChatGPTTaskEvent,
  })

  const { applyChatGPTRateLimit, noteChatGPTRateLimitGate } = createChatGPTRateLimit({
    state: d.rateState, classifyChatGPTRateLimit: d.classifyChatGPTRateLimit,
    RATE_LIMIT_GATE: d.RATE_LIMIT_GATE,
    CHATGPT_RATE_LIMIT_BACKOFF_MS: d.CHATGPT_RATE_LIMIT_BACKOFF_MS,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
    noteChatGPTRecoveryProgress: d.noteChatGPTRecoveryProgress,
    publishChatAgentRuntimeState: d.publishChatAgentRuntimeState,
    sendToChatGPTKey: d.sendToChatGPTKey,
  })

  const {
    chatGPTInterpreterDownloadConversation, noteChatGPTExpiredArtifact,
    chatGPTArtifactExpiredSince, noteChatGPTHTTPStatus,
  } = createChatGPTHTTPHealth({
    chatGPTExpiredArtifactConversations: d.chatGPTExpiredArtifactConversations,
    EXPIRED_ARTIFACT_TTL_MS: d.EXPIRED_ARTIFACT_TTL_MS,
    chatGPTEntryForWebContentsID, isChatGPTConversationTransportURL: d.isChatGPTConversationTransportURL,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
    setChatGPTHumanAction, clearChatGPTHumanAction,
    noteChatGPTRecoveryFault: d.noteChatGPTRecoveryFault,
    getRateLimitUntil: d.getRateLimitUntil,
  })

  return {
    closeInternalChatGPTBrowserForWindow, closeAllInternalChatGPTBrowsers,
    rehomeChatGPTWorkers, closeChatGPTViewsForWindow, closeAllChatGPTViews,
    chatGPTEntryForWebContentsID, noteChatGPTNetworkActivity,
    noteChatGPTNetworkFailure, requireOwnedChatGPTEntry, releaseChatGPTView,
    setChatGPTBounds, currentChatGPTState, publishChatGPTState,
    observeChatGPTAffinityURL, syncChatGPTAffinityURL,
    proposeCurrentChatGPTAffinity, settleChatGPTAffinityAfterSubmit,
    scheduleChatGPTAffinitySettlement, noteChatGPTRendererFault,
    chatGPTHumanActionMessage, setChatGPTHumanAction, clearChatGPTHumanAction,
    applyChatGPTRateLimit, noteChatGPTRateLimitGate,
    chatGPTInterpreterDownloadConversation, noteChatGPTExpiredArtifact,
    chatGPTArtifactExpiredSince, noteChatGPTHTTPStatus,
  }
}
