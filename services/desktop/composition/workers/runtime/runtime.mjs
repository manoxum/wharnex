import {
  createSupervisorResponseLease, createSupervisorPool, createTranslatorTaskRuntime,
  createEphemeralWorkerRuntime, createChatAgentExecution,
} from '../../../agent/index.mjs'

export function createAgentWorkerRuntime(deps) {
  const {
    chatAgentBackoff, persistWorkspaceChatRemote, hydrateExpectedChatAgentBundle, recentlyDeliveredChatGPTBundleRequestId, disarmExpectedChatGPTBundle,
    pendingChatGPTBundleDeliveries, CHAT_AGENT_AWAIT_PROBE_MS, chatgptTransportModes, chatGPTHumanActionMessage, AWAIT_STALL_ATTENTION_MS,
    EXPECTED_BUNDLE_TTL_MS, desktopWindows, chatgptViews, touchChatGPTEntry, reusableSupervisor,
    chatGPTEntryIsActiveVisible, ensureChatGPTView, chatSupervisorStates, chatAgentLane, sanitizeOptionalChatCacheKey,
    supervisorBindingHeld, chatAgentTaskPayload, sanitizeChatCacheKey, chatAgentConversationURL, sameConversationURL,
    loadOwnedChatGPTURL, waitForChatGPTSurfaceReady, isTrustedChatGPTOrigin, CHATGPT_URL, executeChatAgentWrite,
    createChatGPTWorkerView, publishChatAgentRuntimeState, assignChatGPTWorker, loadAndSettleChatGPTWorkerConversation, executeChatAgentMarkdownTranslation,
    chatAgentResidency, chatGPTWorkerEntries, retireChatGPTWorkerView, EPHEMERAL_WORKER_TASK_TYPES, EPHEMERAL_WORKER_IDLE_RETIRE_MS,
    EPHEMERAL_WORKER_PACE_PRIORITY, chatAgentWorkerActivity, parkChatGPTWorkerAfterLoadFailure, releaseChatGPTConversationReadProbe, organizeChatGPTConversation,
    accountFailureDetail, enqueueChatAgentTask, chatAgentConversationID, archiveChatGPTConversation, deleteChatGPTConversation,
    parseBundleName, deleteChatGPTLibraryArtifact, workerEntryForIndex, chatAgentRateLimitDelayMs, chatGPTConversationReadGateMs,
    ChatGPTRateLimitDeferral, CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS, executeChatAgentOrchestratorPlan, executeOrchestratorExecution, orchestratorExecutionWorkerRuntime,
    executeChatAgentTodoClassification, executeReleaseNotesBundleTask, releaseNotesWorkerRuntime, executeUITestingTask, probeChatAgentResponse, executeChatAgentTitleDiscover,
    executeChatAgentTempTitle, executeChatAgentTitleAwait,
    chatAgentLifecycleBlocked, chatGPTSupervisorOwnsExpectedResponse,
  } = deps

  async function chatAgentLifecycleRetry(task, key, conversationURL, error, { persist = true } = {}) {
    const detail = String(error || 'remote lifecycle operation did not complete')
    if (Number(task.attempt || 0) < Number(task.max_attempts || 0)) {
      return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: detail }
    }
    if (persist) await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'attention' })
    return { status: 'failed', error: detail }
  }

  // ─── Supervisor pool ────────────────────────────────────────────────────────
  //
  // A Supervisor owns one Wharnex chat for the whole life of its request: it opens
  // the conversation, submits the request bundle, follows the remote instance in
  // real time, and collects the response bundle. It never takes renaming,
  // organizing, archiving, deletion, title or translation work, so small jobs can
  // never evict a conversation that is mid-request — and it releases its chat only
  // once that request has settled and another chat actually needs the slot.
  //
  // Everything the pool exists for is the absence of one thing: a cross-chat
  // navigation. The bound renderer is already on the conversation, so observing a
  // response costs no provider request at all, and alternating between chats is a
  // visibility change rather than a reload.

  // How long a Supervisor task waits when every slot is still finishing a request.
  // Nothing reached ChatGPT, so this outcome is free and charges no attempt.
  const CHAT_SUPERVISOR_SLOT_WAIT_MS = 15_000

  const { superviseChatAgentResponse } = createSupervisorResponseLease({
    hydrateExpectedChatAgentBundle, recentlyDeliveredChatGPTBundleRequestId,
    disarmExpectedChatGPTBundle, pendingChatGPTBundleDeliveries,
    CHAT_AGENT_AWAIT_PROBE_MS, chatgptTransportModes, chatGPTHumanActionMessage,
    pollExpectedChatGPTDownloadKey: (...args) => deps.getDownloadPoller()(...args),
    AWAIT_STALL_ATTENTION_MS, EXPECTED_BUNDLE_TTL_MS,
  })

  const {
    chatSupervisorHostWindow, bindChatSupervisor, noteChatSupervisorLane,
    chatSupervisorLanesHeldByOthers, executeChatSupervisorTask,
  } = createSupervisorPool({
    desktopWindows, chatgptViews, touchChatGPTEntry,
    desiredSupervisorSlots: deps.desiredSupervisorSlots,
    reusableSupervisor, chatGPTEntryIsActiveVisible, ensureChatGPTView,
    chatSupervisorStates, chatAgentLane, sanitizeOptionalChatCacheKey,
    supervisorBindingHeld, chatAgentTaskPayload, sanitizeChatCacheKey,
    chatAgentConversationURL, CHAT_SUPERVISOR_SLOT_WAIT_MS,
    sameConversationURL, loadOwnedChatGPTURL, waitForChatGPTSurfaceReady,
    isTrustedChatGPTOrigin, CHATGPT_URL, superviseChatAgentResponse,
    executeChatAgentWrite,
  })

  const { executeChatTranslatorTask } = createTranslatorTaskRuntime({
    desktopWindows, createChatGPTWorkerView, publishChatAgentRuntimeState,
    chatAgentTaskPayload, assignChatGPTWorker, loadAndSettleChatGPTWorkerConversation,
    CHATGPT_URL, executeChatAgentMarkdownTranslation, chatAgentResidency,
    chatGPTWorkerEntries, retireChatGPTWorkerView,
  })

  const ephemeralWorkerViews = new Map()

  const { executeEphemeralWorkerTask } = createEphemeralWorkerRuntime({
    EPHEMERAL_WORKER_TASK_TYPES, EPHEMERAL_WORKER_IDLE_RETIRE_MS,
    EPHEMERAL_WORKER_PACE_PRIORITY, ephemeralWorkerViews, chatGPTWorkerEntries,
    desktopWindows, retireChatGPTWorkerView, createChatGPTWorkerView,
    publishChatAgentRuntimeState, chatAgentWorkerActivity,
    executeChatTranslatorTask, executeChatAgentTask: (...args) => executeChatAgentTask(...args),
    parkChatGPTWorkerAfterLoadFailure, releaseChatGPTConversationReadProbe,
  })

  const { executeChatAgentTask } = createChatAgentExecution({
    organizeChatGPTConversation,
    chatAgentBackoff,
    accountFailureDetail,
    persistWorkspaceChatRemote,
    enqueueChatAgentTask,
    chatAgentConversationID,
    chatAgentLifecycleRetry,
    chatAgentLifecycleBlocked,
    archiveChatGPTConversation,
    deleteChatGPTConversation,
    parseBundleName,
    deleteChatGPTLibraryArtifact,
    workerEntryForIndex,
    executeChatTranslatorTask,
    chatAgentRateLimitDelayMs,
    chatGPTConversationReadGateMs,
    chatAgentTaskPayload,
    sanitizeChatCacheKey,
    chatAgentConversationURL,
    chatGPTSupervisorOwnsExpectedResponse,
    CHAT_AGENT_AWAIT_PROBE_MS,
    assignChatGPTWorker,
    chatAgentResidency,
    sameConversationURL,
    loadAndSettleChatGPTWorkerConversation,
    isTrustedChatGPTOrigin,
    CHATGPT_URL,
    waitForChatGPTSurfaceReady,
    ChatGPTRateLimitDeferral,
    CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS,
    executeChatAgentOrchestratorPlan,
    executeOrchestratorExecution,
    orchestratorExecutionWorkerRuntime,
    executeChatAgentTodoClassification,
    executeReleaseNotesBundleTask,
    releaseNotesWorkerRuntime,
    executeUITestingTask,
    probeChatAgentResponse,
    executeChatAgentWrite,
    executeChatAgentTitleDiscover,
    executeChatAgentTempTitle,
    executeChatAgentTitleAwait,
  })

  return {
    chatSupervisorHostWindow, bindChatSupervisor, noteChatSupervisorLane,
    chatSupervisorLanesHeldByOthers, executeChatSupervisorTask,
    executeChatTranslatorTask, executeEphemeralWorkerTask, executeChatAgentTask,
  }
}
