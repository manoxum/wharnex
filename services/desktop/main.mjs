// Keep this import prelude intact: self-evolution host builds syntax-check the entrypoint before activation.
import { createDesktopBaseDependencies } from './composition/entry/dependencies/index.mjs'
import { createArtifactWorkerRuntime } from './composition/utilities/artifacts/index.mjs'
import { createAgentWorkerRuntime } from './composition/workers/runtime/index.mjs'
import { createRecoveryRuntime } from './composition/supervision/recovery/index.mjs'
import { createResponseRuntime } from './composition/transport/response/index.mjs'
import { createOrchestrationRuntime } from './composition/orchestration/index.mjs'
import { createDesktopCollections } from './composition/state/index.mjs'
import { createDesktopCompositionSettings } from './composition/config/index.mjs'
import { createDesktopChatGPTTransportStage } from './composition/transport/index.mjs'
import { createDesktopWindowAssembly } from './composition/window/index.mjs'
import { createDesktopEntrypointRuntime } from './composition/entry/index.mjs'
import { createDesktopAuthViewRuntime, createDesktopOwnershipRuntime, createDesktopChatWorkflowRuntime } from './composition/session/index.mjs'

const {
  app, BrowserWindow, ClipboardItem, Menu, Notification, Tray, WebContentsView, clipboard,
  dialog, ipcMain, nativeImage, screen, session, shell, createHash, randomUUID,
  mkdirSync, rmSync, mkdir, readFile, readdir, rm, writeFile, path,
  fileURLToPath, TextDecoder, ChatGPTSubmitCoordinator, dispatchChatGPTAccountKey, dispatchChatGPTPointerClick, dispatchChatGPTPointerPress, submitWithoutReplay, ChatGPTUploadCoordinator,
  chatGPTUploadThumbnailScript, pasteWithUploadRetry, plannerPromptMarkdown, selectChatGPTUploadFile, waitForChatGPTReady, createChatGPTFileUpload, registerExpectedBundleRecoveryIPC, registerChatGPTBundleIPC,
  shouldAttachProjectContext, chatGPTDeliveryContinuationPrompt, chooseChatGPTRecoveryAction, classifyChatGPTConversationTransport, commitChatGPTRecoveryAction, createChatGPTRecoveryState, isChatGPTConversationTransportURL, isRecoverableChatGPTNetworkError,
  noteChatGPTRecoveryAssistantCount, noteChatGPTRecoveryFault, noteChatGPTRecoveryProgress, reconcileChatGPTConversationTransport, recordChatGPTConversationTransport, claimNetworkFaultReloadSlot, isNetworkRecoveryFault, RATE_LIMIT_GATE,
  classifyChatGPTRateLimit, registerChatAttachmentIPC, throwIfChatGPTTransportAborted, boundedChatInputPartBytes, requestPreparationTimer, withRequestPreparationDeadline, createManualChatGPTTransport, classifyChatGPTRequestDelivery,
  registerChatGPTPromptIPC, createChatGPTDraftSubmission, preserveLocalFocusDuringBackgroundOperation, installNativeSurfaceLifecycleGuard, recoverableDesktopWindows, MIN_DESKTOP_WINDOW_SIZE, ProjectWindowRegistry, canonicalProjectPath,
  registerWindowIPC, spellcheckContextMenuTemplate, createWorkspaceSurfaceRouting, registerDesktopShellIPC, registerSpellcheckIPC, createDesktopWindowCreator, securePreferences, restoreDesktopWindowsAtStartup,
  orchestratorCompletionDiagnostic, executeOrchestratorExecution, orchestratorContextIncrementPaths, rearmOrchestratorPlanDownload, sendOrchestratorContextIncrement, orchestratorRetryInput, orchestratorPlanFilename, orchestratorBundleFilename,
  orchestratorDeliveryFor, registerOrchestratorExecutionDownload, OrchestrationTaskPins, orchestratorRequestFilename, writeOrchestratorRequestBundle, captureChatGPTAgentPage, captureParkedWorkerPage, createChatAgentFollowups,
  createWorkerInteraction, createDesktopSupervisorSurfaces, closeWorkerMonitor, closeWorkerMonitorAfterState, openWorkerMonitor, chatAgentMemorySnapshot, projectAgentBrowser, buildChatAgentRuntimeState,
  chatAgentLiveBundlePending, publicSupervisorId, supervisorSurfaceRoute, DEFAULT_SUPERVISOR_SLOTS, DEFAULT_WORKER_SLOTS, HARD_MAX_SUPERVISOR_SLOTS, HARD_MAX_WORKER_SLOTS, normalizeSupervisorSlotCount,
  normalizeWorkerSlotCount, autoScaleDrainTarget, autoScaleSupervisorDrainTarget, autoScaleSupervisorTarget, autoScaleTarget, normalizeChatAgentPolicies, workerSuspensionState, workerSuspendsAllTaskTypes,
  createChatAgentPolicyStore, createKeepFlowingState, autoScaleWorkerDemand, MAX_TRANSLATOR_SLOTS, translatorCapacityTarget, chatAgentQueueDiagnostics, ChatAgentSchedulerClient, chatAgentBackoff,
  createChatAgentTaskQueue, chatAgentTaskPayload, createChatAgentConversationURL, createWorkerScheduler, createTranslatorScheduler, createSupervisorScheduler, createChatAgentSchedulingOperations, createDesktopAgentScheduling,
  createChatAgentRuntimeRefresh, createChatAgentRuntimeControls, CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS, ChatAgentGlobalPacer, WorkerActivity, ChatAgentResidency, CHAT_AGENT_NAVIGATION_GAP_MS,
  CHAT_AGENT_AWAIT_PROBE_MS, chatAgentLane, orchestratorTaskChat, createWorkerPacing, CHATGPT_BEHAVIOR, reasoningEffortStateScript, executeReleaseNotesBundleTask, registerReleaseNotesBundleDownload,
  markdownTranslationFilename, todoClassificationFilename, EPHEMERAL_WORKER_TASK_TYPES, EPHEMERAL_AGENT_ID, EPHEMERAL_WORKER_LABELS, EPHEMERAL_WORKER_IDLE_RETIRE_MS, EPHEMERAL_WORKER_PACE_PRIORITY, pollWorkerExpectedDownload,
  registerAgentIPC, readStoredAttachment, removeStoredChatAttachments, storedAttachmentPath, buildBundleName, parseBundleName, safeChatId, uploadChatArtifact,
  chatInputArchiveFilename, chatInputPartManifest, localChatInputBootstrap, writeChatInputTransportArchives, MAX_CONTEXT_BYTES, MAX_PLAN_BYTES, MAX_EXECUTION_BUNDLE_BYTES, MAX_MARKDOWN_TRANSLATION_BYTES,
  MAX_MARKDOWN_TRANSLATION_RESULT_BYTES, MAX_TODO_CLASSIFICATION_BYTES, TODO_CLASSIFICATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS, MAX_ORCHESTRATOR_PLAN_BYTES, ORCHESTRATOR_PLAN_TIMEOUT_MS, ORCHESTRATOR_PLAN_GENERATING_GRACE_MS,
  ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS, CHATGPT_URL, CHATGPT_LOGIN_URL, CHATGPT_LIBRARY_URL, CHATGPT_PARTITION, CHATGPT_CHROMIUM_VERSION, CHATGPT_ACCEPT_LANGUAGES, CHATGPT_AFFINITY_RECOVERY_GRACE_MS,
  EXPIRED_ARTIFACT_TTL_MS, RETRYABLE_PROMPT_TTL_MS, DELIVERED_BUNDLE_DEDUP_TTL_MS, EXPECTED_BUNDLE_TTL_MS, DOM_DOWNLOAD_POLL_MS, DOM_DOWNLOAD_RETRY_MS, DOWNLOAD_INFLIGHT_TIMEOUT_MS, BUNDLE_COMPLETION_GRACE_MS,
  BUNDLE_CONTINUATION_BASE_MS, BUNDLE_COMPLETION_CONFIRM_MS, MAX_BUNDLE_CONTINUATIONS, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, PROCESSING_SIGNAL_GRACE_MS, BUNDLE_UNOBSERVED_SETTLE_MS, CONVERSATION_TRANSPORT_STALE_MS, PROCESSING_STALE_ATTENTION_MS,
  AWAIT_STALL_ATTENTION_MS, CHATGPT_RATE_LIMIT_BACKOFF_MS, CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS, CHATGPT_DOM_PROBE_FAILURE_LIMIT, CHATGPT_ACCOUNT_ACTION_SETTLE_MS, CHATGPT_MENU_REOPEN_ATTEMPTS, CHATGPT_CONTROL_PRESS_HOLD_MS, DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
  chatGPTComposerReadyScript, chatGPTExpectedDownloadScript, chatGPTHumanActionScript, chatGPTResponseCompletionScript, chatGPTFillComposerScript, chatGPTSubmitScript, chatGPTVisibleActivityScript, chatGPTProcessingDurationScript,
  chatGPTSubmittedRequestEvidenceScript, behaviorProbeScript, isBehaviorProbeEnabled, normalizeBehaviorProbeResult, sanitizeBehaviorProbeControl, BEHAVIOR_PROBE_CONTROLS, ensureChatGPTReasoningEffort, normalizeChatGPTReasoningEffort,
  stepChatGPTEffort, evaluateChatGPTDOMWithDeadline, accountFailureDetail, ChatGPTAccountProviderChain, pathSize, restoreBrowserSession, snapshotBrowserSession, createBrowserSessionOperations,
  createInternalChatGPTBrowser, registerBrowserDataIPC, chatGPTNavigationDisposition, chatInputSettleDelay, chromeCompatibleUserAgent, isChatGPTAuthURL, isHTTPS, isTrustedChatGPTOrigin,
  normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatCacheKey, sanitizeOptionalChatCacheKey, sanitizeChatGPTAuthMode, sanitizeDiagnosticURL, sanitizeSessionId,
  BundleOwnershipError, canonicalWharnessBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename, confirmChatGPTAffinity, createChatGPTAffinityTracker,
  isChatGPTAffinityAwaitingSettlement, markChatGPTAffinitySubmitted, observeChatGPTAffinity, proposeChatGPTAffinity, publicChatGPTAffinity, rejectChatGPTAffinity, settleChatGPTAffinity, shouldPreserveChatGPTAffinityNavigation,
  syncChatGPTAffinity, chatGPTSessionProbeExpression, closeManagedBrowserAuth, electronCookieDetails, launchManagedBrowserAuth, managedBrowserProfileDirectory, registerChatGPTAccountIPC, registerChatGPTSessionControlIPC,
  registerChatGPTSurfaceIPC, createWorkspaceChatRemote, createChatGPTRateLimitResume, createChatGPTConversationReadHealth, createChatGPTCacheMarker, configureChatGPTSession, createChatGPTConversationURLs, chatGPTConversationLoadFailureScript,
  withChatGPTNavigationDeadline, desktopInstanceName, desktopWindowTitle, initializeDesktopIdentity, configureDesktopProcess, registerClipboardIPC, traceForTask, traceId,
  withTrace,
} = createDesktopBaseDependencies()

const here = path.dirname(fileURLToPath(import.meta.url))
const { DESKTOP_INSTANCE, DESKTOP_ICON, FRONTEND_URL, BACKEND_URL, FRONTEND_ORIGIN, FRONTEND_RUNTIME_TOKEN } =
  initializeDesktopIdentity({ app, nativeImage, environment: process.env, consoleTarget: console, globalTarget: globalThis, requireLocalHTTPURL })
// Supervisor ownership and transport factories capture these functions during
// module evaluation, so establish them before composing those factories.
const {
  conversationID: chatGPTConversationID,
  canonicalURL: canonicalChatGPTConversationURL,
  sameConversation: sameConversationURL,
} = createChatGPTConversationURLs(requireTrustedChatGPTURL)
const settings = createDesktopCompositionSettings()
const CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS = settings.staleAssignmentRetryMs
const CHATGPT_USER_AGENT = settings.chatGPTUserAgent
const CHATGPT_BUNDLE_RETENTION_MS = settings.bundleRetentionMs
configureDesktopProcess({
  app, BrowserWindow, environment: process.env, platform: process.platform,
  processTarget: process, logger: console, getMainWindow: () => mainWindow,
})

let mainWindow
let desktopTrayControl
const {
  chatgptViews, chatGPTWorkerEntries, chatAgentWorkerStates, chatSupervisorStates,
  activeChatTranslatorSlots, chatGPTAuthBrowsers, internalChatGPTBrowsers,
  desktopWindows, projectWindowRegistry, preparedChatGPTDrafts,
  retryableChatGPTPrompts, pendingChatGPTComments, flushingChatGPTComments,
  recentChatGPTCommentIds, recentChatGPTCommentFingerprints,
  chatGPTActivityFingerprints, expectedChatGPTBundles, expectedChatGPTTranslations,
  expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications,
  expectedChatGPTOrchestratorPlans, expectedChatGPTOrchestratorExecutions,
  pollingExpectedChatGPTBundles, chatGPTTransportTails,
  chatGPTExpiredArtifactConversations, pendingChatGPTBundleDeliveries,
  deliveredChatGPTBundleRequestIds, chatgptTransportModes,
} = createDesktopCollections(ProjectWindowRegistry)
let chatSupervisorScheduler
let chatTranslatorScheduler
let dueChatTranslations = 0
let configuredChatAgentSupervisorSlots = DEFAULT_SUPERVISOR_SLOTS
let desiredChatAgentSupervisorSlots = DEFAULT_SUPERVISOR_SLOTS
let configuredChatAgentWorkerSlots = DEFAULT_WORKER_SLOTS
let desiredChatAgentWorkerSlots = DEFAULT_WORKER_SLOTS
let chatAgentPolicies = normalizeChatAgentPolicies()
let chatAgentScheduler
let chatAgentRuntimeDiagnostics = {
  scheduler: { running: false, backend_reachable: false, last_refresh_at: '', last_error: '' },
  queue: { queued: 0, counts: {}, due: 0, scheduled: 0, guarded: 0, blocked: 0, oldest_due_created_at: '', next_not_before: '' },
  provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', rate_limit_level: 0, last_rate_limit_at: '', last_rate_limit_source: '', last_valid_bundle_at: '', average_processing_ms: 0, valid_sample_count: 0, initial_wait_ms: 60_000, updated_at: '' },
}
let deferredSupervisorNavigation
let deferredSupervisorNavigationTimer
let quitting = false
let explicitDesktopExit = false
let pollingChatGPTVisibleActivity = false
const chatAgentResidency = new ChatAgentResidency({ minResidenceMs: Number(process.env.WHARNESS_CHAT_AGENT_RESIDENCY_MS || 30_000) })
const orchestrationTaskPins = new OrchestrationTaskPins()
const chatGPTWorkerPacer = new ChatAgentGlobalPacer()
// Phase changes can come several per second from one task; coalesce them into
// the runtime-state broadcast instead of recomputing it for each.
let chatAgentWorkerActivityPublishTimer
const chatAgentWorkerActivity = new WorkerActivity({
  onChange: () => {
    if (chatAgentWorkerActivityPublishTimer) return
    chatAgentWorkerActivityPublishTimer = setTimeout(() => {
      chatAgentWorkerActivityPublishTimer = undefined
      publishChatAgentRuntimeState()
    }, 250)
  },
})
let chatGPTRateLimitUntil = 0
let chatGPTRateLimitResumeProbeRequired = false
let chatGPTRateLimitResumeProbe
let chatGPTRateLimitResumeProbeNotBefore = 0
// Recent provider refusals, used to tell one throttled request apart from an
// account-wide gate. Ephemeral Desktop state; the resulting suspension is
// durable backend state.
let chatGPTRateLimitHits = []
let chatGPTRateLimitKind = ''
// When the newest local gate was applied, so a stale provider reading cannot
// clear a suspension that has not reached the backend yet.
let chatGPTRateLimitAppliedAt = 0
const manualChatGPTTransport = createManualChatGPTTransport({
  clipboard,
  ClipboardItem,
  onStateChange: (key) => publishChatGPTState(key),
})
let chatGPTAccountOperation = Promise.resolve()
const chatGPTAccountProviders = new ChatGPTAccountProviderChain({})
const CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS = settings.autoScaleDrainCooldownMs
let chatAgentWorkerLastGrowAt = 0
let chatAgentSupervisorLastGrowAt = 0
const CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS = settings.runtimeStateBroadcastMs
const CHAT_AGENT_SUBMIT_GAP_MS = settings.submitGapMs
const CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS = settings.submitGapRecoveryMs
const CHATGPT_WORKER_NAVIGATION_GAP_MS = settings.navigationGapMs
const CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS = settings.navigationGapHealthyMs
const FRONTEND_RENDERER_RESTART_LIMIT = settings.frontendRendererRestartLimit
const CHAT_AGENT_STARTUP_DELAY_MS = settings.startupDelayMs
const CHAT_AGENT_WORKER_SPAWN_GAP_MS = settings.workerSpawnGapMs
let chatGPTDownloadPoller
let recentExpectedDownload
const chatGPTUploads = new ChatGPTUploadCoordinator()
const chatGPTSubmissions = new ChatGPTSubmitCoordinator()

const { publishChatAgentRuntimeState, pauseChatAgentWorkers, resumeChatAgentWorkers } =
  createChatAgentRuntimeControls({
    getRuntimeState: () => chatAgentRuntimeState(),
    desktopWindows, sendToWindowState: (...args) => sendToWindowState(...args),
    refreshDesktopTray: () => refreshDesktopTray(),
    broadcastDelayMs: CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS,
    state: {
      get policies() { return chatAgentPolicies },
      set policies(value) { chatAgentPolicies = value },
      get scheduler() { return chatAgentScheduler },
    },
    normalizeChatAgentPolicies,
    persistChatAgentPolicies: (...args) => persistChatAgentPolicies(...args),
  })
const {
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
} = createDesktopOwnershipRuntime({
  desktopWindows, chatgptViews, chatGPTWorkerEntries, expectedChatGPTBundles, expectedChatGPTTranslations,
  expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications, expectedChatGPTOrchestratorPlans, pendingChatGPTComments, chatgptTransportModes,
  canonicalChatGPTConversationURL, sameConversationURL, pendingChatGPTBundleDeliveries, chatGPTTransportTails, chatSupervisorStates,
  preparedChatGPTDrafts, retryableChatGPTPrompts, RETRYABLE_PROMPT_TTL_MS, sanitizeOptionalChatCacheKey, chatAgentConversationID,
  chatAgentResidency, withTrace, traceId, sanitizeChatCacheKey,
  hasPendingChatGPTComments: (...args) => hasPendingChatGPTComments(...args),
  getDesiredChatAgentSupervisorSlots: () => desiredChatAgentSupervisorSlots,
  requireOwnedEntry: (...args) => requireOwnedChatGPTEntry(...args),
  deferredNavigationPending: () => Boolean(deferredSupervisorNavigation),
  applyDeferredNavigation: () => applyDeferredSupervisorNavigation(),
  ensureChatGPTView: (...args) => ensureChatGPTView(...args),
})

const {
  acquireProjectForWindow, suspendNativeSurfacesForWindow, releaseProjectForWindow,
  releaseWindowProjects, persistDesktopRecoverySession, consumeDesktopRecoverySession,
  projectMenuLabel, projectWindowState, restoreProjectWindow, requestProjectClose,
  activeDesktopProjects, showDesktopFallbackWindow, sendDesktopTrayProjectAction,
  desktopTrayController, publishDesktopNotification, refreshDesktopTray,
  ensureDesktopTray, requestFullDesktopQuit, desktopWindowClose, chatGPTCacheMarker,
  persistWindowLayout, scheduleWindowLayoutPersistence, loadWindowLayout,
  loadWindowPlacement, persistRestartIntent, consumeRestartIntent,
  waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch,
} = createDesktopWindowAssembly({
  app, dialog, Menu, Notification, Tray, nativeImage,
  session, DESKTOP_ICON, DESKTOP_INSTANCE, desktopInstanceName, desktopWindowTitle, desktopWindows,
  projectWindowRegistry, canonicalProjectPath, activeChatGPTEntry, reconcileChatGPTThrottle, chatGPTKeyForEntry, sendToWindowState,
  chatAgentRuntimeState, resumeChatAgentWorkers, createChatGPTCacheMarker, CHATGPT_CHROMIUM_VERSION,
  platform: process.platform,
  pauseChatAgentWorkers: () => pauseChatAgentWorkers({}),
  userDataPath: () => app.getPath('userData'), displays: () => screen.getAllDisplays(),
  getTrayControl: () => desktopTrayControl,
  setTrayControl: (control) => { desktopTrayControl = control },
  setMainWindow: (window) => { mainWindow = window },
  getDeferredSupervisorNavigation: () => deferredSupervisorNavigation,
  refreshDesktopTray: () => refreshDesktopTray(),
  createWindow: (...args) => createWindow(...args),
  hideAgentInteractionsForWindow: (...args) => hideChatAgentInteractionsForWindow(...args),
  persistWindowLayout: () => persistWindowLayout(),
  markExplicitDesktopExit: () => { explicitDesktopExit = true },
  isQuitting: () => quitting,
})

const {
  canonicalBundleFilename, authoritativeBundleFilename, armExpectedChatGPTBundle,
  disarmExpectedChatGPTBundle, cancelChatGPTRequestState, chatGPTAssistantTurnCount,
  expectedChatGPTBundleForDownload, chatGPTExpectedKeyForRequest,
  recentlyDeliveredChatGPTBundleRequestId, markChatGPTBundleRequestDelivered,
  chatGPTBundleAlreadyValidated, quiesceChatGPTRecoveryAfterValidatedBundle,
  pendingBundleDirectory, pendingChatGPTBundlePayloads, acknowledgeChatGPTBundle,
  chatGPTPartitionPath, managedAuthProfilePath, pendingBrowserImportPath,
  closeInternalChatGPTBrowserForWindow, closeAllInternalChatGPTBrowsers,
  rehomeChatGPTWorkers, closeChatGPTViewsForWindow, closeAllChatGPTViews,
  chatGPTEntryForWebContentsID, noteChatGPTNetworkActivity, noteChatGPTNetworkFailure,
  requireOwnedChatGPTEntry, releaseChatGPTView, setChatGPTBounds, currentChatGPTState,
  publishChatGPTState, observeChatGPTAffinityURL, syncChatGPTAffinityURL,
  proposeCurrentChatGPTAffinity, settleChatGPTAffinityAfterSubmit,
  scheduleChatGPTAffinitySettlement, noteChatGPTRendererFault, chatGPTHumanActionMessage,
  setChatGPTHumanAction, clearChatGPTHumanAction, applyChatGPTRateLimit,
  noteChatGPTRateLimitGate, chatGPTInterpreterDownloadConversation,
  noteChatGPTExpiredArtifact, chatGPTArtifactExpiredSince, noteChatGPTHTTPStatus,
  publishPlanDownload, publishPlanDownloadError, publishBundleDownload,
  publishBundleDownloadError, deliverOrchestratorTaskBundle,
  registerChatGPTMarkdownTranslationDownload, registerChatGPTTodoClassificationDownload,
  chatGPTDownloadIsHumanBrowsing, orchestratorPlanDownloads,
  registerChatGPTOrchestratorPlanDownload, takeRetainedChatGPTOrchestratorPlan,
  handleLegacyPlanDownload, recordValidBundleMetric, handleBundleDownload,
  registerChatGPTPlanDownloads,
} = createDesktopChatWorkflowRuntime({
  app, path, readdir, readFile, rm, buildBundleName,
  safeChatId, wharnessBundleRequestIdFromFilename, parseBundleName, sanitizeChatCacheKey, sanitizeOptionalChatCacheKey, expectedChatGPTBundles,
  createChatGPTRecoveryState, abortChatGPTTransportPreparations, retryableChatGPTPrompts, preparedChatGPTDrafts, manualChatGPTTransport, pendingChatGPTComments,
  chatgptViews, reconcileChatGPTThrottle, publishChatAgentRuntimeState, deliveredChatGPTBundleRequestIds, pendingChatGPTBundleDeliveries, validateWharnessBundleDownload,
  managedBrowserProfileDirectory, EXPECTED_BUNDLE_TTL_MS, DELIVERED_BUNDLE_DEDUP_TTL_MS, CHATGPT_BUNDLE_RETENTION_MS, internalChatGPTBrowsers, chatGPTAuthBrowsers,
  chatGPTWorkerEntries, desktopWindows, closeManagedBrowserAuth, flushingChatGPTComments, chatGPTActivityFingerprints, chatGPTTransportTails,
  chatGPTExpiredArtifactConversations, sendToChatGPTKey, windowStateForEntry, normalizeBounds, activeChatGPTEntry, publicSupervisorId,
  publicChatGPTAffinity, sendToWindowState, CHATGPT_URL, sanitizeDiagnosticURL, chatGPTKeyForEntry, requireTrustedChatGPTURL,
  observeChatGPTAffinity, syncChatGPTAffinity, proposeChatGPTAffinity, settleChatGPTAffinity, isChatGPTAffinityAwaitingSettlement, Notification,
  classifyChatGPTRateLimit, RATE_LIMIT_GATE, CHATGPT_RATE_LIMIT_BACKOFF_MS, EXPIRED_ARTIFACT_TTL_MS, noteChatGPTRecoveryProgress, noteChatGPTRecoveryFault,
  isChatGPTConversationTransportURL, recordChatGPTConversationTransport, isRecoverableChatGPTNetworkError, BACKEND_URL, expectedChatGPTTranslations, expectedChatGPTTodoClassifications,
  MARKDOWN_TRANSLATION_TIMEOUT_MS, MAX_MARKDOWN_TRANSLATION_RESULT_BYTES, TODO_CLASSIFICATION_TIMEOUT_MS, MAX_TODO_CLASSIFICATION_BYTES, expectedChatGPTOrchestratorPlans, MAX_ORCHESTRATOR_PLAN_BYTES,
  ORCHESTRATOR_PLAN_TIMEOUT_MS, MAX_PLAN_BYTES, wharnessPlanRequestIdFromFilename, validateWharnessPlanFile, chatAgentConversationID, MAX_EXECUTION_BUNDLE_BYTES,
  chatAgentWorkerActivity, registerOrchestratorExecutionDownload, expectedChatGPTOrchestratorExecutions, registerReleaseNotesBundleDownload, expectedChatGPTReleaseNotes, chatGPTKeyForWebContents,
  canonicalWharnessBundleDownload, BundleOwnershipError,
  clearChatGPTHumanAction: (...args) => clearChatGPTHumanAction(...args),
  scheduler: () => chatAgentScheduler, recentDownload: () => recentExpectedDownload,
  refreshChatAgentRuntimeState: (...args) => refreshChatAgentRuntimeState(...args),
  enqueueChatAgentTask: (...args) => enqueueChatAgentTask(...args),
  rateState: {
    get hits() { return chatGPTRateLimitHits }, set hits(value) { chatGPTRateLimitHits = value },
    get until() { return chatGPTRateLimitUntil }, set until(value) { chatGPTRateLimitUntil = value },
    get resumeProbeRequired() { return chatGPTRateLimitResumeProbeRequired },
    set resumeProbeRequired(value) { chatGPTRateLimitResumeProbeRequired = value },
    get kind() { return chatGPTRateLimitKind }, set kind(value) { chatGPTRateLimitKind = value },
    get appliedAt() { return chatGPTRateLimitAppliedAt }, set appliedAt(value) { chatGPTRateLimitAppliedAt = value },
    get policies() { return chatAgentPolicies }, get scheduler() { return chatAgentScheduler },
    get runtimeDiagnostics() { return chatAgentRuntimeDiagnostics },
  },
  hideAgentInteractionsForWindow: (...args) => hideChatAgentInteractionsForWindow(...args),
  grantChatGPTLayoutViewport: (...args) => grantChatGPTLayoutViewport(...args),
  retireChatGPTSupervisorSurface: (...args) => retireChatGPTSupervisorSurface(...args),
  supervisorBindingHeld: (...args) => supervisorBindingHeld(...args),
  cancelExternalAuthentication: (...args) => cancelExternalAuthentication(...args),
  getDeferredSupervisorNavigation: () => deferredSupervisorNavigation,
  canonicalChatGPTConversationURL: (value) => canonicalChatGPTConversationURL(value),
  waitForConcreteChatGPTConversation: (...args) => waitForConcreteChatGPTConversation(...args),
  recordChatGPTTaskEvent: (...args) => recordChatGPTTaskEvent(...args),
  getRateLimitUntil: () => chatGPTRateLimitUntil,
  tempPath: () => app.getPath('temp'),
  recordProviderDiagnostics: (provider) => {
    chatAgentRuntimeDiagnostics.provider = { ...chatAgentRuntimeDiagnostics.provider, ...provider }
    publishChatAgentRuntimeState()
  },
})

const {
  publishAuthComplete, cancelExternalAuthentication, startExternalAuthentication,
  routeChatGPTNavigation, refreshEmbeddedChatGPTAuthentication,
  scheduleEmbeddedChatGPTAuthenticationProbe, observeEmbeddedAuthURL,
  loadOwnedChatGPTURL, createChatGPTView, createChatGPTWorkerView,
  retireChatGPTWorkerView,
} = createDesktopAuthViewRuntime({
  chatgptViews, chatGPTAuthBrowsers, chatGPTKeyForEntry, windowStateForEntry, sendToWindowState, publishChatGPTState,
  sanitizeDiagnosticURL, CHATGPT_LOGIN_URL, CHATGPT_URL, managedAuthProfilePath, closeManagedBrowserAuth, launchManagedBrowserAuth,
  electronCookieDetails, session, CHATGPT_PARTITION, isTrustedChatGPTOrigin, isChatGPTAuthURL, chatGPTNavigationDisposition,
  shell, chatGPTSessionProbeExpression, sanitizeChatCacheKey, requireTrustedChatGPTURL, requireOwnedChatGPTEntry, sameConversationURL,
  currentChatGPTState, chatAgentWorkerActivity, withChatGPTNavigationDeadline, CHATGPT_USER_AGENT, wait, WebContentsView,
  securePreferences, createChatGPTAffinityTracker, touchChatGPTEntry, observeChatGPTAffinityURL, scheduleChatGPTAffinitySettlement, expectedChatGPTBundles,
  chatgptTransportModes, isRecoverableChatGPTNetworkError, noteChatGPTRendererFault, noteChatGPTRecoveryProgress, clearChatGPTHumanAction, chatGPTWorkerEntries,
  chatAgentResidency, publishChatAgentRuntimeState, closeWorkerMonitor, classifyChatGPTConversationTransport, reconcileChatGPTConversationTransport,
  chatGPTSurfaceShouldBeVisible: (...args) => chatGPTSurfaceShouldBeVisible(...args),
  grantChatGPTLayoutViewport: (...args) => grantChatGPTLayoutViewport(...args),
  getDownloadPoller: () => pollExpectedChatGPTDownloadKey,
  getHideChatGPTSidebar: () => hideChatGPTSidebar,
  getHideChatAgentInteractionEntry: () => hideChatAgentInteractionEntry,
})

const desktopAgentScheduling = createDesktopAgentScheduling({
  state: {
    get desiredChatAgentWorkerSlots() { return desiredChatAgentWorkerSlots },
    set desiredChatAgentWorkerSlots(value) { desiredChatAgentWorkerSlots = value },
    get desiredChatAgentSupervisorSlots() { return desiredChatAgentSupervisorSlots },
    set desiredChatAgentSupervisorSlots(value) { desiredChatAgentSupervisorSlots = value },
    get configuredChatAgentWorkerSlots() { return configuredChatAgentWorkerSlots },
    get configuredChatAgentSupervisorSlots() { return configuredChatAgentSupervisorSlots },
    get chatAgentWorkerLastGrowAt() { return chatAgentWorkerLastGrowAt },
    set chatAgentWorkerLastGrowAt(value) { chatAgentWorkerLastGrowAt = value },
    get chatAgentSupervisorLastGrowAt() { return chatAgentSupervisorLastGrowAt },
    set chatAgentSupervisorLastGrowAt(value) { chatAgentSupervisorLastGrowAt = value },
    get chatAgentRuntimeDiagnostics() { return chatAgentRuntimeDiagnostics },
    set chatAgentRuntimeDiagnostics(value) { chatAgentRuntimeDiagnostics = value },
    get chatAgentScheduler() { return chatAgentScheduler },
    get chatSupervisorScheduler() { return chatSupervisorScheduler },
    get chatTranslatorScheduler() { return chatTranslatorScheduler },
    get chatAgentPolicies() { return chatAgentPolicies },
    get dueChatTranslations() { return dueChatTranslations },
    set dueChatTranslations(value) { dueChatTranslations = value },
    get quitting() { return quitting },
    get chatGPTRateLimitUntil() { return chatGPTRateLimitUntil },
    set chatGPTRateLimitUntil(value) { chatGPTRateLimitUntil = value },
    get chatGPTRateLimitResumeProbeRequired() { return chatGPTRateLimitResumeProbeRequired },
    set chatGPTRateLimitResumeProbeRequired(value) { chatGPTRateLimitResumeProbeRequired = value },
    get chatGPTRateLimitKind() { return chatGPTRateLimitKind },
    set chatGPTRateLimitKind(value) { chatGPTRateLimitKind = value },
    get chatGPTRateLimitAppliedAt() { return chatGPTRateLimitAppliedAt },
    set chatGPTRateLimitAppliedAt(value) { chatGPTRateLimitAppliedAt = value },
  },
  app, createChatAgentPolicyStore, createKeepFlowingState,
  createChatAgentSchedulingOperations, createWorkerInteraction,
  createChatAgentRuntimeRefresh, recentlyDeliveredChatGPTBundleRequestId,
  pendingChatGPTBundleDeliveries, expectedChatGPTBundles,
  chatGPTWorkerEntries, chatAgentWorkerStates, orchestrationTaskPins,
  normalizeSupervisorSlotCount, normalizeWorkerSlotCount,
  publishChatAgentRuntimeState, chatgptViews, chatSupervisorLeaseKeys,
  supervisorBindingHeld, chatAgentQueueDiagnostics,
  chatAgentRateLimitDelayMs: (...args) => chatAgentRateLimitDelayMs(...args),
  autoScaleWorkerDemand, autoScaleTarget,
  CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS, autoScaleDrainTarget,
  translatorCapacityTarget, activeChatTranslatorSlots,
  autoScaleSupervisorTarget, autoScaleSupervisorDrainTarget,
  desktopWindows, createChatGPTWorkerView, retireChatGPTWorkerView,
  wait, CHAT_AGENT_WORKER_SPAWN_GAP_MS, sanitizeChatCacheKey,
  chatAgentLane, chatAgentResidency, canonicalChatGPTConversationURL,
  createChatGPTAffinityTracker, syncChatGPTAffinity,
  touchChatGPTEntry, chatAgentLiveBundlePending,
  getEphemeralAgentID: () => EPHEMERAL_AGENT_ID, windowStateForEntry,
  grantChatGPTLayoutViewport: (...args) => grantChatGPTLayoutViewport(...args),
  normalizeBounds, HARD_MAX_WORKER_SLOTS,
  projectAgentBrowser, sanitizeDiagnosticURL, chatAgentMemorySnapshot,
  buildChatAgentRuntimeState, chatSupervisorSlotID, supervisorKeyForSlot,
  chatSupervisorStates, sanitizeOptionalChatCacheKey,
  supervisorBindingHold, chatAgentWorkerActivity,
  getEphemeralWorkerLabels: () => EPHEMERAL_WORKER_LABELS,
  supervisorEntry: () => supervisorEntry(),
  supervisorEntryForSlot: (...args) => supervisorEntryForSlot(...args),
  supervisorKey: (...args) => supervisorKey(...args),
  ensureChatGPTLayoutViewport: (...args) => ensureChatGPTLayoutViewport(...args),
  captureParkedWorkerPage, captureChatGPTAgentPage, BrowserWindow,
  openWorkerMonitor, closeWorkerMonitor,
})
const { policyStore: chatAgentPolicyStore, keepFlowing: keepFlowingState } = desktopAgentScheduling
const loadChatAgentPolicies = chatAgentPolicyStore.load
const persistChatAgentPolicies = chatAgentPolicyStore.persist
const chatAgentKeepFlowingConfigured = keepFlowingState.configured
const chatAgentKeepFlowingEnabled = keepFlowingState.enabled
const chatAgentKeepFlowingActive = keepFlowingState.active
const chatAgentKeepFlowingRequestActive = keepFlowingState.requestActive
const {
  chatAgentKeepFlowingFloor, chatAgentAvailableWorkers,
  setChatAgentSupervisorTarget, chatAgentAvailableSupervisors,
  setChatAgentWorkerTarget, reconcileChatAgentAutoScale,
  reconcileChatTranslatorCapacity, reconcileChatAgentSupervisorAutoScale,
  reconcileChatGPTWorkerPool, ensureChatGPTWorkerPool,
  primeChatGPTWorkerPool, assignChatGPTWorker, workerEntryForIndex,
  chatAgentSupervisingLiveResponse,
  workerEntryForAgentID, hideChatAgentInteractionEntry,
  hideChatAgentInteractionsForWindow, showChatAgentInteraction,
  setChatAgentInteractionBounds, closeChatAgentInteraction,
  reconcileChatAgentWorkerTasks, refreshChatAgentRuntimeState,
} = desktopAgentScheduling
function chatAgentRuntimeState() { return desktopAgentScheduling.chatAgentRuntimeState() }

const chatAgentBrowserSnapshot = desktopAgentScheduling.chatAgentBrowserSnapshot

const supervisorSurfaceDependencies = {
  navigationState: {
    get pending() { return deferredSupervisorNavigation },
    set pending(value) { deferredSupervisorNavigation = value },
    get timer() { return deferredSupervisorNavigationTimer },
    set timer(value) { deferredSupervisorNavigationTimer = value },
  },
  sanitizeChatCacheKey, chatgptViews, cancelExternalAuthentication,
  windowStateForEntry, desktopWindows,
  getDesiredChatAgentSupervisorSlots: () => desiredChatAgentSupervisorSlots,
  supervisorBindingHeld, createChatGPTView, requireOwnedChatGPTEntry,
  touchChatGPTEntry, chatGPTEntryIsActiveVisible, activeChatGPTEntry,
  reconcileChatGPTThrottle, setChatGPTBounds, publishChatGPTState,
  chatGPTKeyForEntry, sendToWindowState, currentChatGPTState,
  supervisorSurfaceRoute, requireTrustedChatGPTURL, CHATGPT_URL,
  sameConversationURL, loadOwnedChatGPTURL,
  flushQueuedChatGPTComments: (...args) => flushQueuedChatGPTComments(...args),
  DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
}
const {
  retireChatGPTSupervisorSurface, supervisorKey, supervisorEntry,
  supervisorSlotID, reusableSupervisor, ensureChatGPTView, evictIdleChatGPTViews,
  chatGPTSurfaceShouldBeVisible, activateChatGPTView,
  clearDeferredSupervisorNavigation, scheduleDeferredSupervisorNavigation,
  setDeferredSupervisorNavigation, differentSupervisorTransport,
  currentSupervisorSurfaceRoute, deferSupervisorNavigationIfBusy,
  applyDeferredSupervisorNavigation,
} = createDesktopSupervisorSurfaces(supervisorSurfaceDependencies)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const chatGPTTransportStageDependencies = {
  rateLimitState: {
    get until() { return chatGPTRateLimitUntil },
    get resumeProbeRequired() { return chatGPTRateLimitResumeProbeRequired },
    set resumeProbeRequired(value) { chatGPTRateLimitResumeProbeRequired = value },
    get resumeProbe() { return chatGPTRateLimitResumeProbe },
    set resumeProbe(value) { chatGPTRateLimitResumeProbe = value },
    get resumeProbeNotBefore() { return chatGPTRateLimitResumeProbeNotBefore },
    set resumeProbeNotBefore(value) { chatGPTRateLimitResumeProbeNotBefore = value },
  },
  canonicalChatGPTConversationURL, requireOwnedChatGPTEntry,
  settleChatGPTAffinityAfterSubmit, wait, BACKEND_URL, MAX_CONTEXT_BYTES,
  sanitizeSessionId, fetch, uploadChatArtifact, app, nativeImage,
  chatAgentWorkerActivity, requestPreparationTimer, throwIfChatGPTTransportAborted,
  path, rm, mkdir, readFile, randomUUID, writeChatInputTransportArchives,
  boundedChatInputPartBytes, withRequestPreparationDeadline,
  localChatInputBootstrap, chatGPTFillComposerScript, chatInputSettleDelay,
  sanitizeChatCacheKey, evaluateChatGPTDOMWithDeadline, waitForChatGPTReady,
  isTrustedChatGPTOrigin, chatGPTAccountProviders, BrowserWindow, desktopWindows,
  preserveLocalFocusDuringBackgroundOperation, windowStateForEntry,
  chatgptViews, dispatchChatGPTPointerPress, CHATGPT_CONTROL_PRESS_HOLD_MS,
  dispatchChatGPTAccountKey, CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
  CHATGPT_MENU_REOPEN_ATTEMPTS, ensureChatGPTView, requireTrustedChatGPTURL,
  sameConversationURL, loadOwnedChatGPTURL, chatGPTConversationID,
  dispatchChatGPTPointerClick, reconcileChatGPTThrottle,
  createChatGPTAffinityTracker, releaseChatGPTView, chatGPTKeyForEntry,
  parseBundleName, CHATGPT_LIBRARY_URL, CHATGPT_URL,
  syncChatGPTAffinityURL, proposeCurrentChatGPTAffinity,
  chatGPTHumanActionScript, noteChatGPTRateLimitGate,
  setChatGPTHumanAction, clearChatGPTHumanAction,
  chatGPTHumanActionMessage, chatGPTComposerReadyScript, touchChatGPTEntry,
  chatGPTConversationLoadFailureScript, chatAgentResidency,
  workerEntryForIndex, orchestrationTaskPins, chatGPTWorkerEntries,
  CHATGPT_USER_AGENT, sanitizeDiagnosticURL,
  getRuntimeDiagnostics: () => chatAgentRuntimeDiagnostics,
  CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS,
  CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS, CHATGPT_WORKER_NAVIGATION_GAP_MS,
  CHAT_AGENT_WORKER_ACTION_GAP_MS, chatGPTWorkerPacer,
  CHAT_AGENT_SUBMIT_GAP_MS, CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS,
  CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, pasteWithUploadRetry,
  chatGPTUploadThumbnailScript, chatGPTUploads, selectChatGPTUploadFile,
  normalizeChatGPTReasoningEffort, ensureChatGPTReasoningEffort,
  reasoningEffortStateScript, CHATGPT_BEHAVIOR, markChatGPTAffinitySubmitted,
  submitWithoutReplay, chatGPTSubmissions, chatGPTSubmitScript,
  authoritativeBundleFilename, chatgptTransportModes, retryableChatGPTPrompts,
  shouldAttachProjectContext, preparedChatGPTDrafts, manualChatGPTTransport,
  chatGPTAssistantTurnCount, armExpectedChatGPTBundle, disarmExpectedChatGPTBundle,
  expectedChatGPTBundles, refreshChatAgentRuntimeState,
  publishChatAgentRuntimeState, chatInputArchiveFilename, writeFile,
  chatInputPartManifest, recentlyDeliveredChatGPTBundleRequestId,
  RETRYABLE_PROMPT_TTL_MS, plannerPromptMarkdown, activateChatGPTView,
  canonicalBundleFilename, chatGPTBundleAlreadyValidated,
  MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, chatGPTDeliveryContinuationPrompt,
  durableWorkspaceChatID: (...args) => durableWorkspaceChatID(...args),
  persistWorkspaceChatRemoteBestEffort: (...args) => persistWorkspaceChatRemoteBestEffort(...args),
  enqueueChatAgentFollowups: (...args) => enqueueChatAgentFollowups(...args),
  enqueueChatAgentTask: (...args) => enqueueChatAgentTask(...args),
  getChatAgentScheduler: () => chatAgentScheduler,
}
const chatGPTTransportStage = createDesktopChatGPTTransportStage(chatGPTTransportStageDependencies)
const {
  waitForConcreteChatGPTConversation, waitForSubmittedChatGPTConversation,
  fetchContextZip, fetchChatContextSelection, fetchSelectedContextZip,
  fetchRequestGitContext, fetchRequestKnowledge, fetchRequestContinuation,
  persistChatArtifact, requireAutoSession,
  fetchChatTransportLimits, decodeChatAttachmentSet, decodeChatArtifactSet,
  createPersistentAttachmentPreview, chatAttachmentRoot,
  materializeChatInput, materializeProtocolChatInput, fillBundledChatGPTComposer,
  executeChatGPTDOMScript, waitForChatGPTSurfaceReady,
  runChatGPTAccountScript, hideChatGPTSidebar, focusedLocalWharnexContents,
  withPreservedLocalFocus, grantChatGPTLayoutViewport,
  ensureChatGPTLayoutViewport, pressChatGPTControl, pressChatGPTControlKey,
  commitChatGPTAccountControl, chooseChatGPTConversationAction,
  ensureChatGPTProject, organizeChatGPTConversation, suggestChatGPTConversationTitle,
  archiveChatGPTConversation, deleteChatGPTConversation,
  deleteChatGPTLibraryArtifact, stopChatGPTConversation,
  reloadOwnedChatGPTConversation, targetChatGPTComposer,
  chatGPTConversationReadCooldownMs, chatGPTConversationReadGateMs,
  releaseChatGPTConversationReadProbe, noteChatGPTConversationReadHealthy,
  noteChatGPTConversationReadFailure, recoverChatGPTConversationLoadFailure,
  parkChatGPTWorkerAfterLoadFailure, noteOrchestrationTaskPin,
  chatAgentRateLimitDelayMs, chatAgentRateLimitResumeBlocked,
  ChatGPTRateLimitDeferral, ChatGPTConversationUnavailable,
  chatAgentNavigationGapMs, paceChatGPTWorkerRequest, paceChatGPTWorkerNavigation,
  chatAgentSubmissionGapMs, paceChatGPTWorkerSubmission,
  loadAndSettleChatGPTWorkerConversation, pasteChatGPTFile,
  stepChatGPTReasoningEffortToward, submitChatGPTDraft,
  preparePromptForChatGPT, queuePreparedPromptForWorker,
  retryPersistedChatGPTPrompt, retryPreparedChatGPTPrompt,
  attachContextToChatGPT, attachPromptToChatGPT,
  submitPreparedChatGPTDraft, submitPromptToChatGPT,
  automaticChatGPTContinuationBlockReason, chatGPTContinuationSuppressedError,
  submitChatGPTContinuation,
} = chatGPTTransportStage

const {
  durableWorkspaceChatID, persistWorkspaceChatRemote,
  persistWorkspaceChatRemoteBestEffort,
} = createWorkspaceChatRemote({
  sanitizeChatCacheKey, canonicalChatGPTConversationURL, BACKEND_URL, fetch,
})

const chatAgentConversationURL = createChatAgentConversationURL(canonicalChatGPTConversationURL)

function chatAgentConversationID(value) {
  return chatGPTConversationID(value)
}


const {
  chatAgentInitialRequestWaitMs, chatAgentRequestEligibleAt,
  enqueueChatAgentTask, enqueueChatAgentLifecycleTask,
} = createChatAgentTaskQueue({
  getRuntimeDiagnostics: () => chatAgentRuntimeDiagnostics,
  getScheduler: () => chatAgentScheduler,
  getSupervisorScheduler: () => chatSupervisorScheduler,
  getPolicies: () => chatAgentPolicies,
  chatAgentConversationID, sanitizeChatCacheKey, canonicalChatGPTConversationURL,
  reconcileChatAgentAutoScale: (...args) => reconcileChatAgentAutoScale(...args),
  persistWorkspaceChatRemote, createHash,
  refreshChatAgentRuntimeState, publishChatAgentRuntimeState,
})

const { expectedChatAgentPayload, enqueueChatAgentFollowups } = createChatAgentFollowups({
  canonicalChatGPTConversationURL, authoritativeBundleFilename,
  chatAgentInitialRequestWaitMs, enqueueChatAgentTask,
})

const {
  recordChatGPTTaskEvent, hydrateExpectedChatAgentBundle, chatAgentChildExists,
  captureChatGPTProcessingDuration, enqueueChatAgentContinuation, probeChatAgentResponse,
  executeChatAgentWrite, executeChatAgentTitleDiscover, executeChatAgentTempTitle,
  executeChatAgentTitleAwait,
} = createResponseRuntime({
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
  getScheduler: () => chatAgentScheduler,
  getRecoveryAction: () => performChatGPTRecoveryAction,
  getContinuationRecorder: () => recordChatGPTContinuationSent,
  setRecentExpectedDownload: (value) => { recentExpectedDownload = value },
})

const { releaseNotesWorkerRuntime, orchestratorExecutionWorkerRuntime,
  orchestratorRequestSupervision, adoptOrchestratorRequest, sendOrchestratorMainRequest,
  chatAgentLifecycleBlocked, checkpointChatAgentTask, orchestratorPlanInstruction,
  parseOrchestratorPlanProposal, orchestratorPlanResult, importOrchestratorPlanArtifact,
  executeChatAgentOrchestratorPlan,
} = createOrchestrationRuntime({
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
  getScheduler: () => chatAgentScheduler,
})

const { executeChatAgentMarkdownTranslation, executeChatAgentTodoClassification } = createArtifactWorkerRuntime({
  markdownTranslationFilename, MAX_MARKDOWN_TRANSLATION_BYTES, paceChatGPTWorkerSubmission, path,
  app, rm, mkdir, writeFile,
  expectedChatGPTTranslations, reconcileChatGPTThrottleForKey, requireOwnedChatGPTEntry, waitForChatGPTSurfaceReady,
  targetChatGPTComposer, CHATGPT_URL, executeChatGPTDOMScript, chatGPTFillComposerScript,
  pasteChatGPTFile, wait, chatInputSettleDelay, chatGPTAssistantTurnCount,
  submitChatGPTDraft, waitForSubmittedChatGPTConversation, MARKDOWN_TRANSLATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS,
  chatGPTHumanActionScript, noteChatGPTRateLimitGate, setChatGPTHumanAction, chatGPTHumanActionMessage,
  pollWorkerExpectedDownload, chatGPTExpectedDownloadScript, enqueueChatAgentTask, chatAgentConversationID,
  todoClassificationFilename, MAX_TODO_CLASSIFICATION_BYTES, chatAgentRateLimitDelayMs, expectedChatGPTTodoClassifications,
  TODO_CLASSIFICATION_TIMEOUT_MS, chatGPTResponseCompletionScript,
})

const {
  chatSupervisorHostWindow, bindChatSupervisor, noteChatSupervisorLane,
  chatSupervisorLanesHeldByOthers, executeChatSupervisorTask,
  executeChatTranslatorTask, executeEphemeralWorkerTask, executeChatAgentTask,
} = createAgentWorkerRuntime({
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
  executeChatAgentTodoClassification, executeReleaseNotesBundleTask, releaseNotesWorkerRuntime, probeChatAgentResponse, executeChatAgentTitleDiscover,
  executeChatAgentTempTitle, executeChatAgentTitleAwait,
  chatAgentLifecycleBlocked, chatGPTSupervisorOwnsExpectedResponse,
  desiredSupervisorSlots: () => desiredChatAgentSupervisorSlots,
  getDownloadPoller: () => pollExpectedChatGPTDownloadKey,
})

const {
  queueChatGPTComment, hasPendingChatGPTComments, flushQueuedChatGPTComments,
  pollChatGPTVisibleActivity, performChatGPTRecoveryAction,
  escalateChatGPTContinuationFailure, recordChatGPTContinuationSent,
  pollExpectedChatGPTDownloadKey, pollExpectedChatGPTDownloads,
} = createRecoveryRuntime({
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
  readPollingChatGPTVisibleActivity: () => pollingChatGPTVisibleActivity,
  setPollingChatGPTVisibleActivity: (value) => { pollingChatGPTVisibleActivity = value },
  setRecentExpectedDownload: (value) => { recentExpectedDownload = value },
})

const desktopEntrypoint = createDesktopEntrypointRuntime({
  ipcMain, trustedSender, registerWindowIPC, registerDesktopShellIPC, registerSpellcheckIPC, desktopWindows, acquireProjectForWindow,
  releaseProjectForWindow, suspendNativeSurfacesForWindow, sendToWindowState, desktopWindowClose, DESKTOP_INSTANCE, publishDesktopNotification, canonicalProjectPath,
  desktopTrayController, persistWindowLayout, persistRestartIntent, waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch, app, registerChatGPTSurfaceIPC,
  registerChatGPTAccountIPC, registerChatGPTSessionControlIPC, registerExpectedBundleRecoveryIPC, registerChatGPTBundleIPC, registerChatGPTPromptIPC, deferSupervisorNavigationIfBusy, activateChatGPTView,
  requireTrustedChatGPTURL, isTrustedChatGPTOrigin, loadOwnedChatGPTURL, sanitizeChatCacheKey, waitForChatGPTSurfaceReady, chatgptViews, reconcileChatGPTThrottle,
  setChatGPTBounds, currentChatGPTState, canonicalChatGPTConversationURL, shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinityURL, chatGPTConversationID, sameConversationURL,
  observeChatGPTAffinityURL, scheduleChatGPTAffinitySettlement, ensureChatGPTView, requireOwnedChatGPTEntry, confirmChatGPTAffinity, sanitizeDiagnosticURL, publishChatGPTState,
  publicChatGPTAffinity, rejectChatGPTAffinity, reloadOwnedChatGPTConversation, releaseChatGPTView, enqueueChatAgentLifecycleTask, stopChatGPTConversation, publishChatGPTAccountAction,
  suggestChatGPTConversationTitle, hideChatGPTSidebar, isBehaviorProbeEnabled, sanitizeBehaviorProbeControl, ensureChatGPTLayoutViewport, executeChatGPTDOMScript, behaviorProbeScript,
  normalizeBehaviorProbeResult, sanitizeChatGPTAuthMode, cancelExternalAuthentication, chatGPTSurfaceShouldBeVisible, chatgptTransportModes, abortChatGPTTransportPreparations, preparedChatGPTDrafts,
  retryableChatGPTPrompts, expectedChatGPTBundles, manualChatGPTTransport, startExternalAuthentication, shell, authoritativeBundleFilename, classifyChatGPTRequestDelivery,
  withChatGPTTransportPreparation, targetChatGPTComposer, chatGPTSubmittedRequestEvidenceScript, chatInputArchiveFilename, disarmExpectedChatGPTBundle, refreshChatAgentRuntimeState, publishChatAgentRuntimeState,
  armExpectedChatGPTBundle, chatAgentInitialRequestWaitMs, durableWorkspaceChatID, persistWorkspaceChatRemoteBestEffort, expectedChatAgentPayload, enqueueChatAgentTask, setChatGPTHumanAction,
  chatGPTResponseCompletionScript, classifyChatGPTConversationTransport, CONVERSATION_TRANSPORT_STALE_MS, reconcileChatGPTConversationTransport, submitChatGPTContinuation, ChatGPTRateLimitDeferral, escalateChatGPTContinuationFailure,
  createChatGPTRecoveryState, clearChatGPTHumanAction, recordChatGPTContinuationSent, canonicalBundleFilename, dialog, path, readFile,
  MAX_EXECUTION_BUNDLE_BYTES, canonicalWharnessBundleDownload, validateWharnessBundleDownload, pendingChatGPTBundlePayloads, acknowledgeChatGPTBundle, pendingChatGPTBundleDeliveries, withChatGPTSupervisorTransport,
  submitPromptToChatGPT, queuePreparedPromptForWorker, preparePromptForChatGPT, retryPreparedChatGPTPrompt, attachContextToChatGPT, attachPromptToChatGPT, submitPreparedChatGPTDraft,
  queueChatGPTComment, cancelChatGPTRequestState, CHATGPT_URL, CHATGPT_LOGIN_URL, BEHAVIOR_PROBE_CONTROLS, registerAgentIPC, normalizeSupervisorSlotCount,
  normalizeWorkerSlotCount, setChatAgentSupervisorTarget, setChatAgentWorkerTarget, chatAgentKeepFlowingFloor, reconcileChatAgentAutoScale, normalizeChatAgentPolicies, persistChatAgentPolicies,
  pauseChatAgentWorkers, resumeChatAgentWorkers, chatAgentBrowserSnapshot, workerEntryForAgentID, hideChatAgentInteractionEntry, openWorkerMonitor, BrowserWindow,
  closeWorkerMonitor, showChatAgentInteraction, setChatAgentInteractionBounds, closeChatAgentInteraction, registerBrowserDataIPC, registerChatAttachmentIPC, fetchChatTransportLimits,
  decodeChatAttachmentSet, chatAttachmentRoot, createPersistentAttachmentPreview, registerClipboardIPC, clipboard, ClipboardItem, fetchContextZip,
  configureChatGPTSession, session, CHATGPT_PARTITION, CHATGPT_USER_AGENT, CHATGPT_ACCEPT_LANGUAGES, CHATGPT_CHROMIUM_VERSION, chatGPTUploads,
  chatGPTSubmissions, chatGPTCacheMarker, registerChatGPTPlanDownloads, noteChatGPTNetworkActivity, noteChatGPTNetworkFailure, noteChatGPTHTTPStatus, loadChatAgentPolicies,
  ensureDesktopTray, flushQueuedChatGPTComments, pollChatGPTVisibleActivity, pollExpectedChatGPTDownloads, DOM_DOWNLOAD_POLL_MS, restoreDesktopWindowsAtStartup, loadWindowLayout,
  consumeRestartIntent, consumeDesktopRecoverySession, recoverableDesktopWindows, refreshDesktopTray, createWorkerScheduler, primeChatGPTWorkerPool, CHAT_AGENT_STARTUP_DELAY_MS,
  ChatAgentSchedulerClient, BACKEND_URL, HARD_MAX_WORKER_SLOTS, withTrace, traceForTask, chatAgentWorkerActivity, executeChatAgentTask,
  noteOrchestrationTaskPin, parkChatGPTWorkerAfterLoadFailure, workerEntryForIndex, releaseChatGPTConversationReadProbe, workerSuspensionState, workerSuspendsAllTaskTypes, chatAgentRateLimitResumeBlocked,
  chatSupervisorBoundLanes, chatAgentResidency, chatAgentKeepFlowingActive, chatAgentSupervisingLiveResponse, projectWindowRegistry, orchestrationTaskPins, chatGPTWorkerEntries,
  chatAgentWorkerStates, closeWorkerMonitorAfterState, reconcileChatGPTWorkerPool, createTranslatorScheduler, MAX_TRANSLATOR_SLOTS, executeEphemeralWorkerTask, activeChatTranslatorSlots,
  createSupervisorScheduler, HARD_MAX_SUPERVISOR_SLOTS, executeChatSupervisorTask, chatSupervisorSlotID, chatSupervisorHostWindow, chatSupervisorStates, sanitizeOptionalChatCacheKey,
  supervisorBindingHeld, chatSupervisorLanesHeldByOthers, persistDesktopRecoverySession, chatGPTPartitionPath, managedAuthProfilePath, pendingBrowserImportPath, closeAllChatGPTViews,
  closeAllInternalChatGPTBrowsers, closeManagedBrowserAuth, chatGPTAuthBrowsers, snapshotBrowserSession, restoreBrowserSession, pathSize, internalChatGPTBrowsers,
  isHTTPS, desktopWindowTitle, securePreferences, DESKTOP_ICON, Menu, randomUUID, here,
  loadWindowPlacement, MIN_DESKTOP_WINDOW_SIZE, FRONTEND_URL, FRONTEND_RUNTIME_TOKEN, FRONTEND_ORIGIN, installNativeSurfaceLifecycleGuard, spellcheckContextMenuTemplate,
  FRONTEND_RENDERER_RESTART_LIMIT, scheduleWindowLayoutPersistence, hideChatAgentInteractionsForWindow, rehomeChatGPTWorkers, closeInternalChatGPTBrowserForWindow, closeChatGPTViewsForWindow, releaseWindowProjects,
  logger: console,
  clearRecentDownload: () => { recentExpectedDownload = undefined },
  setMainWindow: (win) => { mainWindow = win },
  getMainWindow: () => mainWindow,
  isQuitting: () => quitting,
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
  getDeferredSupervisorNavigation: () => deferredSupervisorNavigation,
  getChatAgentScheduler: () => chatAgentScheduler,
  get desiredChatAgentWorkerSlots() { return desiredChatAgentWorkerSlots },
  get desiredChatAgentSupervisorSlots() { return desiredChatAgentSupervisorSlots },
  getExplicitDesktopExit: () => explicitDesktopExit,
  getQuitting: () => quitting,
  setQuitting: (value) => { quitting = value },
  getDownloadPoller: () => chatGPTDownloadPoller,
  getDesktopTrayControl: () => desktopTrayControl,
  getWorkerScheduler: () => chatAgentScheduler,
  getTranslatorScheduler: () => chatTranslatorScheduler,
  getSupervisorScheduler: () => chatSupervisorScheduler,
  agentState: {
    get supervisorSlots() { return configuredChatAgentSupervisorSlots },
    set supervisorSlots(value) { configuredChatAgentSupervisorSlots = value },
    get workerSlots() { return configuredChatAgentWorkerSlots },
    set workerSlots(value) { configuredChatAgentWorkerSlots = value },
    get policies() { return chatAgentPolicies },
    set policies(value) { chatAgentPolicies = value },
    get scheduler() { return chatAgentScheduler },
    clearRateLimit() {
      chatGPTRateLimitUntil = 0
      chatGPTRateLimitHits = []
      chatGPTRateLimitKind = ''
      chatGPTRateLimitAppliedAt = 0
      chatGPTRateLimitResumeProbeRequired = false
      chatGPTRateLimitResumeProbeNotBefore = 0
    },
  },
  state: {
    get policies() { return chatAgentPolicies },
    set policies(value) { chatAgentPolicies = value },
    get workerScheduler() { return chatAgentScheduler },
    set workerScheduler(value) { chatAgentScheduler = value },
    set translatorScheduler(value) { chatTranslatorScheduler = value },
    set supervisorScheduler(value) { chatSupervisorScheduler = value },
    set downloadPoller(value) { chatGPTDownloadPoller = value },
    get dueTranslations() { return dueChatTranslations },
    get quitting() { return quitting },
  },
})
app.whenReady().then(() => desktopEntrypoint.start())
desktopEntrypoint.registerLifecycle()
