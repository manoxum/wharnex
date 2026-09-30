// Keep this import prelude intact: self-evolution host builds syntax-check the entrypoint before activation.
import { app, BrowserWindow, ClipboardItem, Menu, Notification, Tray, WebContentsView, clipboard, dialog, ipcMain, nativeImage, screen, session, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'
import {
  ChatGPTSubmitCoordinator, dispatchChatGPTAccountKey, dispatchChatGPTPointerClick,
  dispatchChatGPTPointerPress, submitWithoutReplay, createChatGPTPromptTransport,
  ChatGPTUploadCoordinator, chatGPTUploadThumbnailScript, pasteWithUploadRetry,
  plannerPromptMarkdown, selectChatGPTUploadFile, waitForChatGPTReady,
  createChatGPTFileUpload,
  createExpectedBundleSupervision, registerExpectedBundleRecoveryIPC,
  createSupervisorTransport,
  createChatGPTCommentQueue,
  createChatGPTBundleExpectation,
  createExpectedBundleLookup, createValidatedBundleState,
  registerChatGPTBundleIPC,
  shouldAttachProjectContext,
  chatGPTDeliveryContinuationPrompt, chooseChatGPTRecoveryAction,
  classifyChatGPTConversationTransport, commitChatGPTRecoveryAction,
  createChatGPTRecoveryState, isChatGPTConversationTransportURL,
  isRecoverableChatGPTNetworkError, noteChatGPTRecoveryAssistantCount,
  noteChatGPTRecoveryFault, noteChatGPTRecoveryProgress,
  reconcileChatGPTConversationTransport, recordChatGPTConversationTransport,
  claimNetworkFaultReloadSlot, isNetworkRecoveryFault, RATE_LIMIT_GATE,
  classifyChatGPTRateLimit, registerChatAttachmentIPC,
  createChatGPTRequestContextClient, createChatGPTAttachmentTools,
  createChatGPTTransportPreparation, throwIfChatGPTTransportAborted,
  boundedChatInputPartBytes, requestPreparationTimer,
  withRequestPreparationDeadline, createManualChatGPTTransport,
  classifyChatGPTRequestDelivery, registerChatGPTPromptIPC,
  createChatGPTRequestCancellation,
  createChatGPTComposerTarget,
  createChatGPTDraftSubmission,
  createChatInputPreparation,
} from './chatgpt/transport/index.mjs'
import {
  preserveLocalFocusDuringBackgroundOperation, installNativeSurfaceLifecycleGuard,
  createDesktopWindowRecovery, recoverableDesktopWindows,
  createDesktopRestartIntent, createDesktopWindowLayout,
  MIN_DESKTOP_WINDOW_SIZE, ProjectWindowRegistry, canonicalProjectPath,
  registerWindowIPC, spellcheckContextMenuTemplate, createProjectWindowOwnership,
  createDesktopProjectNavigation, createWorkspaceSurfaceRouting,
  registerDesktopShellIPC, registerSpellcheckIPC, createDesktopWindowCreator,
  securePreferences,
  createDesktopCoordinatorRelaunch,
  restoreDesktopWindowsAtStartup,
} from './window/index.mjs'
import { createChatGPTAccountOperations } from './chatgpt/account/index.mjs'
import {
  orchestratorCompletionDiagnostic, createOrchestratorConversationGuard,
  executeOrchestratorExecution, orchestratorContextIncrementPaths,
  rearmOrchestratorPlanDownload, sendOrchestratorContextIncrement,
  createOrchestratorPlanWorker, createOrchestratorPlanImport, orchestratorRetryInput,
  registerOrchestratorExecutionDownload, createOrchestratorBundleDelivery,
  OrchestrationTaskPins, orchestratorRequestFilename, writeOrchestratorRequestBundle, createOrchestratorRequestTransport,
  captureChatGPTAgentPage, captureParkedWorkerPage, createResponseProbe,
  createSupervisorOwnership, createSupervisorPool, createSupervisorResponseLease, createAgentWrite, createResponseLineage, createSupervisorSurfaceSlots,
  createSupervisorSurfaceVisibility, createSupervisorSurfaceNavigation, createWorkerInteraction,
  createChatGPTActivityPoll, closeWorkerMonitor, closeWorkerMonitorAfterState,
  openWorkerMonitor, chatAgentMemorySnapshot,
  publicAgentBrowser as projectAgentBrowser, buildChatAgentRuntimeState,
  chatAgentLiveBundlePending, publicSupervisorId, supervisorSurfaceRoute,
  DEFAULT_SUPERVISOR_SLOTS, DEFAULT_WORKER_SLOTS, HARD_MAX_SUPERVISOR_SLOTS,
  HARD_MAX_WORKER_SLOTS, normalizeSupervisorSlotCount, normalizeWorkerSlotCount,
  autoScaleDrainTarget, autoScaleSupervisorDrainTarget, autoScaleSupervisorTarget,
  autoScaleTarget, normalizeChatAgentPolicies, workerSuspensionState,
  workerSuspendsAllTaskTypes, createChatAgentPolicyStore, createKeepFlowingState,
  autoScaleWorkerDemand, MAX_TRANSLATOR_SLOTS, translatorCapacityTarget,
  chatAgentQueueDiagnostics, ChatAgentSchedulerClient, chatAgentBackoff, createChatAgentTaskQueue,
  createWorkerScheduler, createTranslatorScheduler, createSupervisorScheduler,
  createChatAgentSchedulingOperations,
  createChatAgentRuntimeRefresh,
  createChatAgentRuntimeControls,
  CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS,
  ChatAgentGlobalPacer, WorkerActivity, ChatAgentResidency,
  CHAT_AGENT_NAVIGATION_GAP_MS, CHAT_AGENT_AWAIT_PROBE_MS, chatAgentLane,
  orchestratorTaskChat, createChatAgentExecution, createWorkerPacing, CHATGPT_BEHAVIOR,
  reasoningEffortStateScript, executeReleaseNotesBundleTask,
  registerReleaseNotesBundleDownload, createArtifactWorkers,
  pollWorkerExpectedDownload, registerAgentIPC, createEphemeralWorkerRuntime,
  createTranslatorTaskRuntime,
} from './agent/index.mjs'
import { createChatGPTRecoveryActions } from './chatgpt/transport/recovery/actions/index.mjs'
import {
  readStoredAttachment, removeStoredChatAttachments, storedAttachmentPath,
  buildBundleName, parseBundleName, safeChatId, uploadChatArtifact,
  chatInputArchiveFilename, chatInputPartManifest, localChatInputBootstrap,
  writeChatInputTransportArchives,
  MAX_CONTEXT_BYTES, MAX_PLAN_BYTES, MAX_EXECUTION_BUNDLE_BYTES,
  MAX_MARKDOWN_TRANSLATION_BYTES, MAX_MARKDOWN_TRANSLATION_RESULT_BYTES,
  MAX_TODO_CLASSIFICATION_BYTES, TODO_CLASSIFICATION_TIMEOUT_MS,
  MARKDOWN_TRANSLATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS,
  MAX_ORCHESTRATOR_PLAN_BYTES, ORCHESTRATOR_PLAN_TIMEOUT_MS,
  ORCHESTRATOR_PLAN_GENERATING_GRACE_MS, ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS,
} from './transport/index.mjs'
import {
  CHATGPT_URL, CHATGPT_LOGIN_URL, CHATGPT_LIBRARY_URL, CHATGPT_PARTITION,
  CHATGPT_CHROMIUM_VERSION, CHATGPT_ACCEPT_LANGUAGES,
  CHATGPT_AFFINITY_RECOVERY_GRACE_MS, EXPIRED_ARTIFACT_TTL_MS,
  RETRYABLE_PROMPT_TTL_MS, DELIVERED_BUNDLE_DEDUP_TTL_MS,
  EXPECTED_BUNDLE_TTL_MS, DOM_DOWNLOAD_POLL_MS, DOM_DOWNLOAD_RETRY_MS,
  DOWNLOAD_INFLIGHT_TIMEOUT_MS, BUNDLE_COMPLETION_GRACE_MS,
  BUNDLE_CONTINUATION_BASE_MS, BUNDLE_COMPLETION_CONFIRM_MS,
  MAX_BUNDLE_CONTINUATIONS, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
  PROCESSING_SIGNAL_GRACE_MS, BUNDLE_UNOBSERVED_SETTLE_MS,
  CONVERSATION_TRANSPORT_STALE_MS, PROCESSING_STALE_ATTENTION_MS,
  AWAIT_STALL_ATTENTION_MS, CHATGPT_RATE_LIMIT_BACKOFF_MS,
  CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS, CHATGPT_DOM_PROBE_FAILURE_LIMIT,
  CHATGPT_ACCOUNT_ACTION_SETTLE_MS, CHATGPT_MENU_REOPEN_ATTEMPTS,
  CHATGPT_CONTROL_PRESS_HOLD_MS, DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
} from './chatgpt/config/index.mjs'
import {
  chatGPTAssistantTurnCountScript, chatGPTComposerReadyScript, chatGPTExpectedDownloadScript,
  chatGPTHumanActionScript, chatGPTResponseCompletionScript, chatGPTFillComposerScript,
  chatGPTSubmitScript, chatGPTVisibleActivityScript, chatGPTProcessingDurationScript,
  chatGPTSubmittedRequestEvidenceScript, behaviorProbeScript, isBehaviorProbeEnabled,
  normalizeBehaviorProbeResult, sanitizeBehaviorProbeControl, BEHAVIOR_PROBE_CONTROLS,
  ensureChatGPTReasoningEffort, normalizeChatGPTReasoningEffort, stepChatGPTEffort,
  evaluateChatGPTDOMWithDeadline,
} from './chatgpt/dom/index.mjs'
import { accountFailureDetail, ChatGPTAccountProviderChain } from './chatgpt/account/index.mjs'
import { pathSize, restoreBrowserSession, snapshotBrowserSession, createBrowserSessionOperations, createInternalChatGPTBrowser, registerBrowserDataIPC } from './browser/index.mjs'
import { chatGPTNavigationDisposition, chatInputSettleDelay, chromeCompatibleUserAgent, isChatGPTAuthURL, isHTTPS, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatCacheKey, sanitizeOptionalChatCacheKey, sanitizeChatGPTAuthMode, sanitizeDiagnosticURL, sanitizeSessionId, BundleOwnershipError, canonicalWharnessBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security/security.mjs'
import {
  confirmChatGPTAffinity, createChatGPTAffinityTracker, isChatGPTAffinityAwaitingSettlement,
  markChatGPTAffinitySubmitted, observeChatGPTAffinity, proposeChatGPTAffinity,
  publicChatGPTAffinity, rejectChatGPTAffinity, settleChatGPTAffinity,
  shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinity,
  chatGPTSessionProbeExpression, closeManagedBrowserAuth, electronCookieDetails,
  launchManagedBrowserAuth, managedBrowserProfileDirectory, createChatGPTAuthentication,
  createEmbeddedChatGPTAuthentication,
  registerChatGPTAccountIPC, registerChatGPTSessionControlIPC, registerChatGPTSurfaceIPC,
  createChatGPTThrottle, createWorkspaceChatRemote, createChatGPTAffinityRuntime,
  createChatGPTRateLimit, createChatGPTHTTPHealth, createChatGPTRateLimitResume,
  createChatGPTConversationReadHealth, createChatGPTNetworkActivity,
  createChatGPTHumanAttention,
  createChatGPTCacheMarker, configureChatGPTSession, createChatGPTConversationURLs,
  chatGPTConversationLoadFailureScript, withChatGPTNavigationDeadline,
  createOwnedChatGPTConversationReload,
  createChatGPTViewOperations, createChatGPTViewCleanup, createChatGPTViewState,
  createChatGPTViewOwnership,
} from './chatgpt/session/index.mjs'
import { desktopInstanceName, desktopWindowTitle } from './identity/desktop-identity.mjs'
import { configureDesktopProcess, createDesktopStartupContext, startDesktopRuntime, registerDesktopLifecycleHandlers } from './lifecycle/index.mjs'
import { registerDesktopIPC } from './composition/ipc/index.mjs'
import { desktopIconDataURL } from './icon/desktop-icon-mark.mjs'
import { createDesktopTrayComposition } from './composition/window/index.mjs'
import {
  createChatGPTUtilityDownloads, createOrchestratorPlanDownloads,
  createLegacyPlanDownload, createChatGPTBundleDownload,
  createChatGPTDownloadPublication, createChatGPTDownloadSource,
  createValidBundleMetric, createChatGPTDownloadRouter,
} from './chatgpt/downloads/index.mjs'
import { registerClipboardIPC } from './clipboard/index.mjs'
// Planner requests are deliberately ZIP-only here; retired remote-input
// publication must not be reintroduced into the Desktop request path.
import {
  createOperationalLogShipper, installConsoleCapture, currentTrace,
  installBackendTraceHeader, traceForTask, traceId, withTrace,
} from './observability/index.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_INSTANCE = process.env.WHARNESS_INSTANCE_ID
const DESKTOP_SLUG = desktopInstanceName(DESKTOP_INSTANCE).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wharnex'

function resolveDesktopIcon() {
  const dataHome = process.env.WHARNESS_DESKTOP_DATA_HOME || path.join(homedir(), '.local', 'share')
  for (const candidate of [
    path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps', `wharnex-${DESKTOP_SLUG}.png`),
    path.join(dataHome, 'icons', 'hicolor', 'scalable', 'apps', `wharnex-${DESKTOP_SLUG}.svg`),
  ]) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createFromDataURL(desktopIconDataURL(256, DESKTOP_INSTANCE))
}

const DESKTOP_ICON = resolveDesktopIcon()
app.setName(`Wharnex - ${desktopInstanceName(DESKTOP_INSTANCE)}`)
const FRONTEND_URL = requireLocalHTTPURL(process.env.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173', 'Frontend URL').href
const BACKEND_URL = requireLocalHTTPURL(process.env.WHARNESS_API_URL || 'http://127.0.0.1:8888', 'Backend URL').href
// Every console line from here on is timestamped and shipped to the
// classified operational log (adr/ADR-0075).
const operationalLog = createOperationalLogShipper({ endpoint: new URL('/api/operational-log', BACKEND_URL).href })
installConsoleCapture(console, operationalLog, { trace: currentTrace })
installBackendTraceHeader(globalThis, BACKEND_URL)
app.on('will-quit', () => { void operationalLog.flush() })
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const FRONTEND_RUNTIME_TOKEN = randomUUID()
// Supervisor ownership and transport factories capture these functions during
// module evaluation, so establish them before composing those factories.
const {
  conversationID: chatGPTConversationID,
  canonicalURL: canonicalChatGPTConversationURL,
  sameConversation: sameConversationURL,
} = createChatGPTConversationURLs(requireTrustedChatGPTURL)
// Re-claim spacing after a worker slot was rebound before the task started.
const CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS = 5_000
const CHATGPT_USER_AGENT = chromeCompatibleUserAgent(process.platform, CHATGPT_CHROMIUM_VERSION)
const CHATGPT_BUNDLE_RETENTION_HOURS = Math.max(1, Math.min(24 * 30, Number(process.env.WHARNESS_CHATGPT_BUNDLE_RETENTION_HOURS || 72) || 72))
const CHATGPT_BUNDLE_RETENTION_MS = CHATGPT_BUNDLE_RETENTION_HOURS * 60 * 60 * 1000
configureDesktopProcess({
  app, BrowserWindow, environment: process.env, platform: process.platform,
  processTarget: process, logger: console, getMainWindow: () => mainWindow,
})

let mainWindow
let desktopTrayControl
const chatgptViews = new Map()
const chatGPTWorkerEntries = []
const chatAgentWorkerStates = new Map()
// Supervisor pool runtime, indexed 1..desiredChatAgentSupervisorSlots. Supervisors
// draw from the same durable queue as Workers but claim only the chat-bound task
// types, so each slot needs its own loop state and its own chat binding.
const chatSupervisorStates = new Map()
let chatSupervisorScheduler
let chatTranslatorScheduler
const activeChatTranslatorSlots = new Set()
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
const chatGPTAuthBrowsers = new Map()
const internalChatGPTBrowsers = new Map()
const desktopWindows = new Map()
const projectWindowRegistry = new ProjectWindowRegistry()
let quitting = false
let explicitDesktopExit = false
const preparedChatGPTDrafts = new Map()
const retryableChatGPTPrompts = new Map()
const pendingChatGPTComments = new Map()
const flushingChatGPTComments = new Set()
const recentChatGPTCommentIds = new Map()
const recentChatGPTCommentFingerprints = new Map()
const chatGPTActivityFingerprints = new Map()
const expectedChatGPTBundles = new Map()
const expectedChatGPTTranslations = new Map()
const expectedChatGPTReleaseNotes = new Map()
const expectedChatGPTTodoClassifications = new Map()
const expectedChatGPTOrchestratorPlans = new Map()
const expectedChatGPTOrchestratorExecutions = new Map()
// Plan artifacts that arrived while no attempt held the lease.
//
// ChatGPT delivers when it finishes, not when a Wharnex lease happens to be
// open, and an orchestrator attempt lives only 8 minutes. Cancelling the file
// because nothing was armed threw away the exact artifact the next attempt
// would then spend another attempt asking ChatGPT to produce again — which is
// how four planning requests reached attempt 7/8 with zero plans imported.
const pollingExpectedChatGPTBundles = new Set()
let pollingChatGPTVisibleActivity = false
const chatGPTTransportTails = new Map()
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
// Conversations whose generated-file artifact ChatGPT no longer serves.
//
// A file card stays rendered in the transcript long after ChatGPT has collected
// the artifact behind it, so the card is not evidence the file still exists.
// Clicking it produces a 404 on ChatGPT's own download endpoint and no
// `will-download` event at all, which a poll loop cannot distinguish from "the
// file has not appeared yet" — measured: 134 clicks against two dead cards in a
// single lease. The 404 is the only signal that the artifact must be asked for
// again rather than waited for.
const chatGPTExpiredArtifactConversations = new Map()
// Recent provider refusals, used to tell one throttled request apart from an
// account-wide gate. Ephemeral Desktop state; the resulting suspension is
// durable backend state.
let chatGPTRateLimitHits = []
let chatGPTRateLimitKind = ''
// When the newest local gate was applied, so a stale provider reading cannot
// clear a suspension that has not reached the backend yet.
let chatGPTRateLimitAppliedAt = 0
const pendingChatGPTBundleDeliveries = new Map()
// requestId -> deliveredAt. A second concurrent download of the same file
// (see downloadInFlight above) can still slip through as a genuine race
// between the retry-guard check and the first click's will-download event
// actually firing; this is the last line of defense so the backend is never
// sent the same bundle twice for one request.
const deliveredChatGPTBundleRequestIds = new Map()
// Manual mode keeps the human-facing ChatGPT engine live while automatic
// conversation DOM reads/writes stay disabled. Request bundles are still
// materialized locally and response downloads remain under Wharnex control.
const chatgptTransportModes = new Map()
const manualChatGPTTransport = createManualChatGPTTransport({
  clipboard,
  ClipboardItem,
  onStateChange: (key) => publishChatGPTState(key),
})
let chatGPTAccountOperation = Promise.resolve()
const chatGPTAccountProviders = new ChatGPTAccountProviderChain({})
// Live-observed on a large draining backlog: due-task demand flapped above
// and below zero from one 2s poll to the next, so a pool grown for a burst
// of demand was torn back down before that demand's own next tick, then
// regrown moments later - each cycle creating and destroying real
// WebContentsViews (a navigation to chatgpt.com apiece), which is what
// turned a noisy demand signal into runaway resource churn severe enough to
// crash the desktop. A drain may only fire once a pool has held its grown
// size for a bit, giving genuinely transient demand time to resolve first.
const CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS = 20_000
let chatAgentWorkerLastGrowAt = 0
let chatAgentSupervisorLastGrowAt = 0
const CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS = 250
// Minimum process-wide spacing between prompt submissions. Transport is
// serialized per Worker slot, so without this every free slot could submit at
// once and present the authenticated account with a burst — the shape that
// earns an HTTP 429 for the whole provider.
const CHAT_AGENT_SUBMIT_GAP_MS = CHAT_AGENT_WORKER_ACTION_GAP_MS
// Widest submission spacing, used while the provider still shows the pressure
// that produced an account-wide gate. Staged resume, not a permanent ceiling:
// it decays back to the floor above as valid bundles clear the rate-limit level.
const CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS = 60_000
// Local mirror of the backend's account-wide gate suspension, applied on the
// tick the gate is observed so workers stop before the round-trip returns. The
// persisted value from the backend is authoritative and wins on arrival.
// Protective ceiling for the navigation gate, applied once the provider shows
// sustained 429 pressure. The healthy floor below is what the pool actually
// runs at while ChatGPT is answering normally.
const CHATGPT_WORKER_NAVIGATION_GAP_MS = CHAT_AGENT_NAVIGATION_GAP_MS
const CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS = CHAT_AGENT_WORKER_ACTION_GAP_MS
// How many times a window's frontend renderer may be restarted after a
// crash before Wharnex stops and asks for human attention.
const FRONTEND_RENDERER_RESTART_LIMIT = 5
// Give the local React shell one quiet paint before allocating hidden Chromium
// surfaces for autonomous account work. Starting all renderers together has
// intermittently killed the visible Linux renderer with exitCode=133.
const CHAT_AGENT_STARTUP_DELAY_MS = 2_500
const CHAT_AGENT_WORKER_SPAWN_GAP_MS = 1_500
let chatGPTDownloadPoller
let recentExpectedDownload
const chatGPTUploads = new ChatGPTUploadCoordinator()
const chatGPTSubmissions = new ChatGPTSubmitCoordinator()

const { publishChatAgentRuntimeState, pauseChatAgentWorkers, resumeChatAgentWorkers } =
  createChatAgentRuntimeControls({
    getRuntimeState: () => chatAgentRuntimeState(),
    desktopWindows, sendToWindowState, refreshDesktopTray: () => refreshDesktopTray(),
    broadcastDelayMs: CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS,
    state: {
      get policies() { return chatAgentPolicies },
      set policies(value) { chatAgentPolicies = value },
      get scheduler() { return chatAgentScheduler },
    },
    normalizeChatAgentPolicies,
    persistChatAgentPolicies: (...args) => persistChatAgentPolicies(...args),
  })
function windowStateForWebContents(webContents) {
  if (!webContents) return undefined
  return [...desktopWindows.values()].find((state) => state.window?.webContents?.id === webContents.id)
}

function trustedSender(event) {
  const state = windowStateForWebContents(event?.sender)
  if (!state || state.window.isDestroyed()) throw new Error('Untrusted IPC sender')
  return state
}

function windowStateForEntry(entry) {
  return entry ? desktopWindows.get(entry.ownerWindowId) : undefined
}

function activeChatGPTEntry(windowState) {
  const state = windowState || windowStateForEntry([...chatgptViews.values()].find((entry) => entry.view.isVisible?.()))
  return state?.activeChatGPTKey ? chatgptViews.get(state.activeChatGPTKey) : undefined
}

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
  expectedChatGPTReleaseNotes, expectedChatGPTTodoClassifications,
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
  hasPendingChatGPTComments: (...args) => hasPendingChatGPTComments(...args),
  chatGPTTransportTails, chatSupervisorStates,
  preparedChatGPTDrafts, retryableChatGPTPrompts,
  RETRYABLE_PROMPT_TTL_MS,
  getDesiredChatAgentSupervisorSlots: () => desiredChatAgentSupervisorSlots,
  sanitizeOptionalChatCacheKey, chatAgentConversationID,
})

const { abortChatGPTTransportPreparations, withChatGPTTransportPreparation } = createChatGPTTransportPreparation({
  tails: chatGPTTransportTails,
  requireOwnedEntry: (...args) => requireOwnedChatGPTEntry(...args),
  reconcileThrottle: reconcileChatGPTThrottle,
  residency: chatAgentResidency,
  withTrace,
  traceId,
  deferredNavigationPending: () => Boolean(deferredSupervisorNavigation),
  applyDeferredNavigation: () => applyDeferredSupervisorNavigation(),
})

const { withChatGPTSupervisorTransport } = createSupervisorTransport({
  sanitizeChatCacheKey,
  ensureChatGPTView: (...args) => ensureChatGPTView(...args),
  withChatGPTTransportPreparation,
})
function sendToWindowState(state, channel, payload) {
  if (state?.window && !state.window.isDestroyed()) state.window.webContents.send(channel, payload)
}

function sendToChatGPTKey(cacheKey, channel, payload) {
  const entry = cacheKey ? chatgptViews.get(cacheKey) : undefined
  const state = windowStateForEntry(entry)
  if (state) sendToWindowState(state, channel, payload)
}

function publishChatGPTAccountAction(cacheKey, action, result) {
  sendToChatGPTKey(cacheKey, 'wharness:chatgpt:account-action', {
    cacheKey,
    action,
    ok: result?.ok === true,
    state: String(result?.state || 'unknown').slice(0, 120),
    provider: String(result?.provider || 'typed-browser').slice(0, 40),
  })
}

const {
  acquireProjectForWindow, suspendNativeSurfacesForWindow,
  releaseProjectForWindow, releaseWindowProjects,
} = createProjectWindowOwnership({
  registry: projectWindowRegistry, windows: desktopWindows, canonicalProjectPath,
  windowTitle: (projectPath) => desktopWindowTitle(projectPath, DESKTOP_INSTANCE),
  refreshTray: () => refreshDesktopTray(), trayControl: () => desktopTrayControl,
  activeChatGPTEntry, deferredNavigation: () => deferredSupervisorNavigation,
  reconcileThrottle: reconcileChatGPTThrottle, chatGPTKeyForEntry,
  hideAgentInteractions: (...args) => hideChatAgentInteractionsForWindow(...args),
})

const desktopWindowRecovery = createDesktopWindowRecovery({
  userDataPath: () => app.getPath('userData'),
  windows: desktopWindows,
  canonicalProjectPath,
})
const persistDesktopRecoverySession = desktopWindowRecovery.persist
const consumeDesktopRecoverySession = desktopWindowRecovery.consume

const {
  projectMenuLabel, projectWindowState, restoreProjectWindow, requestProjectClose,
  activeDesktopProjects, showDesktopFallbackWindow, sendDesktopTrayProjectAction,
} = createDesktopProjectNavigation({
  windows: desktopWindows, sendToWindowState,
  createWindow: (...args) => createWindow(...args),
  setMainWindow: (window) => { mainWindow = window },
})

const {
  desktopTrayController, publishDesktopNotification, refreshDesktopTray,
  ensureDesktopTray, requestFullDesktopQuit, desktopWindowClose,
} = createDesktopTrayComposition({
  app, dialog, Menu, Notification, Tray, nativeImage, session,
  icon: DESKTOP_ICON, instanceName: desktopInstanceName(DESKTOP_INSTANCE), platform: process.platform,
  getTrayControl: () => desktopTrayControl,
  setTrayControl: (control) => { desktopTrayControl = control },
  listProjects: activeDesktopProjects, projectLabel: projectMenuLabel,
  restoreProject: restoreProjectWindow, closeProject: requestProjectClose,
  showFallback: showDesktopFallbackWindow, sendProjectAction: sendDesktopTrayProjectAction,
  projectWindowState, sendToWindowState,
  workerState: chatAgentRuntimeState,
  pauseWorkers: () => pauseChatAgentWorkers({}), resumeWorkers: resumeChatAgentWorkers,
  canonicalProjectPath,
  hideAgentInteractionsForWindow: (...args) => hideChatAgentInteractionsForWindow(...args),
  persistWindowLayout: () => persistWindowLayout(),
  persistDesktopRecoverySession,
  markExplicitDesktopExit: () => { explicitDesktopExit = true },
  isQuitting: () => quitting,
})

// Refresh remote assets only when the compatibility Chromium version changes.
const chatGPTCacheMarker = createChatGPTCacheMarker({
  userDataPath: () => app.getPath('userData'),
  chromiumVersion: CHATGPT_CHROMIUM_VERSION,
})

const desktopWindowLayout = createDesktopWindowLayout({
  userDataPath: () => app.getPath('userData'),
  windows: desktopWindows,
  displays: () => screen.getAllDisplays(),
})
const persistWindowLayout = desktopWindowLayout.persist
const scheduleWindowLayoutPersistence = desktopWindowLayout.schedulePersistence
const loadWindowLayout = desktopWindowLayout.loadWindowLayout
const loadWindowPlacement = desktopWindowLayout.loadWindowPlacement

const desktopRestartIntent = createDesktopRestartIntent({ userDataPath: () => app.getPath('userData') })
const persistRestartIntent = desktopRestartIntent.persist
const consumeRestartIntent = desktopRestartIntent.consume

const { waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch } =
  createDesktopCoordinatorRelaunch({ isQuitting: () => quitting })

const {
  canonicalBundleFilename, authoritativeBundleFilename,
  armExpectedChatGPTBundle, disarmExpectedChatGPTBundle,
} = createChatGPTBundleExpectation({
  buildBundleName, safeChatId, requestIdFromFilename: wharnessBundleRequestIdFromFilename,
  parseBundleName, sanitizeChatCacheKey, expectedChatGPTBundles,
  createChatGPTRecoveryState,
})

const { cancelChatGPTRequestState } = createChatGPTRequestCancellation({
  sanitizeChatCacheKey, abortChatGPTTransportPreparations,
  expectedChatGPTBundles, retryableChatGPTPrompts, preparedChatGPTDrafts,
  manualChatGPTTransport, pendingChatGPTComments, chatgptViews,
  clearChatGPTHumanAction: (...args) => clearChatGPTHumanAction(...args),
  reconcileChatGPTThrottle,
  scheduler: () => chatAgentScheduler,
  refreshChatAgentRuntimeState: (...args) => refreshChatAgentRuntimeState(...args),
  publishChatAgentRuntimeState,
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
  expectedChatGPTBundles, chatgptViews,
  requestIdFromFilename: wharnessBundleRequestIdFromFilename,
  sanitizeOptionalChatCacheKey, recentDownload: () => recentExpectedDownload,
  ttlMs: EXPECTED_BUNDLE_TTL_MS,
})
const {
  recentlyDeliveredChatGPTBundleRequestId, markChatGPTBundleRequestDelivered,
  chatGPTBundleAlreadyValidated, quiesceChatGPTRecoveryAfterValidatedBundle,
} = createValidatedBundleState({
  deliveredChatGPTBundleRequestIds, dedupTtlMs: DELIVERED_BUNDLE_DEDUP_TTL_MS,
  pendingChatGPTBundleDeliveries, expectedChatGPTBundles, chatGPTExpectedKeyForRequest,
  abortChatGPTTransportPreparations, scheduler: () => chatAgentScheduler,
  refreshChatAgentRuntimeState: (...args) => refreshChatAgentRuntimeState(...args),
  publishChatAgentRuntimeState,
})

function pendingBundleDirectory() {
  // The response inbox is durable request state, not a process-wide scratch
  // directory. Keeping it below this Desktop instance's userData prevents a
  // second checkout from replaying or deleting bundles owned by this one.
  return path.join(app.getPath('userData'), 'pending-chatgpt-bundles-v1')
}

async function pendingChatGPTBundlePayloads() {
  const payloads = []
  let names = []
  try { names = await readdir(pendingBundleDirectory()) } catch { return payloads }
  for (const name of names) {
    if (!name.endsWith('.zip')) continue
    const requestId = wharnessBundleRequestIdFromFilename(name)
    if (!requestId || recentlyDeliveredChatGPTBundleRequestId(requestId)) continue
    const filePath = path.join(pendingBundleDirectory(), path.basename(name))
    try {
      const bytes = await readFile(filePath)
      validateWharnessBundleDownload(name, bytes)
      const remembered = pendingChatGPTBundleDeliveries.get(requestId)
      payloads.push({ cacheKey: remembered?.cacheKey || '', filename: name, requestId, contentBase64: bytes.toString('base64'), bytes: bytes.byteLength, recovered: true })
      pendingChatGPTBundleDeliveries.set(requestId, { cacheKey: remembered?.cacheKey || '', filename: name, filePath })
    } catch { /* invalid/incomplete downloads are never replayed */ }
  }
  return payloads
}

async function acknowledgeChatGPTBundle(cacheKey, requestId, filename) {
  const key = cacheKey ? sanitizeChatCacheKey(cacheKey) : ''
  const id = String(requestId || '').trim()
  const record = pendingChatGPTBundleDeliveries.get(id)
  if (record && filename && path.basename(filename) !== record.filename) throw new Error('Bundle acknowledgement filename mismatch')
  markChatGPTBundleRequestDelivered(id)
  if (record) {
    pendingChatGPTBundleDeliveries.delete(id)
    try { await rm(record.filePath, { force: true }) } catch { /* acknowledged data is safe to clean later */ }
  }
  if (key) await cancelChatGPTRequestState(key, id)
  if (record?.filename && key && chatAgentScheduler) {
    const parsed = parseBundleName(record.filename)
    if (parsed?.kind === 'res' && parsed?.chatId === safeChatId(key)) {
      await enqueueChatAgentTask('DELETE_BUNDLE', {
        key,
        requestId: id,
        rootRequestId: id,
        conversationURL: '',
        dedupeKey: `delete-bundle:${record.filename}`,
        notBefore: new Date(Date.now() + CHATGPT_BUNDLE_RETENTION_MS).toISOString(),
        payload: { canonical_filename: record.filename, artifact_id: '', locally_persisted: true },
        maxAttempts: 8,
      }).catch((error) => console.warn(`[chat-agent] remote bundle cleanup enqueue failed request=${id}: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
  return { ok: true, requestId: id, alreadyAcknowledged: !record }
}

function chatGPTPartitionPath() {
  return path.join(app.getPath('userData'), 'Partitions', 'wharness-chatgpt')
}

function managedAuthProfilePath() {
  return managedBrowserProfileDirectory(app.getPath('userData'))
}

function pendingBrowserImportPath() {
  return path.join(app.getPath('userData'), '.wharness-browser-session-import.whbs')
}

const {
  closeInternalChatGPTBrowserForWindow, closeAllInternalChatGPTBrowsers,
  rehomeChatGPTWorkers, closeChatGPTViewsForWindow, closeAllChatGPTViews,
} = createChatGPTViewCleanup({
  internalChatGPTBrowsers, chatGPTAuthBrowsers, chatgptViews,
  chatGPTWorkerEntries, desktopWindows,
  hideChatAgentInteractionsForWindow: (...args) => hideChatAgentInteractionsForWindow(...args),
  grantChatGPTLayoutViewport: (...args) => grantChatGPTLayoutViewport(...args),
  retireChatGPTSupervisorSurface: (...args) => retireChatGPTSupervisorSurface(...args),
  closeManagedBrowserAuth,
})

function touchChatGPTEntry(entry) {
  entry.lastUsed = Date.now()
}

const {
  chatGPTEntryForWebContentsID, noteChatGPTNetworkActivity, noteChatGPTNetworkFailure,
} = createChatGPTNetworkActivity({
  chatgptViews, chatGPTWorkerEntries, expectedChatGPTBundles,
  isChatGPTConversationTransportURL, recordChatGPTConversationTransport,
  noteChatGPTRecoveryProgress, isRecoverableChatGPTNetworkError,
  noteChatGPTRecoveryFault,
})

const { requireOwnedChatGPTEntry, releaseChatGPTView } = createChatGPTViewOwnership({
  sanitizeChatCacheKey, chatgptViews, chatGPTWorkerEntries,
  supervisorBindingHeld: (...args) => supervisorBindingHeld(...args),
  sendToChatGPTKey, cancelExternalAuthentication: (...args) => cancelExternalAuthentication(...args),
  preparedChatGPTDrafts, retryableChatGPTPrompts, pendingChatGPTComments,
  flushingChatGPTComments, chatGPTActivityFingerprints,
  expectedChatGPTBundles, chatGPTTransportTails, manualChatGPTTransport,
  windowStateForEntry,
})

const { setChatGPTBounds, currentChatGPTState, publishChatGPTState } = createChatGPTViewState({
  chatgptViews, desktopWindows, chatGPTAuthBrowsers,
  sanitizeChatCacheKey, normalizeBounds, activeChatGPTEntry,
  getDeferredSupervisorNavigation: () => deferredSupervisorNavigation,
  publicSupervisorId, manualChatGPTTransport, publicChatGPTAffinity,
  windowStateForEntry, sendToWindowState, homeURL: CHATGPT_URL,
})

const {
  observeChatGPTAffinityURL, syncChatGPTAffinityURL, proposeCurrentChatGPTAffinity,
  settleChatGPTAffinityAfterSubmit, scheduleChatGPTAffinitySettlement,
} = createChatGPTAffinityRuntime({
  requireTrustedChatGPTURL, observeChatGPTAffinity,
  canonicalChatGPTConversationURL: (value) => canonicalChatGPTConversationURL(value),
  syncChatGPTAffinity, homeURL: CHATGPT_URL, sanitizeDiagnosticURL,
  proposeChatGPTAffinity, publishChatGPTState, settleChatGPTAffinity,
  isChatGPTAffinityAwaitingSettlement, chatGPTKeyForEntry,
  waitForConcreteChatGPTConversation,
})

function noteChatGPTRendererFault(cacheKey, reason) {
  const expected = expectedChatGPTBundles.get(cacheKey)
  if (!expected?.recovery) return false
  noteChatGPTRecoveryFault(expected.recovery, reason, Date.now())
  console.warn(`[chatgpt-recovery] renderer-fault key=${cacheKey} request=${expected.requestId} error=${reason}`)
  return true
}

const {
  chatGPTHumanActionMessage, setChatGPTHumanAction, clearChatGPTHumanAction,
} = createChatGPTHumanAttention({
  chatgptViews, expectedChatGPTBundles, retryableChatGPTPrompts,
  windowStateForEntry, sendToChatGPTKey, sendToWindowState,
  Notification, recordChatGPTTaskEvent: (...args) => recordChatGPTTaskEvent(...args),
})

// Register provider rate-limit evidence and suspend the pool accordingly.
//
// Both provider shapes stop the account for the same fixed window. The kind is
// still preserved as diagnostic evidence, while the local clock is set optimistically so
// workers stop on this tick rather than after the backend round-trip, and the
// durable value from the backend then takes over.
const { applyChatGPTRateLimit, noteChatGPTRateLimitGate } = createChatGPTRateLimit({
  state: {
    get hits() { return chatGPTRateLimitHits }, set hits(value) { chatGPTRateLimitHits = value },
    get until() { return chatGPTRateLimitUntil }, set until(value) { chatGPTRateLimitUntil = value },
    get resumeProbeRequired() { return chatGPTRateLimitResumeProbeRequired },
    set resumeProbeRequired(value) { chatGPTRateLimitResumeProbeRequired = value },
    get kind() { return chatGPTRateLimitKind }, set kind(value) { chatGPTRateLimitKind = value },
    get appliedAt() { return chatGPTRateLimitAppliedAt }, set appliedAt(value) { chatGPTRateLimitAppliedAt = value },
    get policies() { return chatAgentPolicies }, get scheduler() { return chatAgentScheduler },
    get runtimeDiagnostics() { return chatAgentRuntimeDiagnostics },
  },
  classifyChatGPTRateLimit, RATE_LIMIT_GATE, CHATGPT_RATE_LIMIT_BACKOFF_MS,
  expectedChatGPTBundles, noteChatGPTRecoveryProgress,
  publishChatAgentRuntimeState, sendToChatGPTKey,
})

const {
  chatGPTInterpreterDownloadConversation, noteChatGPTExpiredArtifact,
  chatGPTArtifactExpiredSince, noteChatGPTHTTPStatus,
} = createChatGPTHTTPHealth({
  chatGPTExpiredArtifactConversations, EXPIRED_ARTIFACT_TTL_MS,
  chatGPTEntryForWebContentsID, isChatGPTConversationTransportURL,
  expectedChatGPTBundles, setChatGPTHumanAction, clearChatGPTHumanAction,
  noteChatGPTRecoveryFault, getRateLimitUntil: () => chatGPTRateLimitUntil,
})

const {
  publishPlanDownload, publishPlanDownloadError,
  publishBundleDownload, publishBundleDownloadError,
} = createChatGPTDownloadPublication({
  sendToChatGPTKey, sanitizeChatCacheKey, parseBundleName, path,
  deliverOrchestratorTaskBundle: (...args) => deliverOrchestratorTaskBundle(...args),
  wharnessBundleRequestIdFromFilename, expectedChatGPTBundles,
})

const { deliverOrchestratorTaskBundle } = createOrchestratorBundleDelivery({
  backendURL: BACKEND_URL,
  pendingDeliveries: pendingChatGPTBundleDeliveries,
  acknowledge: acknowledgeChatGPTBundle,
  scheduler: () => chatAgentScheduler,
  enqueue: (...args) => enqueueChatAgentTask(...args),
  canonicalURL: (value) => canonicalChatGPTConversationURL(value),
})

const {
  registerChatGPTMarkdownTranslationDownload,
  registerChatGPTTodoClassificationDownload,
} = createChatGPTUtilityDownloads({
  expectedChatGPTTranslations, expectedChatGPTTodoClassifications,
  tempPath: () => app.getPath('temp'),
  MARKDOWN_TRANSLATION_TIMEOUT_MS, MAX_MARKDOWN_TRANSLATION_RESULT_BYTES,
  TODO_CLASSIFICATION_TIMEOUT_MS, MAX_TODO_CLASSIFICATION_BYTES,
})

const chatGPTDownloadIsHumanBrowsing = createChatGPTDownloadSource(internalChatGPTBrowsers)

const orchestratorPlanDownloads = createOrchestratorPlanDownloads({
  expectedChatGPTOrchestratorPlans,
  tempPath: () => app.getPath('temp'),
  MAX_ORCHESTRATOR_PLAN_BYTES, ORCHESTRATOR_PLAN_TIMEOUT_MS,
})
const {
  registerChatGPTOrchestratorPlanDownload,
  takeRetainedChatGPTOrchestratorPlan,
} = orchestratorPlanDownloads

const handleLegacyPlanDownload = createLegacyPlanDownload({
  tempPath: () => app.getPath('temp'), maxBytes: MAX_PLAN_BYTES,
  requestIdFromFilename: wharnessPlanRequestIdFromFilename,
  validatePlanFile: validateWharnessPlanFile,
  publishPlan: publishPlanDownload, publishError: publishPlanDownloadError,
  humanBrowsing: chatGPTDownloadIsHumanBrowsing, sanitizeURL: sanitizeDiagnosticURL,
})

const recordValidBundleMetric = createValidBundleMetric({
  scheduler: () => chatAgentScheduler, chatGPTWorkerEntries, chatgptViews,
  chatAgentConversationID,
  recordProviderDiagnostics: (provider) => {
    chatAgentRuntimeDiagnostics.provider = { ...chatAgentRuntimeDiagnostics.provider, ...provider }
    publishChatAgentRuntimeState()
  },
})

const handleBundleDownload = createChatGPTBundleDownload({
  pendingDeliveries: pendingChatGPTBundleDeliveries,
  maxBytes: MAX_EXECUTION_BUNDLE_BYTES, pendingDirectory: pendingBundleDirectory,
  expectedBundles: expectedChatGPTBundles,
  validateBundle: validateWharnessBundleDownload,
  recordValidBundle: recordValidBundleMetric,
  recentlyDelivered: recentlyDeliveredChatGPTBundleRequestId,
  quiesceRecovery: quiesceChatGPTRecoveryAfterValidatedBundle,
  publishBundle: publishBundleDownload, publishError: publishBundleDownloadError,
  recordTaskEvent: (...args) => recordChatGPTTaskEvent(...args),
  sanitizeURL: sanitizeDiagnosticURL,
})

const { registerChatGPTPlanDownloads } = createChatGPTDownloadRouter({
  chatGPTWorkerEntries, chatAgentWorkerActivity,
  registerOrchestratorExecutionDownload, expectedChatGPTOrchestratorExecutions,
  tempPath: () => app.getPath('temp'),
  registerChatGPTOrchestratorPlanDownload,
  registerChatGPTMarkdownTranslationDownload,
  registerReleaseNotesBundleDownload, expectedChatGPTReleaseNotes,
  registerChatGPTTodoClassificationDownload, expectedChatGPTBundleForDownload,
  chatGPTKeyForWebContents, canonicalWharnessBundleDownload,
  BundleOwnershipError, path, publishBundleDownloadError,
  handleBundleDownload, handleLegacyPlanDownload,
})

function chatGPTKeyForEntry(entry) {
  const key = String(entry?.ownerKey || '')
  if (!key) return ''
  if (entry?.role === 'worker') return chatGPTWorkerEntries.includes(entry) ? key : ''
  return chatgptViews.get(key) === entry ? key : ''
}

function chatGPTKeyForWebContents(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return ''
  for (const [key, entry] of chatgptViews) if (entry.view.webContents.id === webContents.id && entry.ownerKey === key) return key
  const worker = chatGPTWorkerEntries.find((entry) => entry.view.webContents.id === webContents.id && entry.ownerKey)
  return worker?.ownerKey || ''
}

const {
  publishAuthComplete, cancelExternalAuthentication,
  startExternalAuthentication, routeChatGPTNavigation,
} = createChatGPTAuthentication({
  chatgptViews, chatGPTAuthBrowsers, chatGPTKeyForEntry,
  windowStateForEntry, sendToWindowState, publishChatGPTState,
  sanitizeDiagnosticURL, loginURL: CHATGPT_LOGIN_URL, homeURL: CHATGPT_URL,
  managedAuthProfilePath, closeManagedBrowserAuth, launchManagedBrowserAuth,
  electronCookieDetails, session, partition: CHATGPT_PARTITION,
  isTrustedChatGPTOrigin, isChatGPTAuthURL, loadOwnedChatGPTURL,
  chatGPTSurfaceShouldBeVisible: (...args) => chatGPTSurfaceShouldBeVisible(...args),
  chatGPTNavigationDisposition, shell,
})

const {
  refreshEmbeddedChatGPTAuthentication, scheduleEmbeddedChatGPTAuthenticationProbe,
  observeEmbeddedAuthURL,
} = createEmbeddedChatGPTAuthentication({
  isTrustedChatGPTOrigin, isChatGPTAuthURL, chatGPTSessionProbeExpression,
  publishChatGPTState, chatGPTNavigationDisposition, publishAuthComplete,
  sanitizeDiagnosticURL,
})

let chatGPTViewOperations
function chatGPTViewLifecycle() {
  if (!chatGPTViewOperations) chatGPTViewOperations = createChatGPTViewOperations({
    sanitizeChatCacheKey, requireTrustedChatGPTURL,
    requireOwnedChatGPTEntry, sameConversationURL,
    currentChatGPTState, windowStateForEntry,
    chatAgentWorkerActivity, sanitizeDiagnosticURL,
    withChatGPTNavigationDeadline, userAgent: CHATGPT_USER_AGENT,
    wait, isTrustedChatGPTOrigin,
    WebContentsView, securePreferences, CHATGPT_PARTITION,
    CHATGPT_USER_AGENT, createChatGPTAffinityTracker,
    chatgptViews, grantChatGPTLayoutViewport,
    chatGPTNavigationDisposition, routeChatGPTNavigation,
    touchChatGPTEntry, publishChatGPTState, observeChatGPTAffinityURL,
    scheduleChatGPTAffinitySettlement, scheduleEmbeddedChatGPTAuthenticationProbe,
    expectedChatGPTBundles, pollExpectedChatGPTDownloadKey,
    chatgptTransportModes, hideChatGPTSidebar, observeEmbeddedAuthURL,
    isRecoverableChatGPTNetworkError, noteChatGPTRendererFault,
    noteChatGPTRecoveryProgress, clearChatGPTHumanAction,
    chatGPTWorkerEntries, chatAgentResidency, shell,
    publishChatAgentRuntimeState, closeWorkerMonitor,
    hideChatAgentInteractionEntry,
    classifyChatGPTConversationTransport, reconcileChatGPTConversationTransport,
  })
  return chatGPTViewOperations
}

function loadOwnedChatGPTURL(cacheKey, entry, value, reason = 'navigate') {
  return chatGPTViewLifecycle().loadOwnedChatGPTURL(cacheKey, entry, value, reason)
}

function createChatGPTView(cacheKey, windowState) {
  return chatGPTViewLifecycle().createChatGPTView(cacheKey, windowState)
}

function createChatGPTWorkerView(slotId, windowState) {
  return chatGPTViewLifecycle().createChatGPTWorkerView(slotId, windowState)
}

function retireChatGPTWorkerView(entry) {
  return chatGPTViewLifecycle().retireChatGPTWorkerView(entry)
}

const chatAgentPolicyStore = createChatAgentPolicyStore({
  userDataPath: () => app.getPath('userData'), policies: () => chatAgentPolicies,
})
const loadChatAgentPolicies = chatAgentPolicyStore.load
const persistChatAgentPolicies = chatAgentPolicyStore.persist

const keepFlowingState = createKeepFlowingState({
  policies: () => chatAgentPolicies,
  workerStates: chatAgentWorkerStates,
  workerCount: () => chatGPTWorkerEntries.length,
  delivered: recentlyDeliveredChatGPTBundleRequestId,
  pendingDeliveries: pendingChatGPTBundleDeliveries,
  expectedBundles: expectedChatGPTBundles,
})
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
} = createChatAgentSchedulingOperations({
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
  },
  chatGPTWorkerEntries, chatAgentKeepFlowingActive, orchestrationTaskPins,
  chatAgentWorkerStates, normalizeSupervisorSlotCount,
  normalizeWorkerSlotCount, publishChatAgentRuntimeState,
  chatgptViews, chatSupervisorLeaseKeys, supervisorBindingHeld,
  chatAgentQueueDiagnostics,
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
})

const {
  workerEntryForAgentID, hideChatAgentInteractionEntry,
  hideChatAgentInteractionsForWindow, showChatAgentInteraction,
  setChatAgentInteractionBounds, closeChatAgentInteraction,
} = createWorkerInteraction({
  chatGPTWorkerEntries, isEphemeralAgentID: (id) => EPHEMERAL_AGENT_ID.test(id),
  desktopWindows, windowStateForEntry,
  grantChatGPTLayoutViewport: (...args) => grantChatGPTLayoutViewport(...args),
  publishChatAgentRuntimeState, chatAgentWorkerStates, normalizeBounds,
  reconcileChatGPTWorkerPool: (...args) => reconcileChatGPTWorkerPool(...args),
})

const { reconcileChatAgentWorkerTasks, refreshChatAgentRuntimeState } = createChatAgentRuntimeRefresh({
  state: {
    get scheduler() { return chatAgentScheduler },
    get desiredWorkerSlots() { return desiredChatAgentWorkerSlots },
    get diagnostics() { return chatAgentRuntimeDiagnostics },
    set diagnostics(value) { chatAgentRuntimeDiagnostics = value },
    get rateLimitUntil() { return chatGPTRateLimitUntil },
    set rateLimitUntil(value) { chatGPTRateLimitUntil = value },
    get resumeProbeRequired() { return chatGPTRateLimitResumeProbeRequired },
    set resumeProbeRequired(value) { chatGPTRateLimitResumeProbeRequired = value },
    get rateLimitKind() { return chatGPTRateLimitKind },
    set rateLimitKind(value) { chatGPTRateLimitKind = value },
    get rateLimitAppliedAt() { return chatGPTRateLimitAppliedAt },
    set rateLimitAppliedAt(value) { chatGPTRateLimitAppliedAt = value },
  },
  chatGPTWorkerEntries, chatAgentWorkerStates, HARD_MAX_WORKER_SLOTS,
  chatAgentQueueDiagnostics, runtimeState: () => chatAgentRuntimeState(),
})

const publicAgentBrowser = (entry) => projectAgentBrowser(entry, sanitizeDiagnosticURL)

function chatAgentRuntimeMemory(agents) {
  try { return chatAgentMemorySnapshot(agents, app.getAppMetrics()) } catch { return chatAgentMemorySnapshot(agents, []) }
}

function chatAgentRuntimeState() {
  return buildChatAgentRuntimeState({
    chatAgentPolicies, desiredChatAgentSupervisorSlots, desiredChatAgentWorkerSlots,
    configuredChatAgentSupervisorSlots, configuredChatAgentWorkerSlots,
    chatSupervisorSlotID, supervisorKeyForSlot, chatgptViews, desktopWindows,
    chatSupervisorStates, sanitizeOptionalChatCacheKey, supervisorBindingHold,
    chatGPTWorkerEntries, chatAgentWorkerStates, chatAgentKeepFlowingActive,
    chatAgentKeepFlowingConfigured, orchestrationTaskPins, chatAgentResidency,
    chatAgentWorkerActivity, EPHEMERAL_AGENT_ID, EPHEMERAL_WORKER_LABELS,
    chatAgentScheduler, chatAgentRuntimeDiagnostics, publicAgentBrowser,
    chatAgentRuntimeMemory,
  })
}

// Captures an agent's page even when nothing is painting it.
async function chatAgentBrowserSnapshot(agentID) {
  const id = String(agentID || '').trim()
  const entry = id === 'supervisor' ? supervisorEntry() : /^supervisor-[1-9][0-9]?$/.test(id) ? supervisorEntryForSlot(id) : chatGPTWorkerEntries.find((candidate) => candidate.slotId === id)
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) throw new Error('Agent browser instance is not available')
  const layoutKey = entry.ownerKey || (entry.role === 'supervisor' ? supervisorKey(windowStateForEntry(entry)) : entry.slotId || id)
  ensureChatGPTLayoutViewport(layoutKey, entry)
  let dataUrl
  try {
    dataUrl = entry.role === 'worker' && !entry.interactionWindowId
      ? await captureParkedWorkerPage(entry, BrowserWindow, { openMonitor: openWorkerMonitor, closeMonitor: closeWorkerMonitor })
      : await captureChatGPTAgentPage(wc)
  } catch (error) {
    const category = String(error?.message || '').includes('excedeu') ? 'deadline' : 'capture-failed'
    console.warn(`[chat-agent-snapshot] agent=${id} category=${category}`)
    throw error
  }
  return { agentId: id, dataUrl, capturedAt: new Date().toISOString() }
}

const {
  retireChatGPTSupervisorSurface, supervisorKey, supervisorEntry,
  supervisorSlotID, reusableSupervisor, ensureChatGPTView,
  evictIdleChatGPTViews,
} = createSupervisorSurfaceSlots({
  sanitizeChatCacheKey, chatgptViews, cancelExternalAuthentication,
  windowStateForEntry, desktopWindows,
  getDesiredChatAgentSupervisorSlots: () => desiredChatAgentSupervisorSlots,
  supervisorBindingHeld, createChatGPTView, requireOwnedChatGPTEntry,
  touchChatGPTEntry, chatGPTEntryIsActiveVisible,
})

const { chatGPTSurfaceShouldBeVisible, activateChatGPTView } = createSupervisorSurfaceVisibility({
  chatgptViews, sanitizeChatCacheKey, windowStateForEntry,
  ensureChatGPTView, activeChatGPTEntry, reconcileChatGPTThrottle,
  setChatGPTBounds, touchChatGPTEntry, evictIdleChatGPTViews,
  publishChatGPTState,
})

const {
  clearDeferredSupervisorNavigation, scheduleDeferredSupervisorNavigation,
  setDeferredSupervisorNavigation, differentSupervisorTransport,
  currentSupervisorSurfaceRoute, deferSupervisorNavigationIfBusy,
  applyDeferredSupervisorNavigation,
} = createSupervisorSurfaceNavigation({
  navigationState: {
    get pending() { return deferredSupervisorNavigation },
    set pending(value) { deferredSupervisorNavigation = value },
    get timer() { return deferredSupervisorNavigationTimer },
    set timer(value) { deferredSupervisorNavigationTimer = value },
  },
  sanitizeChatCacheKey, supervisorEntry, supervisorKey,
  chatgptViews, reconcileChatGPTThrottle, chatGPTKeyForEntry,
  sendToWindowState, currentChatGPTState, supervisorSurfaceRoute,
  reusableSupervisor,
  getDesiredChatAgentSupervisorSlots: () => desiredChatAgentSupervisorSlots,
  activateChatGPTView, requireTrustedChatGPTURL, CHATGPT_URL,
  sameConversationURL, loadOwnedChatGPTURL, chatGPTSurfaceShouldBeVisible,
  flushQueuedChatGPTComments: (...args) => flushQueuedChatGPTComments(...args),
  DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS,
})

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForConcreteChatGPTConversation(wc, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let candidate = ''
  let stableSince = 0
  while (Date.now() < deadline) {
    if (!wc || wc.isDestroyed()) break
    const current = canonicalChatGPTConversationURL(wc.getURL())
    if (current !== candidate) {
      candidate = current
      stableSince = current ? Date.now() : 0
    }
    if (candidate && !wc.isLoading() && Date.now() - stableSince >= 600) return candidate
    await wait(100)
  }
  return ''
}

async function waitForSubmittedChatGPTConversation(cacheKey, entry, fallback = '') {
  const { wc } = requireOwnedChatGPTEntry(cacheKey, entry)
  const stableURL = await waitForConcreteChatGPTConversation(wc, 30_000)
  if (stableURL) settleChatGPTAffinityAfterSubmit(cacheKey, entry, stableURL)
  return stableURL || canonicalChatGPTConversationURL(fallback)
}

const requestContextClient = createChatGPTRequestContextClient({
  backendURL: BACKEND_URL,
  maxContextBytes: MAX_CONTEXT_BYTES,
})
const {
  fetchContextZip, fetchChatContextSelection, fetchSelectedContextZip,
  fetchRequestGitContext, fetchRequestKnowledge, fetchRequestContinuation,
} = requestContextClient

async function persistChatArtifact(sessionId, requestId, direction, kind, filename, contentType, bytes, signal) {
  return uploadChatArtifact(BACKEND_URL, sanitizeSessionId(sessionId), { requestId, direction, kind, filename, contentType, bytes }, signal)
}

async function requireAutoSession(sessionId, signal) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error', signal })
  if (!response.ok) throw new Error(`Session lookup HTTP ${response.status}`)
  const sessionState = await response.json()
  if (!['auto', 'auto_approve'].includes(sessionState?.automation_mode)) throw new Error('Automatic ChatGPT submission requires a project automatic mode')
}

const chatGPTAttachmentTools = createChatGPTAttachmentTools({
  backendURL: BACKEND_URL,
  userDataPath: () => app.getPath('userData'),
  nativeImage,
  getFileIcon: (...args) => app.getFileIcon(...args),
})
const {
  fetchChatTransportLimits, decodeChatAttachmentSet, decodeChatArtifactSet,
  createPersistentAttachmentPreview, chatAttachmentRoot,
} = chatGPTAttachmentTools

const {
  materializeChatInput, materializeProtocolChatInput,
  fillBundledChatGPTComposer,
} = createChatInputPreparation({
  chatAgentWorkerActivity, requestPreparationTimer,
  throwIfChatGPTTransportAborted, fetchChatTransportLimits,
  decodeChatAttachmentSet, decodeChatArtifactSet, path, app, rm, mkdir,
  fetchRequestKnowledge, fetchRequestGitContext, fetchRequestContinuation,
  fetchSelectedContextZip, writeChatInputTransportArchives,
  boundedChatInputPartBytes, persistChatArtifact, readFile, randomUUID,
  withRequestPreparationDeadline, localChatInputBootstrap,
  chatGPTFillComposerScript, pasteChatGPTFile: (...args) => pasteChatGPTFile(...args),
  wait, chatInputSettleDelay,
})

async function executeChatGPTDOMScript(cacheKey, entry, stage, script) {
  const key = sanitizeChatCacheKey(cacheKey)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await evaluateChatGPTDOMWithDeadline(wc, script)
    } catch (error) {
      console.warn(`[chatgpt-dom] stage=${stage} key=${key} attempt=${attempt} evaluation failed; waiting for renderer stability`)
      await wait(250)
      if (attempt < 3) await waitForChatGPTSurfaceReady(key, entry)
    }
  }
  console.warn(`[chatgpt-dom] stage=${stage} key=${key} exhausted renderer evaluation retries`)
  throw new Error(`A interface do ChatGPT não ficou estável ao preparar ${stage}. Reabra a aba ChatGPT e tente novamente.`)
}

function serializeChatGPTAccountOperation(operation) {
  const next = chatGPTAccountOperation.catch(() => undefined).then(operation)
  chatGPTAccountOperation = next.catch(() => undefined)
  return next
}

function runChatGPTAccountAction(action, payload, browserFallback) {
  return chatGPTAccountProviders.run(action, payload, (_ignoredAction, ignoredPayload) => browserFallback(ignoredPayload))
}

const {
  runChatGPTAccountScript,
  hideChatGPTSidebar,
  focusedLocalWharnexContents,
  withPreservedLocalFocus,
  grantChatGPTLayoutViewport,
  ensureChatGPTLayoutViewport,
  pressChatGPTControl,
  pressChatGPTControlKey,
  commitChatGPTAccountControl,
  chooseChatGPTConversationAction,
  ensureChatGPTProject,
  organizeChatGPTConversation,
  suggestChatGPTConversationTitle,
  archiveChatGPTConversation,
  deleteChatGPTConversation,
  deleteChatGPTLibraryArtifact,
  stopChatGPTConversation,
} = createChatGPTAccountOperations({
  executeChatGPTDOMScript,
  isTrustedChatGPTOrigin,
  runChatGPTAccountAction,
  BrowserWindow,
  desktopWindows,
  preserveLocalFocusDuringBackgroundOperation,
  windowStateForEntry,
  chatgptViews,
  dispatchChatGPTPointerPress,
  wait,
  CHATGPT_CONTROL_PRESS_HOLD_MS,
  dispatchChatGPTAccountKey,
  requireOwnedChatGPTEntry,
  CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
  CHATGPT_MENU_REOPEN_ATTEMPTS,
  sanitizeChatCacheKey,
  ensureChatGPTView,
  serializeChatGPTAccountOperation,
  paceChatGPTWorkerNavigation: (...args) => paceChatGPTWorkerNavigation(...args),
  requireTrustedChatGPTURL,
  sameConversationURL,
  loadOwnedChatGPTURL,
  waitForChatGPTSurfaceReady,
  chatGPTConversationID,
  dispatchChatGPTPointerClick,
  reconcileChatGPTThrottle,
  createChatGPTAffinityTracker,
  releaseChatGPTView,
  chatGPTKeyForEntry,
  path,
  parseBundleName,
  CHATGPT_LIBRARY_URL,
})

const { reloadOwnedChatGPTConversation } = createOwnedChatGPTConversationReload({
  sanitizeChatCacheKey, requireOwnedChatGPTEntry,
  canonicalChatGPTConversationURL, sameConversationURL,
  loadOwnedChatGPTURL, isTrustedChatGPTOrigin, homeURL: CHATGPT_URL,
})

const { targetChatGPTComposer } = createChatGPTComposerTarget({
  sanitizeChatCacheKey, ensureChatGPTView, requireOwnedChatGPTEntry,
  ensureChatGPTLayoutViewport, requireTrustedChatGPTURL,
  canonicalChatGPTConversationURL, syncChatGPTAffinityURL,
  sameConversationURL, loadOwnedChatGPTURL, proposeCurrentChatGPTAffinity,
  waitForChatGPTSurfaceReady, executeChatGPTDOMScript,
  chatGPTHumanActionScript, noteChatGPTRateLimitGate,
  setChatGPTHumanAction, clearChatGPTHumanAction,
  chatGPTHumanActionMessage, chatGPTComposerReadyScript,
  touchChatGPTEntry, wait,
})

async function waitForChatGPTSurfaceReady(cacheKey, entry) {
  const { wc } = requireOwnedChatGPTEntry(cacheKey, entry)
  const settle = () => waitForChatGPTReady({
    isLoading: () => entry.loading || wc.isLoading(),
    lastNetworkActivity: () => entry.lastNetworkActivity,
    wait,
  })
  await settle()
  if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('Active cached view is not a trusted ChatGPT page')
  await recoverChatGPTConversationLoadFailure(cacheKey, entry, wc, settle)
}

// ChatGPT's "could not load this conversation" surface stalls every action on
// the page until retry is pressed. It is what a throttled conversation read
// (GET /backend-api/conversations/<id> → 429) looks like, so pressing retry
// again and again only earns more refusals. A failure must hold across two
// probes, then the page's own retry control is pressed once (or the page is
// reloaded when that control is not unambiguous), paced for a Worker. If the
// conversation still does not load, the action is deferred for free with a
// growing per-conversation backoff so the read throttle can clear.
const {
  chatGPTConversationReadCooldownMs, chatGPTConversationReadGateMs,
  releaseChatGPTConversationReadProbe, noteChatGPTConversationReadHealthy,
  noteChatGPTConversationReadFailure, recoverChatGPTConversationLoadFailure,
  parkChatGPTWorkerAfterLoadFailure,
} = createChatGPTConversationReadHealth({
  chatGPTConversationLoadFailureScript, canonicalChatGPTConversationURL,
  chatGPTConversationID, wait,
  paceChatGPTWorkerNavigation: (...args) => paceChatGPTWorkerNavigation(...args),
  createConversationUnavailable: (delayMs) => new ChatGPTConversationUnavailable(delayMs),
  chatAgentResidency, createChatGPTAffinityTracker,
})

function noteOrchestrationTaskPin(worker, task, result) {
  const entry = workerEntryForIndex(worker)
  if (!entry) return
  const outcome = orchestrationTaskPins.note(entry.slotId, task, result)
  if (outcome) console.log(`[chat-agent] orchestration-pin slot=${entry.slotId} task=${String(task?.chat_id || '')} ${outcome} status=${String(result?.status || '')}`)
}

const {
  chatAgentRateLimitDelayMs, chatAgentRateLimitResumeBlocked,
} = createChatGPTRateLimitResume({
  state: {
    get until() { return chatGPTRateLimitUntil },
    get resumeProbeRequired() { return chatGPTRateLimitResumeProbeRequired },
    set resumeProbeRequired(value) { chatGPTRateLimitResumeProbeRequired = value },
    get resumeProbe() { return chatGPTRateLimitResumeProbe },
    set resumeProbe(value) { chatGPTRateLimitResumeProbe = value },
    get resumeProbeNotBefore() { return chatGPTRateLimitResumeProbeNotBefore },
    set resumeProbeNotBefore(value) { chatGPTRateLimitResumeProbeNotBefore = value },
  },
  chatGPTWorkerEntries, chatGPTKeyForEntry,
  paceChatGPTWorkerNavigation: (...args) => paceChatGPTWorkerNavigation(...args),
  isTrustedChatGPTOrigin, homeURL: CHATGPT_URL, userAgent: CHATGPT_USER_AGENT,
  wait, waitForChatGPTReady, chatGPTHumanActionScript,
  noteChatGPTRateLimitGate, sanitizeDiagnosticURL,
})

// Process-wide spacing between cross-chat navigation starts, scaled by how the
// provider is actually behaving.
//
// A fixed 30-second gate protected the account at a cost that only appeared at
// scale: navigation is serialized process-wide, so the whole pool could rebind
// twice a minute no matter how many workers were free or how many conversations
// held due work. Six idle workers waiting on one clock is not protection, it is
// the idleness the gate was never meant to buy. The provider's own durable
// 429 evidence is the right input: while it reports no pressure the gate stays
// at a healthy floor, and every escalation level walks it back up to the
// protective 30-second ceiling, which is where a rate-limited account belongs.
const {
  ChatGPTRateLimitDeferral, ChatGPTConversationUnavailable,
  chatAgentNavigationGapMs, paceChatGPTWorkerRequest, paceChatGPTWorkerNavigation,
  chatAgentSubmissionGapMs, paceChatGPTWorkerSubmission, loadAndSettleChatGPTWorkerConversation,
} = createWorkerPacing({
  getRuntimeDiagnostics: () => chatAgentRuntimeDiagnostics,
  CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS,
  CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS, CHATGPT_WORKER_NAVIGATION_GAP_MS,
  CHAT_AGENT_WORKER_ACTION_GAP_MS, chatAgentWorkerActivity, chatGPTWorkerPacer,
  CHAT_AGENT_SUBMIT_GAP_MS, CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS,
  CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, chatAgentRateLimitDelayMs,
  loadOwnedChatGPTURL, waitForChatGPTSurfaceReady, chatAgentResidency,
})

const { pasteChatGPTFile } = createChatGPTFileUpload({
  chatGPTKeyForEntry, requireOwnedChatGPTEntry, pasteWithUploadRetry,
  paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs,
  ChatGPTRateLimitDeferral, chatAgentWorkerActivity,
  waitForChatGPTSurfaceReady, chatGPTComposerReadyScript,
  chatGPTUploadThumbnailScript, path, chatGPTUploads,
  selectChatGPTUploadFile,
})

// Keep the account-specific control interaction isolated from submission.
async function stepChatGPTReasoningEffortToward(key, entry, wanted) {
  return stepChatGPTEffort({
    key, entry, wanted, behavior: CHATGPT_BEHAVIOR,
    executeDOM: executeChatGPTDOMScript, requireOwned: requireOwnedChatGPTEntry,
    press: pressChatGPTControl, pressKey: pressChatGPTControlKey,
    wait, settleMs: CHATGPT_ACCOUNT_ACTION_SETTLE_MS,
    reopenAttempts: CHATGPT_MENU_REOPEN_ATTEMPTS,
  })
}

// A successful DOM send and an observed provider POST are different facts.
// Automatic flows dispatch once when observation is ambiguous, then supervise
// the armed request instead of replaying a potentially duplicate submission.
const { submitChatGPTDraft } = createChatGPTDraftSubmission({
  chatAgentWorkerActivity, targetChatGPTComposer, normalizeChatGPTReasoningEffort,
  canonicalChatGPTConversationURL, sameConversationURL,
  ensureChatGPTReasoningEffort, executeChatGPTDOMScript,
  reasoningEffortStateScript, CHATGPT_BEHAVIOR, requireOwnedChatGPTEntry,
  stepChatGPTReasoningEffortToward, markChatGPTAffinitySubmitted,
  submitWithoutReplay, chatAgentRateLimitDelayMs, ChatGPTRateLimitDeferral,
  chatGPTSubmissions, chatGPTSubmitScript,
})

const {
  preparePromptForChatGPT,
  queuePreparedPromptForWorker,
  retryPersistedChatGPTPrompt,
  retryPreparedChatGPTPrompt,
  attachContextToChatGPT,
  attachPromptToChatGPT,
  submitPreparedChatGPTDraft,
  submitPromptToChatGPT,
  automaticChatGPTContinuationBlockReason,
  chatGPTContinuationSuppressedError,
  submitChatGPTContinuation,
} = createChatGPTPromptTransport({
  throwIfChatGPTTransportAborted,
  sanitizeChatCacheKey,
  durableWorkspaceChatID: (...args) => durableWorkspaceChatID(...args),
  authoritativeBundleFilename,
  chatgptTransportModes,
  normalizeChatGPTReasoningEffort,
  requireAutoSession,
  retryableChatGPTPrompts,
  canonicalChatGPTConversationURL,
  chatgptViews,
  shouldAttachProjectContext,
  chatGPTConversationID,
  requestPreparationTimer,
  withRequestPreparationDeadline,
  materializeChatInput,
  localChatInputBootstrap,
  preparedChatGPTDrafts,
  manualChatGPTTransport,
  path,
  touchChatGPTEntry,
  CHATGPT_URL,
  targetChatGPTComposer,
  syncChatGPTAffinityURL,
  executeChatGPTDOMScript,
  chatGPTFillComposerScript,
  pasteChatGPTFile,
  wait,
  chatInputSettleDelay,
  chatGPTAssistantTurnCount,
  armExpectedChatGPTBundle,
  submitChatGPTDraft,
  disarmExpectedChatGPTBundle,
  waitForSubmittedChatGPTConversation,
  persistWorkspaceChatRemoteBestEffort: (...args) => persistWorkspaceChatRemoteBestEffort(...args),
  enqueueChatAgentFollowups,
  expectedChatGPTBundles,
  sanitizeSessionId,
  getChatAgentScheduler: () => chatAgentScheduler,
  enqueueChatAgentTask: (...args) => enqueueChatAgentTask(...args),
  refreshChatAgentRuntimeState,
  publishChatAgentRuntimeState,
  BACKEND_URL,
  fetch,
  chatInputArchiveFilename,
  app,
  rm,
  mkdir,
  MAX_CONTEXT_BYTES,
  writeFile,
  chatInputPartManifest,
  clearChatGPTHumanAction,
  recentlyDeliveredChatGPTBundleRequestId,
  RETRYABLE_PROMPT_TTL_MS,
  fetchContextZip,
  plannerPromptMarkdown,
  activateChatGPTView,
  requireOwnedChatGPTEntry,
  canonicalBundleFilename,
  fillBundledChatGPTComposer,
  chatGPTBundleAlreadyValidated,
  MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
  chatGPTDeliveryContinuationPrompt,
})

const {
  durableWorkspaceChatID, persistWorkspaceChatRemote,
  persistWorkspaceChatRemoteBestEffort,
} = createWorkspaceChatRemote({
  sanitizeChatCacheKey, canonicalChatGPTConversationURL, BACKEND_URL, fetch,
})

function chatAgentTaskPayload(task) {
  if (task?.payload && typeof task.payload === 'object' && !Buffer.isBuffer(task.payload)) return task.payload
  try { return JSON.parse(String(task?.payload || '{}')) } catch { return {} }
}

function chatAgentConversationURL(task, payload = chatAgentTaskPayload(task)) {
  const fromPayload = canonicalChatGPTConversationURL(payload?.conversation_url || '')
  if (fromPayload) return fromPayload
  const id = String(task?.conversation_id || '').trim()
  return /^[A-Za-z0-9-]{1,128}$/.test(id) ? `https://chatgpt.com/c/${id}` : ''
}

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

function expectedChatAgentPayload(key, requestId, conversationURL, values = {}) {
  return {
    conversation_url: canonicalChatGPTConversationURL(conversationURL),
    expected_filename: authoritativeBundleFilename(values.expectedFilename, requestId, key),
    assistant_baseline: Math.max(0, Number(values.assistantBaseline || 0)),
    recovery_bootstrap: String(values.recoveryBootstrap || ''), original_prompt: String(values.originalPrompt || ''),
    session_id: String(values.sessionId || ''), live_tunnels: Array.isArray(values.liveTunnels) ? values.liveTunnels.slice(0, 16) : [],
    project_name: String(values.projectName || ''), project_path: String(values.projectPath || ''),
    fallback_title: String(values.fallbackTitle || ''), recovery_count: Math.max(0, Number(values.recoveryCount || 0)),
    workspace_chat_id: String(values.workspaceChatId || ''),
    request_metadata: values.requestMetadata && typeof values.requestMetadata === 'object' ? { ...values.requestMetadata } : {},
    request_eligible_at: String(values.requestEligibleAt || ''),
  }
}

async function enqueueChatAgentFollowups(key, requestId, conversationURL, values = {}) {
  const requestEligibleAt = String(values.requestEligibleAt || new Date(Date.now() + chatAgentInitialRequestWaitMs()).toISOString())
  const payload = expectedChatAgentPayload(key, requestId, conversationURL, { ...values, requestEligibleAt })
  // The canonical host project path, never the ChatGPT display name. An empty
  // value is resolved by the backend from the task's own chat or session.
  const common = { key, requestId, rootRequestId: requestId, conversationURL, sessionID: payload.session_id, projectID: payload.project_path, payload, notBefore: requestEligibleAt }
  // Guaranteed, not best-effort: this AWAIT_RESPONSE task is the Main
  // Request's only durable record, so the caller needs the resulting task id
  // (to anchor every later recovery/bundle decision event) and needs a
  // failure here to be a real failure, not a swallowed console.error.
  return enqueueChatAgentTask('AWAIT_RESPONSE', { ...common, dedupeKey: `await:${requestId}`, maxAttempts: 30, retry: true })
}

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
  getScheduler: () => chatAgentScheduler,
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
  performChatGPTRecoveryAction: (...args) => performChatGPTRecoveryAction(...args),
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
  setRecentExpectedDownload: (value) => { recentExpectedDownload = value },
})

const { executeChatAgentWrite } = createAgentWrite({
  paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs, sanitizeSessionId,
  canonicalChatGPTConversationURL, durableWorkspaceChatID,
  withChatGPTTransportPreparation, preparePromptForChatGPT,
  chatGPTBundleAlreadyValidated, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
  chatGPTDeliveryContinuationPrompt, sameConversationURL,
  submitChatGPTContinuation, submitPromptToChatGPT, expectedChatGPTBundles,
  recordChatGPTContinuationSent: (...args) => recordChatGPTContinuationSent(...args),
  persistWorkspaceChatRemoteBestEffort, expectedChatAgentPayload,
  enqueueChatAgentTask, chatAgentInitialRequestWaitMs,
})

async function executeChatAgentTitleDiscover() {
  // Compatibility sink for durable pre-upgrade discovery tasks. Accepted
  // planner bundles now own naming through turn.chat_title.
  return { status: 'done' }
}

async function executeChatAgentTempTitle() {
  // Compatibility sink for durable pre-upgrade tasks. The planner response now
  // carries chat_title, so this task must never open a temporary conversation.
  return { status: 'done' }
}

async function executeChatAgentTitleAwait(task, entry, key, payload) {
  // A temporary conversation may predate this upgrade. Do not use it as a
  // naming source; only queue its cleanup if it still exists.
  const tempURL = canonicalChatGPTConversationURL(payload.temp_url || '')
  if (tempURL && !(await chatAgentChildExists(task, 'DELETE_TEMP_CHAT'))) {
    await enqueueChatAgentTask('DELETE_TEMP_CHAT', {
      key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id,
      conversationURL: tempURL, parentTaskID: task.task_id,
      dedupeKey: `delete-temp:${chatAgentConversationID(tempURL)}`,
      payload: { ...payload, target_url: tempURL }, maxAttempts: 8,
    })
  }
  return { status: 'done' }
}

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
  chatGPTBundleAlreadyValidated, getScheduler: () => chatAgentScheduler,
  expectedChatGPTBundles, sanitizeChatCacheKey, orchestratorConversationGuard,
  executeChatGPTDOMScript, chatGPTSubmittedRequestEvidenceScript,
  chatInputArchiveFilename, armExpectedChatGPTBundle, enqueueChatAgentFollowups,
  disarmExpectedChatGPTBundle, clearChatGPTHumanAction,
  orchestratorRetryInput, readStoredAttachment, chatAttachmentRoot,
  withChatGPTTransportPreparation, preparePromptForChatGPT, path,
})

async function chatAgentLifecycleBlocked(task) {
  const listed = await chatAgentScheduler.list({ chat_id: task.chat_id })
  return (listed?.tasks || []).some((item) => item.task_id !== task.task_id && ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status) && ['BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE'].includes(item.type))
}

// The exact artifact a translation answer has to be.
//
// It is a response bundle like every other exchange with the provider, not a
// bare Markdown file: the archive carries its own protocol identity and the
// digest of the document it answers, so "this is the translation of what we
// sent" became something the engine can check rather than assume.
function markdownTranslationFilename(taskID) {
  const id = String(taskID || '').trim()
  if (!/^cat_[a-f0-9]{20}$/.test(id)) throw new Error('invalid translation task id')
  return `whx_translation_res_${id}.zip`
}

function todoClassificationFilename(taskID) {
  const id = String(taskID || '').trim()
  if (!/^cat_[a-f0-9]{20}$/.test(id)) throw new Error('invalid TODO classification task id')
  return `whx_todo_classification_res_${id}.zip`
}

// Legacy per-task JSON artifact. Retained only so a planning request that was
// already checkpointed under the old contract can finish on it; nothing new is
// ever asked for in this shape.
function orchestratorPlanFilename(taskID) {
  const id = String(taskID || '').trim()
  if (!/^cat_[a-f0-9]{20}$/.test(id)) throw new Error('invalid orchestrator planning task id')
  return `whx_orchestrator_plan_${id}.json`
}

// The planning result is a response bundle like every other planner artifact.
// The chat segment is the literal "orchestrator": a planning request owns no
// Harness chat, and the segment may not contain '_'.
function orchestratorBundleFilename(requestID) {
  const id = String(requestID || '').trim()
  if (!/^orp_[0-9]{8}T[0-9]{6}_[0-9a-f]{16}$/.test(id)) throw new Error('invalid orchestrator request id')
  return buildBundleName('res', 'orchestrator', id)
}

// A checkpoint written under the old contract names a `.json` artifact; anything
// else — including a fresh request — uses the bundle.
function orchestratorDeliveryFor(checkpointFilename) {
  return String(checkpointFilename || '').endsWith('.json') ? 'json' : 'bundle'
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

// Transport for one translation request.
//
// The worker composes nothing. The backend's translation engine built the
// request bundle, wrote the instruction into it, and named the exact artifact
// that counts as an answer; this function uploads that archive, waits for that
// exact filename, and returns the bytes it downloaded without reading them. The
// engine that authored the contract is the one that validates the reply.
//
// That is the whole reason translation moved onto a bundle. When the worker
// pasted a prose instruction and hoped for a Markdown file back, an answer in
// the wrong shape — prose, the source echoed back, a differently named file —
// was indistinguishable from no answer, so the job sat in the queue until it
// timed out. A bundle can be wrong in ways that have names.

const { executeChatAgentMarkdownTranslation, executeChatAgentTodoClassification } = createArtifactWorkers({
  markdownTranslationFilename,
  MAX_MARKDOWN_TRANSLATION_BYTES,
  paceChatGPTWorkerSubmission,
  path,
  app,
  rm,
  mkdir,
  writeFile,
  expectedChatGPTTranslations,
  reconcileChatGPTThrottleForKey,
  requireOwnedChatGPTEntry,
  waitForChatGPTSurfaceReady,
  targetChatGPTComposer,
  CHATGPT_URL,
  executeChatGPTDOMScript,
  chatGPTFillComposerScript,
  pasteChatGPTFile,
  wait,
  chatInputSettleDelay,
  chatGPTAssistantTurnCount,
  submitChatGPTDraft,
  waitForSubmittedChatGPTConversation,
  MARKDOWN_TRANSLATION_TIMEOUT_MS,
  MARKDOWN_TRANSLATION_POLL_MS,
  chatGPTHumanActionScript,
  noteChatGPTRateLimitGate,
  setChatGPTHumanAction,
  chatGPTHumanActionMessage,
  pollWorkerExpectedDownload,
  chatGPTExpectedDownloadScript,
  enqueueChatAgentTask,
  chatAgentConversationID,
  todoClassificationFilename,
  MAX_TODO_CLASSIFICATION_BYTES,
  chatAgentRateLimitDelayMs,
  expectedChatGPTTodoClassifications,
  TODO_CLASSIFICATION_TIMEOUT_MS,
  chatGPTResponseCompletionScript,
})

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
// A Supervisor owns one Harness chat for the whole life of its request: it opens
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
  pollExpectedChatGPTDownloadKey: (...args) => pollExpectedChatGPTDownloadKey(...args),
  AWAIT_STALL_ATTENTION_MS, EXPECTED_BUNDLE_TTL_MS,
})

const {
  chatSupervisorHostWindow, bindChatSupervisor, noteChatSupervisorLane,
  chatSupervisorLanesHeldByOthers, executeChatSupervisorTask,
} = createSupervisorPool({
  desktopWindows, chatgptViews, touchChatGPTEntry,
  desiredSupervisorSlots: () => desiredChatAgentSupervisorSlots,
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

// Translation, Orchestrator planning and release notes never wait behind the
// Orchestrator execution Workers, and never take one of their slots. Each
// such task gets its own browser that lives until the task settles: a WAITING
// observation (a plan still being generated) keeps the page on its
// conversation, so the next observation does not reopen it. The configured
// Worker count and auto scale apply to Orchestrator execution only.
const EPHEMERAL_WORKER_TASK_TYPES = new Set(['TRANSLATE_MARKDOWN', 'ORCHESTRATOR_PLAN', 'RELEASE_NOTES'])
const EPHEMERAL_AGENT_ID = /^(ephemeral|translator)-cat_[a-f0-9]{20}$/
const EPHEMERAL_WORKER_LABELS = { ORCHESTRATOR_PLAN: 'Planeamento', RELEASE_NOTES: 'Release notes', TRANSLATE_MARKDOWN: 'Tradução' }
const EPHEMERAL_WORKER_IDLE_RETIRE_MS = 20 * 60_000
const EPHEMERAL_WORKER_PACE_PRIORITY = 2
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
  probeChatAgentResponse,
  executeChatAgentWrite,
  executeChatAgentTitleDiscover,
  executeChatAgentTempTitle,
  executeChatAgentTitleAwait,
})

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
  readPollingChatGPTVisibleActivity: () => pollingChatGPTVisibleActivity,
  setPollingChatGPTVisibleActivity: (value) => { pollingChatGPTVisibleActivity = value },
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
  setRecentExpectedDownload: (value) => { recentExpectedDownload = value },
})

const browserSessionOperations = createBrowserSessionOperations({
  app, session, dialog, partition: CHATGPT_PARTITION,
  partitionPath: chatGPTPartitionPath, authProfilePath: managedAuthProfilePath,
  pendingImportPath: pendingBrowserImportPath, attachmentRoot: chatAttachmentRoot,
  closeViews: closeAllChatGPTViews, closeInternalBrowsers: closeAllInternalChatGPTBrowsers,
  closeManagedAuth: closeManagedBrowserAuth, authBrowsers: chatGPTAuthBrowsers,
  preparedDrafts: preparedChatGPTDrafts, retryablePrompts: retryableChatGPTPrompts,
  expectedBundles: expectedChatGPTBundles,
  clearRecentDownload: () => { recentExpectedDownload = undefined },
  snapshot: snapshotBrowserSession, restore: restoreBrowserSession, size: pathSize,
})
const {
  exportSession: exportBrowserSession,
  importSession: importBrowserSession,
  applyPendingImport: applyPendingBrowserSessionImport,
  clearSession: clearBrowserSession,
  storageUsage: desktopStorageUsage,
  clearDesktopData: clearDesktopWharnexData,
} = browserSessionOperations

const openInternalChatGPTBrowser = createInternalChatGPTBrowser({
  BrowserWindow, shell, browsers: internalChatGPTBrowsers,
  trustedURL: requireTrustedChatGPTURL, isTrustedOrigin: isTrustedChatGPTOrigin,
  isHTTPS, titleFor: desktopWindowTitle, securePreferences,
  partition: CHATGPT_PARTITION, userAgent: CHATGPT_USER_AGENT,
  icon: DESKTOP_ICON, instance: DESKTOP_INSTANCE, homeURL: CHATGPT_URL,
})

const createWindow = createDesktopWindowCreator({
  BrowserWindow, Menu, shell, randomUUID, path, here,
  canonicalProjectPath, loadWindowPlacement, MIN_DESKTOP_WINDOW_SIZE,
  desktopWindowTitle, DESKTOP_INSTANCE, DESKTOP_ICON, securePreferences,
  desktopWindows, setMainWindow: (win) => { mainWindow = win },
  getMainWindow: () => mainWindow, isQuitting: () => quitting,
  FRONTEND_URL, FRONTEND_RUNTIME_TOKEN, FRONTEND_ORIGIN,
  installNativeSurfaceLifecycleGuard, suspendNativeSurfacesForWindow,
  spellcheckContextMenuTemplate, FRONTEND_RENDERER_RESTART_LIMIT,
  publishChatGPTState, scheduleWindowLayoutPersistence,
  desktopWindowClose, hideChatAgentInteractionsForWindow,
  rehomeChatGPTWorkers, closeInternalChatGPTBrowserForWindow,
  closeChatGPTViewsForWindow, releaseWindowProjects,
  persistWindowLayout, refreshDesktopTray, isHTTPS,
})

const { normalizedWorkspaceSurface, desktopWindowAtScreenPoint } = createWorkspaceSurfaceRouting({
  canonicalProjectPath, windows: desktopWindows,
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
})

function registerIPC() {
  registerDesktopIPC({
    common: { ipcMain, trustedSender },
    window: {
      registerWindowIPC, registerDesktopShellIPC, registerSpellcheckIPC, desktopWindows,
      acquireProjectForWindow, releaseProjectForWindow, suspendNativeSurfacesForWindow, createWindow,
      normalizedWorkspaceSurface, desktopWindowAtScreenPoint, sendToWindowState, desktopWindowClose,
      DESKTOP_INSTANCE, publishDesktopNotification, canonicalProjectPath, desktopTrayController,
      persistWindowLayout, persistRestartIntent, waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch,
      app,
    },
    chatgpt: {
      registerChatGPTSurfaceIPC, registerChatGPTAccountIPC, registerChatGPTSessionControlIPC, registerExpectedBundleRecoveryIPC,
      registerChatGPTBundleIPC, registerChatGPTPromptIPC, deferSupervisorNavigationIfBusy, activateChatGPTView,
      requireTrustedChatGPTURL, isTrustedChatGPTOrigin, loadOwnedChatGPTURL, sanitizeChatCacheKey,
      waitForChatGPTSurfaceReady, chatgptViews, reconcileChatGPTThrottle, setChatGPTBounds,
      currentChatGPTState, canonicalChatGPTConversationURL, shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinityURL,
      chatGPTConversationID, sameConversationURL, observeChatGPTAffinityURL, scheduleChatGPTAffinitySettlement,
      ensureChatGPTView, requireOwnedChatGPTEntry, confirmChatGPTAffinity, sanitizeDiagnosticURL,
      publishChatGPTState, publicChatGPTAffinity, rejectChatGPTAffinity, reloadOwnedChatGPTConversation,
      releaseChatGPTView, enqueueChatAgentLifecycleTask, stopChatGPTConversation, publishChatGPTAccountAction,
      suggestChatGPTConversationTitle, hideChatGPTSidebar, isBehaviorProbeEnabled, sanitizeBehaviorProbeControl,
      ensureChatGPTLayoutViewport, executeChatGPTDOMScript, behaviorProbeScript, normalizeBehaviorProbeResult,
      sanitizeChatGPTAuthMode, cancelExternalAuthentication, chatGPTSurfaceShouldBeVisible, chatgptTransportModes,
      abortChatGPTTransportPreparations, preparedChatGPTDrafts, retryableChatGPTPrompts, expectedChatGPTBundles,
      manualChatGPTTransport, startExternalAuthentication, shell, openInternalChatGPTBrowser,
      authoritativeBundleFilename, classifyChatGPTRequestDelivery, withChatGPTTransportPreparation, targetChatGPTComposer,
      chatGPTSubmittedRequestEvidenceScript, chatInputArchiveFilename, disarmExpectedChatGPTBundle, refreshChatAgentRuntimeState,
      publishChatAgentRuntimeState, armExpectedChatGPTBundle, chatAgentInitialRequestWaitMs, durableWorkspaceChatID,
      persistWorkspaceChatRemoteBestEffort, expectedChatAgentPayload, enqueueChatAgentTask, setChatGPTHumanAction,
      chatGPTResponseCompletionScript, classifyChatGPTConversationTransport, CONVERSATION_TRANSPORT_STALE_MS, reconcileChatGPTConversationTransport,
      submitChatGPTContinuation, ChatGPTRateLimitDeferral, escalateChatGPTContinuationFailure, createChatGPTRecoveryState,
      clearChatGPTHumanAction, recordChatGPTContinuationSent, canonicalBundleFilename, dialog,
      app, path, readFile, MAX_EXECUTION_BUNDLE_BYTES,
      canonicalWharnessBundleDownload, validateWharnessBundleDownload, pendingChatGPTBundlePayloads, acknowledgeChatGPTBundle,
      pendingChatGPTBundleDeliveries, withChatGPTSupervisorTransport, submitPromptToChatGPT, queuePreparedPromptForWorker,
      preparePromptForChatGPT, retryPreparedChatGPTPrompt, attachContextToChatGPT, attachPromptToChatGPT,
      submitPreparedChatGPTDraft, queueChatGPTComment, cancelChatGPTRequestState, CHATGPT_URL,
      CHATGPT_LOGIN_URL, BEHAVIOR_PROBE_CONTROLS,
      getDeferredSupervisorNavigation: () => deferredSupervisorNavigation,
      getChatAgentScheduler: () => chatAgentScheduler,
    },
    agent: {
      registerAgentIPC, normalizeSupervisorSlotCount, normalizeWorkerSlotCount, setChatAgentSupervisorTarget,
      setChatAgentWorkerTarget, chatAgentKeepFlowingFloor, refreshChatAgentRuntimeState, publishChatAgentRuntimeState,
      reconcileChatAgentAutoScale, normalizeChatAgentPolicies, persistChatAgentPolicies, pauseChatAgentWorkers,
      resumeChatAgentWorkers, chatAgentBrowserSnapshot, workerEntryForAgentID, hideChatAgentInteractionEntry,
      openWorkerMonitor, BrowserWindow, closeWorkerMonitor, showChatAgentInteraction,
      setChatAgentInteractionBounds, closeChatAgentInteraction,
      state: {
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
    },
    browser: {
      registerBrowserDataIPC, desktopStorageUsage, exportBrowserSession,
      importBrowserSession, clearBrowserSession, clearDesktopWharnexData,
    },
    attachments: {
      registerChatAttachmentIPC, shell, fetchChatTransportLimits,
      decodeChatAttachmentSet, chatAttachmentRoot, createPersistentAttachmentPreview,
    },
    clipboard: {
      registerClipboardIPC, clipboard, ClipboardItem, app, fetchContextZip,
    },
  })
}

app.whenReady().then(() => startDesktopRuntime(createDesktopStartupContext({
  app, applyPendingBrowserSessionImport, logger: console, configureChatGPTSession,
  session, CHATGPT_PARTITION, CHATGPT_USER_AGENT, CHATGPT_ACCEPT_LANGUAGES,
  CHATGPT_CHROMIUM_VERSION, chatGPTUploads, chatGPTSubmissions, chatGPTCacheMarker,
  registerChatGPTPlanDownloads, noteChatGPTNetworkActivity,
  noteChatGPTNetworkFailure, noteChatGPTHTTPStatus, loadChatAgentPolicies,
  registerIPC, ensureDesktopTray, flushQueuedChatGPTComments,
  pollChatGPTVisibleActivity, pollExpectedChatGPTDownloads,
  reconcileChatAgentAutoScale, DOM_DOWNLOAD_POLL_MS,
  restoreDesktopWindowsAtStartup, loadWindowLayout, consumeRestartIntent,
  consumeDesktopRecoverySession, recoverableDesktopWindows, createWindow,
  persistWindowLayout, refreshDesktopTray, desktopWindows,
  createWorkerScheduler, primeChatGPTWorkerPool, CHAT_AGENT_STARTUP_DELAY_MS,
  ChatAgentSchedulerClient, BACKEND_URL, desiredChatAgentWorkerSlots,
  HARD_MAX_WORKER_SLOTS, withTrace, traceForTask, chatAgentWorkerActivity,
  executeChatAgentTask, noteOrchestrationTaskPin,
  parkChatGPTWorkerAfterLoadFailure, workerEntryForIndex,
  releaseChatGPTConversationReadProbe, workerSuspensionState,
  workerSuspendsAllTaskTypes, chatAgentRateLimitResumeBlocked,
  chatSupervisorBoundLanes, chatAgentResidency, chatAgentKeepFlowingActive,
  chatAgentSupervisingLiveResponse, projectWindowRegistry,
  orchestrationTaskPins, chatGPTWorkerEntries, publishChatAgentRuntimeState,
  chatAgentWorkerStates, closeWorkerMonitorAfterState,
  reconcileChatGPTWorkerPool, refreshChatAgentRuntimeState,
  createTranslatorScheduler, MAX_TRANSLATOR_SLOTS,
  executeEphemeralWorkerTask, activeChatTranslatorSlots,
  createSupervisorScheduler, desiredChatAgentSupervisorSlots,
  HARD_MAX_SUPERVISOR_SLOTS, executeChatSupervisorTask,
  chatSupervisorSlotID, chatSupervisorHostWindow, chatSupervisorStates,
  sanitizeOptionalChatCacheKey, chatgptViews, supervisorBindingHeld,
  chatSupervisorLanesHeldByOthers,
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
})))

registerDesktopLifecycleHandlers({
  app, desktopWindows, persistDesktopRecoverySession, persistWindowLayout,
  ensureDesktopTray, getExplicitDesktopExit: () => explicitDesktopExit,
  getQuitting: () => quitting, setQuitting: (value) => { quitting = value },
  getDownloadPoller: () => chatGPTDownloadPoller,
  getDesktopTrayControl: () => desktopTrayControl,
  getWorkerScheduler: () => chatAgentScheduler,
  getTranslatorScheduler: () => chatTranslatorScheduler,
  getSupervisorScheduler: () => chatSupervisorScheduler, createWindow,
})
