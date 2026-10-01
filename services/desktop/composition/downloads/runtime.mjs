import { createOrchestratorBundleDelivery } from '../../agent/index.mjs'
import {
  createChatGPTUtilityDownloads, createOrchestratorPlanDownloads,
  createLegacyPlanDownload, createChatGPTBundleDownload,
  createChatGPTDownloadPublication, createChatGPTDownloadSource,
  createValidBundleMetric, createChatGPTDownloadRouter,
} from '../../chatgpt/downloads/index.mjs'

export function createDesktopDownloadRuntime(d) {
  const {
    publishPlanDownload, publishPlanDownloadError,
    publishBundleDownload, publishBundleDownloadError,
  } = createChatGPTDownloadPublication({
    sendToChatGPTKey: d.sendToChatGPTKey,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    parseBundleName: d.parseBundleName, path: d.path,
    deliverOrchestratorTaskBundle: d.deliverOrchestratorTaskBundle,
    wharnessBundleRequestIdFromFilename: d.wharnessBundleRequestIdFromFilename,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
  })

  const { deliverOrchestratorTaskBundle } = createOrchestratorBundleDelivery({
    backendURL: d.BACKEND_URL,
    pendingDeliveries: d.pendingChatGPTBundleDeliveries,
    acknowledge: d.acknowledgeChatGPTBundle,
    scheduler: d.scheduler, enqueue: d.enqueueChatAgentTask,
    canonicalURL: d.canonicalChatGPTConversationURL,
  })

  const {
    registerChatGPTMarkdownTranslationDownload,
    registerChatGPTTodoClassificationDownload,
  } = createChatGPTUtilityDownloads({
    expectedChatGPTTranslations: d.expectedChatGPTTranslations,
    expectedChatGPTTodoClassifications: d.expectedChatGPTTodoClassifications,
    tempPath: d.tempPath,
    MARKDOWN_TRANSLATION_TIMEOUT_MS: d.MARKDOWN_TRANSLATION_TIMEOUT_MS,
    MAX_MARKDOWN_TRANSLATION_RESULT_BYTES: d.MAX_MARKDOWN_TRANSLATION_RESULT_BYTES,
    TODO_CLASSIFICATION_TIMEOUT_MS: d.TODO_CLASSIFICATION_TIMEOUT_MS,
    MAX_TODO_CLASSIFICATION_BYTES: d.MAX_TODO_CLASSIFICATION_BYTES,
  })

  const chatGPTDownloadIsHumanBrowsing = createChatGPTDownloadSource(d.internalChatGPTBrowsers)
  const orchestratorPlanDownloads = createOrchestratorPlanDownloads({
    expectedChatGPTOrchestratorPlans: d.expectedChatGPTOrchestratorPlans,
    tempPath: d.tempPath,
    MAX_ORCHESTRATOR_PLAN_BYTES: d.MAX_ORCHESTRATOR_PLAN_BYTES,
    ORCHESTRATOR_PLAN_TIMEOUT_MS: d.ORCHESTRATOR_PLAN_TIMEOUT_MS,
  })
  const {
    registerChatGPTOrchestratorPlanDownload,
    takeRetainedChatGPTOrchestratorPlan,
  } = orchestratorPlanDownloads

  const handleLegacyPlanDownload = createLegacyPlanDownload({
    tempPath: d.tempPath, maxBytes: d.MAX_PLAN_BYTES,
    requestIdFromFilename: d.wharnessPlanRequestIdFromFilename,
    validatePlanFile: d.validateWharnessPlanFile,
    publishPlan: publishPlanDownload, publishError: publishPlanDownloadError,
    humanBrowsing: chatGPTDownloadIsHumanBrowsing,
    sanitizeURL: d.sanitizeDiagnosticURL,
  })

  const recordValidBundleMetric = createValidBundleMetric({
    scheduler: d.scheduler,
    chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    chatgptViews: d.chatgptViews,
    chatAgentConversationID: d.chatAgentConversationID,
    recordProviderDiagnostics: d.recordProviderDiagnostics,
  })

  const handleBundleDownload = createChatGPTBundleDownload({
    pendingDeliveries: d.pendingChatGPTBundleDeliveries,
    maxBytes: d.MAX_EXECUTION_BUNDLE_BYTES,
    pendingDirectory: d.pendingBundleDirectory,
    expectedBundles: d.expectedChatGPTBundles,
    validateBundle: d.validateWharnessBundleDownload,
    recordValidBundle: recordValidBundleMetric,
    recentlyDelivered: d.recentlyDeliveredChatGPTBundleRequestId,
    quiesceRecovery: d.quiesceChatGPTRecoveryAfterValidatedBundle,
    publishBundle: publishBundleDownload, publishError: publishBundleDownloadError,
    recordTaskEvent: d.recordChatGPTTaskEvent,
    sanitizeURL: d.sanitizeDiagnosticURL,
  })

  const { registerChatGPTPlanDownloads } = createChatGPTDownloadRouter({
    chatGPTWorkerEntries: d.chatGPTWorkerEntries,
    chatAgentWorkerActivity: d.chatAgentWorkerActivity,
    registerOrchestratorExecutionDownload: d.registerOrchestratorExecutionDownload,
    expectedChatGPTOrchestratorExecutions: d.expectedChatGPTOrchestratorExecutions,
    tempPath: d.tempPath, registerChatGPTOrchestratorPlanDownload,
    registerChatGPTMarkdownTranslationDownload,
    registerReleaseNotesBundleDownload: d.registerReleaseNotesBundleDownload,
    expectedChatGPTReleaseNotes: d.expectedChatGPTReleaseNotes,
    registerChatGPTTodoClassificationDownload,
    expectedChatGPTBundleForDownload: d.expectedChatGPTBundleForDownload,
    chatGPTKeyForWebContents: d.chatGPTKeyForWebContents,
    canonicalWharnessBundleDownload: d.canonicalWharnessBundleDownload,
    BundleOwnershipError: d.BundleOwnershipError, path: d.path,
    publishBundleDownloadError, handleBundleDownload, handleLegacyPlanDownload,
  })

  return {
    publishPlanDownload, publishPlanDownloadError,
    publishBundleDownload, publishBundleDownloadError,
    deliverOrchestratorTaskBundle,
    registerChatGPTMarkdownTranslationDownload,
    registerChatGPTTodoClassificationDownload,
    chatGPTDownloadIsHumanBrowsing, orchestratorPlanDownloads,
    registerChatGPTOrchestratorPlanDownload,
    takeRetainedChatGPTOrchestratorPlan,
    handleLegacyPlanDownload, recordValidBundleMetric,
    handleBundleDownload, registerChatGPTPlanDownloads,
  }
}
