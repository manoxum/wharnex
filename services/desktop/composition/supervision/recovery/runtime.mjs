import { createChatGPTCommentQueue, createExpectedBundleSupervision } from '../../../chatgpt/transport/index.mjs'
import { createChatGPTActivityPoll } from '../../../agent/index.mjs'
import { createChatGPTRecoveryActions } from '../../../chatgpt/transport/recovery/actions/index.mjs'

export function createRecoveryRuntime(deps) {
  const {
    sanitizeChatCacheKey, canonicalBundleFilename, normalizeChatGPTReasoningEffort, pendingChatGPTComments, recentChatGPTCommentIds,
    recentChatGPTCommentFingerprints, flushingChatGPTComments, sanitizeSessionId, chatgptViews, withChatGPTTransportPreparation,
    targetChatGPTComposer, executeChatGPTDOMScript, chatGPTComposerReadyScript, expectedChatGPTBundles, fillBundledChatGPTComposer,
    chatGPTAssistantTurnCount, wait, submitChatGPTDraft, armExpectedChatGPTBundle, touchChatGPTEntry,
    sendToChatGPTKey, reconcileChatGPTThrottle, isTrustedChatGPTOrigin, chatgptTransportModes, chatGPTHumanActionScript,
    noteChatGPTRateLimitGate, noteChatGPTRecoveryProgress, setChatGPTHumanAction, clearChatGPTHumanAction, chatGPTVisibleActivityScript,
    chatGPTActivityFingerprints, CHATGPT_DOM_PROBE_FAILURE_LIMIT, noteChatGPTRendererFault, requireOwnedChatGPTEntry, isNetworkRecoveryFault,
    claimNetworkFaultReloadSlot, commitChatGPTRecoveryAction, recordChatGPTTaskEvent, reloadOwnedChatGPTConversation, chatGPTBundleAlreadyValidated,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, submitChatGPTContinuation, ChatGPTRateLimitDeferral, pollingExpectedChatGPTBundles, pendingChatGPTBundleDeliveries,
    EXPECTED_BUNDLE_TTL_MS, chatGPTSupervisorOwnsExpectedResponse, chooseChatGPTRecoveryAction, noteChatGPTRecoveryFault, recentlyDeliveredChatGPTBundleRequestId,
    disarmExpectedChatGPTBundle, chatAgentKeepFlowingRequestActive, DOM_DOWNLOAD_RETRY_MS, captureChatGPTProcessingDuration, chatGPTExpectedDownloadScript,
    DOWNLOAD_INFLIGHT_TIMEOUT_MS, chatGPTResponseCompletionScript, noteChatGPTRecoveryAssistantCount, PROCESSING_SIGNAL_GRACE_MS, classifyChatGPTConversationTransport,
    CONVERSATION_TRANSPORT_STALE_MS, reconcileChatGPTConversationTransport, PROCESSING_STALE_ATTENTION_MS, BUNDLE_COMPLETION_GRACE_MS, isChatGPTAffinityAwaitingSettlement,
    CHATGPT_AFFINITY_RECOVERY_GRACE_MS,
  } = deps

  const { queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments } = createChatGPTCommentQueue({
    sanitizeChatCacheKey, canonicalBundleFilename, normalizeChatGPTReasoningEffort,
    pendingChatGPTComments, recentChatGPTCommentIds, recentChatGPTCommentFingerprints,
    flushingChatGPTComments, sanitizeSessionId, chatgptViews,
    withChatGPTTransportPreparation, targetChatGPTComposer, executeChatGPTDOMScript,
    chatGPTComposerReadyScript, expectedChatGPTBundles, fillBundledChatGPTComposer,
    chatGPTAssistantTurnCount, wait, submitChatGPTDraft, armExpectedChatGPTBundle,
    touchChatGPTEntry, sendToChatGPTKey,
  })
  const { pollChatGPTVisibleActivity } = createChatGPTActivityPoll({
    chatgptViews,
    reconcileChatGPTThrottle,
    isTrustedChatGPTOrigin,
    chatgptTransportModes,
    chatGPTHumanActionScript,
    noteChatGPTRateLimitGate,
    expectedChatGPTBundles,
    noteChatGPTRecoveryProgress,
    setChatGPTHumanAction,
    clearChatGPTHumanAction,
    chatGPTVisibleActivityScript,
    chatGPTActivityFingerprints,
    sendToChatGPTKey,
    CHATGPT_DOM_PROBE_FAILURE_LIMIT,
    noteChatGPTRendererFault,
    readPollingChatGPTVisibleActivity: deps.readPollingChatGPTVisibleActivity,
    setPollingChatGPTVisibleActivity: deps.setPollingChatGPTVisibleActivity,
  })

  const { performChatGPTRecoveryAction, escalateChatGPTContinuationFailure, recordChatGPTContinuationSent } = createChatGPTRecoveryActions({
    requireOwnedChatGPTEntry,
    isNetworkRecoveryFault,
    claimNetworkFaultReloadSlot,
    commitChatGPTRecoveryAction,
    recordChatGPTTaskEvent,
    reloadOwnedChatGPTConversation,
    sendToChatGPTKey,
    setChatGPTHumanAction,
    chatGPTBundleAlreadyValidated,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
    withChatGPTTransportPreparation,
    expectedChatGPTBundles,
    submitChatGPTContinuation,
    ChatGPTRateLimitDeferral,
  })

  const { pollExpectedChatGPTDownloadKey, pollExpectedChatGPTDownloads } = createExpectedBundleSupervision({
    pollingExpectedChatGPTBundles,
    expectedChatGPTBundles,
    hasPendingChatGPTComments,
    pendingChatGPTBundleDeliveries,
    chatgptTransportModes,
    EXPECTED_BUNDLE_TTL_MS,
    sendToChatGPTKey,
    chatgptViews,
    chatGPTSupervisorOwnsExpectedResponse,
    isTrustedChatGPTOrigin,
    chooseChatGPTRecoveryAction,
    performChatGPTRecoveryAction,
    noteChatGPTRecoveryFault,
    recentlyDeliveredChatGPTBundleRequestId,
    disarmExpectedChatGPTBundle,
    chatAgentKeepFlowingRequestActive,
    DOM_DOWNLOAD_RETRY_MS,
    captureChatGPTProcessingDuration,
    chatGPTExpectedDownloadScript,
    DOWNLOAD_INFLIGHT_TIMEOUT_MS,
    chatGPTResponseCompletionScript,
    noteChatGPTRecoveryAssistantCount,
    PROCESSING_SIGNAL_GRACE_MS,
    classifyChatGPTConversationTransport,
    CONVERSATION_TRANSPORT_STALE_MS,
    reconcileChatGPTConversationTransport,
    setChatGPTHumanAction,
    PROCESSING_STALE_ATTENTION_MS,
    BUNDLE_COMPLETION_GRACE_MS,
    isChatGPTAffinityAwaitingSettlement,
    CHATGPT_AFFINITY_RECOVERY_GRACE_MS,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
    CHATGPT_DOM_PROBE_FAILURE_LIMIT,
    noteChatGPTRendererFault,
    setRecentExpectedDownload: deps.setRecentExpectedDownload,
  })

  return {
    queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments,
    pollChatGPTVisibleActivity, performChatGPTRecoveryAction,
    escalateChatGPTContinuationFailure, recordChatGPTContinuationSent,
    pollExpectedChatGPTDownloadKey, pollExpectedChatGPTDownloads,
  }
}
