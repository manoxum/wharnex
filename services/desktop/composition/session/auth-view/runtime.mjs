import {
  createChatGPTAuthentication, createEmbeddedChatGPTAuthentication,
  createChatGPTViewOperations,
} from '../../../chatgpt/session/index.mjs'

export function createDesktopAuthViewRuntime(deps) {
  const {
    chatgptViews, chatGPTAuthBrowsers, chatGPTKeyForEntry, windowStateForEntry, sendToWindowState, publishChatGPTState,
    sanitizeDiagnosticURL, CHATGPT_LOGIN_URL, CHATGPT_URL, managedAuthProfilePath, closeManagedBrowserAuth, launchManagedBrowserAuth,
    electronCookieDetails, session, CHATGPT_PARTITION, isTrustedChatGPTOrigin, isChatGPTAuthURL, chatGPTNavigationDisposition,
    shell, chatGPTSessionProbeExpression, sanitizeChatCacheKey, requireTrustedChatGPTURL, requireOwnedChatGPTEntry, sameConversationURL,
    currentChatGPTState, chatAgentWorkerActivity, withChatGPTNavigationDeadline, CHATGPT_USER_AGENT, wait, WebContentsView,
    securePreferences, createChatGPTAffinityTracker, touchChatGPTEntry, observeChatGPTAffinityURL, scheduleChatGPTAffinitySettlement, expectedChatGPTBundles,
    chatgptTransportModes, isRecoverableChatGPTNetworkError, noteChatGPTRendererFault, noteChatGPTRecoveryProgress, clearChatGPTHumanAction, chatGPTWorkerEntries,
    chatAgentResidency, publishChatAgentRuntimeState, closeWorkerMonitor, classifyChatGPTConversationTransport, reconcileChatGPTConversationTransport,
  } = deps

  const {
    publishAuthComplete, cancelExternalAuthentication,
    startExternalAuthentication, routeChatGPTNavigation,
  } = createChatGPTAuthentication({
    chatgptViews, chatGPTAuthBrowsers, chatGPTKeyForEntry,
    windowStateForEntry, sendToWindowState, publishChatGPTState,
    sanitizeDiagnosticURL, loginURL: CHATGPT_LOGIN_URL, homeURL: CHATGPT_URL,
    managedAuthProfilePath, closeManagedBrowserAuth, launchManagedBrowserAuth,
    electronCookieDetails, session, partition: CHATGPT_PARTITION,
    isTrustedChatGPTOrigin, isChatGPTAuthURL, loadOwnedChatGPTURL,
    chatGPTSurfaceShouldBeVisible: deps.chatGPTSurfaceShouldBeVisible,
    chatGPTNavigationDisposition, shell,
  })

  const {
    refreshEmbeddedChatGPTAuthentication, scheduleEmbeddedChatGPTAuthenticationProbe,
    observeEmbeddedAuthURL,
  } = createEmbeddedChatGPTAuthentication({
    isTrustedChatGPTOrigin, isChatGPTAuthURL, chatGPTSessionProbeExpression,
    publishChatGPTState, chatGPTNavigationDisposition, publishAuthComplete,
    sanitizeDiagnosticURL,
  })

  let chatGPTViewOperations
  function chatGPTViewLifecycle() {
    if (!chatGPTViewOperations) chatGPTViewOperations = createChatGPTViewOperations({
      sanitizeChatCacheKey, requireTrustedChatGPTURL,
      requireOwnedChatGPTEntry, sameConversationURL,
      currentChatGPTState, windowStateForEntry,
      chatAgentWorkerActivity, sanitizeDiagnosticURL,
      withChatGPTNavigationDeadline, userAgent: CHATGPT_USER_AGENT,
      wait, isTrustedChatGPTOrigin,
      WebContentsView, securePreferences, CHATGPT_PARTITION,
      CHATGPT_USER_AGENT, createChatGPTAffinityTracker,
      chatgptViews, grantChatGPTLayoutViewport: deps.grantChatGPTLayoutViewport,
      chatGPTNavigationDisposition, routeChatGPTNavigation,
      touchChatGPTEntry, publishChatGPTState, observeChatGPTAffinityURL,
      scheduleChatGPTAffinitySettlement, scheduleEmbeddedChatGPTAuthenticationProbe,
      expectedChatGPTBundles, pollExpectedChatGPTDownloadKey: (...args) => deps.getDownloadPoller()(...args),
      chatgptTransportModes, hideChatGPTSidebar: (...args) => deps.getHideChatGPTSidebar()(...args), observeEmbeddedAuthURL,
      isRecoverableChatGPTNetworkError, noteChatGPTRendererFault,
      noteChatGPTRecoveryProgress, clearChatGPTHumanAction,
      chatGPTWorkerEntries, chatAgentResidency, shell,
      publishChatAgentRuntimeState, closeWorkerMonitor,
      hideChatAgentInteractionEntry: (...args) => deps.getHideChatAgentInteractionEntry()(...args),
      classifyChatGPTConversationTransport, reconcileChatGPTConversationTransport,
    })
    return chatGPTViewOperations
  }

  function loadOwnedChatGPTURL(cacheKey, entry, value, reason = 'navigate') {
    return chatGPTViewLifecycle().loadOwnedChatGPTURL(cacheKey, entry, value, reason)
  }

  function createChatGPTView(cacheKey, windowState) {
    return chatGPTViewLifecycle().createChatGPTView(cacheKey, windowState)
  }

  function createChatGPTWorkerView(slotId, windowState) {
    return chatGPTViewLifecycle().createChatGPTWorkerView(slotId, windowState)
  }

  function retireChatGPTWorkerView(entry) {
    return chatGPTViewLifecycle().retireChatGPTWorkerView(entry)
  }

  return {
    publishAuthComplete, cancelExternalAuthentication, startExternalAuthentication,
    routeChatGPTNavigation, refreshEmbeddedChatGPTAuthentication,
    scheduleEmbeddedChatGPTAuthenticationProbe, observeEmbeddedAuthURL,
    loadOwnedChatGPTURL, createChatGPTView, createChatGPTWorkerView,
    retireChatGPTWorkerView,
  }
}
