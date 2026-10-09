import { createDesktopMessageRouting } from '../../window/message-routing.mjs'
import { createChatGPTViewKeys } from '../view-keys.mjs'
import { createChatGPTThrottle } from '../../../chatgpt/session/ownership/throttle.mjs'
import { createSupervisorOwnership } from '../../../agent/supervision/ownership/binding.mjs'
import { createChatGPTTransportPreparation } from '../../../chatgpt/transport/requests/transport-preparation.mjs'
import { createSupervisorTransport } from '../../../chatgpt/transport/requests/supervisor.mjs'

export function createDesktopOwnershipRuntime(deps) {
  const {
    desktopWindows, chatgptViews, chatGPTWorkerEntries, expectedChatGPTBundles, expectedChatGPTTranslations,
    expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications, expectedChatGPTUITestDiscoveries, expectedChatGPTOrchestratorPlans, pendingChatGPTComments, chatgptTransportModes,
    canonicalChatGPTConversationURL, sameConversationURL, pendingChatGPTBundleDeliveries, chatGPTTransportTails, chatSupervisorStates,
    preparedChatGPTDrafts, retryableChatGPTPrompts, RETRYABLE_PROMPT_TTL_MS, sanitizeOptionalChatCacheKey, chatAgentConversationID,
    chatAgentResidency, withTrace, traceId, sanitizeChatCacheKey,
  } = deps

  const {
    windowStateForWebContents, trustedSender, windowStateForEntry,
    activeChatGPTEntry, sendToWindowState, sendToChatGPTKey,
    publishChatGPTAccountAction,
  } = createDesktopMessageRouting({ desktopWindows, chatgptViews })
  const { chatGPTKeyForEntry, chatGPTKeyForWebContents, touchChatGPTEntry } = createChatGPTViewKeys({
    chatgptViews, chatGPTWorkerEntries,
  })

  // "Supervised" mirrors the desktop composition invariant: a hidden/inactive
  // owned view keeps running at full speed only while Wharnex genuinely needs
  // to observe it (an expected bundle download, a pending human action, an
  // in-flight transport request, or account automation). Wharnex's own
  // detection (executeJavaScript health probes, will-navigate/did-navigate,
  // download events) is driven from this main process on its own timers, not
  // from the ChatGPT page's own JS timers, so it is unaffected by Chromium's
  // background throttling either way; only the remote page's own idle
  // timers/rAF slow down once nothing here is waiting on it.
  // Every armed artifact expectation, not only a request bundle. The bundle map
  // is keyed by cache key; the utility maps are keyed by their exact result
  // filename and carry the cache key inside, so they are matched by value. All
  // all utility maps hold at most a handful of live entries.
  const {
    chatGPTArtifactExpectationArmed, reconcileChatGPTThrottleForKey,
    chatGPTEntryNeedsSupervision, chatGPTEntryIsActiveVisible,
    reconcileChatGPTThrottle,
  } = createChatGPTThrottle({
    expectedChatGPTBundles, expectedChatGPTTranslations,
    expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications, expectedChatGPTUITestDiscoveries,
    expectedChatGPTOrchestratorPlans, chatgptViews, pendingChatGPTComments,
    windowStateForEntry,
  })

  const {
    chatGPTSupervisorOwnsExpectedResponse, supervisorBindingHold,
    supervisorBindingHeld, chatSupervisorSlotID, supervisorEntryForSlot,
    supervisorKeyForSlot, chatSupervisorLeaseKeys, chatSupervisorBoundLanes,
  } = createSupervisorOwnership({
    chatgptViews, chatgptTransportModes, expectedChatGPTBundles,
    canonicalChatGPTConversationURL, sameConversationURL,
    pendingChatGPTBundleDeliveries,
    hasPendingChatGPTComments: deps.hasPendingChatGPTComments,
    chatGPTTransportTails, chatSupervisorStates,
    preparedChatGPTDrafts, retryableChatGPTPrompts,
    RETRYABLE_PROMPT_TTL_MS,
    getDesiredChatAgentSupervisorSlots: deps.getDesiredChatAgentSupervisorSlots,
    sanitizeOptionalChatCacheKey, chatAgentConversationID,
  })

  const { abortChatGPTTransportPreparations, withChatGPTTransportPreparation } = createChatGPTTransportPreparation({
    tails: chatGPTTransportTails,
    requireOwnedEntry: deps.requireOwnedEntry,
    reconcileThrottle: reconcileChatGPTThrottle,
    residency: chatAgentResidency,
    withTrace,
    traceId,
    deferredNavigationPending: deps.deferredNavigationPending,
    applyDeferredNavigation: deps.applyDeferredNavigation,
  })

  const { withChatGPTSupervisorTransport } = createSupervisorTransport({
    sanitizeChatCacheKey,
    ensureChatGPTView: deps.ensureChatGPTView,
    withChatGPTTransportPreparation,
  })
  return {
    windowStateForWebContents, trustedSender, windowStateForEntry, activeChatGPTEntry,
    sendToWindowState, sendToChatGPTKey, publishChatGPTAccountAction,
    chatGPTKeyForEntry, chatGPTKeyForWebContents, touchChatGPTEntry,
    chatGPTArtifactExpectationArmed, reconcileChatGPTThrottleForKey,
    chatGPTEntryNeedsSupervision, chatGPTEntryIsActiveVisible, reconcileChatGPTThrottle,
    chatGPTSupervisorOwnsExpectedResponse, supervisorBindingHold, supervisorBindingHeld,
    chatSupervisorSlotID, supervisorEntryForSlot, supervisorKeyForSlot,
    chatSupervisorLeaseKeys, chatSupervisorBoundLanes,
    abortChatGPTTransportPreparations, withChatGPTTransportPreparation,
    withChatGPTSupervisorTransport,
  }
}
