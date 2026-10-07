import * as source9 from '../../../agent/index.mjs'

export function createAgentDependencies() {
  return {
    orchestratorCompletionDiagnostic: source9.orchestratorCompletionDiagnostic, executeOrchestratorExecution: source9.executeOrchestratorExecution, orchestratorContextIncrementPaths: source9.orchestratorContextIncrementPaths,
    rearmOrchestratorPlanDownload: source9.rearmOrchestratorPlanDownload, sendOrchestratorContextIncrement: source9.sendOrchestratorContextIncrement, orchestratorRetryInput: source9.orchestratorRetryInput,
    orchestratorPlanFilename: source9.orchestratorPlanFilename, orchestratorBundleFilename: source9.orchestratorBundleFilename, orchestratorDeliveryFor: source9.orchestratorDeliveryFor,
    registerOrchestratorExecutionDownload: source9.registerOrchestratorExecutionDownload, OrchestrationTaskPins: source9.OrchestrationTaskPins, orchestratorRequestFilename: source9.orchestratorRequestFilename,
    writeOrchestratorRequestBundle: source9.writeOrchestratorRequestBundle, captureChatGPTAgentPage: source9.captureChatGPTAgentPage, captureParkedWorkerPage: source9.captureParkedWorkerPage,
    createChatAgentFollowups: source9.createChatAgentFollowups, createWorkerInteraction: source9.createWorkerInteraction, createDesktopSupervisorSurfaces: source9.createDesktopSupervisorSurfaces,
    closeWorkerMonitor: source9.closeWorkerMonitor, closeWorkerMonitorAfterState: source9.closeWorkerMonitorAfterState, openWorkerMonitor: source9.openWorkerMonitor,
    chatAgentMemorySnapshot: source9.chatAgentMemorySnapshot, projectAgentBrowser: source9.publicAgentBrowser, buildChatAgentRuntimeState: source9.buildChatAgentRuntimeState,
    chatAgentLiveBundlePending: source9.chatAgentLiveBundlePending, publicSupervisorId: source9.publicSupervisorId, supervisorSurfaceRoute: source9.supervisorSurfaceRoute,
    DEFAULT_SUPERVISOR_SLOTS: source9.DEFAULT_SUPERVISOR_SLOTS, DEFAULT_WORKER_SLOTS: source9.DEFAULT_WORKER_SLOTS, HARD_MAX_SUPERVISOR_SLOTS: source9.HARD_MAX_SUPERVISOR_SLOTS,
    HARD_MAX_WORKER_SLOTS: source9.HARD_MAX_WORKER_SLOTS, normalizeSupervisorSlotCount: source9.normalizeSupervisorSlotCount, normalizeWorkerSlotCount: source9.normalizeWorkerSlotCount,
    autoScaleDrainTarget: source9.autoScaleDrainTarget, autoScaleSupervisorDrainTarget: source9.autoScaleSupervisorDrainTarget, autoScaleSupervisorTarget: source9.autoScaleSupervisorTarget,
    autoScaleTarget: source9.autoScaleTarget, normalizeChatAgentPolicies: source9.normalizeChatAgentPolicies, workerSuspensionState: source9.workerSuspensionState,
    workerSuspendsAllTaskTypes: source9.workerSuspendsAllTaskTypes, createChatAgentPolicyStore: source9.createChatAgentPolicyStore, createKeepFlowingState: source9.createKeepFlowingState,
    autoScaleWorkerDemand: source9.autoScaleWorkerDemand, MAX_TRANSLATOR_SLOTS: source9.MAX_TRANSLATOR_SLOTS, translatorCapacityTarget: source9.translatorCapacityTarget,
    chatAgentQueueDiagnostics: source9.chatAgentQueueDiagnostics, ChatAgentSchedulerClient: source9.ChatAgentSchedulerClient, chatAgentBackoff: source9.chatAgentBackoff,
    createChatAgentTaskQueue: source9.createChatAgentTaskQueue, chatAgentTaskPayload: source9.chatAgentTaskPayload, createChatAgentConversationURL: source9.createChatAgentConversationURL,
    createWorkerScheduler: source9.createWorkerScheduler, createTranslatorScheduler: source9.createTranslatorScheduler, createSupervisorScheduler: source9.createSupervisorScheduler,
    createChatAgentSchedulingOperations: source9.createChatAgentSchedulingOperations, createDesktopAgentScheduling: source9.createDesktopAgentScheduling, createChatAgentRuntimeRefresh: source9.createChatAgentRuntimeRefresh,
    createChatAgentRuntimeControls: source9.createChatAgentRuntimeControls, CHAT_AGENT_TRANSLATION_ACTION_GAP_MS: source9.CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS: source9.CHAT_AGENT_WORKER_ACTION_GAP_MS,
    ChatAgentGlobalPacer: source9.ChatAgentGlobalPacer, WorkerActivity: source9.WorkerActivity, ChatAgentResidency: source9.ChatAgentResidency,
    CHAT_AGENT_NAVIGATION_GAP_MS: source9.CHAT_AGENT_NAVIGATION_GAP_MS, CHAT_AGENT_AWAIT_PROBE_MS: source9.CHAT_AGENT_AWAIT_PROBE_MS, chatAgentLane: source9.chatAgentLane,
    orchestratorTaskChat: source9.orchestratorTaskChat, createWorkerPacing: source9.createWorkerPacing, CHATGPT_BEHAVIOR: source9.CHATGPT_BEHAVIOR,
    reasoningEffortStateScript: source9.reasoningEffortStateScript, executeReleaseNotesBundleTask: source9.executeReleaseNotesBundleTask, registerReleaseNotesBundleDownload: source9.registerReleaseNotesBundleDownload,
    markdownTranslationFilename: source9.markdownTranslationFilename, todoClassificationFilename: source9.todoClassificationFilename, uiTestingDiscoveryFilename: source9.uiTestingDiscoveryFilename, EPHEMERAL_WORKER_TASK_TYPES: source9.EPHEMERAL_WORKER_TASK_TYPES,
    EPHEMERAL_AGENT_ID: source9.EPHEMERAL_AGENT_ID, EPHEMERAL_WORKER_LABELS: source9.EPHEMERAL_WORKER_LABELS, EPHEMERAL_WORKER_IDLE_RETIRE_MS: source9.EPHEMERAL_WORKER_IDLE_RETIRE_MS,
    EPHEMERAL_WORKER_PACE_PRIORITY: source9.EPHEMERAL_WORKER_PACE_PRIORITY, pollWorkerExpectedDownload: source9.pollWorkerExpectedDownload, registerAgentIPC: source9.registerAgentIPC, registerUITestingGuideIPC: source9.registerUITestingGuideIPC,
  }
}
