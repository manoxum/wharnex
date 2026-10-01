import { createChatGPTAccountOperations } from '../composition/index.mjs'

export function createDesktopChatGPTAccount(d) {
  let accountOperation = Promise.resolve()
  function serializeChatGPTAccountOperation(operation) {
    const next = accountOperation.catch(() => undefined).then(operation)
    accountOperation = next.catch(() => undefined)
    return next
  }
  function runChatGPTAccountAction(action, payload, browserFallback) {
    return d.chatGPTAccountProviders.run(action, payload,
      (_ignoredAction, ignoredPayload) => browserFallback(ignoredPayload))
  }
  return createChatGPTAccountOperations({
    executeChatGPTDOMScript: d.executeChatGPTDOMScript,
    isTrustedChatGPTOrigin: d.isTrustedChatGPTOrigin,
    runChatGPTAccountAction,
    BrowserWindow: d.BrowserWindow,
    desktopWindows: d.desktopWindows,
    preserveLocalFocusDuringBackgroundOperation: d.preserveLocalFocusDuringBackgroundOperation,
    windowStateForEntry: d.windowStateForEntry,
    chatgptViews: d.chatgptViews,
    dispatchChatGPTPointerPress: d.dispatchChatGPTPointerPress,
    wait: d.wait,
    CHATGPT_CONTROL_PRESS_HOLD_MS: d.CHATGPT_CONTROL_PRESS_HOLD_MS,
    dispatchChatGPTAccountKey: d.dispatchChatGPTAccountKey,
    requireOwnedChatGPTEntry: d.requireOwnedChatGPTEntry,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS: d.CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    CHATGPT_MENU_REOPEN_ATTEMPTS: d.CHATGPT_MENU_REOPEN_ATTEMPTS,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    ensureChatGPTView: d.ensureChatGPTView,
    serializeChatGPTAccountOperation,
    paceChatGPTWorkerNavigation: (...args) => d.paceChatGPTWorkerNavigation(...args),
    requireTrustedChatGPTURL: d.requireTrustedChatGPTURL,
    sameConversationURL: d.sameConversationURL,
    loadOwnedChatGPTURL: d.loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady: d.waitForChatGPTSurfaceReady,
    chatGPTConversationID: d.chatGPTConversationID,
    dispatchChatGPTPointerClick: d.dispatchChatGPTPointerClick,
    reconcileChatGPTThrottle: d.reconcileChatGPTThrottle,
    createChatGPTAffinityTracker: d.createChatGPTAffinityTracker,
    releaseChatGPTView: d.releaseChatGPTView,
    chatGPTKeyForEntry: d.chatGPTKeyForEntry,
    path: d.path,
    parseBundleName: d.parseBundleName,
    CHATGPT_LIBRARY_URL: d.CHATGPT_LIBRARY_URL,
  })
}
