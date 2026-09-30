import * as source7 from '../../../chatgpt/transport/index.mjs'
import * as source11 from '../../../chatgpt/config/index.mjs'
import * as source12 from '../../../chatgpt/dom/index.mjs'
import * as source13 from '../../../chatgpt/account/index.mjs'
import * as source16 from '../../../chatgpt/session/index.mjs'

export function createChatgptDependencies() {
  return {
    ChatGPTSubmitCoordinator: source7.ChatGPTSubmitCoordinator, dispatchChatGPTAccountKey: source7.dispatchChatGPTAccountKey, dispatchChatGPTPointerClick: source7.dispatchChatGPTPointerClick,
    dispatchChatGPTPointerPress: source7.dispatchChatGPTPointerPress, submitWithoutReplay: source7.submitWithoutReplay, ChatGPTUploadCoordinator: source7.ChatGPTUploadCoordinator,
    chatGPTUploadThumbnailScript: source7.chatGPTUploadThumbnailScript, pasteWithUploadRetry: source7.pasteWithUploadRetry, plannerPromptMarkdown: source7.plannerPromptMarkdown,
    selectChatGPTUploadFile: source7.selectChatGPTUploadFile, waitForChatGPTReady: source7.waitForChatGPTReady, createChatGPTFileUpload: source7.createChatGPTFileUpload,
    registerExpectedBundleRecoveryIPC: source7.registerExpectedBundleRecoveryIPC, registerChatGPTBundleIPC: source7.registerChatGPTBundleIPC, shouldAttachProjectContext: source7.shouldAttachProjectContext,
    chatGPTDeliveryContinuationPrompt: source7.chatGPTDeliveryContinuationPrompt, chooseChatGPTRecoveryAction: source7.chooseChatGPTRecoveryAction, classifyChatGPTConversationTransport: source7.classifyChatGPTConversationTransport,
    commitChatGPTRecoveryAction: source7.commitChatGPTRecoveryAction, createChatGPTRecoveryState: source7.createChatGPTRecoveryState, isChatGPTConversationTransportURL: source7.isChatGPTConversationTransportURL,
    isRecoverableChatGPTNetworkError: source7.isRecoverableChatGPTNetworkError, noteChatGPTRecoveryAssistantCount: source7.noteChatGPTRecoveryAssistantCount, noteChatGPTRecoveryFault: source7.noteChatGPTRecoveryFault,
    noteChatGPTRecoveryProgress: source7.noteChatGPTRecoveryProgress, reconcileChatGPTConversationTransport: source7.reconcileChatGPTConversationTransport, recordChatGPTConversationTransport: source7.recordChatGPTConversationTransport,
    claimNetworkFaultReloadSlot: source7.claimNetworkFaultReloadSlot, isNetworkRecoveryFault: source7.isNetworkRecoveryFault, RATE_LIMIT_GATE: source7.RATE_LIMIT_GATE,
    classifyChatGPTRateLimit: source7.classifyChatGPTRateLimit, registerChatAttachmentIPC: source7.registerChatAttachmentIPC, throwIfChatGPTTransportAborted: source7.throwIfChatGPTTransportAborted,
    boundedChatInputPartBytes: source7.boundedChatInputPartBytes, requestPreparationTimer: source7.requestPreparationTimer, withRequestPreparationDeadline: source7.withRequestPreparationDeadline,
    createManualChatGPTTransport: source7.createManualChatGPTTransport, classifyChatGPTRequestDelivery: source7.classifyChatGPTRequestDelivery, registerChatGPTPromptIPC: source7.registerChatGPTPromptIPC,
    createChatGPTDraftSubmission: source7.createChatGPTDraftSubmission,
    CHATGPT_URL: source11.CHATGPT_URL, CHATGPT_LOGIN_URL: source11.CHATGPT_LOGIN_URL, CHATGPT_LIBRARY_URL: source11.CHATGPT_LIBRARY_URL,
    CHATGPT_PARTITION: source11.CHATGPT_PARTITION, CHATGPT_CHROMIUM_VERSION: source11.CHATGPT_CHROMIUM_VERSION, CHATGPT_ACCEPT_LANGUAGES: source11.CHATGPT_ACCEPT_LANGUAGES,
    CHATGPT_AFFINITY_RECOVERY_GRACE_MS: source11.CHATGPT_AFFINITY_RECOVERY_GRACE_MS, EXPIRED_ARTIFACT_TTL_MS: source11.EXPIRED_ARTIFACT_TTL_MS, RETRYABLE_PROMPT_TTL_MS: source11.RETRYABLE_PROMPT_TTL_MS,
    DELIVERED_BUNDLE_DEDUP_TTL_MS: source11.DELIVERED_BUNDLE_DEDUP_TTL_MS, EXPECTED_BUNDLE_TTL_MS: source11.EXPECTED_BUNDLE_TTL_MS, DOM_DOWNLOAD_POLL_MS: source11.DOM_DOWNLOAD_POLL_MS,
    DOM_DOWNLOAD_RETRY_MS: source11.DOM_DOWNLOAD_RETRY_MS, DOWNLOAD_INFLIGHT_TIMEOUT_MS: source11.DOWNLOAD_INFLIGHT_TIMEOUT_MS, BUNDLE_COMPLETION_GRACE_MS: source11.BUNDLE_COMPLETION_GRACE_MS,
    BUNDLE_CONTINUATION_BASE_MS: source11.BUNDLE_CONTINUATION_BASE_MS, BUNDLE_COMPLETION_CONFIRM_MS: source11.BUNDLE_COMPLETION_CONFIRM_MS, MAX_BUNDLE_CONTINUATIONS: source11.MAX_BUNDLE_CONTINUATIONS,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: source11.MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, PROCESSING_SIGNAL_GRACE_MS: source11.PROCESSING_SIGNAL_GRACE_MS, BUNDLE_UNOBSERVED_SETTLE_MS: source11.BUNDLE_UNOBSERVED_SETTLE_MS,
    CONVERSATION_TRANSPORT_STALE_MS: source11.CONVERSATION_TRANSPORT_STALE_MS, PROCESSING_STALE_ATTENTION_MS: source11.PROCESSING_STALE_ATTENTION_MS, AWAIT_STALL_ATTENTION_MS: source11.AWAIT_STALL_ATTENTION_MS,
    CHATGPT_RATE_LIMIT_BACKOFF_MS: source11.CHATGPT_RATE_LIMIT_BACKOFF_MS, CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS: source11.CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS, CHATGPT_DOM_PROBE_FAILURE_LIMIT: source11.CHATGPT_DOM_PROBE_FAILURE_LIMIT,
    CHATGPT_ACCOUNT_ACTION_SETTLE_MS: source11.CHATGPT_ACCOUNT_ACTION_SETTLE_MS, CHATGPT_MENU_REOPEN_ATTEMPTS: source11.CHATGPT_MENU_REOPEN_ATTEMPTS, CHATGPT_CONTROL_PRESS_HOLD_MS: source11.CHATGPT_CONTROL_PRESS_HOLD_MS,
    DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS: source11.DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
    chatGPTComposerReadyScript: source12.chatGPTComposerReadyScript, chatGPTExpectedDownloadScript: source12.chatGPTExpectedDownloadScript, chatGPTHumanActionScript: source12.chatGPTHumanActionScript,
    chatGPTResponseCompletionScript: source12.chatGPTResponseCompletionScript, chatGPTFillComposerScript: source12.chatGPTFillComposerScript, chatGPTSubmitScript: source12.chatGPTSubmitScript,
    chatGPTVisibleActivityScript: source12.chatGPTVisibleActivityScript, chatGPTProcessingDurationScript: source12.chatGPTProcessingDurationScript, chatGPTSubmittedRequestEvidenceScript: source12.chatGPTSubmittedRequestEvidenceScript,
    behaviorProbeScript: source12.behaviorProbeScript, isBehaviorProbeEnabled: source12.isBehaviorProbeEnabled, normalizeBehaviorProbeResult: source12.normalizeBehaviorProbeResult,
    sanitizeBehaviorProbeControl: source12.sanitizeBehaviorProbeControl, BEHAVIOR_PROBE_CONTROLS: source12.BEHAVIOR_PROBE_CONTROLS, ensureChatGPTReasoningEffort: source12.ensureChatGPTReasoningEffort,
    normalizeChatGPTReasoningEffort: source12.normalizeChatGPTReasoningEffort, stepChatGPTEffort: source12.stepChatGPTEffort, evaluateChatGPTDOMWithDeadline: source12.evaluateChatGPTDOMWithDeadline,
    accountFailureDetail: source13.accountFailureDetail, ChatGPTAccountProviderChain: source13.ChatGPTAccountProviderChain,
    confirmChatGPTAffinity: source16.confirmChatGPTAffinity, createChatGPTAffinityTracker: source16.createChatGPTAffinityTracker, isChatGPTAffinityAwaitingSettlement: source16.isChatGPTAffinityAwaitingSettlement,
    markChatGPTAffinitySubmitted: source16.markChatGPTAffinitySubmitted, observeChatGPTAffinity: source16.observeChatGPTAffinity, proposeChatGPTAffinity: source16.proposeChatGPTAffinity,
    publicChatGPTAffinity: source16.publicChatGPTAffinity, rejectChatGPTAffinity: source16.rejectChatGPTAffinity, settleChatGPTAffinity: source16.settleChatGPTAffinity,
    shouldPreserveChatGPTAffinityNavigation: source16.shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinity: source16.syncChatGPTAffinity, chatGPTSessionProbeExpression: source16.chatGPTSessionProbeExpression,
    closeManagedBrowserAuth: source16.closeManagedBrowserAuth, electronCookieDetails: source16.electronCookieDetails, launchManagedBrowserAuth: source16.launchManagedBrowserAuth,
    managedBrowserProfileDirectory: source16.managedBrowserProfileDirectory, registerChatGPTAccountIPC: source16.registerChatGPTAccountIPC, registerChatGPTSessionControlIPC: source16.registerChatGPTSessionControlIPC,
    registerChatGPTSurfaceIPC: source16.registerChatGPTSurfaceIPC, createWorkspaceChatRemote: source16.createWorkspaceChatRemote, createChatGPTRateLimitResume: source16.createChatGPTRateLimitResume,
    createChatGPTConversationReadHealth: source16.createChatGPTConversationReadHealth, createChatGPTCacheMarker: source16.createChatGPTCacheMarker, configureChatGPTSession: source16.configureChatGPTSession,
    createChatGPTConversationURLs: source16.createChatGPTConversationURLs, chatGPTConversationLoadFailureScript: source16.chatGPTConversationLoadFailureScript, withChatGPTNavigationDeadline: source16.withChatGPTNavigationDeadline,
  }
}
