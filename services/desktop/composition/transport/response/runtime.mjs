import {
  createResponseLineage, createResponseProbe, createAgentWrite, createLegacyTitleTasks,
} from '../../../agent/index.mjs'

export function createResponseRuntime(deps) {
  const {
    expectedChatGPTBundles, armExpectedChatGPTBundle, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, chatGPTProcessingDurationScript,
    CHATGPT_BEHAVIOR, chatGPTBundleAlreadyValidated, disarmExpectedChatGPTBundle, BUNDLE_CONTINUATION_BASE_MS,
    enqueueChatAgentTask, chatGPTSupervisorOwnsExpectedResponse, CHAT_AGENT_AWAIT_PROBE_MS, recentlyDeliveredChatGPTBundleRequestId,
    pendingChatGPTBundleDeliveries, sameConversationURL, orchestratorTaskChat, paceChatGPTWorkerNavigation,
    loadOwnedChatGPTURL, waitForChatGPTSurfaceReady, executeChatGPTDOMScript, chatGPTHumanActionScript,
    noteChatGPTRateLimitGate, chatAgentRateLimitDelayMs, chatGPTHumanActionMessage, chatAgentKeepFlowingEnabled,
    chooseChatGPTRecoveryAction, chatGPTResponseCompletionScript, PROCESSING_SIGNAL_GRACE_MS, DOM_DOWNLOAD_RETRY_MS,
    chatGPTExpectedDownloadScript, AWAIT_STALL_ATTENTION_MS, DOWNLOAD_INFLIGHT_TIMEOUT_MS, noteChatGPTRecoveryAssistantCount,
    isChatGPTAffinityAwaitingSettlement, BUNDLE_UNOBSERVED_SETTLE_MS, BUNDLE_COMPLETION_CONFIRM_MS, paceChatGPTWorkerSubmission,
    sanitizeSessionId, canonicalChatGPTConversationURL, durableWorkspaceChatID, withChatGPTTransportPreparation,
    preparePromptForChatGPT, chatGPTDeliveryContinuationPrompt, submitChatGPTContinuation, submitPromptToChatGPT,
    persistWorkspaceChatRemoteBestEffort, expectedChatAgentPayload, chatAgentInitialRequestWaitMs, chatAgentConversationID,
  } = deps

  // Durably records one decision against the Main Request's own AWAIT_RESPONSE
  // task (see armExpectedChatGPTBundle's mainRequestTaskId). Best-effort by
  // construction: recordTaskEvent itself never throws, and a missing task id
  // (arming raced the enqueue, or the enqueue never reached this expectation)
  // silently skips rather than blocking the caller's own automation.
  const {
    recordChatGPTTaskEvent, hydrateExpectedChatAgentBundle,
    chatAgentChildExists, captureChatGPTProcessingDuration,
    enqueueChatAgentContinuation,
  } = createResponseLineage({
    getScheduler: deps.getScheduler,
    expectedChatGPTBundles, armExpectedChatGPTBundle,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, chatGPTProcessingDurationScript,
    CHATGPT_BEHAVIOR, chatGPTBundleAlreadyValidated,
    disarmExpectedChatGPTBundle, BUNDLE_CONTINUATION_BASE_MS,
    enqueueChatAgentTask,
  })

  const { probeChatAgentResponse } = createResponseProbe({
    hydrateExpectedChatAgentBundle,
    chatGPTSupervisorOwnsExpectedResponse,
    CHAT_AGENT_AWAIT_PROBE_MS,
    recentlyDeliveredChatGPTBundleRequestId,
    pendingChatGPTBundleDeliveries,
    disarmExpectedChatGPTBundle,
    sameConversationURL,
    orchestratorTaskChat,
    paceChatGPTWorkerNavigation,
    loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady,
    executeChatGPTDOMScript,
    chatGPTHumanActionScript,
    noteChatGPTRateLimitGate,
    chatAgentRateLimitDelayMs,
    chatGPTHumanActionMessage,
    chatAgentKeepFlowingEnabled,
    chooseChatGPTRecoveryAction,
    performChatGPTRecoveryAction: (...args) => deps.getRecoveryAction()(...args),
    chatGPTResponseCompletionScript,
    PROCESSING_SIGNAL_GRACE_MS,
    enqueueChatAgentContinuation,
    DOM_DOWNLOAD_RETRY_MS,
    chatGPTExpectedDownloadScript,
    AWAIT_STALL_ATTENTION_MS,
    captureChatGPTProcessingDuration,
    DOWNLOAD_INFLIGHT_TIMEOUT_MS,
    noteChatGPTRecoveryAssistantCount,
    isChatGPTAffinityAwaitingSettlement,
    BUNDLE_UNOBSERVED_SETTLE_MS,
    BUNDLE_COMPLETION_CONFIRM_MS,
    setRecentExpectedDownload: deps.setRecentExpectedDownload,
  })

  const { executeChatAgentWrite } = createAgentWrite({
    paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs, sanitizeSessionId,
    canonicalChatGPTConversationURL, durableWorkspaceChatID,
    withChatGPTTransportPreparation, preparePromptForChatGPT,
    chatGPTBundleAlreadyValidated, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
    chatGPTDeliveryContinuationPrompt, sameConversationURL,
    submitChatGPTContinuation, submitPromptToChatGPT, expectedChatGPTBundles,
    recordChatGPTContinuationSent: (...args) => deps.getContinuationRecorder()(...args),
    persistWorkspaceChatRemoteBestEffort, expectedChatAgentPayload,
    enqueueChatAgentTask, chatAgentInitialRequestWaitMs,
  })

  const { executeChatAgentTitleDiscover, executeChatAgentTempTitle, executeChatAgentTitleAwait } = createLegacyTitleTasks({
    canonicalChatGPTConversationURL, chatAgentChildExists,
    enqueueChatAgentTask, chatAgentConversationID,
  })

  return {
    recordChatGPTTaskEvent, hydrateExpectedChatAgentBundle, chatAgentChildExists,
    captureChatGPTProcessingDuration, enqueueChatAgentContinuation, probeChatAgentResponse,
    executeChatAgentWrite, executeChatAgentTitleDiscover, executeChatAgentTempTitle,
    executeChatAgentTitleAwait,
  }
}
