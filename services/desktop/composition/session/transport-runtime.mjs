import {
  createChatGPTBundleExpectation, createChatGPTRequestCancellation,
} from '../../chatgpt/transport/index.mjs'
import {
  createExpectedBundleLookup, createValidatedBundleState,
} from '../../chatgpt/transport/index.mjs'
import { chatGPTAssistantTurnCountScript } from '../../chatgpt/dom/index.mjs'
import { createPendingBundleInbox } from './pending-bundle-inbox.mjs'
import { createDesktopProfilePaths } from './profile-paths.mjs'

export function createDesktopChatTransportRuntime(d) {
  const {
    canonicalBundleFilename, authoritativeBundleFilename,
    armExpectedChatGPTBundle, disarmExpectedChatGPTBundle,
  } = createChatGPTBundleExpectation({
    buildBundleName: d.buildBundleName, safeChatId: d.safeChatId,
    requestIdFromFilename: d.wharnessBundleRequestIdFromFilename,
    parseBundleName: d.parseBundleName, sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
    createChatGPTRecoveryState: d.createChatGPTRecoveryState,
  })

  const { cancelChatGPTRequestState } = createChatGPTRequestCancellation({
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    abortChatGPTTransportPreparations: d.abortChatGPTTransportPreparations,
    expectedChatGPTBundles: d.expectedChatGPTBundles,
    retryableChatGPTPrompts: d.retryableChatGPTPrompts,
    preparedChatGPTDrafts: d.preparedChatGPTDrafts,
    manualChatGPTTransport: d.manualChatGPTTransport,
    pendingChatGPTComments: d.pendingChatGPTComments,
    chatgptViews: d.chatgptViews,
    clearChatGPTHumanAction: d.clearChatGPTHumanAction,
    reconcileChatGPTThrottle: d.reconcileChatGPTThrottle,
    scheduler: d.scheduler,
    refreshChatAgentRuntimeState: d.refreshChatAgentRuntimeState,
    publishChatAgentRuntimeState: d.publishChatAgentRuntimeState,
  })

  async function chatGPTAssistantTurnCount(wc) {
    try {
      const count = await wc.executeJavaScript(chatGPTAssistantTurnCountScript(), true)
      return Math.max(0, Number(count) || 0)
    } catch {
      return 0
    }
  }

  const { expectedChatGPTBundleForDownload, chatGPTExpectedKeyForRequest } = createExpectedBundleLookup({
    expectedChatGPTBundles: d.expectedChatGPTBundles, chatgptViews: d.chatgptViews,
    requestIdFromFilename: d.wharnessBundleRequestIdFromFilename,
    sanitizeOptionalChatCacheKey: d.sanitizeOptionalChatCacheKey,
    recentDownload: d.recentDownload, ttlMs: d.EXPECTED_BUNDLE_TTL_MS,
  })
  const {
    recentlyDeliveredChatGPTBundleRequestId, markChatGPTBundleRequestDelivered,
    chatGPTBundleAlreadyValidated, quiesceChatGPTRecoveryAfterValidatedBundle,
  } = createValidatedBundleState({
    deliveredChatGPTBundleRequestIds: d.deliveredChatGPTBundleRequestIds,
    dedupTtlMs: d.DELIVERED_BUNDLE_DEDUP_TTL_MS,
    pendingChatGPTBundleDeliveries: d.pendingChatGPTBundleDeliveries,
    expectedChatGPTBundles: d.expectedChatGPTBundles, chatGPTExpectedKeyForRequest,
    abortChatGPTTransportPreparations: d.abortChatGPTTransportPreparations,
    scheduler: d.scheduler, refreshChatAgentRuntimeState: d.refreshChatAgentRuntimeState,
    publishChatAgentRuntimeState: d.publishChatAgentRuntimeState,
  })

  const { pendingBundleDirectory, pendingChatGPTBundlePayloads, acknowledgeChatGPTBundle } = createPendingBundleInbox({
    app: d.app, path: d.path, readdir: d.readdir, readFile: d.readFile, rm: d.rm,
    requestIdFromFilename: d.wharnessBundleRequestIdFromFilename,
    recentlyDelivered: recentlyDeliveredChatGPTBundleRequestId,
    validateBundle: d.validateWharnessBundleDownload,
    deliveries: d.pendingChatGPTBundleDeliveries,
    sanitizeChatCacheKey: d.sanitizeChatCacheKey,
    markDelivered: markChatGPTBundleRequestDelivered,
    cancelRequest: cancelChatGPTRequestState, scheduler: d.scheduler,
    parseBundleName: d.parseBundleName, safeChatId: d.safeChatId,
    enqueueTask: d.enqueueChatAgentTask,
    retentionMs: d.CHATGPT_BUNDLE_RETENTION_MS,
  })

  const { chatGPTPartitionPath, managedAuthProfilePath, pendingBrowserImportPath } = createDesktopProfilePaths({
    app: d.app, path: d.path,
    managedBrowserProfileDirectory: d.managedBrowserProfileDirectory,
  })

  return {
    canonicalBundleFilename, authoritativeBundleFilename,
    armExpectedChatGPTBundle, disarmExpectedChatGPTBundle,
    cancelChatGPTRequestState, chatGPTAssistantTurnCount,
    expectedChatGPTBundleForDownload, chatGPTExpectedKeyForRequest,
    recentlyDeliveredChatGPTBundleRequestId, markChatGPTBundleRequestDelivered,
    chatGPTBundleAlreadyValidated, quiesceChatGPTRecoveryAfterValidatedBundle,
    pendingBundleDirectory, pendingChatGPTBundlePayloads, acknowledgeChatGPTBundle,
    chatGPTPartitionPath, managedAuthProfilePath, pendingBrowserImportPath,
  }
}
