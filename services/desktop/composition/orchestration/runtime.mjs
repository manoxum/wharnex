import {
  createOrchestratorConversationGuard, createOrchestratorRequestTransport,
  createOrchestratorPlanImport, createOrchestratorPlanWorker,
} from '../../agent/index.mjs'

export function createOrchestrationRuntime(deps) {
  const {
    expectedChatGPTReleaseNotes, app, paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs,
    requireOwnedChatGPTEntry, waitForChatGPTSurfaceReady, targetChatGPTComposer, CHATGPT_URL,
    executeChatGPTDOMScript, chatGPTFillComposerScript, pasteChatGPTFile, chatInputSettleDelay,
    chatGPTAssistantTurnCount, submitChatGPTDraft, waitForSubmittedChatGPTConversation, wait,
    chatGPTHumanActionScript, noteChatGPTRateLimitGate, setChatGPTHumanAction, chatGPTHumanActionMessage,
    chatGPTResponseCompletionScript, chatGPTExpectedDownloadScript, reconcileChatGPTThrottleForKey, enqueueChatAgentTask,
    chatAgentConversationID, canonicalChatGPTConversationURL, paceChatGPTWorkerNavigation, loadOwnedChatGPTURL,
    BACKEND_URL, sameConversationURL, requireTrustedChatGPTURL, pendingChatGPTBundleDeliveries,
    recentlyDeliveredChatGPTBundleRequestId, chatGPTBundleAlreadyValidated, expectedChatGPTBundles, sanitizeChatCacheKey,
    chatGPTSubmittedRequestEvidenceScript, chatInputArchiveFilename, armExpectedChatGPTBundle, enqueueChatAgentFollowups,
    disarmExpectedChatGPTBundle, clearChatGPTHumanAction, orchestratorRetryInput, readStoredAttachment,
    chatAttachmentRoot, withChatGPTTransportPreparation, preparePromptForChatGPT, path,
    sanitizeSessionId, fetch, orchestratorDeliveryFor, orchestratorBundleFilename,
    orchestratorPlanFilename, takeRetainedChatGPTOrchestratorPlan, orchestratorContextIncrementPaths, removeStoredChatAttachments,
    orchestratorRequestFilename, expectedChatGPTOrchestratorPlans, normalizeChatGPTReasoningEffort, sanitizeDiagnosticURL,
    fetchContextZip, storedAttachmentPath, writeOrchestratorRequestBundle, persistChatArtifact,
    ORCHESTRATOR_PLAN_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS, rearmOrchestratorPlanDownload, chatGPTArtifactExpiredSince,
    MAX_BUNDLE_CONTINUATIONS, pollWorkerExpectedDownload, ORCHESTRATOR_PLAN_GENERATING_GRACE_MS, ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS,
    orchestratorCompletionDiagnostic, sendOrchestratorContextIncrement,
  } = deps

  function releaseNotesWorkerRuntime() {
    return {
      expectedDownloads: expectedChatGPTReleaseNotes,
      tempRoot: app.getPath('temp'),
      pace: paceChatGPTWorkerSubmission,
      rateLimitDelay: chatAgentRateLimitDelayMs,
      requireEntry: requireOwnedChatGPTEntry,
      waitSurfaceReady: waitForChatGPTSurfaceReady,
      targetComposer: (key, entry) => targetChatGPTComposer(key, CHATGPT_URL, false, entry),
      executeDOM: executeChatGPTDOMScript,
      fillScript: chatGPTFillComposerScript,
      pasteFile: (entry, filePath) => pasteChatGPTFile(entry, filePath, 1, 1, { pacedWorker: true }),
      settleDelay: (bytes) => chatInputSettleDelay(bytes, 1),
      assistantTurnCount: chatGPTAssistantTurnCount,
      submit: (key, target) => submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort: false, rateLimitExempt: false }),
      waitConversation: waitForSubmittedChatGPTConversation,
      wait,
      humanActionScript: chatGPTHumanActionScript,
      noteRateLimit: noteChatGPTRateLimitGate,
      setHumanAction: (key, kind) => setChatGPTHumanAction(key, kind, '', 'release-notes-worker'),
      humanActionMessage: chatGPTHumanActionMessage,
      responseCompletionScript: chatGPTResponseCompletionScript,
      expectedDownloadScript: chatGPTExpectedDownloadScript,
      reconcile: reconcileChatGPTThrottleForKey,
      cleanup: (task, key, conversationUrl) => enqueueChatAgentTask('DELETE_TEMP_CHAT', {
        key, requestId: task.task_id, rootRequestId: task.task_id, conversationURL: conversationUrl,
        parentTaskID: task.task_id, dedupeKey: `delete-release-notes:${chatAgentConversationID(conversationUrl)}`,
        payload: {}, maxAttempts: 4,
      }).catch((error) => console.warn(`[release-notes] temporary ChatGPT cleanup scheduling failed: ${error instanceof Error ? error.message : String(error)}`)),
    }
  }

  const orchestratorConversationGuard = createOrchestratorConversationGuard({
    conversationURL: canonicalChatGPTConversationURL, currentURL: (entry) => entry.view.webContents.getURL(), pace: paceChatGPTWorkerNavigation,
    load: (key, entry, url) => loadOwnedChatGPTURL(key, entry, url, 'orchestrator-task-affinity'), waitReady: waitForChatGPTSurfaceReady })

  function orchestratorExecutionWorkerRuntime() {
    return {
      baseURL: BACKEND_URL, homeURL: CHATGPT_URL, pace: paceChatGPTWorkerNavigation, rateLimitDelay: chatAgentRateLimitDelayMs,
      needsNavigation: (entry, url) => {
        const current = entry.view.webContents.getURL()
        return !(current === requireTrustedChatGPTURL(url) || sameConversationURL(current, url))
      },
      conversationURL: canonicalChatGPTConversationURL,
      ensureConversation: orchestratorConversationGuard.ensureConversation, checkpoint: checkpointChatAgentTask,
      supervision: orchestratorRequestSupervision, adopt: adoptOrchestratorRequest, sendMainRequest: sendOrchestratorMainRequest,
    }
  }

  // Where the agentic transport stands on one request of a task's Main Request.
  const {
    orchestratorRequestSupervision, adoptOrchestratorRequest,
    sendOrchestratorMainRequest,
  } = createOrchestratorRequestTransport({
    pendingChatGPTBundleDeliveries, recentlyDeliveredChatGPTBundleRequestId,
    chatGPTBundleAlreadyValidated, getScheduler: deps.getScheduler,
    expectedChatGPTBundles, sanitizeChatCacheKey, orchestratorConversationGuard,
    executeChatGPTDOMScript, chatGPTSubmittedRequestEvidenceScript,
    chatInputArchiveFilename, armExpectedChatGPTBundle, enqueueChatAgentFollowups,
    disarmExpectedChatGPTBundle, clearChatGPTHumanAction,
    orchestratorRetryInput, readStoredAttachment, chatAttachmentRoot,
    withChatGPTTransportPreparation, preparePromptForChatGPT, path,
  })

  async function chatAgentLifecycleBlocked(task) {
    const listed = await deps.getScheduler().list({ chat_id: task.chat_id })
    return (listed?.tasks || []).some((item) => item.task_id !== task.task_id && ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status) && ['BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE'].includes(item.type))
  }

  const {
    importOrchestratorWorkerPlanBundle, importOrchestratorWorkerPlan,
    checkpointChatAgentTask, orchestratorPlanInstruction,
    parseOrchestratorPlanProposal, orchestratorPlanResult,
    importOrchestratorPlanArtifact, importRetainedOrchestratorPlan,
  } = createOrchestratorPlanImport({ sanitizeSessionId, BACKEND_URL, fetch })

  const executeChatAgentOrchestratorPlan = createOrchestratorPlanWorker({
    sanitizeSessionId, orchestratorDeliveryFor, orchestratorBundleFilename,
    orchestratorPlanFilename, canonicalChatGPTConversationURL,
    takeRetainedChatGPTOrchestratorPlan, importRetainedOrchestratorPlan,
    orchestratorContextIncrementPaths, removeStoredChatAttachments,
    chatAttachmentRoot, tempPath: () => app.getPath('temp'),
    orchestratorRequestFilename, expectedChatGPTOrchestratorPlans,
    reconcileChatGPTThrottleForKey, enqueueChatAgentTask, chatAgentConversationID,
    requireOwnedChatGPTEntry, sameConversationURL, loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady, normalizeChatGPTReasoningEffort,
    chatGPTAssistantTurnCount, sanitizeDiagnosticURL, paceChatGPTWorkerSubmission,
    chatAgentRateLimitDelayMs, targetChatGPTComposer, fetchContextZip,
    storedAttachmentPath, writeOrchestratorRequestBundle, persistChatArtifact,
    executeChatGPTDOMScript, chatGPTFillComposerScript, pasteChatGPTFile,
    wait, chatInputSettleDelay, submitChatGPTDraft,
    waitForSubmittedChatGPTConversation, checkpointChatAgentTask,
    homeURL: CHATGPT_URL, planTimeoutMs: ORCHESTRATOR_PLAN_TIMEOUT_MS,
    pollIntervalMs: MARKDOWN_TRANSLATION_POLL_MS,
    importOrchestratorPlanArtifact, rearmOrchestratorPlanDownload,
    orchestratorPlanResult, chatGPTHumanActionScript, noteChatGPTRateLimitGate,
    setChatGPTHumanAction, chatGPTHumanActionMessage,
    chatGPTResponseCompletionScript, chatGPTArtifactExpiredSince,
    maxBundleContinuations: MAX_BUNDLE_CONTINUATIONS,
    pollWorkerExpectedDownload, chatGPTExpectedDownloadScript,
    generatingGraceMs: ORCHESTRATOR_PLAN_GENERATING_GRACE_MS,
    observeAgainMs: ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS,
    orchestratorCompletionDiagnostic, sendOrchestratorContextIncrement,
  })

  return {
    releaseNotesWorkerRuntime, orchestratorExecutionWorkerRuntime,
    orchestratorRequestSupervision, adoptOrchestratorRequest, sendOrchestratorMainRequest,
    chatAgentLifecycleBlocked, checkpointChatAgentTask, orchestratorPlanInstruction,
    parseOrchestratorPlanProposal, orchestratorPlanResult, importOrchestratorPlanArtifact,
    executeChatAgentOrchestratorPlan,
  }
}
