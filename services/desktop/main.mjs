import { app, BrowserWindow, ClipboardItem, Notification, WebContentsView, clipboard, dialog, ipcMain, nativeImage, session, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TextDecoder } from 'node:util'
import { ChatGPTSubmitCoordinator, dispatchChatGPTAccountKey, dispatchChatGPTPointerClick, dispatchChatGPTPointerPress, submitWithoutReplay } from './chatgpt-input.mjs'
import { preserveLocalFocusDuringBackgroundOperation } from './local-focus-guard.mjs'
import { ChatGPTUploadCoordinator, pasteWithUploadRetry, plannerPromptMarkdown, selectChatGPTUploadFile, waitForChatGPTReady } from './chatgpt-upload.mjs'
import { persistChatAttachmentFiles, readStoredAttachment, readStoredAttachmentPreview, removeStoredChatAttachments, storedAttachmentPath } from './chat-attachment-store.mjs'
import { chatGPTAssistantTurnCountScript, chatGPTComposerReadyScript, chatGPTDownloadDiagnosticScript, chatGPTExpectedDownloadScript, chatGPTHumanActionScript, chatGPTResponseCompletionScript, chatGPTFillComposerScript, chatGPTSubmitScript, chatGPTVisibleActivityScript, chatGPTProcessingDurationScript } from './chatgpt-dom.mjs'
import { accountFailureDetail, chatGPTCommitConversationTitleScript, chatGPTConfirmDeleteScript, chatGPTConversationTitleScript, chatGPTHideSidebarScript, chatGPTLibraryArtifactRectScript, chatGPTLibraryArtifactStateScript, chatGPTMenuItemRectScript, chatGPTNewProjectDialogScript, chatGPTOpenConversationMenuScript, chatGPTProjectItemRectScript, chatGPTShowSidebarScript, chatGPTStopConversationScript, normalizeChatGPTProjectName, normalizeWHXTitle } from './chatgpt-account.mjs'
import { ChatGPTAccountProviderChain } from './chatgpt-account-provider.mjs'
import { behaviorProbeScript, isBehaviorProbeEnabled, normalizeBehaviorProbeResult, sanitizeBehaviorProbeControl, BEHAVIOR_PROBE_CONTROLS } from './chatgpt-behavior-probe.mjs'
import { pathSize, restoreBrowserSession, snapshotBrowserSession } from './browser-session-data.mjs'
import { chatGPTNavigationDisposition, chatInputSettleDelay, chromeCompatibleUserAgent, contextBundleURL, decodeUserAttachment, isChatGPTAuthURL, isHTTPS, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatCacheKey, sanitizeOptionalChatCacheKey, sanitizeChatGPTAuthMode, sanitizeDiagnosticURL, sanitizeSessionId, BundleOwnershipError, canonicalWharnessBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security.mjs'
import { buildBundleName, parseBundleName, safeChatId } from './bundlename.mjs'
import { shouldAttachProjectContext } from './chatgpt-context.mjs'
import { confirmChatGPTAffinity, createChatGPTAffinityTracker, isChatGPTAffinityAwaitingSettlement, markChatGPTAffinitySubmitted, observeChatGPTAffinity, proposeChatGPTAffinity, publicChatGPTAffinity, rejectChatGPTAffinity, settleChatGPTAffinity, shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinity } from './chatgpt-affinity.mjs'
import { chatGPTDeliveryContinuationPrompt, chatGPTStalledRecoveryPrompt, chooseChatGPTRecoveryAction, classifyChatGPTConversationTransport, commitChatGPTRecoveryAction, createChatGPTRecoveryState, isChatGPTConversationTransportURL, isRecoverableChatGPTNetworkError, noteChatGPTRecoveryAssistantCount, noteChatGPTRecoveryFault, noteChatGPTRecoveryProgress, reconcileChatGPTConversationTransport, recordChatGPTConversationTransport } from './chatgpt-recovery.mjs'
import { RATE_LIMIT_GATE, classifyChatGPTRateLimit, isChatGPTBackendAPIURL } from './chatgpt-rate-limit.mjs'
import { chatGPTSessionProbeExpression, closeManagedBrowserAuth, electronCookieDetails, launchManagedBrowserAuth, managedBrowserProfileDirectory } from './managed-browser-auth.mjs'
import { ProjectWindowRegistry, canonicalProjectPath } from './project-window-registry.mjs'
import { desktopIconSVG, desktopInstanceName, desktopWindowTitle } from './desktop-identity.mjs'
import { parseRemoteInputResponse, remoteInputPayload } from './remote-input.mjs'
import { chatInputArchiveFilename, localChatInputBootstrap, writeChatInputArchive } from './chat-input-archive.mjs'
import { DEFAULT_SUPERVISOR_SLOTS, DEFAULT_WORKER_SLOTS, HARD_MAX_SUPERVISOR_SLOTS, HARD_MAX_WORKER_SLOTS, MIN_SUPERVISOR_SLOTS, MIN_WORKER_SLOTS, normalizeSupervisorSlotCount, normalizeWorkerSlotCount } from './chat-agent-pool.mjs'
import { autoScaleDrainTarget, autoScaleSupervisorDrainTarget, autoScaleSupervisorTarget, autoScaleTarget, keepFlowingForWorker, normalizeChatAgentPolicies, workerSuspensionState } from './chat-agent-policies.mjs'
import { chatAgentMemorySnapshot } from './chat-agent-memory.mjs'
import { ChatAgentSchedulerClient, chatAgentBackoff } from './chat-agent-scheduler.mjs'
import { CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS, ChatAgentGlobalPacer } from './chat-agent-pacer.mjs'
import { ChatAgentResidency, CHAT_AGENT_NAVIGATION_GAP_MS, CHAT_AGENT_AWAIT_PROBE_MS, chatAgentLane } from './chat-agent-residency.mjs'
import { CHATGPT_BEHAVIOR } from './chat-agent-behavior.mjs'
import { reasoningEffortAdjustScript, reasoningEffortStateScript } from './chat-agent-scripts.mjs'
import { CHATGPT_REASONING_EFFORTS, ensureChatGPTReasoningEffort, normalizeChatGPTReasoningEffort } from './chatgpt-effort.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_INSTANCE = process.env.WHARNESS_INSTANCE_ID
const DESKTOP_ICON = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(desktopIconSVG(DESKTOP_INSTANCE)).toString('base64')}`)
app.setName(`Wharnex - ${desktopInstanceName(DESKTOP_INSTANCE)}`)
const FRONTEND_URL = requireLocalHTTPURL(process.env.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173', 'Frontend URL').href
const BACKEND_URL = requireLocalHTTPURL(process.env.WHARNESS_API_URL || 'http://127.0.0.1:8888', 'Backend URL').href
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const FRONTEND_RUNTIME_TOKEN = randomUUID()
const CHATGPT_URL = 'https://chatgpt.com/'
const CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login'
const CHATGPT_LIBRARY_URL = 'https://chatgpt.com/library'
const CHATGPT_PARTITION = 'persist:wharness-chatgpt'
const MAX_CONTEXT_BYTES = 256 * 1024 * 1024
const MAX_PLAN_BYTES = 2 * 1024 * 1024
const MAX_EXECUTION_BUNDLE_BYTES = 16 * 1024 * 1024
const MAX_MARKDOWN_TRANSLATION_BYTES = 4 * 1024 * 1024
const MAX_MARKDOWN_TRANSLATION_RESULT_BYTES = 8 * 1024 * 1024
const MAX_TODO_CLASSIFICATION_BYTES = 256 * 1024
const TODO_CLASSIFICATION_TIMEOUT_MS = 4 * 60 * 1000
const MARKDOWN_TRANSLATION_TIMEOUT_MS = 5 * 60 * 1000
const MARKDOWN_TRANSLATION_POLL_MS = 1_000
const MAX_ORCHESTRATOR_PLAN_BYTES = 2 * 1024 * 1024
const ORCHESTRATOR_PLAN_TIMEOUT_MS = 8 * 60 * 1000
// How recently the page must have been producing for reaching the lease
// deadline to count as healthy progress rather than a failed attempt.
const ORCHESTRATOR_PLAN_GENERATING_GRACE_MS = 60_000
// Spacing between passive re-observations of a plan that is still generating.
const ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS = 30_000
// Re-claim spacing after a worker slot was rebound before the task started.
const CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS = 5_000
const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_CHAT_ATTACHMENTS_BYTES = 100 * 1024 * 1024
const MAX_CHAT_ATTACHMENTS = 10
const MAX_CHAT_ARTIFACTS = 4
const MAX_CHAT_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_CHAT_ARTIFACTS_BYTES = 6 * 1024 * 1024
const CHATGPT_CHROMIUM_VERSION = '152.0.7977.65'
const CHATGPT_USER_AGENT = chromeCompatibleUserAgent(process.platform, CHATGPT_CHROMIUM_VERSION)
const CHATGPT_ACCEPT_LANGUAGES = 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7'
const CHATGPT_BUNDLE_RETENTION_HOURS = Math.max(1, Math.min(24 * 30, Number(process.env.WHARNESS_CHATGPT_BUNDLE_RETENTION_HOURS || 72) || 72))
const CHATGPT_BUNDLE_RETENTION_MS = CHATGPT_BUNDLE_RETENTION_HOURS * 60 * 60 * 1000
const CHATGPT_AFFINITY_RECOVERY_GRACE_MS = 60_000
// Some Linux networks advertise IPv6 while dropping HTTPS connections on that
// route. Chromium otherwise selects that route for ChatGPT and leaves the
// embedded view loading indefinitely. The local runtime has a verified IPv4
// path, so keep the desktop browser on it until the host network is fixed.
app.commandLine.appendSwitch('disable-ipv6')
// Electron 44 on this Linux/X11 runtime has trapped in the GPU path while the
// local shell and embedded ChatGPT surfaces are composited together. Wharnex
// is a productivity UI, not a GPU workload; software compositing keeps the
// title-bar overlay and workspace stable without changing application features.
if (process.platform === 'linux') app.disableHardwareAcceleration()
// Channel choice is explicit configuration, ordered by priority. The managed
// desktop-direct entry is always present as the safe final fallback.
const SAFE_ATTACHMENT_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])
const MAX_ATTACHMENT_THUMBNAIL_SOURCE_BYTES = 8 * 1024 * 1024

// An unhandled exception/rejection in this main process otherwise crashes the
// whole Electron app instantly with no trace. Logging keeps the process (and
// every open window) alive so a single bad async path degrades instead of
// killing the app.
process.on('uncaughtException', (error) => {
  console.error('[main-process-fault] uncaughtException', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main-process-fault] unhandledRejection', reason)
})

// Electron's default userData directory is derived only from package.json's
// `name`, so two independent Wharnex checkouts collide on the same profile
// (shared LevelDB storage, shared ChatGPT partition) unless one of them opts
// into an isolated path here.
const customUserDataDir = String(process.env.WHARNESS_DESKTOP_USER_DATA_DIR || '').trim()
if (customUserDataDir) {
  if (!path.isAbsolute(customUserDataDir)) throw new Error('WHARNESS_DESKTOP_USER_DATA_DIR must be an absolute path')
  app.setPath('userData', path.normalize(customUserDataDir))
}
// Without a single-instance lock, a second launch against the same userData
// directory runs a second full Chromium profile alongside the first,
// corrupting shared on-disk storage and doubling memory pressure. A genuine
// second launch now quits immediately and hands off to the running instance.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0] || mainWindow
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

let mainWindow
let chatgptViews = new Map()
const chatGPTWorkerEntries = []
const chatAgentWorkerStates = new Map()
// Supervisor pool runtime, indexed 1..desiredChatAgentSupervisorSlots. Supervisors
// draw from the same durable queue as Workers but claim only the chat-bound task
// types, so each slot needs its own loop state and its own chat binding.
const chatSupervisorStates = new Map()
let chatSupervisorScheduler
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
const preparedChatGPTDrafts = new Map()
const retryableChatGPTPrompts = new Map()
const pendingChatGPTComments = new Map()
const flushingChatGPTComments = new Set()
const recentChatGPTCommentIds = new Map()
const recentChatGPTCommentFingerprints = new Map()
const chatGPTActivityFingerprints = new Map()
const expectedChatGPTBundles = new Map()
const expectedChatGPTTranslations = new Map()
const expectedChatGPTTodoClassifications = new Map()
const expectedChatGPTOrchestratorPlans = new Map()
// Plan artifacts that arrived while no attempt held the lease.
//
// ChatGPT delivers when it finishes, not when a Wharnex lease happens to be
// open, and an orchestrator attempt lives only 8 minutes. Cancelling the file
// because nothing was armed threw away the exact artifact the next attempt
// would then spend another attempt asking ChatGPT to produce again — which is
// how four planning requests reached attempt 7/8 with zero plans imported.
const chatGPTOrchestratorPlanInbox = new Map()
const ORCHESTRATOR_PLAN_INBOX_MAX = 16
const ORCHESTRATOR_PLAN_INBOX_TTL_MS = 6 * 60 * 60 * 1000
const pollingExpectedChatGPTBundles = new Set()
const chatGPTTransportTails = new Map()
const chatGPTTransportAbortControllers = new Map()
const chatAgentResidency = new ChatAgentResidency({ minResidenceMs: Number(process.env.WHARNESS_CHAT_AGENT_RESIDENCY_MS || 30_000) })
let chatGPTSupervisorTransportTail = Promise.resolve()
const chatGPTWorkerPacer = new ChatAgentGlobalPacer()
let chatGPTRateLimitUntil = 0
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
const EXPIRED_ARTIFACT_TTL_MS = 10 * 60_000
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
const RETRYABLE_PROMPT_TTL_MS = 10 * 60 * 1000
// Keep the delivered tombstone for at least as long as the retry affordance.
// This makes a late click idempotent after the valid bundle already consumed
// the in-memory prompt instead of surfacing a false missing-delivery error.
const DELIVERED_BUNDLE_DEDUP_TTL_MS = RETRYABLE_PROMPT_TTL_MS
// Defense in depth for Manual chat transport mode (cacheKey -> 'manual').
// The frontend never calls preparePrompt while a chat is Manual, so this
// only matters for a bundle already armed before the human flips the
// toggle mid-flight — see the 3 checks below. Absence means Scraper.
const chatgptTransportModes = new Map()
let chatGPTAccountOperation = Promise.resolve()
const chatGPTAccountProviders = new ChatGPTAccountProviderChain({})
const EXPECTED_BUNDLE_TTL_MS = 60 * 60 * 1000
const DOM_DOWNLOAD_POLL_MS = 2_000
const DOM_DOWNLOAD_RETRY_MS = 5_000
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
const BUNDLE_COMPLETION_GRACE_MS = 4_000
const BUNDLE_CONTINUATION_BASE_MS = 5_000
// How long a structural completion must keep holding, with the bundle still
// absent, before it is treated as terminal. One instant of a live page is not
// evidence: ChatGPT satisfies every completion condition transiently between
// reasoning steps and before the file card mounts.
const BUNDLE_COMPLETION_CONFIRM_MS = 15_000
// Minimum process-wide spacing between prompt submissions. Transport is
// serialized per Worker slot, so without this every free slot could submit at
// once and present the authenticated account with a burst — the shape that
// earns an HTTP 429 for the whole provider.
const CHAT_AGENT_SUBMIT_GAP_MS = CHAT_AGENT_WORKER_ACTION_GAP_MS
// Widest submission spacing, used while the provider still shows the pressure
// that produced an account-wide gate. Staged resume, not a permanent ceiling:
// it decays back to the floor above as valid bundles clear the rate-limit level.
const CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS = 60_000
const MAX_BUNDLE_CONTINUATIONS = 3
const PROCESSING_SIGNAL_GRACE_MS = 15_000
// How long a completion must hold when the generating indicator was never
// observed for this request at all.
//
// The ordinary grace is measured from the moment generation visibly stopped,
// which is real evidence the turn ended. Without that observation there is no
// such moment, only "the page has looked static since we first looked" — true
// of a turn that has not started, of a gap between reasoning phases, and of a
// tool call running with no visible marker. Three minutes is the cost of being
// wrong in the safe direction; concluding early costs the whole response.
const BUNDLE_UNOBSERVED_SETTLE_MS = 3 * 60_000
const CONVERSATION_TRANSPORT_STALE_MS = 30_000
const PROCESSING_STALE_ATTENTION_MS = 5 * 60_000
// How long an AWAIT_RESPONSE probe may keep reading a page that is neither
// generating nor complete before it asks for a human.
//
// Passive observation deliberately does not spend the attempt budget, so a
// second bound is required, and it has to be evidence-shaped: the clock only
// runs while the page shows no structural sign of life at all, and any
// generating/complete/download signal resets it. A visibly working model is
// therefore never interrupted, while a genuinely stuck surface still stops.
const AWAIT_STALL_ATTENTION_MS = 10 * 60_000
const CHATGPT_RATE_LIMIT_BACKOFF_MS = 60_000
// Local mirror of the backend's account-wide gate suspension, applied on the
// tick the gate is observed so workers stop before the round-trip returns. The
// persisted value from the backend is authoritative and wins on arrival.
const CHATGPT_RATE_LIMIT_GATE_MS = 5 * 60_000
// Protective ceiling for the navigation gate, applied once the provider shows
// sustained 429 pressure. The healthy floor below is what the pool actually
// runs at while ChatGPT is answering normally.
const CHATGPT_WORKER_NAVIGATION_GAP_MS = CHAT_AGENT_NAVIGATION_GAP_MS
const CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS = CHAT_AGENT_WORKER_ACTION_GAP_MS
const CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS = 15 * 60_000
const CHATGPT_DOM_PROBE_FAILURE_LIMIT = 3
const CHATGPT_ACCOUNT_ACTION_SETTLE_MS = 350
// A trusted click on the conversation-options trigger has no confirmation the
// Radix menu actually rendered; live task history showed it deterministically
// not opening under worker-pool contention with nothing ever re-clicking it.
const CHATGPT_MENU_REOPEN_ATTEMPTS = 3
// Radix reconciles a menu's open state against the pointerup that follows its
// pointerdown, so the press is held briefly rather than dispatched in one tick.
const CHATGPT_CONTROL_PRESS_HOLD_MS = 90
const DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS = 250
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

function securePreferences(extra = {}) {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    ...extra,
  }
}

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
// four hold at most a handful of live entries.
function chatGPTArtifactExpectationArmed(key) {
  if (expectedChatGPTBundles.has(key)) return true
  for (const map of [expectedChatGPTTranslations, expectedChatGPTTodoClassifications, expectedChatGPTOrchestratorPlans]) {
    for (const expected of map.values()) if (expected?.key === key) return true
  }
  return false
}

// Arming or disarming an expectation changes the answer above, so the owning
// renderer's throttle has to be reconciled at both edges - the predicate alone
// only takes effect the next time something else happens to reconcile.
function reconcileChatGPTThrottleForKey(key, entry) {
  // A Worker entry lives in the pool, never in `chatgptViews`, so resolving
  // through that map alone would silently skip exactly the pool that runs the
  // utility artifacts. The caller's own owned entry is the authority; the map
  // lookup only covers callers that hold none.
  const owned = entry || chatgptViews.get(key)
  if (owned) reconcileChatGPTThrottle(key, owned)
}

function chatGPTEntryNeedsSupervision(key, entry) {
  // An armed expected bundle keeps its Supervisor at full speed whether or not
  // that slot happens to be the visible one. A hidden Supervisor is the normal
  // case now: it stays bound to its chat for the whole request so the response
  // is collected without ever re-navigating the conversation.
  //
  // The same is required of the utility artifacts — TODO classification,
  // markdown translation, orchestrator plan — and used not to be, because this
  // predicate only knew about `expectedChatGPTBundles`. Those three run on a
  // hidden Worker with no transport preparation held across the response wait,
  // so Chromium background-throttled the very renderer that had to stream the
  // answer and reveal its download control. Live evidence: a TODO
  // classification whose assistant turn stayed frozen mid-stream at two
  // characters, still carrying `streaming-animation`, for 81 consecutive polls
  // until the task's four-minute timeout expired and burned an attempt.
  return Boolean(entry.loading || entry.humanAction?.active || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.conversationRequests.size > 0 || pendingChatGPTComments.has(key) || chatGPTArtifactExpectationArmed(key))
}

function chatGPTEntryIsActiveVisible(key, entry) {
  const windowState = windowStateForEntry(entry)
  return Boolean(windowState && windowState.activeChatGPTKey === key && windowState.chatgptVisible)
}

// Whether the Supervisor bound to this chat owns its response supervision.
//
// Ownership used to require the slot to be the visible one, because only two
// slots existed and a hidden one was a warm standby for the next chat. With a
// Supervisor per chat the relationship is inverted: the slot that sent the
// request stays on that conversation until its bundle arrives, visible or not,
// and the main-process poll reads it there. That is what removes the navigation
// a Worker would otherwise make to a page that is already loaded — the provider
// request that earned the account its 429s.
//
// Manual transport and an in-flight external login are excluded: in both cases
// no automated supervision may run on the surface, so claiming ownership would
// silence the lane for everybody.
function chatGPTSupervisorOwnsExpectedResponse(key, requestId = '', conversationURL = '') {
  const entry = chatgptViews.get(key)
  if (!entry || entry.view.webContents.isDestroyed()) return false
  if (entry.externalAuthProvider || chatgptTransportModes.get(key) === 'manual') return false
  const expected = expectedChatGPTBundles.get(key)
  if (!expected || (requestId && expected.requestId !== String(requestId))) return false
  const currentURL = canonicalChatGPTConversationURL(entry.affinity.boundURL || entry.view.webContents.getURL())
  const expectedURL = canonicalChatGPTConversationURL(conversationURL)
  return Boolean(currentURL && (!expectedURL || sameConversationURL(currentURL, expectedURL)))
}

// Why this Supervisor slot may not give its chat up yet.
//
// A Supervisor unbinds only once it has nothing left to finish: the request
// completed and a valid bundle was collected and handed over. Anything still in
// flight — an armed expectation, a settling delivery, a queued comment, an open
// transport or account operation, a pending human action, a live Supervisor
// lease — is work that dies with the renderer, and re-doing it costs exactly the
// provider requests this topology exists to avoid.
function supervisorBindingHold(key, entry) {
  if (!entry) return ''
  const expected = expectedChatGPTBundles.get(key)
  if (expected) {
    if (pendingChatGPTBundleDeliveries.has(expected.requestId)) return 'bundle-delivery'
    return 'expected-bundle'
  }
  if (hasPendingChatGPTComments(key)) return 'queued-comment'
  if (Number(entry.transportPreparationCount || 0) > 0) return 'transport'
  if (entry.accountOperationActive) return 'account-operation'
  if (entry.humanAction?.active) return 'human-action'
  if (entry.externalAuthProvider) return 'external-auth'
  if (chatSupervisorLeaseKeys().has(key)) return 'supervisor-lease'
  // A draft or retry affordance the human may still act on. Both are swept only
  // when something touches that chat again, so the hold has to expire on its own
  // recorded age — an abandoned draft must not pin a renderer for the life of
  // the process while other chats queue for a slot.
  const drafted = Math.max(
    Number(preparedChatGPTDrafts.get(key)?.preparedAt || 0),
    Number(retryableChatGPTPrompts.get(key)?.preparedAt || 0))
  if (drafted && Date.now() - drafted < RETRYABLE_PROMPT_TTL_MS) return 'prepared-prompt'
  return ''
}

function supervisorBindingHeld(key, entry) {
  return supervisorBindingHold(key, entry) !== ''
}

function chatSupervisorSlotID(index) {
  return `supervisor-${Math.max(1, Math.min(desiredChatAgentSupervisorSlots, Number(index) || 1))}`
}

function supervisorEntryForSlot(slotID) {
  const id = String(slotID || '')
  if (!id) return undefined
  for (const entry of chatgptViews.values()) if (entry.slotId === id) return entry
  return undefined
}

function supervisorKeyForSlot(slotID) {
  const id = String(slotID || '')
  if (!id) return ''
  for (const [key, entry] of chatgptViews) if (entry.slotId === id) return key
  return ''
}

// Chats a Supervisor currently holds a durable lease for. A leased task is work
// in progress by definition, so its chat cannot be handed to another slot.
function chatSupervisorLeaseKeys() {
  const keys = new Set()
  for (const runtime of chatSupervisorStates.values()) {
    const key = sanitizeOptionalChatCacheKey(runtime?.task?.chat_id)
    if (key) keys.add(key)
  }
  return keys
}

// Lanes every bound Supervisor is responsible for, whatever the task.
//
// Workers are barred from these lanes as defence in depth: the durable claim
// already partitions task types by pool, but a Worker arriving on a conversation
// a Supervisor is resident on is a second navigation of a loaded page even when
// the task itself is legitimate small work.
function chatSupervisorBoundLanes() {
  const lanes = new Set()
  for (const [key, entry] of chatgptViews) {
    if (!supervisorBindingHeld(key, entry)) continue
    lanes.add(`h:${key}`)
    const conversationID = chatAgentConversationID(entry.affinity.boundURL || entry.view.webContents.getURL())
    if (conversationID) lanes.add(`c:${conversationID}`)
  }
  return lanes
}

function reconcileChatGPTThrottle(key, entry) {
  if (!entry || entry.view.webContents.isDestroyed()) return
  const fullSpeed = chatGPTEntryIsActiveVisible(key, entry) || chatGPTEntryNeedsSupervision(key, entry)
  if (entry.backgroundThrottled === !fullSpeed) return
  // setBackgroundThrottling's `allowed` parameter is "is throttling allowed",
  // the inverse of "stay full speed" — false keeps this view at full speed.
  entry.view.webContents.setBackgroundThrottling(!fullSpeed)
  entry.backgroundThrottled = !fullSpeed
}

function chatGPTTransportAbortKey(cacheKey, requestId) {
  const key = sanitizeChatCacheKey(cacheKey)
  const id = String(requestId || '').trim()
  return id ? `${key}:${id}` : ''
}

function registerChatGPTTransportAbort(cacheKey, requestId, controller) {
  const abortKey = chatGPTTransportAbortKey(cacheKey, requestId)
  if (!abortKey) return ''
  const controllers = chatGPTTransportAbortControllers.get(abortKey) || new Set()
  controllers.add(controller)
  chatGPTTransportAbortControllers.set(abortKey, controllers)
  return abortKey
}

function unregisterChatGPTTransportAbort(abortKey, controller) {
  if (!abortKey) return
  const controllers = chatGPTTransportAbortControllers.get(abortKey)
  if (!controllers) return
  controllers.delete(controller)
  if (!controllers.size) chatGPTTransportAbortControllers.delete(abortKey)
}

function abortChatGPTTransportPreparations(cacheKey, requestId) {
  const abortKey = chatGPTTransportAbortKey(cacheKey, requestId)
  const controllers = abortKey ? chatGPTTransportAbortControllers.get(abortKey) : undefined
  if (!controllers?.size) return 0
  for (const controller of controllers) controller.abort()
  return controllers.size
}

function throwIfChatGPTTransportAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('WHARNEX_REQUEST_CANCELLED: ChatGPT request preparation was cancelled')
  error.name = 'AbortError'
  error.code = 'WHARNEX_REQUEST_CANCELLED'
  throw error
}

async function withChatGPTTransportPreparation(cacheKey, entry, requestId, operation) {
  const key = sanitizeChatCacheKey(cacheKey)
  requireOwnedChatGPTEntry(key, entry)
  // Worker browser transport is a physical-slot resource. Serializing by chat
  // alone lets stale work from the prior resident conversation overlap the
  // same WebContents after a rebind.
  const transportKey = entry.role === 'worker' ? `slot:${entry.slotId}` : `chat:${key}`
  const prior = chatGPTTransportTails.get(transportKey) || Promise.resolve()
  let release
  let preparing = false
  const tail = new Promise((resolve) => { release = resolve })
  const controller = new AbortController()
  const abortKey = registerChatGPTTransportAbort(key, requestId, controller)
  chatGPTTransportTails.set(transportKey, tail)
  if (entry.role === 'worker') chatAgentResidency.setNonPreemptive(entry.slotId, true)
  try {
    try { await prior } catch { /* a prior operation cannot poison the queue */ }
    throwIfChatGPTTransportAborted(controller.signal)
    entry.transportPreparationCount = Number(entry.transportPreparationCount || 0) + 1
    entry.transportRequestId = String(requestId || '')
    preparing = true
    entry.transportAbortSignal = controller.signal
    reconcileChatGPTThrottle(key, entry)
    return await operation()
  } finally {
    if (preparing) {
      entry.transportPreparationCount = Math.max(0, Number(entry.transportPreparationCount || 0) - 1)
      if (!entry.transportPreparationCount) entry.transportRequestId = ''
      if (entry.transportAbortSignal === controller.signal) delete entry.transportAbortSignal
      reconcileChatGPTThrottle(key, entry)
      if (entry.role !== 'worker' && !entry.transportPreparationCount && deferredSupervisorNavigation) setTimeout(() => { void applyDeferredSupervisorNavigation() }, 0)
    }
    release()
    if (entry.role === 'worker') chatAgentResidency.setNonPreemptive(entry.slotId, false)
    if (chatGPTTransportTails.get(transportKey) === tail) chatGPTTransportTails.delete(transportKey)
    unregisterChatGPTTransportAbort(abortKey, controller)
  }
}

async function waitForDifferentSupervisorTransport(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  for (;;) {
    const currentKey = supervisorKey(windowStateForEntry(chatgptViews.get(key)))
    const current = currentKey ? chatgptViews.get(currentKey) : undefined
    if (!current || currentKey === key || Number(current.transportPreparationCount || 0) === 0) return
    const activeTail = chatGPTTransportTails.get(`chat:${currentKey}`)
    if (activeTail) {
      try { await activeTail } catch { /* transport failures still release the Supervisor */ }
      continue
    }
    await wait(25)
  }
}

function preserveVisibleSupervisorForTransport(cacheKey, windowState) {
  const key = sanitizeChatCacheKey(cacheKey)
  const desiredKey = String(windowState?.desiredVisibleChatGPTKey || windowState?.activeChatGPTKey || '')
  if (!windowState?.chatgptVisible || !desiredKey || desiredKey === key) return
  if (deferredSupervisorNavigation?.windowState === windowState && deferredSupervisorNavigation.key === desiredKey) return
  const visibleEntry = chatgptViews.get(desiredKey)
  if (!visibleEntry) return
  setDeferredSupervisorNavigation(desiredKey, windowState, {
    bounds: windowState.chatgptBounds,
    url: visibleEntry.view.webContents.getURL(),
    visible: true,
  }, visibleEntry)
}

async function withChatGPTSupervisorTransport(cacheKey, windowState, requestId, operation) {
  const key = sanitizeChatCacheKey(cacheKey)
  const prior = chatGPTSupervisorTransportTail
  let release
  const tail = new Promise((resolve) => { release = resolve })
  chatGPTSupervisorTransportTail = tail
  try { await prior } catch { /* a prior direct submission cannot poison the queue */ }
  try {
    await waitForDifferentSupervisorTransport(key)
    preserveVisibleSupervisorForTransport(key, windowState)
    const { entry } = ensureChatGPTView(key, windowState)
    return await withChatGPTTransportPreparation(key, entry, requestId, () => operation(key, entry))
  } finally {
    release()
    if (chatGPTSupervisorTransportTail === tail) chatGPTSupervisorTransportTail = Promise.resolve()
  }
}

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

function acquireProjectForWindow(windowState, value) {
  const lock = projectWindowRegistry.acquire(windowState.id, value)
  if (!lock.ok) {
    const owner = desktopWindows.get(lock.ownerWindowId)
    if (owner?.window && !owner.window.isDestroyed()) { owner.window.show(); owner.window.focus() }
    return { ...lock, message: 'Este projeto já está aberto noutra janela do Wharnex. A janela proprietária foi trazida para a frente.' }
  }
  windowState.projects.add(lock.path)
  windowState.activeProject = lock.path
  windowState.window.setTitle(desktopWindowTitle(lock.path, DESKTOP_INSTANCE))
  return lock
}

// Native WebContentsViews live above the renderer tree. Project frames cannot
// be trusted to hide them during unmount: closing the last project replaces the
// frame with the launcher, and the renderer may disappear before its cleanup
// IPC runs. The Desktop lifecycle boundary therefore hides both kinds of native
// surface before changing project ownership.
function suspendNativeSurfacesForWindow(windowState) {
  if (!windowState) return false
  windowState.chatgptVisible = false
  windowState.desiredVisibleChatGPTKey = ''
  if (deferredSupervisorNavigation?.windowState === windowState) deferredSupervisorNavigation.visible = false
  const active = activeChatGPTEntry(windowState)
  if (active && !active.view.webContents.isDestroyed()) {
    active.view.setVisible(false)
    reconcileChatGPTThrottle(chatGPTKeyForEntry(active), active)
  }
  hideChatAgentInteractionsForWindow(windowState)
  return true
}

function releaseProjectForWindow(windowState, value) {
  const requested = canonicalProjectPath(value)
  if (windowState.activeProject === requested) suspendNativeSurfacesForWindow(windowState)
  const result = projectWindowRegistry.release(windowState.id, value)
  if (result.released) {
    windowState.projects.delete(result.path)
    if (windowState.activeProject === result.path) {
      windowState.activeProject = [...windowState.projects][0] || ''
      windowState.window.setTitle(desktopWindowTitle(windowState.activeProject, DESKTOP_INSTANCE))
    }
  }
  return result
}

function releaseWindowProjects(windowState) {
  projectWindowRegistry.releaseWindow(windowState.id)
  windowState.projects.clear()
  windowState.activeProject = ''
}

function windowLayoutPath() { return path.join(app.getPath('userData'), 'wharness-window-layout.json') }

function chatGPTCacheMarkerPath() { return path.join(app.getPath('userData'), 'wharness-chatgpt-cache-marker.json') }

// The spoofed Chrome UA (CHATGPT_CHROMIUM_VERSION) is what the startup cache
// clear actually guards: assets cached under a different UA than the one
// about to make requests could be served back mismatched. That risk exists
// only when the UA itself changes between runs, not on an ordinary restart
// running the same build - which is what made every restart force every
// Supervisor/Worker to refetch ChatGPT's entire SPA bundle over the network
// instead of from disk, a large share of what made startup feel heavy.
function chatGPTCacheMarkerCurrent() {
  try { return JSON.parse(readFileSync(chatGPTCacheMarkerPath(), 'utf8'))?.chromiumVersion === CHATGPT_CHROMIUM_VERSION }
  catch { return false }
}

function writeChatGPTCacheMarker() {
  try { writeFileSync(chatGPTCacheMarkerPath(), JSON.stringify({ chromiumVersion: CHATGPT_CHROMIUM_VERSION }), { mode: 0o600 }) }
  catch (error) { console.warn(`[chatgpt-cache] marker write failed: ${error instanceof Error ? error.message : String(error)}`) }
}

const DEFAULT_DESKTOP_WINDOW_SIZE = Object.freeze({ width: 1540, height: 960 })
const MIN_DESKTOP_WINDOW_SIZE = Object.freeze({ width: 1100, height: 720 })
let windowLayoutPersistTimer

function normalizedWindowSize(value) {
  const width = Number(value?.width)
  const height = Number(value?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  if (width < MIN_DESKTOP_WINDOW_SIZE.width || height < MIN_DESKTOP_WINDOW_SIZE.height) return undefined
  if (width > 8192 || height > 8192) return undefined
  return { width: Math.round(width), height: Math.round(height) }
}

function readWindowLayoutState() {
  try {
    const parsed = JSON.parse(readFileSync(windowLayoutPath(), 'utf8'))
    const windows = Array.isArray(parsed?.windows) ? parsed.windows.filter((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item)) : []
    const sizes = {}
    if (parsed?.sizes && typeof parsed.sizes === 'object') {
      for (const [id, value] of Object.entries(parsed.sizes)) {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue
        const size = normalizedWindowSize(value)
        if (size) sizes[id] = size
      }
    }
    return { windows: windows.length ? [...new Set(windows)].slice(0, 12) : ['primary'], sizes }
  } catch { return { windows: ['primary'], sizes: {} } }
}

function persistedWindowSize(windowState) {
  if (!windowState?.window || windowState.window.isDestroyed()) return undefined
  try {
    const bounds = typeof windowState.window.getNormalBounds === 'function' ? windowState.window.getNormalBounds() : windowState.window.getBounds()
    return normalizedWindowSize(bounds)
  } catch { return undefined }
}

function persistWindowLayout(ids = [...desktopWindows.values()].filter((state) => !state.window.isDestroyed()).map((state) => state.id)) {
  try {
    const previous = readWindowLayoutState()
    const windows = [...new Set(ids)].filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)).slice(0, 12)
    const sizes = {}
    for (const id of windows) {
      const live = desktopWindows.get(id)
      const size = persistedWindowSize(live) || previous.sizes[id]
      if (size) sizes[id] = size
    }
    writeFileSync(windowLayoutPath(), JSON.stringify({ version: 2, windows, sizes }), { mode: 0o600 })
  } catch (error) { console.warn('[windows] layout persistence failed', error) }
}

function scheduleWindowLayoutPersistence() {
  clearTimeout(windowLayoutPersistTimer)
  windowLayoutPersistTimer = setTimeout(() => {
    windowLayoutPersistTimer = undefined
    persistWindowLayout()
  }, 180)
}

function loadWindowLayout() { return readWindowLayoutState().windows }

function loadWindowSize(id) { return readWindowLayoutState().sizes[id] || DEFAULT_DESKTOP_WINDOW_SIZE }

function restartIntentPath() { return path.join(app.getPath('userData'), 'wharness-window-restart-intent.json') }

function persistRestartIntent(scope, currentWindowId) {
  try {
    writeFileSync(restartIntentPath(), JSON.stringify({ version: 1, scope, current_window_id: currentWindowId, created_at: Date.now() }), { mode: 0o600 })
  } catch (error) { console.warn('[windows] restart intent persistence failed', error) }
}

function consumeRestartIntent() {
  try {
    const filename = restartIntentPath()
    const parsed = JSON.parse(readFileSync(filename, 'utf8'))
    try { rmSync(filename, { force: true }) } catch { /* best effort */ }
    const scope = parsed?.scope === 'current' ? 'current' : parsed?.scope === 'all' ? 'all' : ''
    const currentWindowId = typeof parsed?.current_window_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(parsed.current_window_id) ? parsed.current_window_id : ''
    const createdAt = Number(parsed?.created_at || 0)
    if (!scope || !currentWindowId || !Number.isFinite(createdAt) || Date.now() - createdAt > 10 * 60 * 1000) return undefined
    return { scope, currentWindowId }
  } catch { return undefined }
}

function canonicalBundleFilename(chatId, requestId) {
  const id = String(requestId || '').trim()
  const filename = buildBundleName('res', safeChatId(chatId), id)
  if (wharnessBundleRequestIdFromFilename(filename) !== id) throw new Error('Invalid Wharnex request id for bundle transport')
  return filename
}

function authoritativeBundleFilename(value, requestId, fallbackChatId) {
  const candidate = path.basename(String(value || '').trim())
  const parsed = parseBundleName(candidate)
  if (parsed?.kind === 'res' && (parsed.subrequestId || parsed.requestId) === String(requestId || '').trim()) return candidate
  return canonicalBundleFilename(fallbackChatId, requestId)
}

function armExpectedChatGPTBundle(cacheKey, requestId, assistantBaseline = 0, recoveryBootstrap = '', liveTunnels = [], originalPrompt = '', sessionId = '', expectedFilename = '', requestMetadata = {}) {
  const key = sanitizeChatCacheKey(cacheKey)
  const prior = expectedChatGPTBundles.get(key)
  const sameRequest = prior?.requestId === String(requestId)
  const filename = authoritativeBundleFilename(expectedFilename || (sameRequest ? prior?.filename : ''), requestId, key)
  expectedChatGPTBundles.set(key, {
    requestId: String(requestId), filename,
    armedAt: sameRequest ? prior.armedAt : Date.now(),
    assistantBaseline: sameRequest
      ? Math.max(Number(prior.assistantBaseline || 0), Number(assistantBaseline) || 0)
      : Math.max(0, Number(assistantBaseline) || 0),
    lastDOMClick: 0,
    downloadInFlight: false,
    settledAt: 0,
    continuationCount: sameRequest ? Number(prior.continuationCount || 0) : 0,
    invalidBundleCount: sameRequest ? Number(prior.invalidBundleCount || 0) : 0,
    lastContinuationAt: sameRequest ? Number(prior.lastContinuationAt || 0) : 0,
    backoffUntil: sameRequest ? Number(prior.backoffUntil || 0) : 0,
    domProbeFailures: 0,
    processingObservedAt: sameRequest ? Number(prior.processingObservedAt || 0) : 0,
    processingAbsentSince: sameRequest ? Number(prior.processingAbsentSince || 0) : 0,
    // Last moment the remote page showed ANY structural sign of life for this
    // request: generating, complete, or a download affordance. It is what makes
    // a passive probe boundable by evidence rather than by an attempt counter,
    // so a page stuck in neither state cannot supervise itself forever.
    progressAt: sameRequest ? Number(prior.progressAt || 0) || Date.now() : Date.now(),
    rehydrating: sameRequest ? prior.rehydrating === true : false,
    recoveryEligibleAt: sameRequest ? Number(prior.recoveryEligibleAt || 0) : 0,
    recoveryBootstrap: String(recoveryBootstrap || (sameRequest ? prior?.recoveryBootstrap : '') || ''),
    originalPrompt: String(originalPrompt || (sameRequest ? prior?.originalPrompt : '') || ''),
    sessionId: String(sessionId || (sameRequest ? prior?.sessionId : '') || ''),
    requestMetadata: Object.keys(requestMetadata || {}).length
      ? { ...requestMetadata }
      : (sameRequest && prior?.requestMetadata ? { ...prior.requestMetadata } : {}),
    liveTunnels: Array.isArray(liveTunnels) && liveTunnels.length ? liveTunnels.slice(0, 16) : (sameRequest && Array.isArray(prior?.liveTunnels) ? prior.liveTunnels.slice(0, 16) : []),
    recovery: createChatGPTRecoveryState(Date.now()),
  })
  return filename
}

// A prompt that was armed as an expected bundle but never actually reached
// ChatGPT (submitChatGPTDraft threw before the message was sent) must not be
// left behind: the DOM poll otherwise treats the still-open, already-settled
// prior turn as "finished without a bundle" and overwrites the unsent draft
// with a content-free WHARNEX DELIVERY CONTINUATION nudge instead of
// surfacing the real send failure to the human.
function disarmExpectedChatGPTBundle(cacheKey, requestId) {
  const key = sanitizeChatCacheKey(cacheKey)
  const expected = expectedChatGPTBundles.get(key)
  if (expected && expected.requestId === String(requestId)) expectedChatGPTBundles.delete(key)
}

async function cancelChatGPTRequestState(cacheKey, requestId) {
  const key = sanitizeChatCacheKey(cacheKey)
  const id = String(requestId || '').trim()
  if (!id) throw new Error('ChatGPT request cancellation requires a request id')
  const abortedPreparations = abortChatGPTTransportPreparations(key, id)
  let cleared = abortedPreparations > 0
  const expected = expectedChatGPTBundles.get(key)
  if (expected?.requestId === id) { expectedChatGPTBundles.delete(key); cleared = true }
  const retryable = retryableChatGPTPrompts.get(key)
  if (String(retryable?.request?.requestId || '') === id) { retryableChatGPTPrompts.delete(key); cleared = true }
  const prepared = preparedChatGPTDrafts.get(key)
  if (String(prepared?.requestId || '') === id) { preparedChatGPTDrafts.delete(key); cleared = true }
  const comments = pendingChatGPTComments.get(key) || []
  const retainedComments = comments.filter((comment) => String(comment?.requestId || '') !== id)
  if (retainedComments.length !== comments.length) {
    cleared = true
    if (retainedComments.length) pendingChatGPTComments.set(key, retainedComments)
    else pendingChatGPTComments.delete(key)
  }
  const entry = chatgptViews.get(key)
  if (entry?.humanAction?.active && (!entry.humanAction.requestId || entry.humanAction.requestId === id)) {
    clearChatGPTHumanAction(key, 'pedido cancelado')
    cleared = true
  }
  if (entry) reconcileChatGPTThrottle(key, entry)
  let cancelledTasks = 0
  if (chatAgentScheduler) {
    const lineage = await chatAgentScheduler.cancelLineage(id)
    cancelledTasks = Math.max(0, Number(lineage?.cancelled || 0))
    // Cancellation and bundle acknowledgement are durable lifecycle work. A
    // diagnostic projection must never turn their successful result into an
    // IPC failure after the state has already been cleared.
    try {
      await refreshChatAgentRuntimeState()
      publishChatAgentRuntimeState()
    } catch (error) {
      console.warn(`[chat-agent] runtime refresh after request cancellation failed request=${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { ok: true, cacheKey: key, requestId: id, cleared, cancelledTasks, abortedPreparations }
}

async function chatGPTAssistantTurnCount(wc) {
  try {
    const count = await wc.executeJavaScript(chatGPTAssistantTurnCountScript(), true)
    return Math.max(0, Number(count) || 0)
  } catch {
    return 0
  }
}

function expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename = '') {
  const canonicalRequestId = wharnessBundleRequestIdFromFilename(path.basename(String(sourceFilename || '')))
  if (canonicalRequestId) {
    for (const [key, expected] of expectedChatGPTBundles) {
      if (expected.requestId === canonicalRequestId) return { key, ...expected }
    }
  }
  const sourceEntry = sourceWebContents && [...chatgptViews.entries()].find(([, candidate]) => candidate.view.webContents.id === sourceWebContents.id)
  if (sourceEntry) {
    const expected = expectedChatGPTBundles.get(sourceEntry[0])
    if (expected && Date.now() - expected.armedAt <= EXPECTED_BUNDLE_TTL_MS) return { key: sourceEntry[0], ...expected }
  }
  if (recentExpectedDownload && Date.now() - recentExpectedDownload.at <= 12_000) {
    const expected = expectedChatGPTBundles.get(recentExpectedDownload.key)
    if (expected?.requestId === recentExpectedDownload.requestId) return { key: recentExpectedDownload.key, ...expected }
  }
  return undefined
}

function recentlyDeliveredChatGPTBundleRequestId(requestId) {
  const deliveredAt = deliveredChatGPTBundleRequestIds.get(requestId)
  return typeof deliveredAt === 'number' && Date.now() - deliveredAt < DELIVERED_BUNDLE_DEDUP_TTL_MS
}

function markChatGPTBundleRequestDelivered(requestId) {
  const now = Date.now()
  deliveredChatGPTBundleRequestIds.set(requestId, now)
  for (const [id, deliveredAt] of deliveredChatGPTBundleRequestIds) {
    if (now - deliveredAt >= DELIVERED_BUNDLE_DEDUP_TTL_MS) deliveredChatGPTBundleRequestIds.delete(id)
  }
}

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

function closeInternalChatGPTBrowserForWindow(windowState) {
  const browser = internalChatGPTBrowsers.get(windowState?.id)
  if (!browser) return false
  internalChatGPTBrowsers.delete(windowState.id)
  if (!browser.isDestroyed()) browser.close()
  return true
}

function closeAllInternalChatGPTBrowsers() {
  for (const browser of internalChatGPTBrowsers.values()) if (!browser.isDestroyed()) browser.close()
  internalChatGPTBrowsers.clear()
}

function rehomeChatGPTWorkers(windowState) {
  hideChatAgentInteractionsForWindow(windowState)
  const replacement = [...desktopWindows.values()].find((state) => state.id !== windowState?.id && state.window && !state.window.isDestroyed())
  if (!replacement) return false
  for (const entry of chatGPTWorkerEntries) {
    if (entry.ownerWindowId !== windowState.id || entry.view.webContents.isDestroyed()) continue
    if (entry.attached) {
      try { windowState.window.contentView.removeChildView?.(entry.view) } catch { /* already detached */ }
      replacement.window.contentView.addChildView(entry.view)
    }
    entry.ownerWindowId = replacement.id
    entry.interactionWindowId = ''
    entry.parkedLayout = true
    // Re-parenting rebuilds the native view hierarchy, so the renderer's layout
    // viewport does not survive it. Re-grant rather than hide straight away,
    // which would strand the slot at 0x0 for every later account operation.
    grantChatGPTLayoutViewport(entry.view)
    entry.layoutViewportGranted = true
  }
  return true
}

function closeChatGPTViewsForWindow(windowState) {
  for (const [key, entry] of [...chatgptViews.entries()]) if (entry.ownerWindowId === windowState.id) retireChatGPTSupervisorSurface(key)
  windowState.activeChatGPTKey = ''
  windowState.chatgptVisible = false
}

function closeAllChatGPTViews() {
  for (const record of chatGPTAuthBrowsers.values()) {
    record.cancelled = true
    void closeManagedBrowserAuth(record)
  }
  chatGPTAuthBrowsers.clear()
  for (const entry of chatgptViews.values()) {
    clearTimeout(entry.affinitySettleTimer)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }
  chatgptViews = new Map()
  for (const entry of chatGPTWorkerEntries.splice(0)) {
    clearTimeout(entry.affinitySettleTimer)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }
  for (const state of desktopWindows.values()) { state.activeChatGPTKey = ''; state.chatgptVisible = false; state.activeAgentInteractionId = '' }
}

function touchChatGPTEntry(entry) {
  entry.lastUsed = Date.now()
}

function chatGPTEntryForWebContentsID(webContentsId) {
  if (webContentsId == null) return undefined
  const supervisor = [...chatgptViews.entries()].find(([, candidate]) => candidate.view.webContents.id === webContentsId)
  if (supervisor) return supervisor
  const worker = chatGPTWorkerEntries.find((candidate) => candidate.view.webContents.id === webContentsId && candidate.ownerKey)
  return worker ? [worker.ownerKey, worker] : undefined
}

function noteChatGPTNetworkActivity(details, phase = 'network') {
  const match = chatGPTEntryForWebContentsID(details?.webContentsId)
  if (!match) return
  const [key, entry] = match
  const now = Date.now()
  entry.lastNetworkActivity = now
  const conversationTransport = isChatGPTConversationTransportURL(details?.url)
  if (conversationTransport) entry.lastConversationActivity = now
  const requestKey = String(details?.id ?? '')
  if (conversationTransport && requestKey) {
    recordChatGPTConversationTransport(entry.conversationRequests, requestKey, entry.conversationTransportGeneration, phase, now)
    if (phase === 'before') entry.staleConversationRequestIds.clear()
    else if (phase === 'completed' || phase === 'error') entry.staleConversationRequestIds.delete(requestKey)
  }
  const expected = expectedChatGPTBundles.get(key)
  if (expected?.recovery && conversationTransport) {
    noteChatGPTRecoveryProgress(expected.recovery, `${phase}:${requestKey}:${details?.method || ''}`, now)
  }
}

function noteChatGPTNetworkFailure(details) {
  const match = chatGPTEntryForWebContentsID(details?.webContentsId)
  if (!match) return false
  const conversationTransport = isChatGPTConversationTransportURL(details?.url)
  if (!isRecoverableChatGPTNetworkError(details?.error, { conversationTransport })) return false
  const [key] = match
  const expected = expectedChatGPTBundles.get(key)
  if (!expected?.recovery) return false
  const relevant = details?.resourceType === 'mainFrame' || conversationTransport
  if (!relevant) return false
  noteChatGPTRecoveryFault(expected.recovery, String(details?.error || 'ChatGPT network transport failed'), Date.now())
  console.warn(`[chatgpt-recovery] network-fault key=${key} request=${expected.requestId} error=${String(details?.error || 'unknown')}`)
  return true
}

function requireOwnedChatGPTEntry(cacheKey, entry) {
  const key = sanitizeChatCacheKey(cacheKey)
  const workerOwnsKey = entry?.role === 'worker' && entry.ownerKey === key && chatGPTWorkerEntries.includes(entry)
  const supervisorOwnsKey = entry?.role !== 'worker' && entry?.ownerKey === key && chatgptViews.get(key) === entry
  if (!workerOwnsKey && !supervisorOwnsKey) throw new Error('ChatGPT view ownership mismatch')
  return { key, entry, wc: entry.view.webContents }
}

function releaseChatGPTView(cacheKey, ownerState) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = chatgptViews.get(key)
  if (!entry) return false
  if (ownerState && entry.ownerWindowId !== ownerState.id) throw new Error('ChatGPT view belongs to another Wharnex window')
  if (entry.humanAction?.active) sendToChatGPTKey(key, 'wharness:chatgpt:human-action', { cacheKey: key, active: false, requestId: entry.humanAction.requestId || '', clearedAt: new Date().toISOString(), reason: 'surface released' })
  cancelExternalAuthentication(key)
  clearTimeout(entry.authProbeTimer)
  clearTimeout(entry.affinitySettleTimer)
  chatgptViews.delete(key)
  preparedChatGPTDrafts.delete(key)
  retryableChatGPTPrompts.delete(key)
  pendingChatGPTComments.delete(key)
  flushingChatGPTComments.delete(key)
  chatGPTActivityFingerprints.delete(key)
  expectedChatGPTBundles.delete(key)
  chatGPTTransportTails.delete(key)
  const state = windowStateForEntry(entry)
  if (state?.activeChatGPTKey === key) {
    state.activeChatGPTKey = ''
    state.chatgptVisible = false
  }
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  console.log(`[chatgpt-instance] released key=${key} window=${entry.ownerWindowId}`)
  return true
}

function setChatGPTBounds(value, windowState) {
  const bounds = normalizeBounds(value, windowState?.window?.getContentBounds())
  const entry = activeChatGPTEntry(windowState)
  if (!bounds || !entry) return false
  windowState.chatgptBounds = bounds
  entry.view.setBounds(bounds)
  // Real pane bounds have arrived, so this view is no longer parked and is safe
  // to show.
  entry.parkedLayout = false
  return true
}

function currentChatGPTState(cacheKey = '', windowState) {
  const defaultKey = windowState?.activeChatGPTKey || ''
  const key = cacheKey ? sanitizeChatCacheKey(cacheKey) : defaultKey
  const entry = key ? chatgptViews.get(key) : undefined
  if (entry && windowState && entry.ownerWindowId !== windowState.id) throw new Error('ChatGPT view belongs to another Wharnex window')
  const surfaceDeferred = Boolean(key && deferredSupervisorNavigation?.key === key && (!windowState || deferredSupervisorNavigation.windowState === windowState))
  const wc = entry?.view.webContents
  return {
    cacheKey: key,
    surfaceDeferred,
    url: wc?.getURL() || CHATGPT_URL,
    title: wc?.getTitle() || 'ChatGPT',
    loading: entry?.loading ?? true,
    canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
    canGoForward: Boolean(wc?.navigationHistory.canGoForward()),
    externalAuthProvider: entry?.externalAuthProvider || '',
    authMode: entry?.authMode || 'embedded',
    authWindowOpen: Boolean(key && chatGPTAuthBrowsers.has(key)),
    authenticated: Boolean(entry?.authenticated),
    humanAction: entry?.humanAction?.active ? { cacheKey: key, ...entry.humanAction } : undefined,
    ...publicChatGPTAffinity(entry?.affinity),
  }
}

function publishChatGPTState(key = '') {
  if (!key) {
    for (const state of desktopWindows.values()) if (state.activeChatGPTKey) publishChatGPTState(state.activeChatGPTKey)
    return
  }
  const entry = chatgptViews.get(key)
  const state = windowStateForEntry(entry)
  if (!state) return
  sendToWindowState(state, 'wharness:chatgpt:state', currentChatGPTState(key, state))
}

function isChatGPTNewChatSurfaceURL(value) {
  try {
    const trusted = requireTrustedChatGPTURL(value)
    const pathname = new URL(trusted).pathname
    return pathname === '/' || pathname === ''
  } catch { return false }
}

function observeChatGPTAffinityURL(cacheKey, entry, value) {
  const observed = observeChatGPTAffinity(entry.affinity, {
    home: isChatGPTNewChatSurfaceURL(value),
    conversationUrl: canonicalChatGPTConversationURL(value),
  })
  if (observed) console.log(`[chatgpt-affinity] observed key=${cacheKey} url=${sanitizeDiagnosticURL(observed)}`)
  return observed
}

function syncChatGPTAffinityURL(cacheKey, entry, linkedURL = '') {
  const linkedConversation = canonicalChatGPTConversationURL(linkedURL)
  const currentURL = entry.view.webContents.getURL()
  syncChatGPTAffinity(entry.affinity, linkedConversation, !linkedConversation && isChatGPTNewChatSurfaceURL(currentURL))
  console.log(`[chatgpt-affinity] sync key=${cacheKey} phase=${entry.affinity.phase} linked=${sanitizeDiagnosticURL(linkedConversation || CHATGPT_URL)}`)
  return linkedConversation
}

function proposeCurrentChatGPTAffinity(cacheKey, entry, linkedConversation, currentConversation) {
  if (!currentConversation || !linkedConversation || currentConversation === linkedConversation) return currentConversation
  const candidate = proposeChatGPTAffinity(entry.affinity, currentConversation)
  if (candidate) {
    console.log(`[chatgpt-affinity] rebind-candidate key=${cacheKey} url=${sanitizeDiagnosticURL(candidate)}`)
    publishChatGPTState(cacheKey)
  }
  return currentConversation
}

function noteChatGPTRendererFault(cacheKey, reason) {
  const expected = expectedChatGPTBundles.get(cacheKey)
  if (!expected?.recovery) return false
  noteChatGPTRecoveryFault(expected.recovery, reason, Date.now())
  console.warn(`[chatgpt-recovery] renderer-fault key=${cacheKey} request=${expected.requestId} error=${reason}`)
  return true
}

function chatGPTHumanActionMessage(kind, detail = '') {
  const suffix = String(detail || '').trim()
  if (kind === 'verification') return 'O ChatGPT exige uma verificação humana/anti-robô. Abra o separador ChatGPT e conclua a verificação; a recuperação automática ficou pausada para não reiniciar o desafio.'
  if (kind === 'authentication') return 'A sessão do ChatGPT precisa de autenticação humana. Abra o separador ChatGPT e conclua o login para o Wharnex retomar o pedido.'
  if (kind === 'access') return 'O ChatGPT bloqueou o acesso ao pedido. Abra o separador ChatGPT e conclua qualquer verificação apresentada antes de continuar.'
  if (kind === 'surface') return 'A interface do ChatGPT deixou de expor o compositor mesmo após uma recarga de recuperação. Abra o separador ChatGPT e confirme se existe um aviso, bloqueio ou alteração de interface.'
  if (kind === 'transport') return `A ligação ao ChatGPT continuou a falhar após as tentativas automáticas${suffix ? ` (${suffix})` : ''}. Verifique a ligação/VPN/proxy e abra o ChatGPT antes de continuar.`
  if (kind === 'stalled') return 'O pedido do ChatGPT continuou sem progresso após a recarga e a única continuação automática permitida. Abra o separador ChatGPT e conclua/retome o pedido manualmente.'
  return 'O ChatGPT requer uma ação humana antes de o Wharnex poder continuar.'
}

function setChatGPTHumanAction(cacheKey, kind, detail = '', source = 'dom') {
  const entry = chatgptViews.get(cacheKey)
  if (!entry) return false
  const expected = expectedChatGPTBundles.get(cacheKey)
  const requestId = expected?.requestId || entry.transportRequestId || retryableChatGPTPrompts.get(cacheKey)?.request?.requestId || ''
  const message = chatGPTHumanActionMessage(kind, detail)
  const fingerprint = `${kind}:${requestId}:${String(detail || '').slice(0, 160)}`
  if (entry.humanAction?.active && entry.humanNoticeFingerprint === fingerprint) return false
  entry.humanAction = { active: true, kind, source, requestId, message, detectedAt: new Date().toISOString() }
  entry.humanNoticeFingerprint = fingerprint
  const payload = { cacheKey, ...entry.humanAction }
  sendToChatGPTKey(cacheKey, 'wharness:chatgpt:human-action', payload)
  const state = windowStateForEntry(entry)
  if (state?.window && !state.window.isDestroyed()) {
    state.window.flashFrame(true)
    if (Notification.isSupported()) {
      try {
        const notification = new Notification({ title: 'Ação necessária no ChatGPT', body: message, silent: false })
        notification.on('click', () => {
          if (state.window.isDestroyed()) return
          state.window.show(); state.window.focus()
          sendToWindowState(state, 'wharness:chatgpt:human-action', { ...payload, open: true })
        })
        notification.show()
      } catch (error) { console.warn('[chatgpt-human-action] notification failed', error) }
    }
  }
  console.warn(`[chatgpt-human-action] key=${cacheKey} request=${requestId || '-'} kind=${kind} source=${source}`)
  return true
}

function clearChatGPTHumanAction(cacheKey, reason = '') {
  const entry = chatgptViews.get(cacheKey)
  if (!entry?.humanAction?.active) return false
  const prior = entry.humanAction
  entry.humanAction = undefined
  entry.humanNoticeFingerprint = ''
  const state = windowStateForEntry(entry)
  if (state?.window && !state.window.isDestroyed() && state.window.isFocused()) state.window.flashFrame(false)
  sendToChatGPTKey(cacheKey, 'wharness:chatgpt:human-action', {
    cacheKey,
    active: false,
    kind: prior.kind,
    source: prior.source,
    requestId: prior.requestId,
    message: reason ? `Controlo do ChatGPT restabelecido: ${reason}.` : 'Controlo do ChatGPT restabelecido.',
    detectedAt: new Date().toISOString(),
  })
  return true
}

// Register provider rate-limit evidence and suspend the pool accordingly.
//
// The two shapes are answered differently: one throttled request takes the
// progressive ladder, while ChatGPT's account-wide gate suspends every claim
// and submission for a fixed window. The local clock is set optimistically so
// workers stop on this tick rather than after the backend round-trip, and the
// durable value from the backend then takes over.
function applyChatGPTRateLimit(cacheKey, { source = 'unknown', domGate = false } = {}) {
  const now = Date.now()
  const classification = classifyChatGPTRateLimit(chatGPTRateLimitHits, { now, domGate })
  chatGPTRateLimitHits = classification.hits
  const gate = classification.kind === RATE_LIMIT_GATE
  const escalated = gate && chatGPTRateLimitKind !== RATE_LIMIT_GATE
  // While a suspension is already counting down, a further refusal is expected
  // noise and must not restart the round-trip on every response — unless it is
  // the one that reveals the isolated 429 was really an account-wide gate.
  if (now < chatGPTRateLimitUntil && !escalated) return true

  const localUntil = now + (gate ? CHATGPT_RATE_LIMIT_GATE_MS : CHATGPT_RATE_LIMIT_BACKOFF_MS)
  chatGPTRateLimitUntil = Math.max(chatGPTRateLimitUntil, localUntil)
  chatGPTRateLimitKind = classification.kind
  chatGPTRateLimitAppliedAt = now

  const expected = expectedChatGPTBundles.get(cacheKey)
  if (expected) {
    expected.backoffUntil = Math.max(Number(expected.backoffUntil || 0), chatGPTRateLimitUntil)
    noteChatGPTRecoveryProgress(expected.recovery, `http:429-${classification.kind}`, now)
  }

  if (chatAgentScheduler) {
    void chatAgentScheduler.recordRateLimit(source, classification.kind).then((provider) => {
      const persistedUntil = Date.parse(String(provider?.paused_until || ''))
      if (Number.isFinite(persistedUntil)) chatGPTRateLimitUntil = Math.max(chatGPTRateLimitUntil, persistedUntil)
      if (expected && Number.isFinite(persistedUntil)) expected.backoffUntil = Math.max(Number(expected.backoffUntil || 0), persistedUntil)
      chatAgentRuntimeDiagnostics.provider = { ...chatAgentRuntimeDiagnostics.provider, ...provider }
      publishChatAgentRuntimeState()
    }).catch((error) => {
      console.warn(`[chat-agent] could not persist provider rate-limit ${classification.kind}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  console.warn(`[chat-agent] provider-rate-limit kind=${classification.kind} source=${source} hits=${classification.recentHits} until=${new Date(chatGPTRateLimitUntil).toISOString()}`)
  if (cacheKey) {
    sendToChatGPTKey(cacheKey, 'wharness:chatgpt:activity', {
      cacheKey,
      state: 'thinking',
      text: gate
        ? 'O ChatGPT bloqueou a conta por excesso de pedidos. Os workers ficam suspensos cerca de 30 minutos e retomam de forma escalonada, sem perder tarefas nem tentativas.'
        : 'O ChatGPT aplicou limitação temporária. Os workers entram em cooldown progressivo e retomam com navegação global espaçada.',
      capturedAt: new Date().toISOString(),
    })
  }
  return true
}

// ChatGPT's own limit control, seen by the passive health probe. That control
// is conclusive structural evidence on its own, so it escalates straight to the
// account-wide suspension without waiting for a second refusal.
function noteChatGPTRateLimitGate(cacheKey, health) {
  if (health?.rateLimited !== true) return false
  applyChatGPTRateLimit(cacheKey, { source: 'dom_gate', domGate: true })
  return true
}

// ChatGPT's own generated-file download endpoint for one conversation.
function chatGPTInterpreterDownloadConversation(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:') return ''
    if (url.hostname !== 'chatgpt.com' && !url.hostname.endsWith('.chatgpt.com')) return ''
    return String(url.pathname.match(/^\/backend-api\/conversation\/([A-Za-z0-9-]{1,128})\/interpreter\/download$/)?.[1] || '')
  } catch { return '' }
}

function noteChatGPTExpiredArtifact(conversationID, now = Date.now()) {
  if (!conversationID) return false
  chatGPTExpiredArtifactConversations.set(conversationID, now)
  for (const [id, at] of [...chatGPTExpiredArtifactConversations]) {
    if (now - at > EXPIRED_ARTIFACT_TTL_MS) chatGPTExpiredArtifactConversations.delete(id)
  }
  return true
}

function chatGPTArtifactExpiredSince(conversationID, since) {
  const at = Number(chatGPTExpiredArtifactConversations.get(String(conversationID || '')) || 0)
  return at > 0 && at >= Number(since || 0)
}

function noteChatGPTHTTPStatus(details) {
  const match = chatGPTEntryForWebContentsID(details?.webContentsId)
  if (!match) return false
  const [key, entry] = match
  const status = Number(details?.statusCode || 0)
  const conversationTransport = isChatGPTConversationTransportURL(details?.url)
  // Any refusal from a trusted ChatGPT backend endpoint is evidence about the
  // account, not about one conversation. Scoping this to the main frame and the
  // four conversation endpoints is what let a submission burst refuse on a
  // sibling endpoint without the pool ever pausing.
  if (status === 429 && (details?.resourceType === 'mainFrame' || isChatGPTBackendAPIURL(details?.url))) {
    applyChatGPTRateLimit(key, {
      source: details?.resourceType === 'mainFrame' ? 'main_frame' : conversationTransport ? 'conversation_transport' : 'backend_api',
    })
    return true
  }
  // A generated file ChatGPT no longer serves. Recorded per conversation so the
  // task that owns it stops clicking a dead card and asks for the file again.
  if (status === 404) {
    const expiredConversation = chatGPTInterpreterDownloadConversation(details?.url)
    if (expiredConversation) {
      noteChatGPTExpiredArtifact(expiredConversation)
      return true
    }
  }
  if (!conversationTransport) return false
  const expected = expectedChatGPTBundles.get(key)
  if (!expected) return false
  if (status === 401) return setChatGPTHumanAction(key, 'authentication', 'HTTP 401', 'http')
  if (status === 403) return setChatGPTHumanAction(key, 'access', 'HTTP 403', 'http')
  if (status >= 500 && status <= 599) {
    noteChatGPTRecoveryFault(expected.recovery, `ChatGPT HTTP ${status}`, Date.now())
    return true
  }
  if (status > 0 && status < 400) {
    if (Date.now() >= chatGPTRateLimitUntil) expected.backoffUntil = 0
    if (entry.humanAction?.source === 'http' || entry.humanAction?.kind === 'transport') clearChatGPTHumanAction(key, `HTTP ${status}`)
  }
  return false
}

function settleChatGPTAffinityAfterSubmit(cacheKey, entry, conversationURL) {
  const concrete = canonicalChatGPTConversationURL(conversationURL)
  if (!concrete) return ''
  observeChatGPTAffinityURL(cacheKey, entry, concrete)
  let candidate = settleChatGPTAffinity(entry.affinity, concrete)
  if (!candidate && !entry.affinity.boundURL && entry.affinity.phase === 'unbound') {
    candidate = proposeChatGPTAffinity(entry.affinity, concrete)
  } else if (!candidate && entry.affinity.phase === 'candidate' && entry.affinity.candidateURL === concrete) {
    candidate = concrete
  }
  if (candidate) {
    clearTimeout(entry.affinitySettleTimer)
    entry.affinitySettleTimer = undefined
    console.log(`[chatgpt-affinity] definitive-candidate key=${cacheKey} url=${sanitizeDiagnosticURL(candidate)}`)
    publishChatGPTState(cacheKey)
  }
  return concrete
}

function scheduleChatGPTAffinitySettlement(cacheKey, entry) {
  clearTimeout(entry.affinitySettleTimer)
  entry.affinitySettleTimer = undefined
  if (!isChatGPTAffinityAwaitingSettlement(entry.affinity)) return
  if (!canonicalChatGPTConversationURL(entry.view.webContents.getURL())) return
  entry.affinitySettleTimer = setTimeout(async () => {
    entry.affinitySettleTimer = undefined
    if (chatGPTKeyForEntry(entry) !== cacheKey || !isChatGPTAffinityAwaitingSettlement(entry.affinity)) return
    const stableURL = await waitForConcreteChatGPTConversation(entry.view.webContents, 2_500)
    if (stableURL && isChatGPTAffinityAwaitingSettlement(entry.affinity)) settleChatGPTAffinityAfterSubmit(cacheKey, entry, stableURL)
  }, 0)
}

async function refreshEmbeddedChatGPTAuthentication(cacheKey, entry) {
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) return
  const probedURL = wc.getURL()
  if (!isTrustedChatGPTOrigin(probedURL) || isChatGPTAuthURL(probedURL) || entry.externalAuthProvider) {
    if (entry.authenticated) {
      entry.authenticated = false
      publishChatGPTState(cacheKey)
    }
    return
  }
  try {
    const authenticated = Boolean(await wc.executeJavaScript(chatGPTSessionProbeExpression(), true))
    if (wc.isDestroyed() || wc.getURL() !== probedURL || entry.externalAuthProvider) return
    if (entry.authenticated !== authenticated) {
      entry.authenticated = authenticated
      publishChatGPTState(cacheKey)
    }
  } catch {
    // Keep the previous state on transient page/network failures instead of
    // falsely asking an already-authenticated user to sign in again.
  }
}

function scheduleEmbeddedChatGPTAuthenticationProbe(cacheKey, entry, delayMs = 120) {
  clearTimeout(entry.authProbeTimer)
  entry.authProbeTimer = setTimeout(() => {
    entry.authProbeTimer = undefined
    void refreshEmbeddedChatGPTAuthentication(cacheKey, entry)
  }, delayMs)
}

function publishPlanDownload(payload) {
  sendToChatGPTKey(payload?.cacheKey || '', 'wharness:chatgpt:plan-downloaded', payload)
}

function publishPlanDownloadError(message, filename = '', cacheKey = '') {
  console.error(`[chatgpt-plan-download] ${message}${filename ? ` file=${filename}` : ''}${cacheKey ? ` key=${cacheKey}` : ''}`)
  sendToChatGPTKey(cacheKey, 'wharness:chatgpt:plan-download-error', { message, filename, cacheKey })
}

// routingKey is the live surface used only to reach a mounted window; the
// payload's own cacheKey states which chat actually owns the bundle. They
// differ for a cross-request bundle: it must be delivered (the renderer routes
// it by request id across every chat in the workspace) without being
// attributed to the surface that happened to download it.
function publishBundleDownload(payload, routingKey = '') {
  sendToChatGPTKey(routingKey || payload?.cacheKey || '', 'wharness:chatgpt:bundle-downloaded', payload)
}

function publishBundleDownloadError(message, filename = '', cacheKey = '') {
  console.error(`[chatgpt-bundle-download] ${message}${filename ? ` file=${filename}` : ''}${cacheKey ? ` key=${cacheKey}` : ''}`)
  // A late bundle can arrive after this surface has moved to a newer request.
  // Prefer the request encoded in a strict filename so that old transport
  // failures cannot terminate the newer active request.
  const requestId = wharnessBundleRequestIdFromFilename(filename) || expectedChatGPTBundles.get(cacheKey)?.requestId || ''
  sendToChatGPTKey(cacheKey, 'wharness:chatgpt:bundle-download-error', { message, filename, cacheKey, requestId })
}

// Chromium appends its own browser-side duplicate-name suffix ("(2)") when a
// name it already has a download for is offered again - exactly what happens
// when a worker clicks the same result card more than once. The Supervisor's
// canonicalWharnessBundleDownload already tolerates this (bundlename.mjs's
// parseBundleNameWithDuplicateSuffix); these background-worker downloads used
// a strict exact-match instead, so a suffixed repeat fell through every
// recognizer here and reached the OS as an ordinary, undismissable download
// prompt.
function stripChatGPTDownloadDuplicateSuffix(filename) {
  return String(filename || '').replace(/ \([1-9][0-9]{0,3}\)(?=\.[^.]+$)/, '')
}

// The project-scoped human ChatGPT browser shares the automation partition, so
// it reaches the same `will-download` handler. A person browsing there may
// legitimately save anything, and their downloads must keep behaving like
// ordinary browser downloads. Everything else on this partition is Wharnex
// automation, where an unrecognized download is a leak.
function chatGPTDownloadIsHumanBrowsing(sourceWebContents) {
  if (!sourceWebContents) return false
  for (const browser of internalChatGPTBrowsers.values()) {
    if (browser.isDestroyed()) continue
    const wc = browser.webContents
    if (sourceWebContents === wc || sourceWebContents.hostWebContents === wc) return true
  }
  return false
}

function registerChatGPTMarkdownTranslationDownload(item, sourceFilename) {
  const rawFilename = path.basename(String(sourceFilename || ''))
  const filename = stripChatGPTDownloadDuplicateSuffix(rawFilename)
  const expected = expectedChatGPTTranslations.get(filename)
  const looksInternal = /^whx_translation_res_cat_[a-f0-9]{20}\.zip$/.test(filename)
  if (!expected && !looksInternal) return false
  if (rawFilename !== filename) console.warn(`[translation] normalized duplicate-suffixed download name=${rawFilename} -> ${filename}`)
  if (!expected || Date.now() - expected.armedAt > MARKDOWN_TRANSLATION_TIMEOUT_MS + 60_000) {
    item.cancel()
    return true
  }
  const total = Number(item.getTotalBytes?.() || 0)
  if (total > MAX_MARKDOWN_TRANSLATION_RESULT_BYTES) {
    item.cancel()
    expected.reject(new Error('Translation bundle exceeds the 8 MiB result limit'))
    return true
  }
  const dir = path.join(app.getPath('temp'), 'wharness-markdown-translations', expected.taskId)
  const savePath = path.join(dir, filename)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    item.setSavePath(savePath)
  } catch (error) {
    item.cancel()
    expected.reject(error instanceof Error ? error : new Error(String(error)))
    return true
  }
  item.on('updated', () => {
    if (item.getReceivedBytes() > MAX_MARKDOWN_TRANSLATION_RESULT_BYTES) {
      item.cancel()
      expected.reject(new Error('Translation bundle exceeds the 8 MiB result limit'))
    }
  })
  item.once('done', async (_doneEvent, state) => {
    if (state !== 'completed') {
      if (state !== 'cancelled') expected.reject(new Error(`Translation bundle download ended in state ${state}`))
      return
    }
    try {
      const bytes = await readFile(savePath)
      if (bytes.byteLength > MAX_MARKDOWN_TRANSLATION_RESULT_BYTES) throw new Error('Translation bundle exceeds the 8 MiB result limit')
      // The bytes travel to the backend unopened. The Desktop bounds their
      // size and nothing else: parsing the archive here would put the protocol
      // in two places, and the half that validates the answer is the half that
      // wrote the request.
      expected.resolve(bytes)
    } catch (error) {
      expected.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      await rm(savePath, { force: true }).catch(() => undefined)
    }
  })
  return true
}

function registerChatGPTTodoClassificationDownload(item, sourceFilename) {
  const rawFilename = path.basename(String(sourceFilename || ''))
  const filename = stripChatGPTDownloadDuplicateSuffix(rawFilename)
  const expected = expectedChatGPTTodoClassifications.get(filename)
  const looksInternal = /^whx_todo_classification_res_cat_[a-f0-9]{20}\.zip$/.test(filename)
  if (!expected && !looksInternal) return false
  if (rawFilename !== filename) console.warn(`[todo-classification] normalized duplicate-suffixed download name=${rawFilename} -> ${filename}`)
  if (!expected || Date.now() - expected.armedAt > TODO_CLASSIFICATION_TIMEOUT_MS + 60_000) {
    item.cancel()
    return true
  }
  if (Number(item.getTotalBytes?.() || 0) > MAX_TODO_CLASSIFICATION_BYTES) {
    item.cancel(); expected.reject(new Error('TODO classification bundle exceeds the transport limit')); return true
  }
  const dir = path.join(app.getPath('temp'), 'wharnex-todo-classifications', expected.taskId)
  const savePath = path.join(dir, filename)
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); item.setSavePath(savePath) }
  catch (error) { item.cancel(); expected.reject(error instanceof Error ? error : new Error(String(error))); return true }
  item.on('updated', () => {
    if (item.getReceivedBytes() > MAX_TODO_CLASSIFICATION_BYTES) {
      item.cancel(); expected.reject(new Error('TODO classification bundle exceeds the transport limit'))
    }
  })
  item.once('done', async (_event, state) => {
    if (state !== 'completed') {
      if (state !== 'cancelled') expected.reject(new Error(`TODO classification download ended in state ${state}`))
      return
    }
    try {
      const bytes = await readFile(savePath)
      if (bytes.byteLength > MAX_TODO_CLASSIFICATION_BYTES) throw new Error('TODO classification bundle exceeds the transport limit')
      expected.resolve(bytes)
    } catch (error) { expected.reject(error instanceof Error ? error : new Error(String(error))) }
    finally { await rm(savePath, { force: true }).catch(() => undefined) }
  })
  return true
}

function orchestratorPlanInboxDirectory() {
  return path.join(app.getPath('temp'), 'wharness-orchestrator-plans', 'inbox')
}

function pruneChatGPTOrchestratorPlanInbox(now = Date.now()) {
  for (const [name, entry] of [...chatGPTOrchestratorPlanInbox]) {
    if (now - Number(entry?.receivedAt || 0) <= ORCHESTRATOR_PLAN_INBOX_TTL_MS) continue
    chatGPTOrchestratorPlanInbox.delete(name)
    void rm(entry.savePath, { force: true }).catch(() => undefined)
  }
  while (chatGPTOrchestratorPlanInbox.size > ORCHESTRATOR_PLAN_INBOX_MAX) {
    const [name, entry] = chatGPTOrchestratorPlanInbox.entries().next().value
    chatGPTOrchestratorPlanInbox.delete(name)
    void rm(entry.savePath, { force: true }).catch(() => undefined)
  }
}

// Keep an artifact that nothing is waiting for, instead of cancelling it. The
// filename carries its own task id, so a retained plan can only ever be claimed
// by the attempt it belongs to.
function retainChatGPTOrchestratorPlanDownload(item, filename) {
  // Either shape is self-identifying: the legacy artifact carries its task id,
  // the bundle carries its request id. Neither can be claimed by another task.
  const taskId = String(filename.match(/^whx_orchestrator_plan_(cat_[a-f0-9]{20})\.json$/)?.[1] || '')
    || String(parseBundleName(filename)?.requestId || '')
  if (!taskId) {
    item.cancel()
    return true
  }
  if (Number(item.getTotalBytes?.() || 0) > MAX_ORCHESTRATOR_PLAN_BYTES) {
    item.cancel()
    return true
  }
  const savePath = path.join(orchestratorPlanInboxDirectory(), filename)
  try {
    mkdirSync(orchestratorPlanInboxDirectory(), { recursive: true, mode: 0o700 })
    item.setSavePath(savePath)
  } catch (error) {
    item.cancel()
    console.warn(`[orchestrator-worker] could not retain unclaimed plan ${filename}: ${error instanceof Error ? error.message : String(error)}`)
    return true
  }
  item.on('updated', () => {
    if (item.getReceivedBytes() > MAX_ORCHESTRATOR_PLAN_BYTES) item.cancel()
  })
  item.once('done', (_doneEvent, state) => {
    if (state !== 'completed') {
      void rm(savePath, { force: true }).catch(() => undefined)
      return
    }
    chatGPTOrchestratorPlanInbox.set(filename, { taskId, savePath, receivedAt: Date.now() })
    pruneChatGPTOrchestratorPlanInbox()
    console.log(`[orchestrator-worker] retained unclaimed plan task=${taskId} file=${filename}`)
  })
  return true
}

// Claim a retained artifact for the attempt that owns it, if one is waiting.
async function takeRetainedChatGPTOrchestratorPlan(filename) {
  pruneChatGPTOrchestratorPlanInbox()
  const entry = chatGPTOrchestratorPlanInbox.get(filename)
  if (!entry) return ''
  chatGPTOrchestratorPlanInbox.delete(filename)
  try {
    const bytes = await readFile(entry.savePath)
    if (bytes.byteLength > MAX_ORCHESTRATOR_PLAN_BYTES) throw new Error('Orchestrator plan exceeds the 2 MiB result limit')
    return bytes
  } catch (error) {
    console.warn(`[orchestrator-worker] retained plan ${filename} was unusable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  } finally {
    await rm(entry.savePath, { force: true }).catch(() => undefined)
  }
}

function registerChatGPTOrchestratorPlanDownload(item, sourceFilename) {
  const filename = path.basename(String(sourceFilename || ''))
  const expected = expectedChatGPTOrchestratorPlans.get(filename)
  const parsedBundle = parseBundleName(filename)
  const looksInternal = /^whx_orchestrator_plan_cat_[a-f0-9]{20}\.json$/.test(filename)
    || (parsedBundle?.chatId === 'orchestrator' && parsedBundle?.kind === 'res')
  if (!expected && !looksInternal) return false
  if (!expected || Date.now() - expected.armedAt > ORCHESTRATOR_PLAN_TIMEOUT_MS + 60_000) {
    return retainChatGPTOrchestratorPlanDownload(item, filename)
  }
  const total = Number(item.getTotalBytes?.() || 0)
  if (total > MAX_ORCHESTRATOR_PLAN_BYTES) {
    item.cancel()
    expected.reject(new Error('Orchestrator plan exceeds the 2 MiB result limit'))
    return true
  }
  const dir = path.join(app.getPath('temp'), 'wharness-orchestrator-plans', expected.taskId)
  const savePath = path.join(dir, filename)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    item.setSavePath(savePath)
  } catch (error) {
    item.cancel()
    expected.reject(error instanceof Error ? error : new Error(String(error)))
    return true
  }
  item.on('updated', () => {
    if (item.getReceivedBytes() > MAX_ORCHESTRATOR_PLAN_BYTES) {
      item.cancel()
      expected.reject(new Error('Orchestrator plan exceeds the 2 MiB result limit'))
    }
  })
  item.once('done', async (_doneEvent, state) => {
    if (state !== 'completed') {
      if (state !== 'cancelled') expected.reject(new Error(`Orchestrator plan download ended in state ${state}`))
      return
    }
    try {
      const bytes = await readFile(savePath)
      if (bytes.byteLength > MAX_ORCHESTRATOR_PLAN_BYTES) throw new Error('Orchestrator plan exceeds the 2 MiB result limit')
      expected.resolve(bytes)
    } catch (error) {
      expected.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      await rm(savePath, { force: true }).catch(() => undefined)
    }
  })
  return true
}

function registerChatGPTPlanDownloads(chatSession) {
  chatSession.on('will-download', (_event, item, sourceWebContents) => {
    // This handler is registered on the dedicated persist:wharness-chatgpt
    // partition. A generated attachment can be served through an internal
    // download WebContents rather than the visible ChatGPT WebContentsView, so
    // do not require object identity here. The strict filename + JSON protocol
    // + request_id checks below remain the authority for plan interception.
    const sourceFilename = item.getFilename()
    if (registerChatGPTOrchestratorPlanDownload(item, sourceFilename)) return
    if (registerChatGPTMarkdownTranslationDownload(item, sourceFilename)) return
    if (registerChatGPTTodoClassificationDownload(item, sourceFilename)) return
    const expectedBundle = expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename)
    const sourceCacheKey = expectedBundle?.key || chatGPTKeyForWebContents(sourceWebContents)
    // Manual chat transport mode: let the download proceed as an ordinary
    // Chromium download (goes to the user's normal Downloads folder) rather
    // than intercepting/validating/auto-importing it — the human is expected
    // to hand the file to Wharnex themselves via the Manual upload UI.
    if (sourceCacheKey && chatgptTransportModes.get(sourceCacheKey) === 'manual') return
    let bundleCandidate
    try {
      bundleCandidate = canonicalWharnessBundleDownload(sourceFilename, expectedBundle?.requestId || '', item.getMimeType?.() || '', sourceCacheKey || '', expectedBundle?.filename || '')
    } catch (error) {
      if (error instanceof BundleOwnershipError && error.requestId && error.filename) {
        // The name is a valid Wharnex response bundle; it simply belongs to
        // another request or chat in this workspace — the normal shape of
        // running several chats at once. Cancelling it discarded completed
        // model work and reported a spurious transport failure against the
        // unrelated newer request. Accept the bytes into the durable inbox
        // with no cacheKey and let the workspace-wide router deliver them to
        // whichever chat actually owns that request id.
        bundleCandidate = { requestId: error.requestId, filename: error.filename, normalized: path.basename(sourceFilename) !== error.filename, unrouted: true }
        console.warn(`[chatgpt-bundle-download] cross-request bundle accepted for routing file=${error.filename} request=${error.requestId}`)
      } else {
        item.cancel()
        publishBundleDownloadError(error instanceof Error ? error.message : String(error), sourceFilename, sourceCacheKey)
        return
      }
    }
    if (bundleCandidate) {
      const filename = bundleCandidate.filename
      const bundleRequestId = bundleCandidate.requestId
      // An unrouted bundle must never be attributed to the surface that
      // happened to download it: that surface owns a different request, and
      // publishing under its key is exactly how a late bundle used to
      // terminate an unrelated in-flight request.
      const deliveryCacheKey = bundleCandidate.unrouted ? '' : sourceCacheKey
      if (pendingChatGPTBundleDeliveries.has(bundleRequestId)) {
        item.cancel()
        console.warn(`[chatgpt-bundle-download] awaiting-ack duplicate-cancelled file=${filename} request=${bundleRequestId}`)
        return
      }
      const sourceURL = sourceWebContents?.getURL?.() || ''
      if (bundleCandidate.normalized) {
        console.warn(`[chatgpt-bundle-download] normalized sourceFile=${sourceFilename} canonicalFile=${filename} request=${bundleRequestId}`)
      }
      console.log(`[chatgpt-bundle-download] started file=${filename} source=${sanitizeDiagnosticURL(sourceURL)}`)
      const total = item.getTotalBytes()
      if (total > MAX_EXECUTION_BUNDLE_BYTES) {
        item.cancel()
        publishBundleDownloadError('Bundle Wharnex excede o limite de 16 MiB.', filename, sourceCacheKey)
        return
      }
      const dir = pendingBundleDirectory()
      const savePath = path.join(dir, filename)
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        item.setSavePath(savePath)
      } catch (error) {
        item.cancel()
        publishBundleDownloadError(`Não foi possível preparar o bundle: ${error instanceof Error ? error.message : String(error)}`, filename, sourceCacheKey)
        return
      }
      item.on('updated', () => {
        if (item.getReceivedBytes() > MAX_EXECUTION_BUNDLE_BYTES) {
          item.cancel()
          publishBundleDownloadError('Bundle Wharnex excede o limite de 16 MiB.', filename, sourceCacheKey)
        }
      })
      item.once('done', async (_doneEvent, state) => {
        // Release the in-flight guard regardless of outcome — a failed or
        // cancelled download must not permanently block a later retry, and
        // a completed one has nothing left to guard against re-clicking.
        const live = expectedBundle?.key ? expectedChatGPTBundles.get(expectedBundle.key) : undefined
        if (live && live.requestId === expectedBundle.requestId) live.downloadInFlight = false
        if (state !== 'completed') {
          if (state !== 'cancelled') publishBundleDownloadError(`Download do bundle terminou em estado ${state}.`, filename, deliveryCacheKey)
          return
        }
        let retainedForAcknowledgement = false
        try {
          const bytes = await readFile(savePath)
          if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharnex excede o limite de 16 MiB.')
          const validated = validateWharnessBundleDownload(filename, bytes)
          if (chatAgentScheduler) {
            const expectedEntry = expectedBundle?.key
              ? (chatGPTWorkerEntries.find((candidate) => candidate.ownerKey === expectedBundle.key) || chatgptViews.get(expectedBundle.key))
              : undefined
            const durationMs = Number(expectedBundle?.processingDurationMs || 0)
            const conversationID = chatAgentConversationID(expectedEntry?.view?.webContents?.getURL?.() || sourceURL)
            void chatAgentScheduler.recordValidBundle({ requestId: validated.requestId, conversationId: conversationID, durationMs })
              .then((provider) => {
                chatAgentRuntimeDiagnostics.provider = { ...chatAgentRuntimeDiagnostics.provider, ...provider }
                publishChatAgentRuntimeState()
              })
              .catch((error) => console.warn(`[chat-agent] valid-bundle metric failed: ${error instanceof Error ? error.message : String(error)}`))
          }
          if (recentlyDeliveredChatGPTBundleRequestId(validated.requestId)) {
            console.warn(`[chatgpt-bundle-download] duplicate-suppressed file=${filename} request=${validated.requestId}`)
            return
          }
          if (pendingChatGPTBundleDeliveries.has(validated.requestId)) {
            console.warn(`[chatgpt-bundle-download] awaiting-ack duplicate-suppressed file=${filename} request=${validated.requestId}`)
            retainedForAcknowledgement = true
            return
          }
          pendingChatGPTBundleDeliveries.set(validated.requestId, { cacheKey: deliveryCacheKey, filename, filePath: savePath })
          retainedForAcknowledgement = true
          publishBundleDownload({ cacheKey: deliveryCacheKey, filename, requestId: validated.requestId, contentBase64: bytes.toString('base64'), bytes: bytes.byteLength, sourceFilename, normalizedFilename: bundleCandidate.normalized, unrouted: Boolean(bundleCandidate.unrouted) }, sourceCacheKey)
          console.log(`[chatgpt-bundle-download] awaiting-ack file=${filename} bytes=${bytes.byteLength}`)
        } catch (error) {
          if (live && live.requestId === bundleRequestId) {
            live.invalidBundleCount = Number(live.invalidBundleCount || 0) + 1
            live.lastDOMClick = 0
            console.warn(`[chatgpt-bundle-download] protocol-invalid key=${expectedBundle?.key || '-'} request=${bundleRequestId} count=${live.invalidBundleCount}`)
          }
          publishBundleDownloadError(error instanceof Error ? error.message : String(error), filename, deliveryCacheKey)
        } finally {
          if (!retainedForAcknowledgement) try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
        }
      })
      return
    }
    if (sourceFilename.startsWith('whx_bundle_res_')) {
      item.cancel()
      publishBundleDownloadError('Nome do bundle inválido; esperado whx_bundle_res_<chat_id>_<request_id>.zip.', sourceFilename, sourceCacheKey)
      return
    }

    const filename = sourceFilename
    const requestId = wharnessPlanRequestIdFromFilename(filename)
    if (!requestId) {
      if (filename.startsWith('wharness-plan-')) {
        item.cancel()
        publishPlanDownloadError('Nome do ficheiro de plano inválido; esperado wharness-plan-<request_id>.json.', filename, sourceCacheKey)
        return
      }
      // Fail closed. Every recognizer above has declined, so on an automation
      // surface this is a download Wharnex did not ask for and cannot account
      // for. Returning here let it fall through to Chromium's default
      // handling: it landed in the operator's Downloads folder unnoticed - the
      // Worker artifacts that "leaked instead of being captured" - and, when
      // the name collided, raised the operating system's own Save As dialog,
      // which is modal and froze the whole desktop until dismissed by hand.
      // Only the human browsing surface keeps ordinary download behaviour.
      if (chatGPTDownloadIsHumanBrowsing(sourceWebContents)) return
      item.cancel()
      console.warn(`[chatgpt-download] unrecognized artifact cancelled file=${filename} key=${sourceCacheKey || '-'} mime=${item.getMimeType?.() || '-'} source=${sanitizeDiagnosticURL(sourceWebContents?.getURL?.() || '')}`)
      return
    }
    const sourceURL = sourceWebContents?.getURL?.() || ''
    console.log(`[chatgpt-plan-download] started file=${filename} source=${sanitizeDiagnosticURL(sourceURL)}`)

    const total = item.getTotalBytes()
    if (total > MAX_PLAN_BYTES) {
      item.cancel()
      publishPlanDownloadError('Plano Wharnex excede o limite de 2 MiB.', filename, sourceCacheKey)
      return
    }

    const dir = path.join(app.getPath('temp'), 'wharness-plans')
    const savePath = path.join(dir, filename)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      item.setSavePath(savePath)
    } catch (error) {
      item.cancel()
      publishPlanDownloadError(`Não foi possível preparar o download: ${error instanceof Error ? error.message : String(error)}`, filename, sourceCacheKey)
      return
    }

    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_PLAN_BYTES) {
        item.cancel()
        publishPlanDownloadError('Plano Wharnex excede o limite de 2 MiB.', filename, sourceCacheKey)
      }
    })

    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') publishPlanDownloadError(`Download do plano terminou em estado ${state}.`, filename, sourceCacheKey)
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_PLAN_BYTES) throw new Error('Plano Wharnex excede o limite de 2 MiB.')
        const text = bytes.toString('utf8')
        const validated = validateWharnessPlanFile(filename, text)
        publishPlanDownload({ cacheKey: sourceCacheKey, filename, requestId: validated.requestId, text: validated.text, bytes: bytes.byteLength })
        console.log(`[chatgpt-plan-download] imported file=${filename} bytes=${bytes.byteLength}`)
      } catch (error) {
        publishPlanDownloadError(error instanceof Error ? error.message : String(error), filename, sourceCacheKey)
      } finally {
        try { await rm(savePath, { force: true }) } catch { /* best effort temp cleanup */ }
      }
    })
  })
}

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

function publishExternalAuth(entry, provider, url) {
  entry.externalAuthProvider = provider || 'OpenAI'
  entry.view.setVisible(false)
  const state = windowStateForEntry(entry)
  if (state) {
    sendToWindowState(state, 'wharness:chatgpt:external-auth', {
      cacheKey: chatGPTKeyForEntry(entry),
      provider: entry.externalAuthProvider,
      url: sanitizeDiagnosticURL(url || CHATGPT_LOGIN_URL),
      authMode: 'external',
      managedWindow: false,
      managedBrowser: true,
    })
  }
  publishChatGPTState(chatGPTKeyForEntry(entry))
}

function publishAuthComplete(cacheKey, mode, url) {
  const state = windowStateForEntry(chatgptViews.get(cacheKey))
  if (state) {
    sendToWindowState(state, 'wharness:chatgpt:auth-complete', {
      cacheKey,
      authMode: mode,
      url: sanitizeDiagnosticURL(url || CHATGPT_URL),
    })
  }
}

function publishAuthError(cacheKey, provider, message) {
  const state = windowStateForEntry(chatgptViews.get(cacheKey))
  if (state) {
    sendToWindowState(state, 'wharness:chatgpt:auth-error', {
      cacheKey,
      provider: provider || 'OpenAI',
      message: String(message || 'Falha na autenticação externa.'),
    })
  }
}

async function relayManagedBrowserCookies(cookies) {
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  let imported = 0
  for (const cookie of cookies || []) {
    const details = electronCookieDetails(cookie)
    if (!details) continue
    try {
      await chatSession.cookies.set(details)
      imported += 1
    } catch (error) {
      console.warn(`[chatgpt-auth] cookie relay skipped name=${details.name} error=${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!imported) throw new Error('O navegador concluiu o login, mas nenhuma credencial ChatGPT pôde ser transferida para a sessão incorporada.')
  await chatSession.flushStorageData()
  return imported
}

async function cleanupManagedAuthentication(cacheKey, record) {
  if (chatGPTAuthBrowsers.get(cacheKey) === record) chatGPTAuthBrowsers.delete(cacheKey)
  await closeManagedBrowserAuth(record)
}

async function completeExternalAuthentication(cacheKey, entry, record, result) {
  if (record.completed || record.cancelled) return
  record.completed = true
  try {
    const imported = await relayManagedBrowserCookies(result.cookies)
    entry.externalAuthProvider = ''
    entry.authenticated = true
    const embedded = entry.view.webContents
    if (!embedded.isDestroyed()) {
      const current = embedded.getURL()
      const target = isTrustedChatGPTOrigin(current) && !isChatGPTAuthURL(current) ? current : CHATGPT_URL
      await loadOwnedChatGPTURL(cacheKey, entry, target, 'external-auth-complete')
    }
    await cleanupManagedAuthentication(cacheKey, record)
    const ownerState = windowStateForEntry(entry)
    if (ownerState?.activeChatGPTKey === cacheKey) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, ownerState))
    publishChatGPTState(cacheKey)
    publishAuthComplete(cacheKey, 'external', result.callbackURL)
    console.log(`[chatgpt-auth] external callback completed key=${cacheKey} cookies=${imported} url=${sanitizeDiagnosticURL(result.callbackURL)}`)
  } catch (error) {
    await failExternalAuthentication(cacheKey, entry, record, error)
  }
}

async function failExternalAuthentication(cacheKey, entry, record, error) {
  if (record.cancelled) return
  record.cancelled = true
  entry.externalAuthProvider = ''
  await cleanupManagedAuthentication(cacheKey, record)
  const ownerState = windowStateForEntry(entry)
  if (ownerState?.activeChatGPTKey === cacheKey) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, ownerState))
  publishChatGPTState(cacheKey)
  const message = error instanceof Error ? error.message : String(error)
  publishAuthError(cacheKey, record.provider, message)
  console.error(`[chatgpt-auth] external failed key=${cacheKey} provider=${record.provider} error=${message}`)
}

function cancelExternalAuthentication(cacheKey) {
  const record = chatGPTAuthBrowsers.get(cacheKey)
  if (!record) return
  record.cancelled = true
  chatGPTAuthBrowsers.delete(cacheKey)
  void closeManagedBrowserAuth(record)
}

function startExternalAuthentication(entry, provider = 'OpenAI') {
  const cacheKey = chatGPTKeyForEntry(entry)
  if (!cacheKey) throw new Error('ChatGPT view is not registered')
  entry.authMode = 'external'
  const existing = chatGPTAuthBrowsers.get(cacheKey)
  if (existing && !existing.cancelled && !existing.completed) {
    publishExternalAuth(entry, provider, CHATGPT_LOGIN_URL)
    return { ok: true, cacheKey, reused: true }
  }

  const profileDir = managedAuthProfilePath()
  const activeRecord = [...chatGPTAuthBrowsers.entries()].find(([key, candidate]) => key !== cacheKey && !candidate.cancelled && !candidate.completed)
  if (activeRecord) throw new Error('Já existe uma autenticação externa em curso. Conclua ou cancele essa janela antes de iniciar outra.')
  const record = { completed: false, cancelled: false, provider, profileDir, port: 0, child: undefined }
  chatGPTAuthBrowsers.set(cacheKey, record)
  publishExternalAuth(entry, provider, CHATGPT_LOGIN_URL)
  console.log(`[chatgpt-auth] starting managed browser key=${cacheKey} provider=${provider} profile=persistent`)
  void launchManagedBrowserAuth({
    profileDir,
    loginURL: CHATGPT_LOGIN_URL,
    onReady: ({ port, child }) => {
      record.port = port
      record.child = child
      if (record.cancelled) void closeManagedBrowserAuth(record)
      publishChatGPTState(cacheKey)
    },
  }).then((result) => {
    record.port = result.port
    record.child = result.child
    if (record.cancelled) {
      void closeManagedBrowserAuth(record)
      return
    }
    void completeExternalAuthentication(cacheKey, entry, record, result)
  }).catch((error) => {
    if (record.cancelled) {
      void closeManagedBrowserAuth(record)
      return
    }
    void failExternalAuthentication(cacheKey, entry, record, error)
  })
  return { ok: true, cacheKey, reused: false }
}

function routeChatGPTNavigation(entry, event, url) {
  const disposition = chatGPTNavigationDisposition(url)
  if (disposition.kind === 'trusted') return false
  // Same-origin ChatGPT auth redirects must remain renderable in the owned view.
  // Automatically converting /auth/* into a managed-browser flow hides the view
  // before the redirect settles and can strand the pane on the local loading fallback.
  if (disposition.kind === 'chatgpt-auth') {
    entry.externalAuthProvider = ''
    entry.embeddedAuthActive = true
    return false
  }
  if (disposition.kind === 'external-auth') {
    if (entry.authMode === 'embedded') {
      if (disposition.provider === 'Google') {
        event?.preventDefault?.()
        entry.embeddedAuthActive = false
        entry.embeddedAuthCrossedBoundary = false
        startExternalAuthentication(entry, 'Google')
        return true
      }
      entry.externalAuthProvider = ''
      entry.embeddedAuthActive = true
      entry.embeddedAuthCrossedBoundary = true
      return false
    }
    event?.preventDefault?.()
    startExternalAuthentication(entry, disposition.provider || 'OpenAI')
    return true
  }
  event?.preventDefault?.()
  if (disposition.kind === 'external') void shell.openExternal(url)
  return true
}

function observeEmbeddedAuthURL(cacheKey, entry, url) {
  if (!entry.embeddedAuthActive) return
  const disposition = chatGPTNavigationDisposition(url)
  if (disposition.kind === 'external-auth') {
    entry.embeddedAuthCrossedBoundary = true
    return
  }
  if (disposition.kind === 'chatgpt-auth') return
  if (disposition.kind === 'trusted') {
    let pathname = ''
    try { pathname = new URL(url).pathname } catch { return }
    if (!entry.embeddedAuthCrossedBoundary && pathname !== '/') return
    entry.embeddedAuthActive = false
    entry.embeddedAuthCrossedBoundary = false
    publishAuthComplete(cacheKey, 'embedded', url)
    console.log(`[chatgpt-auth] embedded callback completed key=${cacheKey} url=${sanitizeDiagnosticURL(url)}`)
  }
}

function isBenignChatGPTLoadAbort(error) {
  return error?.code === 'ERR_ABORTED' || Number(error?.errno) === -3
}

async function waitForChatGPTNavigationSettle(wc, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!wc.isDestroyed() && wc.isLoading() && Date.now() < deadline) await wait(50)
}

async function loadOwnedChatGPTURL(cacheKey, entry, value, reason = 'navigate') {
  const key = sanitizeChatCacheKey(cacheKey)
  const target = requireTrustedChatGPTURL(value)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  const previous = entry.navigationPromise
  if (previous) {
    if (entry.navigationTarget === target) return previous
    try { await previous } catch { /* the next explicit navigation owns recovery */ }
  }
  if (wc.isDestroyed()) throw new Error('ChatGPT renderer is unavailable')
  if (wc.getURL() === target || sameConversationURL(wc.getURL(), target)) return currentChatGPTState(key, windowStateForEntry(entry))
  let operation
  operation = (async () => {
    entry.navigationTarget = target
    console.log(`[chatgpt-load] start key=${key} reason=${reason} target=${sanitizeDiagnosticURL(target)}`)
    try {
      await wc.loadURL(target, { userAgent: CHATGPT_USER_AGENT })
    } catch (error) {
      if (!isBenignChatGPTLoadAbort(error)) throw error
      await waitForChatGPTNavigationSettle(wc)
      console.log(`[chatgpt-load] benign-abort key=${key} reason=${reason} target=${sanitizeDiagnosticURL(target)} current=${sanitizeDiagnosticURL(wc.getURL())}`)
    } finally {
      if (entry.navigationPromise === operation) {
        entry.navigationPromise = undefined
        entry.navigationTarget = ''
      }
    }
    return currentChatGPTState(key, windowStateForEntry(entry))
  })()
  entry.navigationPromise = operation
  // Electron can occasionally leave a just-created hidden WebContentsView on
  // about:blank without emitting a load event. Retry its first navigation once
  // instead of leaving the user beneath the local loading placeholder forever.
  if (reason === 'initial-show') {
    setTimeout(() => {
      if (entry.navigationPromise !== operation || wc.isDestroyed() || isTrustedChatGPTOrigin(wc.getURL())) return
      console.warn(`[chatgpt-load] initial navigation stalled; retrying once key=${key}`)
      entry.navigationPromise = undefined
      entry.navigationTarget = ''
      wc.stop()
      void loadOwnedChatGPTURL(key, entry, target, 'initial-show-retry').catch((error) => {
        console.error(`[chatgpt-load] initial retry failed key=${key} error=${error?.message || 'unknown'}`)
      })
    }, 10_000)
  }
  return operation
}

function advanceChatGPTConversationTransportGeneration(entry) {
  entry.conversationTransportGeneration = Number(entry.conversationTransportGeneration || 0) + 1
  const classification = classifyChatGPTConversationTransport(entry.conversationRequests, {
    generation: entry.conversationTransportGeneration,
  })
  reconcileChatGPTConversationTransport(entry.conversationRequests, classification)
  entry.staleConversationRequestIds.clear()
}

function createChatGPTView(cacheKey, windowState) {
  if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot create ChatGPT view without an owning Wharnex window')
  const view = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }) })
  view.setBackgroundColor('#ffffff')
  const entry = { ownerKey: cacheKey, ownerWindowId: windowState.id, view, loading: false, lastUsed: Date.now(), lastNetworkActivity: Date.now(), lastConversationActivity: Date.now(), conversationRequests: new Map(), staleConversationRequestIds: new Set(), conversationTransportGeneration: 0, transportPreparationCount: 0, transportRequestId: '', healthProbeFailures: 0, loadingSince: 0, loadingFaultNoted: false, humanAction: undefined, humanNoticeFingerprint: '', lastSurfaceFingerprint: '', externalAuthProvider: '', authMode: 'embedded', embeddedAuthActive: false, embeddedAuthCrossedBoundary: false, authenticated: false, authProbeTimer: undefined, affinitySettleTimer: undefined, navigationPromise: undefined, navigationTarget: '', parkedLayout: true, layoutViewportGranted: true, affinity: createChatGPTAffinityTracker() }
  chatgptViews.set(cacheKey, entry)
  windowState.window.contentView.addChildView(view)
  grantChatGPTLayoutViewport(view)

  const wc = view.webContents
  wc.setUserAgent(CHATGPT_USER_AGENT)
  wc.setWindowOpenHandler(({ url }) => {
    const disposition = chatGPTNavigationDisposition(url)
    const embeddedProviderAllowed = entry.authMode === 'embedded' && disposition.kind === 'external-auth' && disposition.provider !== 'Google'
    if (entry.authMode === 'embedded' && (disposition.kind === 'chatgpt-auth' || embeddedProviderAllowed)) {
      void loadOwnedChatGPTURL(cacheKey, entry, url, 'window-open')
      return { action: 'deny' }
    }
    routeChatGPTNavigation(entry, undefined, url)
    return { action: 'deny' }
  })
  wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) advanceChatGPTConversationTransportGeneration(entry) })
  wc.on('will-navigate', (event, url) => { routeChatGPTNavigation(entry, event, url) })
  wc.on('will-redirect', (event, url) => { routeChatGPTNavigation(entry, event, url) })
  wc.on('did-start-loading', () => { entry.loading = true; entry.loadingSince = Date.now(); entry.loadingFaultNoted = false; touchChatGPTEntry(entry); publishChatGPTState(cacheKey) })
  wc.on('did-stop-loading', () => { entry.loading = false; entry.loadingSince = 0; entry.loadingFaultNoted = false; observeChatGPTAffinityURL(cacheKey, entry, wc.getURL()); scheduleChatGPTAffinitySettlement(cacheKey, entry); touchChatGPTEntry(entry); publishChatGPTState(cacheKey); scheduleEmbeddedChatGPTAuthenticationProbe(cacheKey, entry); if (expectedChatGPTBundles.has(cacheKey)) void pollExpectedChatGPTDownloadKey(cacheKey); setTimeout(() => { if (!entry.accountOperationActive) void hideChatGPTSidebar(cacheKey, entry).catch(() => undefined) }, 500) })
  wc.on('did-navigate', (_event, url) => { observeEmbeddedAuthURL(cacheKey, entry, url); observeChatGPTAffinityURL(cacheKey, entry, url); scheduleChatGPTAffinitySettlement(cacheKey, entry); touchChatGPTEntry(entry); publishChatGPTState(cacheKey); scheduleEmbeddedChatGPTAuthenticationProbe(cacheKey, entry) })
  wc.on('did-navigate-in-page', (_event, url) => { observeEmbeddedAuthURL(cacheKey, entry, url); observeChatGPTAffinityURL(cacheKey, entry, url); scheduleChatGPTAffinitySettlement(cacheKey, entry); touchChatGPTEntry(entry); publishChatGPTState(cacheKey); scheduleEmbeddedChatGPTAuthenticationProbe(cacheKey, entry) })
  wc.on('page-title-updated', () => publishChatGPTState(cacheKey))
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    console.error(`[chatgpt-load] key=${cacheKey} code=${code} main=${Boolean(isMainFrame)} url=${sanitizeDiagnosticURL(url)} error=${description}`)
    if (isMainFrame && isRecoverableChatGPTNetworkError(description)) noteChatGPTRendererFault(cacheKey, description)
  })
  wc.on('render-process-gone', (_event, details) => {
    console.error(`[chatgpt-renderer] key=${cacheKey} gone reason=${details.reason} exitCode=${details.exitCode}`)
    noteChatGPTRendererFault(cacheKey, `renderer process gone: ${details.reason || 'unknown'}`)
  })
  wc.on('unresponsive', () => {
    console.error(`[chatgpt-renderer] key=${cacheKey} unresponsive`)
    noteChatGPTRendererFault(cacheKey, 'renderer unresponsive')
  })
  wc.on('responsive', () => {
    const expected = expectedChatGPTBundles.get(cacheKey)
    if (expected?.recovery) noteChatGPTRecoveryProgress(expected.recovery, 'renderer:responsive', Date.now())
    if (entry.humanAction?.kind === 'transport') clearChatGPTHumanAction(cacheKey, 'renderer responsive')
  })
  console.log(`[chatgpt-instance] created key=${cacheKey} wc=${wc.id}`)
  return entry
}

function createChatGPTWorkerView(slotId, windowState) {
  if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot create ChatGPT worker without a host window')
  const view = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }) })
  view.setBackgroundColor('#ffffff')
  // Hidden Workers do not need to participate in the visible window's native
  // compositor tree. Keeping them detached avoids the Linux WebContentsView
  // attachment trap that killed and reloaded the local frontend renderer as
  // each background slot was created. A Worker is attached only while the
  // operator explicitly surfaces it, then detached again when that pane closes.
  const entry = { role: 'worker', slotId, ownerKey: '', ownerWindowId: windowState.id, interactionWindowId: '', attached: false, view, loading: false, lastUsed: Date.now(), lastNetworkActivity: Date.now(), lastConversationActivity: Date.now(), conversationRequests: new Map(), staleConversationRequestIds: new Set(), conversationTransportGeneration: 0, transportPreparationCount: 0, transportRequestId: '', healthProbeFailures: 0, loadingSince: 0, loadingFaultNoted: false, humanAction: undefined, humanNoticeFingerprint: '', lastSurfaceFingerprint: '', externalAuthProvider: '', authMode: 'embedded', embeddedAuthActive: false, embeddedAuthCrossedBoundary: false, authenticated: false, authProbeTimer: undefined, affinitySettleTimer: undefined, navigationPromise: undefined, navigationTarget: '', parkedLayout: true, layoutViewportGranted: true, affinity: createChatGPTAffinityTracker() }
  grantChatGPTLayoutViewport(view)
  chatGPTWorkerEntries.push(entry)
  chatAgentResidency.register(slotId)
  const wc = view.webContents
  wc.setUserAgent(CHATGPT_USER_AGENT)
  wc.setBackgroundThrottling(false)
  wc.setWindowOpenHandler(({ url }) => {
    const disposition = chatGPTNavigationDisposition(url)
    if (disposition.kind === 'trusted' || disposition.kind === 'chatgpt-auth') {
      if (entry.ownerKey) void loadOwnedChatGPTURL(entry.ownerKey, entry, url, 'worker-window-open').catch(() => undefined)
    } else if (disposition.kind === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) advanceChatGPTConversationTransportGeneration(entry) })
  wc.on('will-navigate', (event, url) => { if (chatGPTNavigationDisposition(url).kind === 'external') { event.preventDefault(); void shell.openExternal(url) } })
  wc.on('did-start-loading', () => { entry.loading = true; entry.loadingSince = Date.now(); entry.loadingFaultNoted = false; touchChatGPTEntry(entry); publishChatAgentRuntimeState() })
  wc.on('did-stop-loading', () => {
    entry.loading = false; entry.loadingSince = 0; entry.loadingFaultNoted = false; touchChatGPTEntry(entry); publishChatAgentRuntimeState()
    if (entry.ownerKey) { observeChatGPTAffinityURL(entry.ownerKey, entry, wc.getURL()); scheduleChatGPTAffinitySettlement(entry.ownerKey, entry) }
  })
  wc.on('did-navigate', (_event, url) => { if (entry.ownerKey) { observeChatGPTAffinityURL(entry.ownerKey, entry, url); scheduleChatGPTAffinitySettlement(entry.ownerKey, entry) }; publishChatAgentRuntimeState() })
  wc.on('did-navigate-in-page', (_event, url) => { if (entry.ownerKey) { observeChatGPTAffinityURL(entry.ownerKey, entry, url); scheduleChatGPTAffinitySettlement(entry.ownerKey, entry) }; publishChatAgentRuntimeState() })
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    console.warn(`[chat-agent] slot=${slotId} load-failed code=${code} main=${Boolean(isMainFrame)} url=${sanitizeDiagnosticURL(url)} error=${description}`)
    if (entry.ownerKey && isMainFrame && isRecoverableChatGPTNetworkError(description)) noteChatGPTRendererFault(entry.ownerKey, description)
  })
  wc.on('render-process-gone', (_event, details) => {
    console.error(`[chat-agent] slot=${slotId} renderer-gone reason=${details.reason} exitCode=${details.exitCode}`)
    if (entry.ownerKey) noteChatGPTRendererFault(entry.ownerKey, `worker renderer process gone: ${details.reason || 'unknown'}`)
    if (hideChatAgentInteractionEntry(entry)) publishChatAgentRuntimeState()
  })
  console.log(`[chat-agent] worker-created slot=${slotId} wc=${wc.id}`)
  return entry
}

function retireChatGPTWorkerView(entry) {
  if (!entry) return false
  chatAgentResidency.retire(entry.slotId)
  hideChatAgentInteractionEntry(entry)
  clearTimeout(entry.affinitySettleTimer)
  const state = windowStateForEntry(entry)
  if (entry.attached) try { state?.window?.contentView?.removeChildView?.(entry.view) } catch { /* already detached */ }
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  return true
}

function chatAgentPolicyPath() {
  return path.join(app.getPath('userData'), 'chat-agent-policies-v1.json')
}

function loadChatAgentPolicies() {
  try { return normalizeChatAgentPolicies(JSON.parse(readFileSync(chatAgentPolicyPath(), 'utf8'))) }
  catch { return normalizeChatAgentPolicies() }
}

function persistChatAgentPolicies() {
  try {
    writeFileSync(chatAgentPolicyPath(), `${JSON.stringify({ version: 1, ...chatAgentPolicies }, null, 2)}\n`, { mode: 0o600 })
  } catch (error) { console.warn('[chat-agent] policy persistence failed', error) }
}

function chatAgentKeepFlowingConfigured(worker) {
  return keepFlowingForWorker(chatAgentPolicies, worker)
}

function chatAgentTaskKeepFlowing(task) {
  return task?.keep_flowing === true
}

function chatAgentKeepFlowingEnabled(worker, task) {
  const runtime = chatAgentWorkerStates.get(worker)
  return chatAgentKeepFlowingConfigured(worker) || chatAgentTaskKeepFlowing(runtime?.task) || chatAgentTaskKeepFlowing(task)
}

function chatAgentTaskKeepFlowingSponsored(runtime) {
  if (chatAgentTaskKeepFlowing(runtime?.task)) return true
  if (runtime?.error) return false
  return String(runtime?.lastResult?.status || '').toLowerCase() === 'waiting'
    && chatAgentTaskKeepFlowing(runtime?.lastTask)
}

function chatAgentKeepFlowingActive(worker) {
  const runtime = chatAgentWorkerStates.get(worker)
  const task = runtime?.task || runtime?.lastTask
  // A task-scoped sponsorship survives the durable WAITING/re-claim cycle of
  // that same task, but releases immediately when the scheduler settles it
  // terminally. Persistent Worker policy remains the broader request sponsor.
  if (!chatAgentKeepFlowingConfigured(worker) && !chatAgentTaskKeepFlowingSponsored(runtime)) return false
  const requestId = String(task?.root_request_id || task?.request_id || '').trim()
  if (['attention', 'failed'].includes(String(runtime?.lastResult?.status || '').toLowerCase())) return false
  if (!requestId || recentlyDeliveredChatGPTBundleRequestId(requestId) || pendingChatGPTBundleDeliveries.has(requestId)) return false
  for (const expected of expectedChatGPTBundles.values()) if (expected.requestId === requestId) return true
  return false
}

function chatAgentKeepFlowingRequestActive(requestId) {
  const id = String(requestId || '').trim()
  if (!id || recentlyDeliveredChatGPTBundleRequestId(id) || pendingChatGPTBundleDeliveries.has(id)) return false
  for (let worker = 1; worker <= chatGPTWorkerEntries.length; worker += 1) {
    const runtime = chatAgentWorkerStates.get(worker)
    const task = runtime?.task || runtime?.lastTask
    if (!chatAgentKeepFlowingConfigured(worker) && !chatAgentTaskKeepFlowingSponsored(runtime)) continue
    if (String(task?.root_request_id || task?.request_id || '').trim() === id) return true
  }
  return false
}

function chatAgentKeepFlowingFloor() {
  let floor = 0
  for (let worker = 1; worker <= chatGPTWorkerEntries.length; worker += 1) if (chatAgentKeepFlowingActive(worker)) floor = worker
  return floor
}

function chatAgentAvailableWorkers() {
  let available = 0
  for (let worker = 1; worker <= desiredChatAgentWorkerSlots; worker += 1) {
    const entry = workerEntryForIndex(worker)
    const runtime = chatAgentWorkerStates.get(worker)
    if (!entry || runtime?.active === false || runtime?.task || chatAgentKeepFlowingActive(worker)) continue
    if (entry.interactionWindowId || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.loading) continue
    available += 1
  }
  return available
}

// Resize the Supervisor pool.
//
// The count has to reach the Supervisor scheduler, which owns one claim loop per
// slot. Sending it to the Worker scheduler instead — as this did — left the
// Supervisor pool frozen at whatever count it was constructed with, so neither
// the operator's stepper nor Auto scale could ever add a Supervisor, while the
// Worker pool was silently resized to the Supervisor number.
function setChatAgentSupervisorTarget(target) {
  const normalized = normalizeSupervisorSlotCount(target)
  if (normalized === desiredChatAgentSupervisorSlots) return normalized
  desiredChatAgentSupervisorSlots = normalized
  chatSupervisorScheduler?.setSupervisorCount(normalized)
  publishChatAgentRuntimeState()
  return normalized
}

// Supervisor slots that could take a waiting chat right now.
//
// A slot counts as available when it holds no renderer yet (the pool has not
// grown into it), or when the renderer it holds is neither mid-request nor
// running a lease. A held Supervisor is not available at any price: taking its
// chat is the cross-chat reload this topology exists to remove.
function chatAgentAvailableSupervisors() {
  const bound = chatgptViews.size
  let available = Math.max(0, desiredChatAgentSupervisorSlots - bound)
  const leased = chatSupervisorLeaseKeys()
  for (const [key, entry] of chatgptViews) {
    if (leased.has(key) || supervisorBindingHeld(key, entry)) continue
    available += 1
  }
  return available
}

function setChatAgentWorkerTarget(target, windowState) {
  const normalized = normalizeWorkerSlotCount(target)
  if (normalized === desiredChatAgentWorkerSlots) return normalized
  desiredChatAgentWorkerSlots = normalized
  chatAgentScheduler?.setWorkerCount(normalized)
  reconcileChatGPTWorkerPool(windowState)
  return normalized
}

async function reconcileChatAgentAutoScale() {
  if (!chatAgentScheduler || chatAgentPolicies.auto_scale !== true) return
  if (chatAgentRateLimitDelayMs() > 0 || chatAgentRuntimeDiagnostics.provider?.paused === true) return
  try {
    const summary = await chatAgentScheduler.queueSummary()
    const queue = chatAgentQueueDiagnostics(summary)
    chatAgentRuntimeDiagnostics = { ...chatAgentRuntimeDiagnostics, queue }
    // Both pools are reconciled on the same tick and from the same reading, but
    // never from the same number: they own disjoint task types, so the shared
    // `due` total describes neither of them.
    const supervisorChanged = reconcileChatAgentSupervisorAutoScale(queue)
    // Worker suspension is intentionally narrower than the provider gate: the
    // Supervisor pool remains operational while Workers stop taking new claims.
    if (workerSuspensionState(chatAgentPolicies).paused) {
      if (supervisorChanged) publishChatAgentRuntimeState()
      return
    }
    const grow = autoScaleTarget({
      enabled: true, due: queue.due_worker, available: chatAgentAvailableWorkers(), current: desiredChatAgentWorkerSlots, maxWorkers: chatAgentPolicies.auto_scale_max_workers,
    })
    if (grow > desiredChatAgentWorkerSlots) {
      console.log(`[chat-agent] auto-scale grow from=${desiredChatAgentWorkerSlots} to=${grow} due=${queue.due_worker}`)
      chatAgentWorkerLastGrowAt = Date.now()
      setChatAgentWorkerTarget(grow)
      publishChatAgentRuntimeState()
      return
    }
    if (Date.now() - chatAgentWorkerLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS) {
      if (supervisorChanged) publishChatAgentRuntimeState()
      return
    }
    const drain = autoScaleDrainTarget({
      enabled: true, due: queue.due_worker, configured: configuredChatAgentWorkerSlots, current: desiredChatAgentWorkerSlots, keepFlowingFloor: chatAgentKeepFlowingFloor(),
    })
    if (drain < desiredChatAgentWorkerSlots) {
      console.log(`[chat-agent] auto-scale drain from=${desiredChatAgentWorkerSlots} to=${drain}`)
      setChatAgentWorkerTarget(drain)
      publishChatAgentRuntimeState()
      return
    }
    if (supervisorChanged) publishChatAgentRuntimeState()
  } catch (error) { console.warn(`[chat-agent] auto-scale poll failed: ${error instanceof Error ? error.message : String(error)}`) }
}

// Auto scale for the Supervisor pool.
//
// Kept separate from the Worker reconciliation because the two pools share only
// the queue they read: a Supervisor serves one conversation for the life of its
// request, so its demand is lanes waiting for a slot, and its ceiling is its own
// policy. Without this the pool could only ever be the number of slots it was
// constructed with, whatever the operator or the backlog asked for.
function reconcileChatAgentSupervisorAutoScale(queue) {
  const available = chatAgentAvailableSupervisors()
  const grow = autoScaleSupervisorTarget({
    enabled: true, dueLanes: queue.due_supervisor_lanes, available,
    current: desiredChatAgentSupervisorSlots, maxSupervisors: chatAgentPolicies.auto_scale_max_supervisors,
  })
  if (grow > desiredChatAgentSupervisorSlots) {
    console.log(`[chat-agent] supervisor auto-scale grow from=${desiredChatAgentSupervisorSlots} to=${grow} lanes=${queue.due_supervisor_lanes}`)
    chatAgentSupervisorLastGrowAt = Date.now()
    setChatAgentSupervisorTarget(grow)
    return true
  }
  if (Date.now() - chatAgentSupervisorLastGrowAt < CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS) return false
  const drain = autoScaleSupervisorDrainTarget({
    enabled: true, dueLanes: queue.due_supervisor_lanes, configured: configuredChatAgentSupervisorSlots,
    current: desiredChatAgentSupervisorSlots, boundSupervisors: chatgptViews.size,
  })
  if (drain < desiredChatAgentSupervisorSlots) {
    console.log(`[chat-agent] supervisor auto-scale drain from=${desiredChatAgentSupervisorSlots} to=${drain}`)
    setChatAgentSupervisorTarget(drain)
    return true
  }
  return false
}

function reconcileChatGPTWorkerPool(windowState) {
  const host = windowState?.window && !windowState.window.isDestroyed()
    ? windowState
    : [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
  if (!host) return
  for (let index = chatGPTWorkerEntries.length; index < desiredChatAgentWorkerSlots; index += 1) createChatGPTWorkerView(`worker-${index + 1}`, host)
  while (chatGPTWorkerEntries.length > desiredChatAgentWorkerSlots) {
    const index = chatGPTWorkerEntries.length
    const runtime = chatAgentWorkerStates.get(index)
    const candidate = chatGPTWorkerEntries[index - 1]
    if (candidate?.interactionWindowId || runtime?.task || runtime?.active !== false) break
    const entry = chatGPTWorkerEntries.pop()
    retireChatGPTWorkerView(entry)
    chatAgentWorkerStates.delete(index)
  }
}

function ensureChatGPTWorkerPool(windowState) {
  reconcileChatGPTWorkerPool(windowState)
}

async function primeChatGPTWorkerPool(windowState) {
  while (!quitting && chatGPTWorkerEntries.length < desiredChatAgentWorkerSlots) {
    const host = windowState?.window && !windowState.window.isDestroyed()
      ? windowState
      : [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
    if (!host) return
    const index = chatGPTWorkerEntries.length
    createChatGPTWorkerView(`worker-${index + 1}`, host)
    if (chatGPTWorkerEntries.length < desiredChatAgentWorkerSlots) await wait(CHAT_AGENT_WORKER_SPAWN_GAP_MS)
  }
}

function assignChatGPTWorker(entry, task) {
  if (!entry || entry.role !== 'worker') throw new Error('Chat-agent worker slot is unavailable')
  const chatId = task?.chat_id || task?.chatId
  if (!chatId) throw new Error('Chat-agent task has no chat id')
  const key = sanitizeChatCacheKey(chatId)
  const lane = chatAgentLane(task)
  if (!lane) throw new Error('Chat-agent task has no resident lane')
  const assignment = chatAgentResidency.beginAssignment(entry.slotId, lane)
  const rawConversation = String(task?.payload?.conversation_url || task?.conversation_url || '').trim()
  const rawID = String(task?.conversation_id || task?.conversationId || '').trim()
  const conversationURL = canonicalChatGPTConversationURL(rawConversation) || (/^[A-Za-z0-9-]{1,128}$/.test(rawID) ? `https://chatgpt.com/c/${rawID}` : '')
  if (entry.ownerKey !== key) {
    clearTimeout(entry.affinitySettleTimer)
    entry.affinity = createChatGPTAffinityTracker()
    entry.conversationRequests.clear()
    entry.staleConversationRequestIds.clear()
    entry.conversationTransportGeneration = 0
    entry.humanAction = undefined
    entry.ownerKey = key
  }
  if (conversationURL) syncChatGPTAffinity(entry.affinity, conversationURL, false)
  touchChatGPTEntry(entry)
  return { key, conversationURL, lane, assignment }
}

function workerEntryForIndex(worker) {
  return chatGPTWorkerEntries[Math.max(0, Number(worker || 1) - 1)]
}

/**
 * Whether this slot is mid-supervision of a response that is still being written.
 *
 * The evidence is the slot's own last settled task: an `AWAIT_RESPONSE` that
 * asked to be retried is, by construction, a supervision that has not concluded.
 * That is exactly the state in which the slot must keep its conversation, and it
 * clears itself the moment the supervision completes, fails, or the slot runs
 * anything else.
 */
function chatAgentSupervisingLiveResponse(worker) {
  const runtime = chatAgentWorkerStates.get(Number(worker) || 0)
  return runtime?.lastTask?.type === 'AWAIT_RESPONSE' && runtime?.lastResult?.status === 'waiting'
}

function workerEntryForAgentID(agentID) {
  const id = String(agentID || '').trim()
  if (!/^worker-[1-9][0-9]?$/.test(id)) throw new Error('Only Worker browser instances can enter interaction mode')
  const entry = chatGPTWorkerEntries.find((candidate) => candidate.slotId === id)
  if (!entry || entry.view.webContents.isDestroyed()) throw new Error('Worker browser instance is not available')
  return entry
}

function hideChatAgentInteractionEntry(entry) {
  if (!entry || entry.role !== 'worker') return false
  const state = desktopWindows.get(entry.interactionWindowId)
  if (state?.activeAgentInteractionId === entry.slotId) state.activeAgentInteractionId = ''
  entry.interactionWindowId = ''
  entry.parkedLayout = true
  try { entry.view.setVisible(false) } catch { /* renderer may already be gone */ }
  if (entry.attached) {
    const ownerState = windowStateForEntry(entry)
    try { ownerState?.window?.contentView?.removeChildView?.(entry.view) } catch { /* already detached */ }
    entry.attached = false
    grantChatGPTLayoutViewport(entry.view)
  }
  return true
}

function hideChatAgentInteractionsForWindow(windowState) {
  let changed = false
  for (const entry of chatGPTWorkerEntries) {
    if (entry.interactionWindowId !== windowState?.id) continue
    changed = hideChatAgentInteractionEntry(entry) || changed
  }
  if (windowState) windowState.activeAgentInteractionId = ''
  if (changed) publishChatAgentRuntimeState()
  return changed
}

function showChatAgentInteraction(agentID, rawBounds, windowState) {
  const entry = workerEntryForAgentID(agentID)
  const bounds = normalizeBounds(rawBounds, windowState?.window?.getContentBounds?.())
  if (!bounds) throw new Error('Worker interaction bounds are invalid')
  const active = String(windowState.activeAgentInteractionId || '')
  if (active && active !== entry.slotId) {
    const previous = chatGPTWorkerEntries.find((candidate) => candidate.slotId === active)
    hideChatAgentInteractionEntry(previous)
  }
  if (entry.interactionWindowId && entry.interactionWindowId !== windowState.id) {
    const previousState = desktopWindows.get(entry.interactionWindowId)
    if (previousState?.activeAgentInteractionId === entry.slotId) previousState.activeAgentInteractionId = ''
  }
  if (entry.ownerWindowId !== windowState.id || !entry.attached) {
    const ownerState = windowStateForEntry(entry)
    if (entry.attached) try { ownerState?.window?.contentView?.removeChildView?.(entry.view) } catch { /* already detached */ }
    windowState.window.contentView.addChildView(entry.view)
    entry.ownerWindowId = windowState.id
    entry.attached = true
  }
  entry.interactionWindowId = windowState.id
  windowState.activeAgentInteractionId = entry.slotId
  entry.view.setBounds(bounds)
  entry.parkedLayout = false
  entry.view.setVisible(true)
  // Real pane bounds on a visible view are a real renderer viewport, so the
  // slot no longer needs the synthetic grant.
  entry.layoutViewportGranted = true
  publishChatAgentRuntimeState()
  return { ok: true, agentId: entry.slotId, bounds }
}

function setChatAgentInteractionBounds(agentID, rawBounds, windowState) {
  const entry = workerEntryForAgentID(agentID)
  if (entry.interactionWindowId !== windowState?.id || windowState.activeAgentInteractionId !== entry.slotId) return { ok: false, agentId: entry.slotId }
  const bounds = normalizeBounds(rawBounds, windowState.window.getContentBounds())
  if (!bounds) throw new Error('Worker interaction bounds are invalid')
  entry.view.setBounds(bounds)
  entry.parkedLayout = false
  return { ok: true, agentId: entry.slotId, bounds }
}

function closeChatAgentInteraction(agentID, windowState) {
  const entry = workerEntryForAgentID(agentID)
  if (entry.interactionWindowId !== windowState?.id) return { ok: true, agentId: entry.slotId, closed: false }
  hideChatAgentInteractionEntry(entry)
  reconcileChatGPTWorkerPool(windowState)
  publishChatAgentRuntimeState()
  return { ok: true, agentId: entry.slotId, closed: true }
}

function reconcileChatAgentWorkerTasks(tasks = []) {
  const prefix = `${chatAgentScheduler?.instanceID || ''}:worker-`
  if (!chatAgentScheduler?.instanceID) return
  const activeByWorker = new Map()
  for (const task of tasks) {
    const status = String(task?.status || '').toUpperCase()
    const owner = String(task?.lease_owner || '')
    if (!['LEASED', 'RUNNING'].includes(status) || !owner.startsWith(prefix)) continue
    const worker = Number(owner.slice(prefix.length))
    if (!Number.isInteger(worker) || worker < 1 || worker > HARD_MAX_WORKER_SLOTS) continue
    const current = activeByWorker.get(worker)
    if (!current || String(task?.updated_at || '') > String(current?.updated_at || '')) activeByWorker.set(worker, task)
  }
  for (let worker = 1; worker <= chatGPTWorkerEntries.length; worker += 1) {
    const prior = chatAgentWorkerStates.get(worker) || { active: worker <= desiredChatAgentWorkerSlots, task: undefined, lastTask: undefined, lastClaimAt: '', error: '' }
    const task = activeByWorker.get(worker)
    if (task) {
      chatAgentWorkerStates.set(worker, { ...prior, active: true, task, lastTask: task, lastClaimAt: String(task.updated_at || prior.lastClaimAt || ''), error: '' })
    } else if (prior.task) {
      chatAgentWorkerStates.set(worker, { ...prior, task: undefined })
    }
  }
}

function publicChatAgentTask(task) {
  if (!task) return undefined
  return {
    task_id: String(task.task_id || ''), type: String(task.type || ''), chat_id: String(task.chat_id || ''),
    // The agents panel is global because the pool is. Without the owning
    // project it reports "no Workers available" beside cards that all look
    // idle to whoever is reading it from the project that is *not* running.
    project_id: String(task.project_id || ''),
    request_id: String(task.request_id || ''), root_request_id: String(task.root_request_id || ''),
    conversation_id: String(task.conversation_id || ''), status: String(task.status || ''),
    attempt: Math.max(0, Number(task.attempt || 0)), max_attempts: Math.max(0, Number(task.max_attempts || 0)),
    assigned_worker: String(task.assigned_worker || ''), keep_flowing: task.keep_flowing === true,
    lease_expires_at: String(task.lease_expires_at || ''), not_before: String(task.not_before || ''),
    last_error: String(task.last_error || ''), created_at: String(task.created_at || ''), updated_at: String(task.updated_at || ''),
  }
}

// Which project an agent slot is currently working for.
//
// The lease is the authority while it is held. Between observations there is no
// lease and the slot is still engaged, so the last task answers instead — but
// only while the engagement is provably still live (a held Supervisor binding, an
// active Keep flowing sponsorship). Reading a settled last task would leave a
// genuinely free slot permanently attributed to a project it finished with.
function chatAgentAgentProject(task, lastTask, engaged) {
  const current = String(task?.project_id || '').trim()
  if (current) return current
  return engaged ? String(lastTask?.project_id || '').trim() : ''
}

// Projects the backend's queue aggregate onto the runtime diagnostics shape.
//
// The numbers that matter operationally are `due` and `scheduled`. A task
// deferred behind its own not_before — every bundle-retention cleanup is
// deferred for days by design — is waiting on a clock, not on a worker, so
// counting it as pending backlog makes a completely idle queue read as a
// stuck one. `oldest_due_created_at` ages only claimable work for the same
// reason: a task that is early is not late.
function chatAgentQueueDiagnostics(summary = {}) {
  const counts = {}
  for (const [status, count] of Object.entries(summary?.counts || {})) {
    counts[String(status).toUpperCase()] = Math.max(0, Number(count) || 0)
  }
  return {
    queued: Math.max(0, Number(summary?.queued) || 0),
    counts,
    due: Math.max(0, Number(summary?.due) || 0),
    // Role-partitioned demand. Each pool is sized from its own half: the shared
    // total would grow the Supervisor pool because a library cleanup is queued,
    // and grow the Worker pool because a conversation is being supervised.
    due_supervisor_lanes: Math.max(0, Number(summary?.due_supervisor_lanes) || 0),
    due_worker: Math.max(0, Number(summary?.due_worker) || 0),
    scheduled: Math.max(0, Number(summary?.scheduled) || 0),
    guarded: Math.max(0, Number(summary?.guarded) || 0),
    blocked: Math.max(0, Number(summary?.blocked) || 0),
    oldest_due_created_at: String(summary?.oldest_due_created_at || ''),
    next_not_before: String(summary?.next_not_before || ''),
  }
}

async function refreshChatAgentRuntimeState() {
  const now = new Date().toISOString()
  if (!chatAgentScheduler) {
    chatAgentRuntimeDiagnostics = {
      ...chatAgentRuntimeDiagnostics,
      scheduler: { running: false, backend_reachable: false, last_refresh_at: now, last_error: 'Scheduler ainda não iniciado' },
    }
    return chatAgentRuntimeState()
  }
  try {
    const [summary, leased, running, provider] = await Promise.all([
      chatAgentScheduler.queueSummary(),
      chatAgentScheduler.list({ status: 'LEASED', limit: 50 }),
      chatAgentScheduler.list({ status: 'RUNNING', limit: 50 }),
      chatAgentScheduler.providerState(),
    ])
    reconcileChatAgentWorkerTasks([...(leased?.tasks || []), ...(running?.tasks || [])])
    chatAgentRuntimeDiagnostics = {
      scheduler: { running: Boolean(chatAgentScheduler.running), backend_reachable: true, last_refresh_at: now, last_error: '' },
      queue: chatAgentQueueDiagnostics(summary),
      provider: {
        provider: String(provider?.provider || 'chatgpt'), paused: provider?.paused === true,
        paused_until: String(provider?.paused_until || ''), reason: String(provider?.reason || ''),
        rate_limit_level: Math.max(0, Number(provider?.rate_limit_level || 0)), last_rate_limit_at: String(provider?.last_rate_limit_at || ''),
        last_rate_limit_source: String(provider?.last_rate_limit_source || ''), last_valid_bundle_at: String(provider?.last_valid_bundle_at || ''),
        average_processing_ms: Math.max(0, Number(provider?.average_processing_ms || 0)), valid_sample_count: Math.max(0, Number(provider?.valid_sample_count || 0)),
        initial_wait_ms: Math.max(60_000, Number(provider?.initial_wait_ms || 60_000)), updated_at: String(provider?.updated_at || ''),
      },
    }
    // The suspension is durable backend state; the local clock is only a
    // mirror, and it is reset by every Desktop restart. Without adopting the
    // persisted deadline here, restarting during a five-minute gate resumed the
    // whole pool immediately — which is exactly how a restart-heavy workflow
    // walks straight back into the block it was waiting out.
    //
    // The mirror has to follow the durable state in BOTH directions. Only ever
    // raising it means an explicit resume — a human lifting the pause, or the
    // backend expiring it — leaves the pool skipping every claim until a local
    // deadline nobody can see finally passes.
    const pausedUntil = Date.parse(String(provider?.paused_until || ''))
    if (provider?.paused === true && Number.isFinite(pausedUntil)) {
      chatGPTRateLimitUntil = Math.max(chatGPTRateLimitUntil, pausedUntil)
    } else if (provider?.paused === false) {
      // Only a reading that already knows about the newest local gate may clear
      // the mirror. A refresh in flight while a 429 is being persisted still
      // reports `paused: false`; obeying it would release the whole pool into
      // the burst the gate was just raised against.
      const observedAt = Date.parse(String(provider?.updated_at || '')) || 0
      if (!chatGPTRateLimitAppliedAt || observedAt >= chatGPTRateLimitAppliedAt) {
        chatGPTRateLimitUntil = 0
        chatGPTRateLimitKind = ''
        chatGPTRateLimitAppliedAt = 0
      }
    }
  } catch (error) {
    chatAgentRuntimeDiagnostics = {
      ...chatAgentRuntimeDiagnostics,
      scheduler: {
        running: Boolean(chatAgentScheduler.running), backend_reachable: false, last_refresh_at: now,
        last_error: String(error?.message || error || 'Backend do scheduler indisponível'),
      },
    }
  }
  return chatAgentRuntimeState()
}

function unavailableAgentBrowser() {
  return { available: false, web_contents_id: 0, os_process_id: 0, url: '', title: '', loading: false }
}

function publicAgentBrowser(entry) {
  // WebContents can disappear between isDestroyed() and any following getter
  // while a Supervisor or Worker is being retired. Runtime state is a
  // diagnostic snapshot, so one closing browser must not reject the whole
  // wharness:agents:state IPC request.
  try {
    const wc = entry?.view?.webContents
    if (!wc || wc.isDestroyed()) return unavailableAgentBrowser()
    const currentURL = wc.getURL() || ''
    let osProcessID = 0
    try { osProcessID = Math.max(0, Number(wc.getOSProcessId()) || 0) } catch {}
    return {
      available: true,
      web_contents_id: wc.id,
      os_process_id: osProcessID,
      url: currentURL ? sanitizeDiagnosticURL(currentURL) : '',
      title: wc.getTitle() || '',
      loading: Boolean(entry.loading),
    }
  } catch {
    return unavailableAgentBrowser()
  }
}

function chatAgentRuntimeMemory(agents) {
  try { return chatAgentMemorySnapshot(agents, app.getAppMetrics()) } catch { return chatAgentMemorySnapshot(agents, []) }
}

function chatAgentRuntimeState() {
  const workerPause = workerSuspensionState(chatAgentPolicies)
  const supervisors = Array.from({ length: desiredChatAgentSupervisorSlots }, (_, offset) => {
    const slot = offset + 1
    const id = chatSupervisorSlotID(slot)
    const key = supervisorKeyForSlot(id)
    const entry = key ? chatgptViews.get(key) : undefined
    const active = Boolean(entry && [...desktopWindows.values()].some((state) => state.activeChatGPTKey === entry.ownerKey))
    const runtime = chatSupervisorStates.get(slot) || {}
    // Report the lease whose chat this slot is actually bound to. The execution
    // loops and the renderer bindings are both capped at desiredChatAgentSupervisorSlots
    // but are assigned independently, so pairing them by index would attribute one slot's
    // task to another slot's chat.
    const own = key && sanitizeOptionalChatCacheKey(runtime.task?.chat_id) === key ? runtime : {}
    const hold = key ? supervisorBindingHold(key, entry) : ''
    return {
      id, label: `Supervisor ${slot}`, role: 'supervisor',
      // A held binding is occupancy, not idleness. Supervision spends almost
      // all of its life between observations, with the lease handed back, so
      // deriving the status from the lease alone painted a Supervisor that is
      // mid-request as available on every cycle — and alternated its card
      // between busy and free for the whole length of a request.
      status: own.task ? (String(own.task.status || '').toUpperCase() === 'RUNNING' ? 'running' : 'claimed')
        : runtime.error ? 'error'
        : entry?.transportPreparationCount ? 'running'
        : entry?.loading ? 'loading'
        : hold ? 'claimed'
        : entry ? 'idle' : 'stopped',
      draining: false, loop_active: runtime.active !== false, interacting: active,
      // What this slot is engaged with right now, whether or not it happens to
      // hold the lease at this instant. Rendering the lease alone made the
      // task row appear and disappear on the observation cycle.
      occupied: Boolean(own.task || hold),
      chat_id: String(key || ''), task: publicChatAgentTask(own.task),
      // The owning project of whatever this slot is engaged with. A Supervisor
      // between observations holds no lease, so reading the project from the
      // lease alone left a busy slot looking unattributed — and a panel that
      // cannot name the project cannot offer to bring it into focus.
      project_id: chatAgentAgentProject(own.task, own.lastTask, Boolean(hold)),
      last_task: publicChatAgentTask(own.lastTask), last_claim_at: String(runtime.lastClaimAt || ''),
      binding_hold: hold, error: String(runtime.error || ''), browser: publicAgentBrowser(entry),
    }
  })
  const workers = chatGPTWorkerEntries.map((entry, offset) => {
    const worker = offset + 1
    const runtime = chatAgentWorkerStates.get(worker) || {}
    return {
      id: entry.slotId || `worker-${worker}`, label: `Worker ${worker}`, role: 'worker',
      status: runtime.task ? (String(runtime.task.status || '').toUpperCase() === 'RUNNING' ? 'running' : 'claimed') : runtime.error ? 'error' : entry.loading ? 'loading' : runtime.active === false ? 'stopped' : chatAgentKeepFlowingActive(worker) ? 'claimed' : 'idle',
      draining: worker > desiredChatAgentWorkerSlots, loop_active: runtime.active !== false, interacting: Boolean(entry.interactionWindowId),
      occupied: Boolean(runtime.task || chatAgentKeepFlowingActive(worker)),
      chat_id: String(runtime.task?.chat_id || runtime.lastTask?.chat_id || entry.ownerKey || ''), task: publicChatAgentTask(runtime.task),
      project_id: chatAgentAgentProject(runtime.task, runtime.lastTask, chatAgentKeepFlowingActive(worker)),
      last_task: publicChatAgentTask(runtime.lastTask), last_claim_at: String(runtime.lastClaimAt || ''),
      error: String(runtime.error || ''), browser: publicAgentBrowser(entry), residency: chatAgentResidency.snapshot(entry.slotId),
      keep_flowing: chatAgentKeepFlowingConfigured(worker), keep_flowing_active: chatAgentKeepFlowingActive(worker), suspended: workerPause.paused,
    }
  })
  const agents = [...supervisors, ...workers]
  const memory = chatAgentRuntimeMemory(agents)
  return {
    instance_id: String(chatAgentScheduler?.instanceID || ''),
    desired_supervisors: desiredChatAgentSupervisorSlots,
    configured_supervisors: configuredChatAgentSupervisorSlots,
    desired_workers: desiredChatAgentWorkerSlots,
    configured_workers: configuredChatAgentWorkerSlots,
    policies: {
      ...chatAgentPolicies,
      auto_scaled_supervisors: Math.max(0, desiredChatAgentSupervisorSlots - configuredChatAgentSupervisorSlots),
      auto_scaled_workers: Math.max(0, desiredChatAgentWorkerSlots - configuredChatAgentWorkerSlots),
    },
    limits: {
      min_supervisors: MIN_SUPERVISOR_SLOTS,
      max_supervisors: HARD_MAX_SUPERVISOR_SLOTS,
      min_workers: MIN_WORKER_SLOTS,
      max_workers: HARD_MAX_WORKER_SLOTS,
    },
    scheduler: chatAgentRuntimeDiagnostics.scheduler,
    queue: chatAgentRuntimeDiagnostics.queue,
    provider: chatAgentRuntimeDiagnostics.provider,
    worker_pause: workerPause,
    memory: memory.totals,
    agents: agents.map((agent) => ({ ...agent, memory: memory.by_agent[agent.id] })),
  }
}

let chatAgentRuntimeStateBroadcastTimer
let chatAgentRuntimeStateBroadcastPending = false
let chatAgentRuntimeStateLatest

// Called from 26 sites, several of them WebContents event handlers
// (did-navigate, did-start-loading...) that fire once per view per
// occurrence - with up to 9 ChatGPT views active, a busy backlog drain can
// trigger many of these within the same second. Computing the (bounded,
// slot-count-sized) state stays synchronous so callers that `return` it as
// their IPC response still get the current value; only the broadcast to
// renderer windows is coalesced, so a burst produces at most one send per
// window per CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS window instead of one per
// event - always eventually delivering the latest state (trailing edge).
function publishChatAgentRuntimeState() {
  const state = chatAgentRuntimeState()
  chatAgentRuntimeStateLatest = state
  if (!chatAgentRuntimeStateBroadcastTimer) {
    for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', state)
    chatAgentRuntimeStateBroadcastTimer = setTimeout(() => {
      chatAgentRuntimeStateBroadcastTimer = undefined
      if (!chatAgentRuntimeStateBroadcastPending) return
      chatAgentRuntimeStateBroadcastPending = false
      for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', chatAgentRuntimeStateLatest)
    }, CHAT_AGENT_RUNTIME_STATE_BROADCAST_MS)
  } else {
    chatAgentRuntimeStateBroadcastPending = true
  }
  return state
}

// Captures an agent's page even when nothing is painting it.
//
// `capturePage()` asks Chromium's Viz compositor for the view's last presented
// frame. A view that is not visible never presents one, so Viz answers
// `UnknownVizError` - "Não foi possível capturar o navegador" - and that is
// every hidden Worker and every non-painted Supervisor, i.e. exactly the
// agents an operator asks to see when something looks stuck. A granted layout
// viewport does not help: it gives the renderer a size, not a presented frame.
//
// Showing the view to force a frame is not an option: a parked surface carries
// layout-only bounds at the window origin, so showing it would paint ChatGPT
// over the operator's workspace - the invariant `chatGPTSurfaceShouldBeVisible`
// exists to prevent exactly that. `Page.captureScreenshot` over the
// WebContents' own debugger asks the *renderer* to rasterize instead of
// reading the compositor's presented frame, so it needs no visibility and no
// bounds change. The debugger is attached only for the capture and detached
// immediately, and it stays entirely in the main process - nothing about it
// reaches the renderer or widens what IPC exposes.
async function captureChatGPTAgentPage(wc) {
  try { return (await wc.capturePage()).toDataURL() } catch { /* not presenting a frame; rasterize instead */ }
  const attachedHere = !wc.debugger.isAttached()
  if (attachedHere) wc.debugger.attach('1.3')
  try {
    await wc.debugger.sendCommand('Page.enable')
    const shot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    if (!shot?.data) throw new Error('ChatGPT renderer returned no screenshot data')
    return `data:image/png;base64,${shot.data}`
  } finally {
    if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
  }
}

async function chatAgentBrowserSnapshot(agentID) {
  const id = String(agentID || '').trim()
  const entry = id === 'supervisor' ? supervisorEntry() : /^supervisor-[1-9][0-9]?$/.test(id) ? supervisorEntryForSlot(id) : chatGPTWorkerEntries.find((candidate) => candidate.slotId === id)
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) throw new Error('Agent browser instance is not available')
  const layoutKey = entry.ownerKey || (entry.role === 'supervisor' ? supervisorKey(windowStateForEntry(entry)) : entry.slotId || id)
  ensureChatGPTLayoutViewport(layoutKey, entry)
  const dataUrl = await captureChatGPTAgentPage(wc)
  return { agentId: id, dataUrl, capturedAt: new Date().toISOString() }
}

function retireChatGPTSupervisorSurface(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = chatgptViews.get(key)
  if (!entry) return false
  clearTimeout(entry.authProbeTimer)
  clearTimeout(entry.affinitySettleTimer)
  cancelExternalAuthentication(key)
  chatgptViews.delete(key)
  const state = windowStateForEntry(entry)
  if (state?.activeChatGPTKey === key) {
    state.activeChatGPTKey = ''
    state.chatgptVisible = false
  }
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  console.log(`[chatgpt-supervisor] retired key=${key}`)
  return true
}

function supervisorKey(windowState) {
  const active = String(windowState?.activeChatGPTKey || '')
  if (active && chatgptViews.has(active)) return active
  for (const state of desktopWindows.values()) {
    const key = String(state.activeChatGPTKey || '')
    if (key && chatgptViews.has(key)) return key
  }
  return [...chatgptViews.keys()][0] || ''
}

function supervisorEntry(windowState) {
  const key = supervisorKey(windowState)
  return key ? chatgptViews.get(key) : undefined
}

function supervisorSlotID() {
  const used = new Set([...chatgptViews.values()].map((entry) => String(entry.slotId || '')))
  for (let index = 1; index <= desiredChatAgentSupervisorSlots; index += 1) {
    const id = `supervisor-${index}`
    if (!used.has(id)) return id
  }
  return 'supervisor-1'
}

// Which bound Supervisor may release its chat so this chat can have a slot.
//
// Only a Supervisor with nothing left to finish is eligible, and it is released
// only because another chat is waiting — never on a timer. A held Supervisor is
// mid-request: retiring its renderer would force the conversation to be loaded
// again, and reloading conversations across a small pool is what produced the
// sustained rate limiting this binding exists to stop.
function reusableSupervisor(cacheKey, windowState) {
  const key = sanitizeChatCacheKey(cacheKey)
  const active = String(windowState?.activeChatGPTKey || '')
  const candidates = [...chatgptViews.entries()]
    .filter(([candidateKey, entry]) => candidateKey !== key && !supervisorBindingHeld(candidateKey, entry))
    .sort(([leftKey, left], [rightKey, right]) => {
      const leftActive = leftKey === active ? 1 : 0
      const rightActive = rightKey === active ? 1 : 0
      if (leftActive !== rightActive) return leftActive - rightActive
      return Number(left.lastUsed || 0) - Number(right.lastUsed || 0)
    })
  return candidates[0]
}

function ensureChatGPTView(cacheKey, windowState) {
  const key = sanitizeChatCacheKey(cacheKey)
  let entry = chatgptViews.get(key)
  if (!entry) {
    const resolved = windowState || [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
    if (chatgptViews.size >= desiredChatAgentSupervisorSlots) {
      const reusable = reusableSupervisor(key, resolved)
      if (!reusable) throw new Error('Todos os slots de Supervisor estão vinculados a pedidos em curso')
      const preserveVisibleIntent = resolved?.chatgptVisible === true
      retireChatGPTSupervisorSurface(reusable[0])
      if (preserveVisibleIntent && resolved) resolved.chatgptVisible = true
    }
    entry = createChatGPTView(key, resolved)
    entry.role = 'supervisor'
    entry.slotId = supervisorSlotID()
  }
  if (windowState && entry.ownerWindowId !== windowState.id) {
    const previousState = windowStateForEntry(entry)
    try { previousState?.window?.contentView?.removeChildView?.(entry.view) } catch { /* already detached */ }
    windowState.window.contentView.addChildView(entry.view)
    if (previousState?.activeChatGPTKey === key) { previousState.activeChatGPTKey = ''; previousState.chatgptVisible = false }
    entry.ownerWindowId = windowState.id
  }
  requireOwnedChatGPTEntry(key, entry)
  touchChatGPTEntry(entry)
  return { key, entry }
}

// One Supervisor slot per chat, up to desiredChatAgentSupervisorSlots chats resident at once.
// Exactly one is visible; the rest stay bound to their own conversation so that
// switching chats is a visibility change rather than a provider navigation. The
// bounded autonomous Worker pool lives outside chatgptViews.

// Retire only as many unheld Supervisors as the cap actually requires, oldest
// first. A held Supervisor is never retired here: if every slot is busy the
// newest chat waits for one to finish rather than interrupting a live request.
function evictIdleChatGPTViews() {
  const excess = chatgptViews.size - desiredChatAgentSupervisorSlots
  if (excess <= 0) return 0
  const releasable = [...chatgptViews.entries()]
    .filter(([key, entry]) => !supervisorBindingHeld(key, entry) && !chatGPTEntryIsActiveVisible(key, entry))
    .sort(([, left], [, right]) => Number(left.lastUsed || 0) - Number(right.lastUsed || 0))
  let released = 0
  for (const [key] of releasable) {
    if (released >= excess) break
    if (retireChatGPTSupervisorSurface(key)) released += 1
  }
  return released
}

// A parked view still carries the full-size layout bounds account automation
// gave it. Showing it before the renderer reports the real pane geometry would
// cover the whole Wharnex window for a frame, which reads exactly like the
// project closing and reopening. Every path that makes an owned surface visible
// shares this predicate, so a parked view cannot slip through one of them.
function chatGPTSurfaceShouldBeVisible(entry, ownerState) {
  if (!entry || !ownerState) return false
  const parked = entry.parkedLayout === true && !ownerState.chatgptBounds
  return Boolean(ownerState.chatgptVisible) && !entry.externalAuthProvider && !parked
}

function activateChatGPTView(cacheKey, bounds, windowState) {
  const resolved = windowState || windowStateForEntry(chatgptViews.get(sanitizeChatCacheKey(cacheKey)))
  const { key, entry } = ensureChatGPTView(cacheKey, resolved)
  const ownerState = windowStateForEntry(entry)
  if (!ownerState) throw new Error('ChatGPT owner window is unavailable')
  const previousKey = ownerState.activeChatGPTKey
  const previous = activeChatGPTEntry(ownerState)
  if (previous && previous !== entry) { previous.view.setVisible(false); reconcileChatGPTThrottle(previousKey, previous) }
  ownerState.activeChatGPTKey = key
  if (bounds) setChatGPTBounds(bounds, ownerState)
  else if (ownerState.chatgptBounds) entry.view.setBounds(ownerState.chatgptBounds)
  entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, ownerState))
  reconcileChatGPTThrottle(key, entry)
  touchChatGPTEntry(entry)
  // Bound resident surfaces right after the newest one is established, so the
  // cap is enforced at the only moment the count can grow.
  evictIdleChatGPTViews(ownerState)
  publishChatGPTState(key)
  return entry
}

function clearDeferredSupervisorNavigation() {
  const pending = deferredSupervisorNavigation
  deferredSupervisorNavigation = undefined
  clearTimeout(deferredSupervisorNavigationTimer)
  deferredSupervisorNavigationTimer = undefined
  if (pending?.windowState) pending.windowState.desiredVisibleChatGPTKey = ''
}

function scheduleDeferredSupervisorNavigation() {
  if (!deferredSupervisorNavigation || deferredSupervisorNavigationTimer) return
  deferredSupervisorNavigationTimer = setTimeout(() => {
    deferredSupervisorNavigationTimer = undefined
    void applyDeferredSupervisorNavigation()
  }, DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS)
}

function setDeferredSupervisorNavigation(cacheKey, windowState, request = {}, current = supervisorEntry(windowState)) {
  const key = sanitizeChatCacheKey(cacheKey)
  clearDeferredSupervisorNavigation()
  deferredSupervisorNavigation = {
    key, windowState, bounds: request?.bounds, url: String(request?.url || ''),
    resetToHomeIfConversation: request?.resetToHomeIfConversation === true, visible: request?.visible !== false && windowState?.chatgptVisible !== false,
  }
  if (windowState) windowState.desiredVisibleChatGPTKey = key
  if (current && !current.view.webContents.isDestroyed()) {
    current.view.setVisible(false)
    reconcileChatGPTThrottle(chatGPTKeyForEntry(current), current)
  }
  if (windowState) sendToWindowState(windowState, 'wharness:chatgpt:state', currentChatGPTState(key, windowState))
  scheduleDeferredSupervisorNavigation()
}

function differentSupervisorTransport(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  return [...chatgptViews.entries()].find(([candidateKey, entry]) => (
    candidateKey !== key && Number(entry.transportPreparationCount || 0) > 0
  ))
}

function deferSupervisorNavigationIfBusy(cacheKey, windowState, request = {}) {
  const key = sanitizeChatCacheKey(cacheKey)
  // Every ChatGPT WebContents uses the authenticated account partition. While
  // one Supervisor is changing its composer, exposing a different Supervisor
  // can therefore surface the provider's shared/cross-tab draft state in the
  // newly selected chat even though the physical write still targets the
  // correct WebContents. Keep the local chat switch immediate, but defer the
  // remote surface until the captured write transaction has completed.
  const activeTransport = differentSupervisorTransport(key)
  if (activeTransport) {
    const current = supervisorEntry(windowState)
    setDeferredSupervisorNavigation(key, windowState, request, current)
    console.log(`[chatgpt-supervisor] deferred-switch from=${activeTransport[0]} to=${key} request=${activeTransport[1].transportRequestId || '-'}`)
    return true
  }
  if (chatgptViews.has(key) || chatgptViews.size < desiredChatAgentSupervisorSlots || reusableSupervisor(key, windowState)) {
    clearDeferredSupervisorNavigation()
    return false
  }
  const currentKey = supervisorKey(windowState)
  const current = currentKey ? chatgptViews.get(currentKey) : undefined
  setDeferredSupervisorNavigation(key, windowState, request, current)
  console.log(`[chatgpt-supervisor] deferred-switch from=${currentKey || '-'} to=${key} request=${current?.transportRequestId || '-'}`)
  return true
}

async function applyDeferredSupervisorNavigation() {
  const pending = deferredSupervisorNavigation
  if (!pending) return
  const state = pending.windowState
  if (!state?.window || state.window.isDestroyed()) {
    clearDeferredSupervisorNavigation()
    return
  }
  if (differentSupervisorTransport(pending.key)) {
    scheduleDeferredSupervisorNavigation()
    return
  }
  if (!chatgptViews.has(pending.key) && chatgptViews.size >= desiredChatAgentSupervisorSlots && !reusableSupervisor(pending.key, state)) {
    scheduleDeferredSupervisorNavigation()
    return
  }
  clearDeferredSupervisorNavigation()
  state.chatgptVisible = pending.visible
  const entry = activateChatGPTView(pending.key, pending.bounds, state)
  const target = pending.url ? requireTrustedChatGPTURL(pending.url) : CHATGPT_URL
  const currentURL = entry.view.webContents.getURL()
  if (!sameConversationURL(currentURL, target) && currentURL !== target) {
    await loadOwnedChatGPTURL(pending.key, entry, target, 'deferred-supervisor-switch')
  }
  if (state.chatgptVisible) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, state))
  void flushQueuedChatGPTComments()
}

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

async function fetchContextZip(sessionId, signal) {
  const id = sanitizeSessionId(sessionId)
  const response = await fetch(contextBundleURL(BACKEND_URL, id), { redirect: 'error', signal })
  if (!response.ok) throw new Error(`Context bundle HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Backend did not return a ZIP bundle')
  const mapsURL = new URL(`/api/sessions/${encodeURIComponent(id)}/context/maps`, BACKEND_URL)
  const mapsResponse = await fetch(mapsURL, { redirect: 'error', signal })
  const maps = await mapsResponse.json().catch(() => ({}))
  if (!mapsResponse.ok || maps?.protocol !== 'harness.context-map/v1' || !Array.isArray(maps?.files)) {
    throw new Error(maps?.error?.message || `Context maps HTTP ${mapsResponse.status}`)
  }
  return { id, bytes, maps: maps.files }
}

async function fetchRequestGitContext(sessionId, signal) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/git/context`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error', signal })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.protocol !== 'harness.git-context/v1') throw new Error(body?.error?.message || `Git context HTTP ${response.status}`)
  return body
}

async function fetchRequestKnowledge(sessionId, requestId, signal) {
  const id = sanitizeSessionId(sessionId)
  const rid = String(requestId || '').trim()
  if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(rid)) throw new Error('Invalid request id for project knowledge snapshot')
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/requests/${encodeURIComponent(rid)}/knowledge`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error', signal })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body?.knowledge) throw new Error(body?.error?.message || `Request knowledge HTTP ${response.status}`)
  return body.knowledge
}

async function fetchRequestContinuation(sessionId, requestId, signal) {
  const id = sanitizeSessionId(sessionId)
  const rid = String(requestId || '').trim()
  if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(rid)) throw new Error('Invalid request id for continuation artifacts')
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/requests/${encodeURIComponent(rid)}/continuation`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error', signal })
  const body = await response.json().catch(() => ({}))
  // The attempt ledger and divergence report exist to make the NEXT round
  // cheaper; failing to fetch them must never block the request they travel
  // with. The prompt already carries both sections in full.
  if (!response.ok || !Array.isArray(body?.files)) return []
  return body.files
}

async function persistChatArtifact(sessionId, requestId, direction, kind, filename, contentType, bytes, signal) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/artifacts`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ request_id: String(requestId || '').trim(), direction, kind, filename, content_type: contentType || 'application/octet-stream', content_base64: Buffer.from(bytes).toString('base64') }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const code = String(body?.error?.code || '').trim()
    const detail = String(body?.error?.message || `Artifact persistence HTTP ${response.status}`)
    throw new Error(code ? `${code}: ${detail}` : detail)
  }
  return response.json()
}

async function publishRemoteChatInput(sessionId, requestId, prompt, bootstrapText, includeContext, attachments, artifacts, projectFiles = [], tunnelInstanceIds = [], requestMetadata = {}, signal) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/remote-input`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(remoteInputPayload(requestId, prompt, bootstrapText, includeContext, attachments, artifacts, projectFiles, tunnelInstanceIds, requestMetadata)),
  })
  const result = await response.json().catch(() => ({}))
  return parseRemoteInputResponse(response.status, result)
}

function normalizeTunnelInstanceIDs(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 16)
}

async function requireAutoSession(sessionId, signal) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error', signal })
  if (!response.ok) throw new Error(`Session lookup HTTP ${response.status}`)
  const sessionState = await response.json()
  if (sessionState?.automation_mode !== 'auto') throw new Error('Automatic ChatGPT submission requires project Auto mode')
}

function decodeChatAttachmentSet(values) {
  if (!Array.isArray(values) || values.length > MAX_CHAT_ATTACHMENTS) throw new Error(`At most ${MAX_CHAT_ATTACHMENTS} chat attachments are allowed`)
  const decoded = values.map((value) => decodeUserAttachment(value, MAX_CHAT_ATTACHMENT_BYTES))
  const names = new Set()
  let total = 0
  for (const attachment of decoded) {
    const portableName = attachment.name.toLocaleLowerCase('en-US')
    if (names.has(portableName)) throw new Error(`Duplicate attachment filename: ${attachment.name}`)
    names.add(portableName)
    total += attachment.bytes.byteLength
  }
  if (total > MAX_CHAT_ATTACHMENTS_BYTES) throw new Error('Chat attachments exceed the 100 MiB total limit')
  return { decoded, total }
}

function decodeChatArtifactSet(values) {
  if (!Array.isArray(values) || values.length > MAX_CHAT_ARTIFACTS) throw new Error(`At most ${MAX_CHAT_ARTIFACTS} Wharnex artifacts are allowed`)
  const decoded = values.map((value) => decodeUserAttachment(value, MAX_CHAT_ARTIFACT_BYTES))
  const names = new Set()
  let total = 0
  for (const artifact of decoded) {
    const portableName = artifact.name.toLocaleLowerCase('en-US')
    if (names.has(portableName)) throw new Error(`Duplicate Wharnex artifact filename: ${artifact.name}`)
    names.add(portableName)
    total += artifact.bytes.byteLength
  }
  if (total > MAX_CHAT_ARTIFACTS_BYTES) throw new Error('Wharnex artifacts exceed the 6 MiB total limit')
  return { decoded, total }
}

async function createPersistentAttachmentPreview(sourcePath, targetPath, mime, sourceBytes) {
  const safeRaster = SAFE_ATTACHMENT_IMAGE_MIMES.has(String(mime || '').toLowerCase()) && Number(sourceBytes || 0) <= MAX_ATTACHMENT_THUMBNAIL_SOURCE_BYTES
  let image = safeRaster ? nativeImage.createFromPath(sourcePath) : nativeImage.createEmpty()
  let kind = 'thumbnail'
  if (image.isEmpty()) {
    image = await app.getFileIcon(sourcePath, { size: 'large' })
    kind = 'icon'
  }
  if (image.isEmpty()) return 'none'
  const size = image.getSize()
  const scale = Math.min(1, 180 / Math.max(1, size.width), 120 / Math.max(1, size.height))
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
  await writeFile(targetPath, image.toPNG(), { mode: 0o600 })
  return kind
}

function chatAttachmentRoot() {
  return path.join(app.getPath('userData'), 'chat-attachments-v1')
}

async function materializeChatInput(cacheKey, sessionId, requestId, values, artifactValues, promptText, includeContext, projectFiles = [], liveTunnels = [], requestMetadata = {}, signal) {
  throwIfChatGPTTransportAborted(signal)
  const { decoded } = decodeChatAttachmentSet(values)
  const artifacts = decodeChatArtifactSet(artifactValues)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', cacheKey)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const knowledge = await fetchRequestKnowledge(sessionId, requestId, signal)
  throwIfChatGPTTransportAborted(signal)
  const gitContext = await fetchRequestGitContext(sessionId, signal)
  const continuation = await fetchRequestContinuation(sessionId, requestId, signal)
  // A derived request must be self-contained even when the linked ChatGPT
  // conversation forgot or truncated an earlier snapshot. The delta remains
  // useful for focus, while the current full context is authoritative.
  const context = includeContext || continuation.length ? await fetchContextZip(sessionId, signal) : undefined
  const archiveName = chatInputArchiveFilename(cacheKey, requestId)
  const archivePath = path.join(dir, archiveName)
  const archive = await writeChatInputArchive(archivePath, {
    requestId,
    requestMetadata,
    prompt: promptText,
    context,
    knowledge,
    gitContext,
    continuation,
    attachments: decoded,
    artifacts: artifacts.decoded,
    projectFiles,
    liveTunnels,
    signal,
  })
  throwIfChatGPTTransportAborted(signal)
  await persistChatArtifact(sessionId, requestId, 'input', 'bundle', archiveName, 'application/zip', await readFile(archivePath), signal)
  if (context) await persistChatArtifact(sessionId, requestId, 'input', 'context', `context-${requestId}.zip`, 'application/zip', context.bytes, signal)
  for (const attachment of decoded) await persistChatArtifact(sessionId, requestId, 'input', 'attachment', attachment.name, attachment.mime, attachment.bytes, signal)
  for (const artifact of artifacts.decoded) await persistChatArtifact(sessionId, requestId, 'input', 'system-artifact', artifact.name, artifact.mime, artifact.bytes, signal)
  return { archivePath, archiveName, userAttachmentCount: decoded.length, artifactCount: artifacts.decoded.length, archiveEntryCount: archive.fileCount, bytes: archive.bytes, requestMetadata: archive.requestMetadata }
}

async function materializeProtocolChatInput(cacheKey, sessionId, requestId, promptText, values = [], liveTunnels = [], requestMetadata = {}, signal) {
  throwIfChatGPTTransportAborted(signal)
  const { decoded } = decodeChatAttachmentSet(values)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-protocol', cacheKey, `${Date.now()}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const archiveName = chatInputArchiveFilename(cacheKey, requestId)
  const archivePath = path.join(dir, archiveName)
  const context = await fetchContextZip(sessionId, signal)
  const knowledge = await fetchRequestKnowledge(sessionId, requestId, signal)
  const gitContext = await fetchRequestGitContext(sessionId, signal)
  const continuation = await fetchRequestContinuation(sessionId, requestId, signal)
  const archive = await writeChatInputArchive(archivePath, { requestId, requestMetadata, prompt: promptText, context, knowledge, gitContext, continuation, attachments: decoded, liveTunnels, signal })
  throwIfChatGPTTransportAborted(signal)
  await persistChatArtifact(sessionId, requestId, 'input', 'bundle', archiveName, 'application/zip', await readFile(archivePath), signal)
  return { archivePath, archiveName, attachmentCount: decoded.length, archiveEntryCount: archive.fileCount, bytes: archive.bytes, requestMetadata: archive.requestMetadata }
}

async function fillBundledChatGPTComposer(key, entry, sessionId, requestId, promptText, expectedFilename, attachments = [], liveTunnels = [], requestMetadata = {}) {
  const signal = entry?.transportAbortSignal
  const input = await materializeProtocolChatInput(key, sessionId, requestId, promptText, attachments, liveTunnels, requestMetadata, signal)
  const bootstrap = localChatInputBootstrap(requestId, input.archiveName, expectedFilename, liveTunnels, input.requestMetadata)
  try {
    throwIfChatGPTTransportAborted(signal)
    const filled = await entry.view.webContents.executeJavaScript(chatGPTFillComposerScript(bootstrap), true)
    if (!filled) throw new Error('ChatGPT composer DOM could not be populated with bundled protocol input')
    await pasteChatGPTFile(entry, input.archivePath, 1, 1)
    await wait(chatInputSettleDelay(input.bytes, 1))
    throwIfChatGPTTransportAborted(signal)
    return { ...input, bootstrap }
  } finally {
    await rm(path.dirname(input.archivePath), { recursive: true, force: true }).catch(() => undefined)
  }
}

async function executeChatGPTDOMScript(cacheKey, entry, stage, script) {
  const key = sanitizeChatCacheKey(cacheKey)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await wc.executeJavaScript(script, true)
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

async function runChatGPTAccountScript(key, entry, stage, script) {
  const result = await executeChatGPTDOMScript(key, entry, `account-${stage}`, script)
  if (!result || typeof result !== 'object') return { ok: false, state: 'invalid-result' }
  return result
}

async function hideChatGPTSidebar(key, entry) {
  if (!entry || entry.view.webContents.isDestroyed() || !isTrustedChatGPTOrigin(entry.view.webContents.getURL())) return { ok: false, state: 'unavailable' }
  return runChatGPTAccountAction('hide-sidebar', { key }, () => commitChatGPTAccountControl(key, entry, 'hide-sidebar', chatGPTHideSidebarScript()))
}

// Electron delivers a resize to the renderer only while the view is visible. A
// setBounds on an already-hidden WebContentsView updates the native bounds and
// never reaches the page, so innerWidth/innerHeight stay 0. That is measured
// Electron 44 behaviour, not inference: a hidden slot given bounds reports a 0x0
// viewport, while the identical slot given the same bounds before being hidden
// reports 1280x900 and keeps it across later navigations.
//
// A 0x0 viewport breaks account automation two ways. Every located control has
// a centre outside the viewport, so `rect()` returns null and the operation
// reports `action-offscreen`; and every percentage-width node collapses to
// width 0, so the shared `visible()` predicate rejects it outright.
//
// Granting the viewport is therefore a visible -> resize -> hidden sequence, and
// it MUST stay synchronous: no compositor frame is produced between the two
// setVisible calls, so the view never actually appears on screen.
const CHATGPT_LAYOUT_VIEWPORT = { x: 0, y: 0, width: 1280, height: 900 }

function focusedLocalWharnexContents() {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (!focusedWindow || focusedWindow.isDestroyed()) return undefined
  const state = [...desktopWindows.values()].find((candidate) => candidate.window === focusedWindow)
  const contents = state?.window?.webContents
  return contents && !contents.isDestroyed() && contents.isFocused() ? contents : undefined
}

function withPreservedLocalFocus(operation) {
  return preserveLocalFocusDuringBackgroundOperation(operation, {
    captureLocal: focusedLocalWharnexContents,
    ownerFor: (contents) => BrowserWindow.fromWebContents(contents),
    isOwnerFocused: (owner) => BrowserWindow.getFocusedWindow() === owner,
  })
}

function grantChatGPTLayoutViewport(view) {
  if (!view || view.webContents?.isDestroyed?.()) return false
  withPreservedLocalFocus(() => {
    view.setVisible(true)
    view.setBounds({ ...CHATGPT_LAYOUT_VIEWPORT })
    view.setVisible(false)
  })
  return true
}

// A hidden owned view is never given bounds by the window layout, which leaves
// its renderer with a zero-sized viewport. Account automation runs on background
// views (maintenance jobs), so give such a view a real layout viewport without
// ever making it visible.
function ensureChatGPTLayoutViewport(key, entry) {
  // Never resize a view the window is actually showing: its bounds belong to
  // the renderer layout, and overwriting them makes the visible ChatGPT surface
  // jump while the user is looking at it.
  //
  // "Showing" is a property of the view, not of the chat. A Worker is hidden
  // even while it owns the very chat the Supervisor has selected — which is the
  // common case, since a chat is organized right after it was used. Matching on
  // the key alone therefore denied a hidden Worker its layout viewport. Only the
  // entry the Supervisor map actually holds for this key is the visible surface;
  // a Worker entry never is.
  const ownerState = windowStateForEntry(entry)
  if (entry?.interactionWindowId && ownerState?.activeAgentInteractionId === entry.slotId) return false
  if (ownerState?.activeChatGPTKey === key && chatgptViews.get(key) === entry) return false
  // The native bounds are NOT evidence the renderer has a viewport, and reading
  // them as if they were is what made this permanent: the first ineffective
  // setBounds left getBounds() reporting 1280x900 while the page stayed at 0x0,
  // so this guard then skipped every later repair. Ownership of the grant is
  // tracked explicitly instead.
  if (entry.layoutViewportGranted === true) return false
  // The viewport has to sit inside the window: Electron clips a child view to
  // its parent, so off-screen bounds collapse the renderer to 0x0. The size is
  // therefore real and at the origin, and the view is marked parked so it can
  // never be shown while carrying these bounds.
  grantChatGPTLayoutViewport(entry.view)
  entry.layoutViewportGranted = true
  entry.parkedLayout = true
  return true
}

// Locates a control with a typed script and commits it with a trusted native
// click. ChatGPT's Radix menu items ignore synthetic HTMLElement.click(), so
// "locate, then click for real" is the only reliable shape for these controls.
// Presses a located control on an owned ChatGPT surface.
//
// `webContents.sendInputEvent` routes a mouse event through the view's own
// widget, and a view that is not visible has nothing for it to hit: the event
// is dropped. Keyboard events do not need hit-testing and still arrive, which
// is why composer typing and submission always worked on a hidden Worker
// while every menu this pool tries to open did not - `menu-not-open` on 116
// DELETE_TEMP_CHAT, 35 RENAME_CHAT and 27 ARCHIVE_CHAT tasks, plus the
// composer's own reasoning-effort picker.
//
// Live CDP testing separated the two: a press dispatched to the very same
// hidden Worker over the WebContents debugger opened the menu, while the
// identical press through sendInputEvent did not. The debugger path delivers
// to the render widget host directly, so it does not depend on the view being
// composited. The event it produces is a real browser-level input event -
// `isTrusted`, indistinguishable to the page from the native one - so this
// stays within ADR-0037's "commit the located target with a trusted native
// input event"; only the delivery route changes, and only for a surface where
// the other route silently drops it.
async function pressChatGPTControl(entry, wc, rect) {
  if (entry?.view?.getVisible?.() !== false) {
    return dispatchChatGPTPointerPress(wc, rect, { wait, guard: withPreservedLocalFocus })
  }
  const x = Math.max(0, Math.floor(Number(rect?.x) || 0))
  const y = Math.max(0, Math.floor(Number(rect?.y) || 0))
  const attachedHere = !wc.debugger.isAttached()
  if (attachedHere) wc.debugger.attach('1.3')
  try {
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await wait(CHATGPT_CONTROL_PRESS_HOLD_MS)
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  } finally {
    if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
  }
  return { x, y }
}

// Keyboard counterpart of pressChatGPTControl, for the same reason and with
// the same closed vocabulary. Keyboard events do not need hit-testing, so they
// are far likelier to survive sendInputEvent on a hidden view than a mouse
// press is - but the effort slider is only reachable after that hidden view's
// menu has been opened over the debugger, and splitting one interaction across
// two delivery routes is exactly the kind of difference that is invisible
// until it fails. One surface, one route.
const CHATGPT_CONTROL_KEYS = Object.freeze({
  Left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  Right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
})

async function pressChatGPTControlKey(entry, wc, name) {
  const mapped = CHATGPT_CONTROL_KEYS[name]
  if (!mapped) throw new Error(`Unsupported ChatGPT control key ${name}`)
  if (entry?.view?.getVisible?.() !== false) {
    withPreservedLocalFocus(() => dispatchChatGPTAccountKey(wc, name))
    return
  }
  const attachedHere = !wc.debugger.isAttached()
  if (attachedHere) wc.debugger.attach('1.3')
  try {
    for (const type of ['keyDown', 'keyUp']) {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type, key: mapped.key, code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode, nativeVirtualKeyCode: mapped.keyCode,
      })
    }
  } finally {
    if (attachedHere) try { wc.debugger.detach() } catch { /* already detached */ }
  }
}

async function commitChatGPTAccountControl(key, entry, stage, script, { attempts = 4 } = {}) {
  let located = { ok: false, state: 'action-unavailable' }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
    located = await runChatGPTAccountScript(key, entry, stage, script)
    // Some typed operations are already satisfied (for example the sidebar
    // is already visible/hidden) and deliberately return no click target.
    if (located.ok && !located.rect) return located
    if (located.ok && located.rect) break
  }
  if (!located.ok || !located.rect) return located
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  // A held press, not an instantaneous click. Radix opens a menu on
  // pointerdown and reconciles it against the pointerup that follows, so both
  // landing in the same tick settles the trigger back closed - live CDP
  // testing isolated this on the composer's effort picker, where an
  // instantaneous down/up left `aria-expanded` false every time and the same
  // press with a short hold opened the menu reliably. These conversation
  // menus are the same kind of Radix trigger, and `menu-not-open` is by far
  // this queue's largest failure class: 116 DELETE_TEMP_CHAT, 35 RENAME_CHAT
  // and 27 ARCHIVE_CHAT tasks have died on it.
  await pressChatGPTControl(entry, wc, located.rect)
  return located
}

async function chooseChatGPTConversationAction(key, entry, action, conversationId = '') {
  const providerAction = action === 'move-project' ? 'move-conversation' : `${action}-conversation`
  return runChatGPTAccountAction(providerAction, { key }, async () => {
    let located = { ok: false, state: 'menu-not-open' }
    for (let attempt = 0; attempt < CHATGPT_MENU_REOPEN_ATTEMPTS; attempt += 1) {
      const opened = await commitChatGPTAccountControl(key, entry, `${action}-menu`, chatGPTOpenConversationMenuScript(conversationId))
      if (!opened.ok) return opened
      located = await commitChatGPTAccountControl(key, entry, action, chatGPTMenuItemRectScript(action))
      if (located.state !== 'menu-not-open') return located
    }
    return located
  })
}

// Idempotent by construction: the account's own project inventory decides
// whether the name already exists before anything is created, and an
// already-present project is matched case-insensitively so "Wharnex" never
// creates a sibling of "wharnex". Creation is confirmed by re-reading the same
// inventory, and a confirmation that finds more than one match is reported as a
// duplicate rather than silently accepted.
async function ensureChatGPTProject(key, entry, projectName, conversationId = '') {
  const name = normalizeChatGPTProjectName(projectName)
  return runChatGPTAccountAction('ensure-project', { key, projectName: name }, async () => {
    const opened = await commitChatGPTAccountControl(key, entry, 'move-project-menu', chatGPTOpenConversationMenuScript(conversationId))
    if (!opened.ok) return opened
    const submenu = await commitChatGPTAccountControl(key, entry, 'move-project', chatGPTMenuItemRectScript('move-project'))
    if (!submenu.ok) return submenu
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)

    const existing = await runChatGPTAccountScript(key, entry, 'find-project', chatGPTProjectItemRectScript(name))
    if (existing.ok) return { ok: true, state: 'exists', project: name, duplicates: existing.duplicates || 1, href: existing.href || '' }

    const create = await commitChatGPTAccountControl(key, entry, 'new-project', chatGPTMenuItemRectScript('new-project'))
    if (!create.ok) return { ...create, ok: false, state: 'create-project-unavailable', project: name }
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)
    const staged = await commitChatGPTAccountControl(key, entry, 'commit-project', chatGPTNewProjectDialogScript(name), { attempts: 6 })
    if (!staged.ok) return { ...staged, ok: false, project: name }
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 4)

    const reopened = await commitChatGPTAccountControl(key, entry, 'confirm-menu', chatGPTOpenConversationMenuScript(conversationId))
    if (!reopened.ok) return { ...reopened, ok: false, state: 'project-not-confirmed', project: name }
    const reSubmenu = await commitChatGPTAccountControl(key, entry, 'confirm-move-project', chatGPTMenuItemRectScript('move-project'))
    if (!reSubmenu.ok) return { ...reSubmenu, ok: false, state: 'project-not-confirmed', project: name }
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
    const confirmed = await runChatGPTAccountScript(key, entry, 'confirm-project', chatGPTProjectItemRectScript(name))
    if (!confirmed.ok) return { ...confirmed, ok: false, state: 'project-not-confirmed', project: name }
    if ((confirmed.duplicates || 1) > 1) console.warn(`[chatgpt-account] duplicate remote project detected name=${name} count=${confirmed.duplicates}`)
    return { ok: true, state: 'created', project: name, duplicates: confirmed.duplicates || 1, href: confirmed.href || '' }
  })
}

async function organizeChatGPTConversation(cacheKey, projectName, title, expectedURL = '', entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = entryOverride || ensureChatGPTView(key).entry
  requireOwnedChatGPTEntry(key, entry)
  return serializeChatGPTAccountOperation(async () => {
    entry.accountOperationActive = true
    try {
      // Account-lifecycle actions are provider-facing navigation exactly like
      // a submission is; live testing found this whole class of action (a
      // DELETE_BUNDLE backlog of over a hundred items above all) sharing only
      // serializeChatGPTAccountOperation's back-to-back queue and none of the
      // process-wide navigation gate, hammering chatgpt.com without a single
      // request ever spaced out - severe enough to crash the desktop.
      await paceChatGPTWorkerNavigation()
      if (expectedURL) {
        const target = requireTrustedChatGPTURL(expectedURL)
        if (!sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'organize-conversation')
        await waitForChatGPTSurfaceReady(key, entry)
      }
      ensureChatGPTLayoutViewport(key, entry)
      const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
      const shown = await commitChatGPTAccountControl(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
      if (!shown.ok) return shown
      if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)

      // ensureChatGPTProject leaves the "Move to project" submenu open with the
      // wanted project present, so selecting it is the very next click.
      const project = await ensureChatGPTProject(key, entry, projectName, conversationId)
      if (!project.ok) return { ...project, ok: false, project: project.project || normalizeChatGPTProjectName(projectName) }
      if (Number(project.duplicates || 1) > 1) return { ok: false, state: 'duplicate-project', project: project.project, duplicates: project.duplicates }
      const selected = await commitChatGPTAccountControl(key, entry, 'select-project', chatGPTProjectItemRectScript(project.project))
      if (!selected.ok) return { ...selected, ok: false, project: project.project }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)

      const rename = await chooseChatGPTConversationAction(key, entry, 'rename', conversationId)
      if (!rename.ok) return { ...rename, ok: false, project: project.project }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
      // The rename control is an inline sidebar input, not a dialog: stage the
      // value, then commit it with a trusted Enter the same way the composer is
      // submitted, and confirm from the row's own label.
      const staged = await runChatGPTAccountScript(key, entry, 'commit-title', chatGPTCommitConversationTitleScript(title))
      if (!staged.ok) return { ...staged, ok: false, project: project.project }
      const { wc } = requireOwnedChatGPTEntry(key, entry)
      withPreservedLocalFocus(() => {
        dispatchChatGPTPointerClick(wc, staged.rect)
        dispatchChatGPTAccountKey(wc, 'Enter')
      })
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)
      const committed = await runChatGPTAccountScript(key, entry, 'confirm-title', chatGPTConversationTitleScript(conversationId))
      return { ok: Boolean(committed.ok), state: committed.ok ? 'renamed' : committed.state, project: project.project, title: normalizeWHXTitle(title) }
    } finally {
      entry.accountOperationActive = false
      await hideChatGPTSidebar(key, entry).catch(() => undefined)
    }
  })
}

async function suggestChatGPTConversationTitle(cacheKey, expectedURL = '', entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = entryOverride || ensureChatGPTView(key).entry
  requireOwnedChatGPTEntry(key, entry)
  if (expectedURL) {
    const target = requireTrustedChatGPTURL(expectedURL)
    if (!sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'read-conversation-title')
    await waitForChatGPTSurfaceReady(key, entry)
  }
  const raw = String(entry.view.webContents.getTitle() || '').replace(/\s*[|·-]\s*ChatGPT\s*$/i, '').trim()
  const generic = !raw || /^(chatgpt|new chat|novo chat)$/i.test(raw)
  return { ok: !generic, state: generic ? 'title-not-ready' : 'suggested', title: generic ? '' : normalizeWHXTitle(raw) }
}

async function archiveChatGPTConversation(cacheKey, expectedURL = '', entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  // A released view plus a known conversation URL is the normal shape of the
  // deferred retry: the chat was already archived locally and its renderer torn
  // down. Recreating the owned view is the only way to actually reach the
  // conversation, and reporting "view-not-live" as success would silently
  // retire a remote archive that never happened.
  // Only an already-resident surface is driven here. Creating a view purely to
  // serve a deferred retry meant a create/navigate/destroy cycle on the shared
  // sandboxed partition, and rapidly cycling sandboxed renderers is what
  // triggers Electron's "Cannot destructure property 'preloadScripts' of
  // 'binding.startupData'" crash, which takes the whole frontend down with it.
  // A retry that finds no live surface stays pending for the next attempt.
  const entry = entryOverride || chatgptViews.get(key)
  if (!entry) return { ok: false, state: 'view-not-live' }
  requireOwnedChatGPTEntry(key, entry)
  return serializeChatGPTAccountOperation(async () => {
    entry.accountOperationActive = true
    reconcileChatGPTThrottle(key, entry)
    try {
      // See the matching comment in organizeChatGPTConversation: account-
      // lifecycle actions are provider-facing navigation and must share the
      // same process-wide gate a submission does.
      await paceChatGPTWorkerNavigation()
      const target = expectedURL ? requireTrustedChatGPTURL(expectedURL) : ''
      if (target && !sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'archive-conversation')
      await waitForChatGPTSurfaceReady(key, entry)
      ensureChatGPTLayoutViewport(key, entry)
      const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
      const stopped = await runChatGPTAccountAction('stop-conversation', { key }, () => commitChatGPTAccountControl(key, entry, 'stop', chatGPTStopConversationScript()))
      if (stopped.state === 'stopping') await wait(750)
      // The archive control lives in the sidebar history row's own menu, so the
      // sidebar has to be open before the conversation's trigger exists.
      const shown = await commitChatGPTAccountControl(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
      if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
      const archived = await chooseChatGPTConversationAction(key, entry, 'archive', conversationId)
      if (archived.ok && entry.role === 'worker') { entry.ownerKey = ''; entry.affinity = createChatGPTAffinityTracker() }
      else if (archived.ok) releaseChatGPTView(key, windowStateForEntry(entry))
      else await hideChatGPTSidebar(key, entry).catch(() => undefined)
      return archived
    } finally {
      entry.accountOperationActive = false
      if (chatgptViews.get(key) === entry) reconcileChatGPTThrottle(key, entry)
    }
  })
}

async function deleteChatGPTConversation(cacheKey, expectedURL = '', entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = entryOverride || chatgptViews.get(key)
  if (!entry) return { ok: false, state: 'view-not-live' }
  requireOwnedChatGPTEntry(key, entry)
  return serializeChatGPTAccountOperation(async () => {
    entry.accountOperationActive = true
    try {
      // See the matching comment in organizeChatGPTConversation.
      await paceChatGPTWorkerNavigation()
      const target = expectedURL ? requireTrustedChatGPTURL(expectedURL) : ''
      if (target && !sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'delete-conversation')
      await waitForChatGPTSurfaceReady(key, entry)
      ensureChatGPTLayoutViewport(key, entry)
      const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
      const shown = await commitChatGPTAccountControl(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
      if (!shown.ok) return shown
      if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
      const chosen = await chooseChatGPTConversationAction(key, entry, 'delete', conversationId)
      if (!chosen.ok) return chosen
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
      const confirmed = await commitChatGPTAccountControl(key, entry, 'confirm-delete', chatGPTConfirmDeleteScript(), { attempts: 6 })
      if (!confirmed.ok) return confirmed
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
      if (entry.role === 'worker') { entry.ownerKey = ''; entry.affinity = createChatGPTAffinityTracker() }
      else releaseChatGPTView(key, windowStateForEntry(entry))
      return { ok: true, state: 'deleted' }
    } finally {
      entry.accountOperationActive = false
      if (chatGPTKeyForEntry(entry)) await hideChatGPTSidebar(key, entry).catch(() => undefined)
    }
  })
}

async function deleteChatGPTLibraryArtifact(cacheKey, canonicalFilename, artifactID = '', entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const filename = path.basename(String(canonicalFilename || '').trim())
  if (!filename || filename !== canonicalFilename || !parseBundleName(filename)) return { ok: false, state: 'invalid-canonical-filename' }
  const entry = entryOverride || chatgptViews.get(key)
  if (!entry) return { ok: false, state: 'view-not-live' }
  requireOwnedChatGPTEntry(key, entry)
  return serializeChatGPTAccountOperation(async () => {
    entry.accountOperationActive = true
    try {
      // See the matching comment in organizeChatGPTConversation - this is the
      // flow a large DELETE_BUNDLE backlog live-reproduced the crash through.
      await paceChatGPTWorkerNavigation()
      if (entry.view.webContents.getURL() !== CHATGPT_LIBRARY_URL) await loadOwnedChatGPTURL(key, entry, CHATGPT_LIBRARY_URL, 'delete-library-artifact')
      ensureChatGPTLayoutViewport(key, entry)
      let located = { ok: false, state: 'artifact-missing', rows: 0 }
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * (attempt ? 2 : 1))
        located = await runChatGPTAccountScript(key, entry, 'library-artifact', chatGPTLibraryArtifactRectScript(filename, artifactID))
        if (located.ok) break
        if (located.state === 'artifact-ambiguous') return located
      }
      if (!located.ok) return located.state === 'artifact-missing' ? { ok: true, state: 'already-deleted' } : located
      withPreservedLocalFocus(() => dispatchChatGPTPointerClick(entry.view.webContents, located.rect))
      const chosen = await commitChatGPTAccountControl(key, entry, 'library-delete', chatGPTMenuItemRectScript('delete'), { attempts: 6 })
      if (!chosen.ok) return chosen
      const confirmed = await commitChatGPTAccountControl(key, entry, 'library-confirm-delete', chatGPTConfirmDeleteScript(), { attempts: 6 })
      if (!confirmed.ok) return confirmed
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 2)
        const state = await runChatGPTAccountScript(key, entry, 'library-confirm-absent', chatGPTLibraryArtifactStateScript(filename, artifactID || located.artifactId || ''))
        if (state.ok && state.state === 'artifact-absent') return { ok: true, state: 'deleted', artifactId: located.artifactId || artifactID, canonicalFilename: filename }
        if (state.matches > 1) return { ok: false, state: 'artifact-ambiguous' }
      }
      return { ok: false, state: 'delete-not-confirmed' }
    } finally {
      entry.accountOperationActive = false
    }
  })
}

async function stopChatGPTConversation(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = chatgptViews.get(key)
  if (!entry) return { ok: true, state: 'view-not-live' }
  return serializeChatGPTAccountOperation(async () => {
    entry.accountOperationActive = true
    reconcileChatGPTThrottle(key, entry)
    try {
      return await runChatGPTAccountAction('stop-conversation', { key }, () => commitChatGPTAccountControl(key, entry, 'stop', chatGPTStopConversationScript()))
    } finally {
      entry.accountOperationActive = false
      reconcileChatGPTThrottle(key, entry)
    }
  })
}

async function reloadOwnedChatGPTConversation(cacheKey, entry, reason = 'reload') {
  const key = sanitizeChatCacheKey(cacheKey)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  const linkedConversation = canonicalChatGPTConversationURL(entry.affinity.boundURL || '')
  if (linkedConversation && !sameConversationURL(wc.getURL(), linkedConversation)) {
    await loadOwnedChatGPTURL(key, entry, linkedConversation, `${reason}-linked`)
    return { restoredLinkedConversation: true, conversationUrl: linkedConversation }
  }
  if (isTrustedChatGPTOrigin(wc.getURL())) {
    wc.reload()
    return { restoredLinkedConversation: false, conversationUrl: canonicalChatGPTConversationURL(wc.getURL()) }
  }
  const fallbackURL = linkedConversation || CHATGPT_URL
  await loadOwnedChatGPTURL(key, entry, fallbackURL, `${reason}-fallback`)
  return { restoredLinkedConversation: Boolean(linkedConversation), conversationUrl: canonicalChatGPTConversationURL(fallbackURL) }
}

async function targetChatGPTComposer(cacheKey, expectedURL = '', preferCurrentConversation = false, entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = entryOverride || ensureChatGPTView(key).entry
  requireOwnedChatGPTEntry(key, entry)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  // A hidden owned view (every Worker, and a Supervisor bound to a
  // non-painted chat) is never given bounds by the window layout, which
  // leaves its renderer at a zero-sized viewport. DOM script execution
  // (fill/click-via-JS) still works there, so ordinary composer prep and
  // `chatGPTSubmitScript`'s DOM-click submission never surfaced this.
  // Anything committed with a trusted native `sendInputEvent` - which the
  // reasoning-effort slider is, see stepChatGPTReasoningEffortToward - needs
  // a real, rendered widget to land on; live CDP testing against a 0x0
  // viewport reproduced exactly this: a native key event dispatched to the
  // page had no effect at all. Granting the viewport here, before any
  // composer interaction, is a no-op for a surface the window is actually
  // showing (see ensureChatGPTLayoutViewport's own guard) and fixes every
  // native-input consumer downstream, not only this one.
  ensureChatGPTLayoutViewport(key, entry)
  if (entry.externalAuthProvider) throw new Error(`ChatGPT está em autenticação externa via ${entry.externalAuthProvider}. Use o navegador do sistema e importe o bundle ZIP pelo Wharnex.`)
  if (expectedURL) {
    const target = requireTrustedChatGPTURL(expectedURL)
    const linkedConversation = canonicalChatGPTConversationURL(target)
    if (linkedConversation && entry.affinity.boundURL !== linkedConversation && entry.affinity.phase !== 'candidate') syncChatGPTAffinityURL(key, entry, linkedConversation)
    const currentConversation = canonicalChatGPTConversationURL(wc.getURL())
    const keepCurrent = preferCurrentConversation && Boolean(currentConversation)
    if (!sameConversationURL(wc.getURL(), target) && !keepCurrent) await loadOwnedChatGPTURL(key, entry, target, 'composer-target')
    else if (keepCurrent) proposeCurrentChatGPTAffinity(key, entry, linkedConversation, currentConversation)
  }
  await waitForChatGPTSurfaceReady(key, entry)
  const assertNoHumanGate = async (stage) => {
    const health = await executeChatGPTDOMScript(key, entry, stage, chatGPTHumanActionScript())
    if (noteChatGPTRateLimitGate(key, health)) {
      throw new Error('O ChatGPT bloqueou a conta por excesso de pedidos; o envio fica suspenso até o limite expirar.')
    }
    if (health?.required === true) {
      const kind = String(health.kind || 'verification')
      setChatGPTHumanAction(key, kind, '', 'dom')
      throw new Error(chatGPTHumanActionMessage(kind))
    }
    if (entry.humanAction?.source === 'dom' && health?.composerReady === true) clearChatGPTHumanAction(key, 'interface disponível')
  }
  const composerReady = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ready = await executeChatGPTDOMScript(key, entry, 'composer-ready', chatGPTComposerReadyScript())
      if (ready) return true
      await wait(250)
    }
    return false
  }
  await assertNoHumanGate('health')
  let ready = await composerReady()
  if (!ready) {
    // A trusted ChatGPT document can finish its top-level navigation while
    // transient network loss leaves its client-side composer unmounted. The
    // previous path waited five seconds and then claimed that a recovery
    // reload had happened, although it had not. One bounded reload lets the
    // explicit user send recover from that incomplete document without
    // looping on a real auth/verification gate.
    console.warn(`[chatgpt-composer] unavailable key=${key}; reloading once before human escalation`)
    wc.reload()
    await waitForChatGPTSurfaceReady(key, entry)
    await assertNoHumanGate('health-after-composer-reload')
    ready = await composerReady()
  }
  if (!ready) {
    setChatGPTHumanAction(key, 'surface', 'composer DOM was not found after bounded recovery reload', 'dom')
    throw new Error(chatGPTHumanActionMessage('surface'))
  }
  touchChatGPTEntry(entry)
  return { key, entry, wc, conversationUrl: canonicalChatGPTConversationURL(wc.getURL()) }
}

async function waitForChatGPTSurfaceReady(cacheKey, entry) {
  const { wc } = requireOwnedChatGPTEntry(cacheKey, entry)
  await waitForChatGPTReady({
    isLoading: () => entry.loading || wc.isLoading(),
    lastNetworkActivity: () => entry.lastNetworkActivity,
    wait,
  })
  if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('Active cached view is not a trusted ChatGPT page')
}

function chatAgentRateLimitDelayMs() {
  return Math.max(0, chatGPTRateLimitUntil - Date.now())
}

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
function chatAgentNavigationGapMs() {
  const provider = chatAgentRuntimeDiagnostics.provider || {}
  const level = Math.max(0, Number(provider.rate_limit_level || 0))
  const lastLimit = Date.parse(String(provider.last_rate_limit_at || '')) || 0
  // A level that has not yet been reset still counts as pressure while the
  // 429 is recent, so recovery widens the gate before the backend clears it.
  const recentlyLimited = lastLimit > 0 && Date.now() - lastLimit < CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS
  if (level <= 0 && !recentlyLimited) return CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS
  const steps = [12_000, 20_000, CHATGPT_WORKER_NAVIGATION_GAP_MS]
  return steps[Math.min(steps.length - 1, Math.max(0, level - 1))]
}

// A provider action that reached the front of the pacing queue only to find a
// suspension raised while it waited. Nothing was attempted, so the task that
// carried it must come back as a free observation rather than spend an attempt.
class ChatGPTRateLimitDeferral extends Error {
  constructor(delayMs) {
    super('ChatGPT rate-limit cooldown is active')
    this.name = 'ChatGPTRateLimitDeferral'
    this.delayMs = Math.max(0, Number(delayMs) || 0)
  }
}

async function paceChatGPTWorkerRequest(measureGapMs, minimumGapMs = CHAT_AGENT_WORKER_ACTION_GAP_MS) {
  await chatGPTWorkerPacer.pace(measureGapMs, { minimumGapMs })
}

async function paceChatGPTWorkerNavigation() {
  await paceChatGPTWorkerRequest(chatAgentNavigationGapMs)
}

// Process-wide spacing for autonomous prompt submissions, sharing the same
// request gate as navigation. Pressure-specific gaps still widen independently,
// but no Worker provider action can follow another by less than 10 seconds.
function chatAgentSubmissionGapMs() {
  const provider = chatAgentRuntimeDiagnostics.provider || {}
  const level = Math.max(0, Number(provider.rate_limit_level || 0))
  const lastLimit = Date.parse(String(provider.last_rate_limit_at || '')) || 0
  const recentlyLimited = lastLimit > 0 && Date.now() - lastLimit < CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS
  if (level <= 0 && !recentlyLimited) return CHAT_AGENT_SUBMIT_GAP_MS
  const steps = [20_000, 30_000, 45_000, CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS]
  return steps[Math.min(steps.length - 1, Math.max(0, level - 1))]
}

async function paceChatGPTWorkerSubmission({ translation = false } = {}) {
  // Translation remains a bounded, artifact-only utility and may run at its
  // explicitly smaller cadence. Every other Worker task, including TODO and
  // lifecycle work, uses the 30-second account-wide floor.
  await paceChatGPTWorkerRequest(
    translation ? () => CHAT_AGENT_TRANSLATION_ACTION_GAP_MS : chatAgentSubmissionGapMs,
    translation ? CHAT_AGENT_TRANSLATION_ACTION_GAP_MS : CHAT_AGENT_WORKER_ACTION_GAP_MS,
  )
}

async function loadAndSettleChatGPTWorkerConversation(key, entry, conversationURL, reason, assignment) {
  await paceChatGPTWorkerNavigation()
  // The caller's pre-flight rate-limit check ran before this action joined the
  // process-wide queue, and a suspension raised while it waited there is the
  // common case rather than the rare one - the Worker that went first is
  // exactly what raised it. AGENTS.md §8 requires a suspended provider to stop
  // receiving actions, not to receive the ones already in flight, so the last
  // point every navigation passes through re-reads it and defers.
  const suspension = chatAgentRateLimitDelayMs()
  if (suspension > 0) throw new ChatGPTRateLimitDeferral(suspension)
  await loadOwnedChatGPTURL(key, entry, conversationURL, reason)
  await waitForChatGPTSurfaceReady(key, entry)
  if (assignment?.rebind && !chatAgentResidency.settleAssignment(entry.slotId, assignment.epoch, assignment.lane)) {
    throw new Error('stale worker assignment after ChatGPT navigation')
  }
}

async function pasteChatGPTFile(entry, filePath, index, count, { translation = false } = {}) {
  const key = chatGPTKeyForEntry(entry)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  const result = await pasteWithUploadRetry({
    beforeAttempt: async () => {
      // A retry is a fresh provider-facing action: without this, two Workers
      // retiring their own 500ms/1s/2s/4s backoffs independently can still
      // land their file-selection attempts on ChatGPT within the same couple
      // of seconds, and live testing showed that contention is exactly what
      // pushes an upload that would otherwise start past the coordinator's
      // observation window. The shared gate spaces retries the same way it
      // already spaces first attempts and navigation.
      await paceChatGPTWorkerSubmission({ translation })
      await waitForChatGPTSurfaceReady(key, entry)
      const ready = await wc.executeJavaScript(chatGPTComposerReadyScript(), true)
      if (!ready) throw new Error('ChatGPT composer DOM was not found before upload')
    },
    beginUpload: () => chatGPTUploads.expect(wc.id),
    cancelUpload: (error) => chatGPTUploads.cancel(wc.id, `ChatGPT upload selection failed: ${error instanceof Error ? error.message : String(error)}`),
    paste: async () => {
      await selectChatGPTUploadFile(wc, filePath)
    },
    onRetry: ({ attempt, error }) => {
      console.warn(`[chatgpt-upload] retry wc=${wc.id} file=${index}/${count} failedAttempt=${attempt} error=${error.message}`)
    },
  })
  console.log(`[chatgpt-upload] confirmed wc=${wc.id} file=${index}/${count} observed=${result.observed}`)
}

// Submission has two different facts that must not be collapsed: whether the
// DOM send action itself failed, and whether our network observer happened to
// see ChatGPT's POST. The first is a safe delivery failure. The second can be
// ambiguous while the remote model is already reasoning, so automatic flows
// dispatch once and keep supervising the armed request instead of replaying a
// potentially duplicate submit. Manual one-shot actions may still require the
// stronger observed-POST signal before reporting success.
// Moves the reasoning-effort slider exactly one step toward `wanted`.
//
// The control is two things in sequence, both Radix and both requiring a
// trusted native event (ADR-0037): a composer button that opens a menu, and
// an ARIA slider inside it driven by ArrowLeft/ArrowRight once focused. One
// call here performs the whole open-move-close sequence so the caller's
// bounded observe/cycle loop sees a clean, readable button label again
// immediately afterward - the slider's own label reads "Esforço de
// raciocínio" (generic) while open, not a level name, so leaving the menu
// open would make the very next observe() report effort-level-unknown.
async function stepChatGPTReasoningEffortToward(key, entry, wanted) {
  const wantedIndex = CHATGPT_REASONING_EFFORTS.indexOf(wanted)
  if (wantedIndex < 0) throw new Error(`Unsupported ChatGPT reasoning effort ${wanted}`)
  const current = await executeChatGPTDOMScript(key, entry, 'reasoning-effort-state', reasoningEffortStateScript(CHATGPT_BEHAVIOR))
  if (!current?.ok) throw new Error(`ChatGPT reasoning effort is unavailable (${String(current?.state || 'unknown')})`)
  if (current.effort === wanted) return
  const direction = CHATGPT_REASONING_EFFORTS.indexOf(current.effort) < wantedIndex ? 'Right' : 'Left'

  // The picker does not always open on the first press - live testing saw the
  // very first click land with `aria-expanded` still false and the second one
  // open it, the same flakiness chooseChatGPTConversationAction already
  // absorbs for ChatGPT's other Radix menus. Retry the open rather than
  // reporting the control missing.
  let staged = await executeChatGPTDOMScript(key, entry, 'reasoning-effort-adjust', reasoningEffortAdjustScript(CHATGPT_BEHAVIOR))
  for (let attempt = 0; attempt < CHATGPT_MENU_REOPEN_ATTEMPTS && staged?.ok && staged.state === 'effort-menu-closed'; attempt += 1) {
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    // A held press, not an instantaneous click: this trigger settles back
    // closed when both events land in the same tick, which is what left the
    // slider unreachable behind "effort-menu-closed" on every attempt (see
    // dispatchChatGPTPointerPress).
    const visible = entry?.view?.getVisible?.()
    const pressed = await pressChatGPTControl(entry, wc, staged.rect)
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
    const before = staged
    staged = await executeChatGPTDOMScript(key, entry, 'reasoning-effort-adjust', reasoningEffortAdjustScript(CHATGPT_BEHAVIOR))
    // Control geometry and the state it reported, never page content. Without
    // this the failure reads only "effort-menu-closed", which cannot separate
    // a press that missed the control from one that landed and was ignored.
    console.log(`[chatgpt-effort] key=${key} open-attempt=${attempt + 1} visible=${String(visible)} pressed=${pressed.x},${pressed.y} rect=${JSON.stringify(before.rect)} viewport=${JSON.stringify(before.viewport || null)} hit=${JSON.stringify(before.hit || null)} hitIsControl=${before.hitIsControl === true} -> ${String(staged?.state || 'unknown')}`)
  }
  if (!staged?.ok || staged.state !== 'effort-slider-ready') {
    throw new Error(`ChatGPT reasoning-effort slider is unavailable (${String(staged?.state || 'unknown')})`)
  }
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  await pressChatGPTControlKey(entry, wc, direction)
  await pressChatGPTControlKey(entry, wc, 'Escape')
  await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
}

async function submitChatGPTDraft(key, entryOverride = undefined, expectedURL = '', preparedTarget = undefined, { requireReasoningEffort = true } = {}) {
  const target = preparedTarget || await targetChatGPTComposer(key, '', false, entryOverride)
  const wc = target.wc
  const reasoningEffort = normalizeChatGPTReasoningEffort(target.reasoningEffort || target.entry.reasoningEffort || 'high')
  const expectedConversation = canonicalChatGPTConversationURL(expectedURL)
  const assertExpectedConversation = () => {
    if (!expectedConversation) return
    if (!sameConversationURL(wc.getURL(), expectedConversation)) {
      throw new Error('A conversa ChatGPT mudou durante a preparação; o pedido não foi enviado para evitar escrever noutra conversa.')
    }
  }
  assertExpectedConversation()
  let effort
  try {
    effort = await ensureChatGPTReasoningEffort({
      target: reasoningEffort,
      observe: () => executeChatGPTDOMScript(key, target.entry, 'reasoning-effort-state', reasoningEffortStateScript(CHATGPT_BEHAVIOR)),
      cycle: async () => {
        requireOwnedChatGPTEntry(key, target.entry)
        assertExpectedConversation()
        await stepChatGPTReasoningEffortToward(key, target.entry, reasoningEffort)
      },
    })
  } catch (error) {
    // A background classification/translation worker only ever requests
    // 'instant' as a latency/cost preference, not a correctness requirement,
    // so for those callers a submission that never reaches ChatGPT because of
    // an unrelated effort-picker regression is strictly worse than one
    // delivered at whatever effort level the account is already on. Every
    // other caller here treats the requested reasoning effort as a hard
    // precondition for a correctness-sensitive planning exchange, so it must
    // keep failing closed.
    if (requireReasoningEffort) throw error
    console.warn(`[chatgpt-effort] key=${key} could not reach ${reasoningEffort}, submitting at whatever level ChatGPT is currently on instead: ${error instanceof Error ? error.message : String(error)}`)
    effort = { effort: `unconfirmed(wanted ${reasoningEffort})`, changed: false, cycles: 0 }
  }
  console.log(`[chatgpt-effort] key=${key} target=${effort.effort} changed=${effort.changed} cycles=${effort.cycles}`)
  markChatGPTAffinitySubmitted(target.entry.affinity)
  const method = 'dom-click'
  const result = await submitWithoutReplay({
    beforeSubmit: async () => {
      assertExpectedConversation()
    },
    beginObservation: () => chatGPTSubmissions.expect(wc.id),
    submit: async () => {
      assertExpectedConversation()
      const clicked = await wc.executeJavaScript(chatGPTSubmitScript(), true)
      if (!clicked) throw new Error('ChatGPT send button is unavailable')
    },
  })
  if (result.accepted) {
    console.log(`[chatgpt-submit] accepted key=${key} method=${method} request=${result.requestId}`)
  } else {
    console.warn(`[chatgpt-submit] dispatched-unconfirmed key=${key} method=${method} error=${result.observationError || 'network observation timeout'}; continuing supervision without replay`)
  }
  return result
}

async function preparePromptForChatGPT(request, entryOverride = undefined) {
  const signal = entryOverride?.transportAbortSignal
  throwIfChatGPTTransportAborted(signal)
  const text = String(request?.text || '').trim()
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const workspaceChatId = durableWorkspaceChatID(key, request?.workspaceChatId)
  const requestId = String(request?.requestId || '').trim()
  const requestedTitle = String(request?.chatTitle || '').replace(/\s+/g, ' ').trim().slice(0, 82)
  const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
  const autoSubmit = request?.autoSubmit === true
  const reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
  if (autoSubmit) await requireAutoSession(request?.sessionId, signal)
  throwIfChatGPTTransportAborted(signal)
  // Preserve this already-authorized delivery only in Desktop memory so a
  // transient remote-surface failure can be retried without replanning.
  retryableChatGPTPrompts.set(key, { request, preparedAt: Date.now() })
  const linkedConversation = canonicalChatGPTConversationURL(request?.url || '')
  const entry = entryOverride || chatgptViews.get(key)
  const currentConversationURL = linkedConversation || canonicalChatGPTConversationURL(entry?.view.webContents.getURL() || '')
  const currentSha = String(request?.contextSha256 || '').trim()
  const previousSha = String(request?.lastContextSha256 || '').trim()
  const previousURL = String(request?.lastContextChatgptUrl || '').trim()
  const requestMetadata = {
    chat_title: requestedTitle,
    chat_id: workspaceChatId || key,
    chat_hash: currentSha,
    requested_at: String(request?.requestedAt || ''),
  }
  const includeContext = shouldAttachProjectContext({ currentSha, previousSha, currentConversationId: chatGPTConversationID(currentConversationURL), previousConversationId: chatGPTConversationID(previousURL), force: request?.includeContext === true })

  const tunnelInstanceIds = normalizeTunnelInstanceIDs(request?.tunnelInstanceIds)
  let remoteInput = null
  if (tunnelInstanceIds.length) {
    try {
      remoteInput = await publishRemoteChatInput(request?.sessionId, requestId, text, request?.bootstrapText, includeContext, request?.attachments || [], request?.artifacts || [], request?.projectFiles || [], tunnelInstanceIds, requestMetadata, signal)
    } catch (error) {
      console.warn(`[chatgpt-protocol-channel] optional live fallback unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Every planner request is transported as exactly one request ZIP. Selected
  // tunnels are optional live mirrors and never replace that authoritative ZIP.
  const directPrompt = remoteInput?.fallbackPrompt ? `${text}\n\n${remoteInput.fallbackPrompt}` : text
  const input = await materializeChatInput(key, request?.sessionId, requestId, request?.attachments || [], request?.artifacts || [], directPrompt, includeContext, request?.projectFiles || [], remoteInput?.tunnels || [], requestMetadata, signal)
  throwIfChatGPTTransportAborted(signal)
  const bootstrap = localChatInputBootstrap(requestId, input.archiveName, expectedFilename, remoteInput?.tunnels || [], input.requestMetadata)
  const target = await targetChatGPTComposer(key, linkedConversation || CHATGPT_URL, linkedConversation ? request?.preferCurrentConversation === true : false, entryOverride)
  throwIfChatGPTTransportAborted(signal)
  target.reasoningEffort = reasoningEffort
  target.entry.reasoningEffort = reasoningEffort
  if (!linkedConversation) syncChatGPTAffinityURL(key, target.entry)
  const filled = await executeChatGPTDOMScript(key, target.entry, 'fill-composer', chatGPTFillComposerScript(bootstrap))
  throwIfChatGPTTransportAborted(signal)
  if (!filled) throw new Error('ChatGPT composer DOM could not be populated with local input bootstrap')
  await pasteChatGPTFile(target.entry, input.archivePath, 1, 1)
  throwIfChatGPTTransportAborted(signal)
  let conversationUrl = target.conversationUrl
  if (autoSubmit) {
    await wait(chatInputSettleDelay(input.bytes, 1))
    throwIfChatGPTTransportAborted(signal)
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    throwIfChatGPTTransportAborted(signal)
    armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, remoteInput?.tunnels || [], directPrompt, request?.sessionId, expectedFilename, input.requestMetadata)
    try {
      throwIfChatGPTTransportAborted(signal)
      await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
    } catch (error) {
      disarmExpectedChatGPTBundle(key, requestId)
      throw error
    }
    conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
    if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversationUrl, { remoteState: 'awaiting-response' })
    try {
      await enqueueChatAgentFollowups(key, requestId, conversationUrl, {
        expectedFilename, assistantBaseline, recoveryBootstrap: bootstrap, originalPrompt: directPrompt,
        sessionId: request?.sessionId || '', liveTunnels: remoteInput?.tunnels || [],
        requestMetadata: input.requestMetadata,
        projectName: request?.projectName || '', projectPath: request?.projectPath || '', workspaceChatId,
      })
    } catch (error) {
      console.error(`[chatgpt-supervision] submitted request ${requestId} but durable follow-up scheduling failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    preparedChatGPTDrafts.delete(key)
  } else {
    preparedChatGPTDrafts.set(key, { preparedAt: Date.now(), attachmentCount: 1, requestId, sessionId: request?.sessionId, recoveryBootstrap: bootstrap, liveTunnels: remoteInput?.tunnels || [], originalPrompt: directPrompt, expectedFilename, projectName: request?.projectName, projectPath: request?.projectPath || '', chatTitle: requestedTitle, conversationUrl: target.conversationUrl, workspaceChatId, requestMetadata: input.requestMetadata, reasoningEffort })
  }
  touchChatGPTEntry(target.entry)
  console.log(`[chatgpt-draft] prepared key=${key} attachments=1 archiveEntries=${input.archiveEntryCount} userAttachments=${input.userAttachmentCount} systemArtifacts=${input.artifactCount} includeContext=${includeContext} bytes=${input.bytes} chars=${text.length} autoSubmit=${autoSubmit}`)
  // Do not clear retryableChatGPTPrompts here: observing this submit only
  // confirms transport (a conversation POST was seen), never that ChatGPT
  // actually received the composed prompt/attachment. The entry stays
  // available for a manual "Reenviar request" until the request reaches a
  // real terminal outcome (validated bundle downloaded, or explicitly
  // superseded/cancelled) — see registerChatGPTPlanDownloads and pick-bundle.
  return { ok: true, cacheKey: key, attachmentCount: 1, submitted: autoSubmit, expectedFilename, includedContext: includeContext, conversationUrl }
}

async function queuePreparedPromptForWorker(request) {
  const rawText = String(request?.text || '').trim()
  if (!rawText) throw new Error('Prepared prompt is empty')
  if (rawText.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.requestId || '').trim()
  if (!requestId) throw new Error('Background planner continuation requires a request id')
  const sessionId = sanitizeSessionId(request?.sessionId)
  await requireAutoSession(sessionId)
  const conversationURL = canonicalChatGPTConversationURL(request?.url || '')
  const workspaceChatId = durableWorkspaceChatID(key, request?.workspaceChatId)
  const includedContext = shouldAttachProjectContext({
    currentSha: String(request?.contextSha256 || '').trim(),
    previousSha: String(request?.lastContextSha256 || '').trim(),
    currentConversationId: chatGPTConversationID(conversationURL),
    previousConversationId: chatGPTConversationID(request?.lastContextChatgptUrl || ''),
    force: request?.includeContext === true,
  })
  const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
  const workerRequest = {
    ...request,
    background: false,
    cacheKey: key,
    workspaceChatId,
    sessionId,
    requestId,
    url: conversationURL,
    autoSubmit: true,
    expectedFilename,
  }
  const queued = await enqueueChatAgentTask('BOT_WRITE', {
    key,
    requestId,
    rootRequestId: requestId,
    conversationURL,
    sessionID: sessionId,
    projectID: String(request?.projectPath || ''),
    dedupeKey: `prepare:${requestId}`,
    payload: { operation: 'PREPARE_PROMPT', request: workerRequest, workspace_chat_id: workspaceChatId },
    maxAttempts: 6,
    notBefore: new Date().toISOString(),
  })
  void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
  console.log(`[chatgpt-worker-write] queued key=${key} request=${requestId} task=${String(queued?.task_id || '-')}`)
  return {
    ok: true,
    cacheKey: key,
    attachmentCount: 1,
    submitted: true,
    queued: true,
    expectedFilename,
    includedContext,
    conversationUrl: conversationURL || undefined,
  }
}

async function retryPersistedChatGPTPrompt(request, entryOverride = undefined) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.expectedRequestId || '').trim()
  const sessionId = sanitizeSessionId(request?.sessionId)
  await requireAutoSession(sessionId)
  const listingURL = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, BACKEND_URL)
  const listingResponse = await fetch(listingURL, { redirect: 'error' })
  if (!listingResponse.ok) throw new Error(`Não foi possível consultar a entrada persistida (HTTP ${listingResponse.status}).`)
  const listing = await listingResponse.json()
  const artifact = [...(listing?.artifacts || [])].reverse().find((item) => item?.request_id === requestId && item?.direction === 'input' && item?.kind === 'bundle')
  if (!artifact?.id) throw new Error('A entrada completa deste pedido não está persistida; recrie o pedido para obter uma nova base segura.')
  const artifactURL = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifact.id)}`, BACKEND_URL)
  const artifactResponse = await fetch(artifactURL, { redirect: 'error' })
  if (!artifactResponse.ok) throw new Error(`Não foi possível recuperar a entrada persistida (HTTP ${artifactResponse.status}).`)
  const bytes = Buffer.from(await artifactResponse.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_CONTEXT_BYTES) throw new Error('A entrada persistida tem tamanho inválido.')
  const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
  const targetURL = canonicalChatGPTConversationURL(request?.url || '')
  if (!targetURL) throw new Error('O pedido pendente não possui uma conversa ChatGPT vinculada para reenvio seguro.')
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'durable-retry')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const archiveName = path.basename(String(artifact.name || `whx-input-${requestId}.zip`))
  const archivePath = path.join(dir, archiveName)
  await writeFile(archivePath, bytes, { mode: 0o600 })
  const target = await targetChatGPTComposer(key, targetURL, false, entryOverride)
  target.reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
  target.entry.reasoningEffort = target.reasoningEffort
  const bootstrap = localChatInputBootstrap(requestId, archiveName, expectedFilename, [])
  const filled = await executeChatGPTDOMScript(key, target.entry, 'fill-durable-retry', chatGPTFillComposerScript(bootstrap))
  if (!filled) throw new Error('ChatGPT composer DOM could not be populated with the persisted request')
  await pasteChatGPTFile(target.entry, archivePath, 1, 1)
  await wait(chatInputSettleDelay(bytes.byteLength, 1))
  const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
  armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, [], String(request?.recoveryPrompt || ''), sessionId, expectedFilename)
  try { await submitChatGPTDraft(key, target.entry, target.conversationUrl, target) }
  catch (error) { disarmExpectedChatGPTBundle(key, requestId); throw error }
  clearChatGPTHumanAction(key, 'entrada persistida reenviada')
  return { ok: true, cacheKey: key, requestId, attachmentCount: 1, submitted: true, expectedFilename, includedContext: true, conversationUrl: targetURL, durable: true }
}

async function retryPreparedChatGPTPrompt(request, entryOverride = undefined) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.expectedRequestId || '').trim()
  // A stale renderer-side retry banner must never be able to replay a request
  // that Desktop is already supervising. An armed expectation means the send
  // action crossed the point where delivery became ambiguous or confirmed; the
  // only safe action is to keep waiting for that exact response.
  const supervised = expectedChatGPTBundles.get(key)
  if (requestId && supervised?.requestId === requestId) {
    return { ok: true, cacheKey: key, requestId, alreadySupervised: true, submitted: true, expectedFilename: supervised.filename }
  }
  // A response bundle already validated and acknowledged for this exact
  // request id is a completed round trip, whether or not a retryable draft
  // still lingers in memory (its TTL is independent of delivery). Checking
  // this only in the "no retryable draft" branch below let a stale-but-not-yet
  // -expired retryable entry win the race: the UI kept showing "Entrega ao
  // ChatGPT pendente" and every retry click re-ran the whole submission
  // against a request ChatGPT had already answered, instead of recognizing
  // it was already delivered.
  if (requestId && recentlyDeliveredChatGPTBundleRequestId(requestId)) {
    retryableChatGPTPrompts.delete(key)
    return { ok: true, cacheKey: key, requestId, alreadyDelivered: true }
  }
  const retryable = retryableChatGPTPrompts.get(key)
  if (!retryable || Date.now() - retryable.preparedAt > RETRYABLE_PROMPT_TTL_MS) {
    retryableChatGPTPrompts.delete(key)
    return retryPersistedChatGPTPrompt(request, entryOverride)
  }
  if (requestId && String(retryable.request?.requestId || '') !== requestId) {
    throw new Error('Uma requisição mais recente substituiu esta; abra a aba do ChatGPT para continuar.')
  }
  return preparePromptForChatGPT(retryable.request, entryOverride)
}

async function attachContextToChatGPT(request, entryOverride = undefined) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const target = await targetChatGPTComposer(key, request?.url || '', true, entryOverride)
  target.reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
  target.entry.reasoningEffort = target.reasoningEffort
  const context = await fetchContextZip(request?.sessionId)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-context')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, `wharness-context-${context.id}.zip`)
  await writeFile(filePath, context.bytes, { mode: 0o600 })
  await pasteChatGPTFile(target.entry, filePath, 1, 1)
  await wait(chatInputSettleDelay(context.bytes.byteLength, 1))
  const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
  if (!submission.accepted) throw new Error('ChatGPT context submission was dispatched but could not be confirmed')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
  touchChatGPTEntry(target.entry)
  return { ok: true, cacheKey: key, bytes: context.bytes.byteLength, submitted: true, conversationUrl }
}

async function attachPromptToChatGPT(request, entryOverride = undefined) {
  const text = String(request?.text || '').trim()
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const target = await targetChatGPTComposer(key, request?.url || '', true, entryOverride)
  target.reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
  target.entry.reasoningEffort = target.reasoningEffort
  const prompt = plannerPromptMarkdown(text)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-prompt')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, prompt.name)
  await writeFile(filePath, prompt.bytes, { mode: 0o600 })
  await pasteChatGPTFile(target.entry, filePath, 1, 1)
  await wait(chatInputSettleDelay(prompt.bytes.byteLength, 1))
  const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
  if (!submission.accepted) throw new Error('ChatGPT prompt submission was dispatched but could not be confirmed')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
  touchChatGPTEntry(target.entry)
  return { ok: true, cacheKey: key, bytes: prompt.bytes.byteLength, submitted: true, conversationUrl }
}

async function submitPreparedChatGPTDraft(cacheKey, entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const prepared = preparedChatGPTDrafts.get(key)
  if (!prepared || Date.now() - prepared.preparedAt > 10 * 60 * 1000) throw new Error('No recent prepared ChatGPT draft exists for this chat')
  const entry = entryOverride || activateChatGPTView(key)
  requireOwnedChatGPTEntry(key, entry)
  const assistantBaseline = await chatGPTAssistantTurnCount(entry.view.webContents)
  const expectedFilename = authoritativeBundleFilename(prepared.expectedFilename, prepared.requestId, key)
  entry.reasoningEffort = normalizeChatGPTReasoningEffort(prepared.reasoningEffort)
  const submission = await submitChatGPTDraft(key, entry, prepared.conversationUrl || entry.affinity.boundURL)
  if (!submission.accepted && !submission.dispatched) throw new Error('ChatGPT prompt submission was not dispatched')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, entry)
  if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
  armExpectedChatGPTBundle(key, prepared.requestId, assistantBaseline, prepared.recoveryBootstrap, prepared.liveTunnels || [], prepared.originalPrompt || '', prepared.sessionId || '', expectedFilename, prepared.requestMetadata || {})
  const workspaceChatId = durableWorkspaceChatID(key, prepared.workspaceChatId)
  if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversationUrl, { remoteState: 'awaiting-response' })
  try {
    await enqueueChatAgentFollowups(key, prepared.requestId, conversationUrl, {
      expectedFilename, assistantBaseline, recoveryBootstrap: prepared.recoveryBootstrap,
      originalPrompt: prepared.originalPrompt || '', sessionId: prepared.sessionId || '', liveTunnels: prepared.liveTunnels || [],
      requestMetadata: prepared.requestMetadata || {},
      projectName: prepared.projectName || '', projectPath: prepared.projectPath || '', fallbackTitle: prepared.chatTitle || '', workspaceChatId,
    })
  } catch (error) {
    console.error(`[chatgpt-supervision] submitted request ${prepared.requestId} but durable follow-up scheduling failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  preparedChatGPTDrafts.delete(key)
  touchChatGPTEntry(entry)
  return { ok: true, cacheKey: key, expectedFilename, conversationUrl, scheduled: true }
}

async function submitPromptToChatGPT(cacheKey, value, expectedURL = '', requestId = '', sessionId = '', entryOverride = undefined) {
  const text = String(value || '').trim()
  if (!text) throw new Error('Repair prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Repair prompt exceeds 1 MiB limit')

  const key = sanitizeChatCacheKey(cacheKey)
  const expectedFilename = canonicalBundleFilename(key, requestId)
  const target = await targetChatGPTComposer(key, expectedURL, false, entryOverride)
  const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
  const prior = expectedChatGPTBundles.get(key)
  const liveTunnels = prior?.requestId === requestId && Array.isArray(prior.liveTunnels) ? prior.liveTunnels : []
  const requestMetadata = prior?.requestId === requestId ? prior.requestMetadata || {} : {}
  const bundled = await fillBundledChatGPTComposer(key, target.entry, sessionId, requestId, text, expectedFilename, [], liveTunnels, requestMetadata)
  await wait(100)
  const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
  if (!submission.accepted && !submission.dispatched) throw new Error('ChatGPT prompt submission was not dispatched')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
  if (!conversationUrl) throw new Error('ChatGPT submission did not produce a stable conversation id')
  armExpectedChatGPTBundle(key, requestId, assistantBaseline, bundled.bootstrap, liveTunnels, text, sessionId, expectedFilename, requestMetadata)
  touchChatGPTEntry(target.entry)
  console.log(`[chatgpt-repair] submitted key=${key} chars=${text.length} method=dom`)
  return { ok: true, cacheKey: key, expectedFilename, conversationUrl, assistantBaseline, recoveryBootstrap: bundled.bootstrap, liveTunnels }
}


function durableWorkspaceChatID(cacheKey, requestedChatID = '') {
  const key = sanitizeChatCacheKey(cacheKey)
  // Conflict and other auxiliary surfaces own an independent remote
  // conversation, but they are not workspace chats. Persisting their URL
  // under either the synthetic key or the parent chat silently corrupts the
  // parent's stable conversation affinity.
  if (key.includes('_cf_')) return ''
  const requested = String(requestedChatID || '').trim()
  if (!requested) return key
  const durableID = sanitizeChatCacheKey(requested)
  return durableID === key ? durableID : ''
}

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

async function persistWorkspaceChatRemote(chatID, conversationURL, { projectRef = '', remoteTitle = '', remoteState = '' } = {}) {
  const key = sanitizeChatCacheKey(chatID)
  const target = new URL(`/api/workspace-chats/${encodeURIComponent(key)}/remote`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'PATCH', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatgpt_url: canonicalChatGPTConversationURL(conversationURL), remote_project_ref: projectRef, remote_title: remoteTitle, remote_state: remoteState }),
  })
  if (!response.ok) throw new Error(`workspace chat remote state HTTP ${response.status}`)
  return response.json()
}

async function persistWorkspaceChatRemoteBestEffort(chatID, conversationURL, values = {}) {
  try {
    return await persistWorkspaceChatRemote(chatID, conversationURL, values)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(`[chatgpt-remote-state] non-fatal persistence failure chat=${sanitizeChatCacheKey(chatID)} state=${String(values?.remoteState || '')} error=${detail}`)
    return { ok: false, error: detail }
  }
}

const CHAT_AGENT_REQUEST_BOUND_TASKS = new Set(['BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE', 'TITLE_DISCOVER', 'TITLE_GENERATE_TEMP', 'TITLE_AWAIT'])

function chatAgentInitialRequestWaitMs() {
  const value = Number(chatAgentRuntimeDiagnostics?.provider?.initial_wait_ms || 60_000)
  return Math.max(60_000, Math.min(15 * 60_000, Number.isFinite(value) ? value : 60_000))
}

function chatAgentRequestEligibleAt(type, payload = {}, explicit = undefined) {
  if (explicit) return explicit
  if (!CHAT_AGENT_REQUEST_BOUND_TASKS.has(String(type || ''))) return new Date().toISOString()
  const inherited = String(payload?.request_eligible_at || '').trim()
  if (inherited && Number.isFinite(Date.parse(inherited))) return inherited
  return new Date(Date.now() + chatAgentInitialRequestWaitMs()).toISOString()
}

async function enqueueChatAgentTask(type, { key, requestId = '', rootRequestId = '', conversationURL = '', parentTaskID = '', dedupeKey = '', payload = {}, maxAttempts = 8, notBefore = undefined, projectID = '', sessionID = '' }) {
  if (!chatAgentScheduler) throw new Error('Chat-agent scheduler is not ready')
  const conversationID = chatAgentConversationID(conversationURL)
  const queued = await chatAgentScheduler.enqueue({
    type, project_id: String(projectID || ''), chat_id: sanitizeChatCacheKey(key), session_id: String(sessionID || ''),
    request_id: String(requestId || ''), root_request_id: String(rootRequestId || requestId || ''), conversation_id: conversationID,
    parent_task_id: String(parentTaskID || ''), dedupe_key: String(dedupeKey || ''), max_attempts: Number(maxAttempts || 8),
    not_before: chatAgentRequestEligibleAt(type, payload, notBefore), payload: { ...payload, conversation_url: canonicalChatGPTConversationURL(conversationURL) },
  })
  // Supervisor and Worker claims are separate loops over the same queue. The
  // enqueue call wakes the Worker client that owns the HTTP request; explicitly
  // wake the complementary pool too so Supervisor work is seen immediately.
  chatSupervisorScheduler?.wake()
  if (chatAgentPolicies.auto_scale === true) void reconcileChatAgentAutoScale()
  return queued
}

async function enqueueChatAgentLifecycleTask(type, request = {}) {
  const key = sanitizeChatCacheKey(request.cacheKey)
  const conversationURL = canonicalChatGPTConversationURL(request.url || '')
  if (!conversationURL) throw new Error(`${type} requires a canonical ChatGPT conversation URL`)
  const conversationID = chatAgentConversationID(conversationURL) || key
  const title = String(request.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const projectName = String(request.projectName || '').trim().slice(0, 160)
  const requestId = String(request.requestId || '').trim()
  const dedupeSuffix = type === 'RENAME_CHAT'
    ? createHash('sha256').update(`${projectName}\0${title}`).digest('hex').slice(0, 16)
    : 'once'
  if (type === 'RENAME_CHAT' && !title) throw new Error('RENAME_CHAT requires a title')
  if (type === 'ARCHIVE_CHAT') {
    await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'archive-pending' })
  } else if (type === 'DELETE_CHAT') {
    await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'delete-pending' })
  }
  const task = await enqueueChatAgentTask(type, {
    key, requestId, rootRequestId: requestId, conversationURL,
    // Only the canonical host project path, never the ChatGPT display name:
    // that label is renameable from ChatGPT's own UI and is not an identity.
    // An absent path is resolved by the backend from the task's own chat.
    projectID: String(request.projectId || ''), sessionID: String(request.sessionId || ''),
    dedupeKey: `${type.toLowerCase()}:${conversationID}:${dedupeSuffix}`,
    payload: { project_name: projectName, title }, maxAttempts: type === 'RENAME_CHAT' ? 8 : 12,
  })
  void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
  return { ok: true, state: 'queued', task_id: String(task?.task_id || ''), type }
}

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
  await enqueueChatAgentTask('AWAIT_RESPONSE', { ...common, dedupeKey: `await:${requestId}`, maxAttempts: 30 })
}

function hydrateExpectedChatAgentBundle(key, task, payload) {
  const requestId = String(task?.request_id || '')
  let expected = expectedChatGPTBundles.get(key)
  if (expected?.requestId === requestId) return expected
  armExpectedChatGPTBundle(key, requestId, payload.assistant_baseline, payload.recovery_bootstrap, payload.live_tunnels || [], payload.original_prompt || '', payload.session_id || task?.session_id || '', payload.expected_filename || '', payload.request_metadata || {})
  expected = expectedChatGPTBundles.get(key)
  expected.continuationCount = Math.max(0, Number(payload.recovery_count || 0))
  return expected
}

async function chatAgentChildExists(task, type) {
  const listed = await chatAgentScheduler.list({ request_id: task.request_id })
  return (listed?.tasks || []).some((item) => item.type === type && item.parent_task_id === task.task_id && item.status !== 'FAILED' && item.status !== 'CANCELLED')
}

async function captureChatGPTProcessingDuration(entry, expected) {
  if (!entry || !expected || Number(expected.processingDurationMs || 0) > 0) return Number(expected?.processingDurationMs || 0)
  try {
    const result = await entry.view.webContents.executeJavaScript(
      chatGPTProcessingDurationScript(CHATGPT_BEHAVIOR.labels.reasoningDisclosure, expected.assistantBaseline), true)
    if (result?.matched === true && Number(result.durationMs) > 0) expected.processingDurationMs = Number(result.durationMs)
  } catch (error) {
    console.warn(`[chat-agent] processing-duration probe failed request=${expected.requestId || '-'} error=${error instanceof Error ? error.message : String(error)}`)
  }
  return Number(expected.processingDurationMs || 0)
}

async function probeChatAgentResponse(task, entry, key, payload, conversationURL) {
  const expected = hydrateExpectedChatAgentBundle(key, task, payload)
  // The Supervisor that submitted this request is already reading the page it
  // never left, so this lease attempted nothing and stands back. It stands back
  // at the observation cadence rather than at the DOM poll: a Worker re-claiming
  // every two seconds for the whole life of a supervised response is a claim,
  // a start and a settle per cycle against work another pool owns.
  if (chatGPTSupervisorOwnsExpectedResponse(key, expected.requestId, conversationURL)) {
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'visible Supervisor owns response supervision' }
  }
  if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId) || pendingChatGPTBundleDeliveries.has(expected.requestId)) {
    disarmExpectedChatGPTBundle(key, expected.requestId)
    return { status: 'done' }
  }
  if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) {
    // Nothing was attempted: the slot simply was not where this probe needed it.
    // Charging the attempt budget for a scheduling artefact is what retired 23
    // healthy supervisions with "exhausted maximum attempts while waiting".
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'resident worker is no longer on the expected conversation' }
  }
  // AWAIT_RESPONSE is deliberately passive: observe the already-resident page,
  // never focus the composer, reload, or navigate a healthy conversation.
  await waitForChatGPTSurfaceReady(key, entry)
  const health = await executeChatGPTDOMScript(key, entry, 'worker-health', chatGPTHumanActionScript())
  // A gated account is not this supervision's fault and must not spend its
  // attempt budget: hand the slot back and let the durable cooldown expire.
  if (noteChatGPTRateLimitGate(key, health)) {
    return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
  }
  if (health?.required === true) return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(String(health.kind || 'verification')) }
  const keepFlowing = chatAgentKeepFlowingEnabled(Number(String(entry.slotId || '').replace('worker-', '')), task)
  if (keepFlowing) {
    const faultAction = chooseChatGPTRecoveryAction(expected.recovery, {}, Date.now(), { faultOnly: true })
    if (faultAction) {
      await performChatGPTRecoveryAction(key, expected, entry, faultAction)
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: `Keep flowing recovery: ${faultAction.reason}` }
    }
  }
  const completion = await entry.view.webContents.executeJavaScript(chatGPTResponseCompletionScript(expected.assistantBaseline), true)
  const now = Date.now()
  // While the page is provably still generating, this lease observed healthy
  // progress rather than attempting anything, so it must not spend the attempt
  // budget. Supervision is bounded by evidence of trouble, never by a clock
  // that runs out while the model is visibly still working.
  if (completion?.thinking === true) {
    expected.processingObservedAt = expected.processingObservedAt || now
    expected.processingAbsentSince = 0
    expected.settledAt = 0
    expected.progressAt = now
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
  }
  if (expected.processingObservedAt && !expected.processingAbsentSince) expected.processingAbsentSince = now
  if (completion?.complete !== true) {
    expected.settledAt = 0
    // Neither generating nor complete. This is a passive read of an ambiguous
    // page, not an attempt, so it must not spend the budget either — but it is
    // also the one state that carries no evidence of progress, so it is bounded
    // by its own stall deadline instead of supervising indefinitely.
    if (now - Number(expected.progressAt || now) >= AWAIT_STALL_ATTENTION_MS) {
      return {
        status: 'attention',
        error: `ChatGPT deixou de dar sinal estrutural para ${expected.filename} durante ${Math.round(AWAIT_STALL_ATTENTION_MS / 60_000)} minutos; a conversa precisa de verificação humana.`,
      }
    }
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
  }
  expected.progressAt = now
  await captureChatGPTProcessingDuration(entry, expected)
  if (!expected.downloadInFlight && (!keepFlowing || Number(expected.invalidBundleCount || 0) === 0)) {
    const clickMode = await entry.view.webContents.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, expected.assistantBaseline), true)
    if (clickMode) {
      expected.downloadInFlight = true
      expected.lastDOMClick = Date.now()
      recentExpectedDownload = { key, requestId: expected.requestId, at: Date.now() }
      return { status: 'waiting', delayMs: DOM_DOWNLOAD_RETRY_MS, observation: true }
    }
  }
  if (keepFlowing) {
    noteChatGPTRecoveryAssistantCount(expected.recovery, completion?.assistantCount, now)
    const recoveryAction = chooseChatGPTRecoveryAction(expected.recovery, {
      complete: completion?.complete === true, thinking: false, failed: completion?.failed === true,
      responseStarted: Number(completion?.assistantCount || 0) > Number(expected.assistantBaseline || 0),
      surfaceReady: completion?.composerReady === true, humanActionRequired: entry.humanAction?.active === true,
      awaitingConversationAffinity: isChatGPTAffinityAwaitingSettlement(entry.affinity), transportActive: false,
    }, now)
    if (recoveryAction) {
      await performChatGPTRecoveryAction(key, expected, entry, recoveryAction, completion)
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: `Keep flowing recovery: ${recoveryAction.reason}` }
    }
  }
  // A completion is a single instant of a live page, and ChatGPT satisfies
  // every structural completion condition transiently — between reasoning
  // steps, and in the gap between finishing its text and mounting the file
  // card. Acting on one such sample is what made Wharnex declare "terminou sem
  // disponibilizar" over a response that was still being produced, and then
  // spend a whole continuation request re-asking for work already in progress.
  // A terminal conclusion therefore requires the completion to still hold, with
  // the bundle still absent, after the grace window — and the grace is measured
  // from the moment the generating indicator actually disappeared.
  const idleSince = Math.max(Number(expected.processingAbsentSince || 0), Number(expected.settledAt || 0))
  if (!expected.settledAt) expected.settledAt = now
  // The grace means "the generating indicator went away and stayed away", which
  // is only meaningful once that indicator was actually seen. When it never was,
  // `idleSince` degrades to "the page has looked static since we first looked" —
  // and a page can look static because the turn has not started, because the
  // model is between reasoning phases, or because a tool call is running with no
  // visible marker. Concluding from that is how a response still being composed
  // was declared finished, and it is what made the continuation prompt land on
  // top of a model that was still working.
  const settleWindow = expected.processingObservedAt ? PROCESSING_SIGNAL_GRACE_MS : BUNDLE_UNOBSERVED_SETTLE_MS
  if (!idleSince || now - idleSince < settleWindow) {
    return { status: 'waiting', delayMs: BUNDLE_COMPLETION_CONFIRM_MS, observation: true }
  }
  if (Number(payload.recovery_count || 0) >= MAX_BUNDLE_CONTINUATIONS) {
    return { status: 'attention', error: `ChatGPT terminou sem disponibilizar ${expected.filename} depois da recuperação limitada.` }
  }
  // Continuations are real ChatGPT requests. Space them so a supervisor that
  // keeps re-observing the same settled turn cannot turn into a request burst.
  const continuationDelay = Math.min(30_000, BUNDLE_CONTINUATION_BASE_MS + Number(payload.recovery_count || 0) * 3_000)
  if (expected.lastContinuationAt && now - expected.lastContinuationAt < continuationDelay) {
    return { status: 'waiting', delayMs: continuationDelay, observation: true }
  }
  if (!(await chatAgentChildExists(task, 'RECOVERY_WRITE'))) {
    const continuation = chatGPTDeliveryContinuationPrompt(expected.requestId, expected.filename, expected.originalPrompt)
    await enqueueChatAgentTask('RECOVERY_WRITE', {
      key, requestId: expected.requestId, rootRequestId: task.root_request_id || expected.requestId,
      conversationURL, parentTaskID: task.task_id, sessionID: expected.sessionId, maxAttempts: 6,
      payload: { ...payload, prompt: continuation, recovery_count: Number(payload.recovery_count || 0) + 1, expected_filename: expected.filename },
    })
    expected.lastContinuationAt = now
    expected.invalidBundleCount = 0
  }
  return { status: 'done' }
}

async function executeChatAgentWrite(task, entry, key, payload, conversationURL) {
  await paceChatGPTWorkerSubmission()
  // The cooldown may have opened while this submission waited its turn in the
  // queue above; submitting into an active provider pause is the one thing that
  // reliably escalates it to the next level.
  const rateLimitDelay = chatAgentRateLimitDelayMs()
  if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
  if (payload.operation === 'PREPARE_PROMPT') {
    const requested = payload.request && typeof payload.request === 'object' ? payload.request : {}
    const sessionId = sanitizeSessionId(task.session_id || requested.sessionId)
    const requestId = String(task.request_id || requested.requestId || '').trim()
    const targetURL = conversationURL || canonicalChatGPTConversationURL(requested.url || '')
    const workspaceChatId = durableWorkspaceChatID(key, payload.workspace_chat_id || requested.workspaceChatId)
    const safeRequest = {
      ...requested,
      background: false,
      cacheKey: key,
      workspaceChatId,
      sessionId,
      requestId,
      url: targetURL,
      autoSubmit: true,
    }
    const prepared = await withChatGPTTransportPreparation(key, entry, requestId, () => preparePromptForChatGPT(safeRequest, entry))
    return { status: 'done', payload: { operation: 'PREPARE_PROMPT', conversation_url: prepared.conversationUrl || targetURL, expected_filename: prepared.expectedFilename } }
  }
  const prompt = String(payload.prompt || payload.original_prompt || '').trim()
  if (!prompt) return { status: 'failed', error: 'chat-agent write payload is empty' }
  const result = await withChatGPTTransportPreparation(key, entry, task.request_id, () => {
    if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) {
      throw new Error('worker conversation changed before submit/upload')
    }
    return submitPromptToChatGPT(key, prompt, conversationURL, task.request_id, payload.session_id || task.session_id || '', entry)
  })
  const workspaceChatId = durableWorkspaceChatID(key, payload.workspace_chat_id)
  if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, result.conversationUrl, { remoteState: 'awaiting-response' })
  const nextPayload = expectedChatAgentPayload(key, task.request_id, result.conversationUrl, {
    expectedFilename: result.expectedFilename, assistantBaseline: result.assistantBaseline, recoveryBootstrap: result.recoveryBootstrap,
    originalPrompt: payload.original_prompt || prompt, sessionId: payload.session_id || task.session_id || '', liveTunnels: result.liveTunnels || payload.live_tunnels || [],
    projectName: payload.project_name || '', projectPath: payload.project_path || '', fallbackTitle: payload.fallback_title || '', recoveryCount: payload.recovery_count || 0, requestEligibleAt: payload.request_eligible_at || '', workspaceChatId,
  })
  try {
    await enqueueChatAgentTask('AWAIT_RESPONSE', {
      key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: result.conversationUrl,
      parentTaskID: task.task_id, dedupeKey: `await:${task.request_id}`, payload: nextPayload, maxAttempts: 30, sessionID: nextPayload.session_id,
      // A submission that was just accepted has not started rendering yet, so a
      // probe running in the same second reads the turn *before* it — a static,
      // complete-looking page — and can conclude the response finished without
      // delivering before the model has written a word. Measured: a recovery
      // write at 12:42:56 reached ATTENTION at 12:43:17, 21 seconds later.
      notBefore: new Date(Date.now() + chatAgentInitialRequestWaitMs()).toISOString(),
    })
  } catch (error) {
    return { status: 'attention', error: `ChatGPT accepted request ${task.request_id}, but response supervision could not be scheduled: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { status: 'done' }
}

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

async function importOrchestratorWorkerPlanBundle(sessionID, requestID, bytes) {
  const sessionId = sanitizeSessionId(sessionID)
  const requestId = String(requestID || '').trim()
  if (!/^orp_[A-Za-z0-9_-]{8,180}$/.test(requestId)) throw new Error('invalid orchestrator request id')
  const target = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/orchestrator/plans/import-bundle`, BACKEND_URL)
  target.searchParams.set('request_id', requestId)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/zip' }, body: bytes,
  })
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(`orchestrator plan bundle import HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response.json()
}

async function importOrchestratorWorkerPlan(sessionID, requestID, proposal) {
  const sessionId = sanitizeSessionId(sessionID)
  const requestId = String(requestID || '').trim()
  if (!/^orp_[A-Za-z0-9_-]{8,180}$/.test(requestId)) throw new Error('invalid orchestrator request id')
  const target = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/orchestrator/plans/import`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, proposal }),
  })
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(`orchestrator plan import HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response.json()
}

async function checkpointChatAgentTask(taskID, owner, payload) {
  const id = String(taskID || '').trim()
  const leaseOwner = String(owner || '').trim()
  if (!/^cat_[a-f0-9]{20}$/.test(id) || !leaseOwner) throw new Error('invalid chat-agent checkpoint identity')
  const target = new URL(`/api/chat-agent/tasks/${encodeURIComponent(id)}/checkpoint`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: leaseOwner, payload }),
  })
  if (!response.ok) {
    let detail = ''
    try { detail = String((await response.json())?.error?.message || '') } catch {}
    throw new Error(`chat-agent checkpoint HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return response.json()
}

// The delivery instruction, written once so the first submission and a
// re-request cannot drift into asking for different things.
function orchestratorPlanInstruction(prompt, filename, rerequest) {
  const delivery = filename.endsWith('.zip')
    ? `WHARNEX ORCHESTRATOR DELIVERY — BUNDLE ONLY\nCreate and attach one ZIP archive named exactly ${filename}. It must contain a single UTF-8 entry named exactly plan.json at the archive root, whose content is the single harness.orchestrator-plan/v1 object requested above. Do not put the JSON or other answer prose in the conversation. Self-check the archive name, the plan.json entry, JSON syntax, unique task ids, dependency references and acyclicity before attaching it.`
    : `WHARNEX ORCHESTRATOR DELIVERY — FILE ONLY\nCreate and attach one UTF-8 JSON file named exactly ${filename}. The file content must be the single harness.orchestrator-plan/v1 object requested above. Do not put the JSON or other answer prose in the conversation. Self-check the filename, JSON syntax, unique task ids, dependency references and acyclicity before attaching it.`
  if (!rerequest) return `${prompt}\n\n${delivery}`
  // The plan was produced; only its file is no longer downloadable. Ask for the
  // artifact again without restarting the planning work.
  return `WHARNEX ORCHESTRATOR RE-DELIVERY — SAME PLAN\n\nThe file you attached earlier is no longer downloadable. Do not re-plan and do not change the plan: attach the same harness.orchestrator-plan/v1 result again as a fresh file.\n\n${delivery}`
}

// Validate and import one orchestrator plan artifact. Shared by the live
// download and by an artifact retained between attempts, so both reach the
// backend through exactly the same protocol checks.
function parseOrchestratorPlanProposal(value) {
  let proposal
  try { proposal = JSON.parse(value) } catch { throw new Error('orchestrator worker returned invalid JSON') }
  if (!proposal || proposal.protocol !== 'harness.orchestrator-plan/v1' || !Array.isArray(proposal.tasks)) {
    throw new Error('orchestrator worker returned mismatched protocol metadata')
  }
  return proposal
}

function orchestratorPlanResult(requestId, imported) {
  return {
    status: 'done',
    payload: {
      protocol: 'harness.orchestrator-planning-result/v1', request_id: requestId,
      plan_id: String(imported?.plan?.id || ''), task_count: Number(imported?.tasks?.length || 0),
    },
  }
}

// One import path for both deliveries, so the bundle and the legacy artifact
// reach the backend through the same identity checks. The bundle is uploaded
// verbatim: the Desktop is transport and never opens the archive.
async function importOrchestratorPlanArtifact(sessionId, requestId, delivery, bytes) {
  if (delivery === 'bundle') return importOrchestratorWorkerPlanBundle(sessionId, requestId, bytes)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return importOrchestratorWorkerPlan(sessionId, requestId, parseOrchestratorPlanProposal(text))
}

// A retained artifact is best-effort: if it is unusable the attempt continues
// to the live path rather than failing a request that can still be answered.
async function importRetainedOrchestratorPlan(sessionId, requestId, delivery, value) {
  try {
    const imported = await importOrchestratorPlanArtifact(sessionId, requestId, delivery, value)
    return orchestratorPlanResult(requestId, imported)
  } catch (error) {
    console.warn(`[orchestrator-worker] retained plan for request=${requestId} could not be imported: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

async function executeChatAgentOrchestratorPlan(task, entry, key, payload, owner) {
  if (payload?.protocol !== 'harness.orchestrator-planning/v1') {
    return { status: 'failed', error: 'invalid orchestrator planning worker protocol payload' }
  }
  const sessionId = sanitizeSessionId(task.session_id || payload.session_id)
  const requestId = String(task.request_id || payload.request_id || '').trim()
  const prompt = String(payload.prompt || '').trim()
  const includeContext = payload.include_context === true
  const attachmentCacheKey = String(payload.attachment_cache_key || '').trim()
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
  if (!/^orp_[A-Za-z0-9_-]{8,180}$/.test(requestId) || !prompt) {
    return { status: 'failed', error: 'orchestrator planning worker payload is incomplete' }
  }
  if (attachments.length && !/^[A-Za-z0-9_-]{1,128}$/.test(attachmentCacheKey)) {
    return { status: 'failed', error: 'orchestrator planning attachment cache key is invalid' }
  }

  // A request already checkpointed under the legacy contract finishes on it;
  // everything new is born as the project's standard response bundle.
  const checkpointFilename = String(payload.expected_filename || '').trim()
  const delivery = orchestratorDeliveryFor(checkpointFilename)
  const filename = delivery === 'bundle' ? orchestratorBundleFilename(requestId) : orchestratorPlanFilename(task.task_id)
  if (checkpointFilename && checkpointFilename !== filename) {
    return { status: 'failed', error: 'orchestrator planning checkpoint filename does not match its task' }
  }
  const checkpointURL = canonicalChatGPTConversationURL(payload.conversation_url || '')
  const checkpointBaseline = Number(payload.assistant_baseline)
  // A plan ChatGPT delivered between attempts is already on disk. Importing it
  // here costs no provider request at all and is the difference between a
  // planning request that completes and one that asks again until it retires.
  const retained = await takeRetainedChatGPTOrchestratorPlan(filename)
  if (retained) {
    const imported = await importRetainedOrchestratorPlan(sessionId, requestId, delivery, retained)
    if (imported) {
      if (attachmentCacheKey) await removeStoredChatAttachments(chatAttachmentRoot(), attachmentCacheKey).catch(() => undefined)
      console.log(`[orchestrator-worker] imported retained plan task=${task.task_id} request=${requestId}`)
      return imported
    }
  }

  const dir = path.join(app.getPath('temp'), 'wharness-orchestrator-plans', task.task_id)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  let resolveDownload
  let rejectDownload
  const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
  download.catch(() => undefined)
  const expected = { taskId: task.task_id, key, filename, armedAt: Date.now(), resolve: resolveDownload, reject: rejectDownload }
  expectedChatGPTOrchestratorPlans.set(filename, expected)
  reconcileChatGPTThrottleForKey(key, entry)

  let conversationUrl = checkpointURL
  let terminalCleanup = false
  try {
    let target
    let assistantBaseline
    if (checkpointURL) {
      const { wc } = requireOwnedChatGPTEntry(key, entry)
      if (!sameConversationURL(wc.getURL(), checkpointURL)) await loadOwnedChatGPTURL(key, entry, checkpointURL, 'orchestrator-checkpoint')
      await waitForChatGPTSurfaceReady(key, entry)
      target = { entry, wc }
      assistantBaseline = Number.isFinite(checkpointBaseline) && checkpointBaseline >= 0 ? checkpointBaseline : await chatGPTAssistantTurnCount(wc)
      console.log(`[orchestrator-worker] resumed task=${task.task_id} request=${requestId} conversation=${sanitizeDiagnosticURL(checkpointURL)}`)
    } else {
      await paceChatGPTWorkerSubmission()
      const rateLimitDelay = chatAgentRateLimitDelayMs()
      if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
      target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
      const filled = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-fill-composer', chatGPTFillComposerScript(orchestratorPlanInstruction(prompt, filename, false)))
      if (!filled) throw new Error('ChatGPT orchestrator composer could not be populated')

      const uploadPaths = []
      let uploadBytes = 0
      if (includeContext) {
        const context = await fetchContextZip(sessionId)
        const contextPath = path.join(dir, 'wharnex-project-context.zip')
        await writeFile(contextPath, context.bytes, { mode: 0o600 })
        uploadPaths.push(contextPath)
        uploadBytes += context.bytes.byteLength
      }
      for (const attachment of attachments) {
        const filePath = await storedAttachmentPath(chatAttachmentRoot(), String(attachment?.storage_ref || ''))
        uploadPaths.push(filePath)
        uploadBytes += Math.max(0, Number(attachment?.size || 0))
      }
      for (let index = 0; index < uploadPaths.length; index += 1) {
        await pasteChatGPTFile(target.entry, uploadPaths[index], index + 1, uploadPaths.length)
      }
      if (uploadPaths.length) await wait(chatInputSettleDelay(uploadBytes, uploadPaths.length))
      else await wait(150)
      assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
      conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
      if (!conversationUrl) throw new Error('ChatGPT orchestrator submission has no stable conversation id')
      await checkpointChatAgentTask(task.task_id, owner, {
        conversation_url: conversationUrl,
        expected_filename: filename,
        assistant_baseline: assistantBaseline,
        submitted_at: new Date().toISOString(),
      })
      console.log(`[orchestrator-worker] checkpointed task=${task.task_id} request=${requestId} conversation=${sanitizeDiagnosticURL(conversationUrl)}`)
    }

    const deadline = Date.now() + ORCHESTRATOR_PLAN_TIMEOUT_MS
    let thinkingObservedAt = 0
    let rerequests = 0
    // Only a 404 observed after this moment means *this* request's artifact is
    // gone; an older one belongs to a turn we already replaced.
    let lastRequestedAt = Date.now()
    while (Date.now() < deadline) {
      const outcome = await Promise.race([
        download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
        wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done: false })),
      ])
      if (outcome.done) {
        if (outcome.error) throw outcome.error
        const imported = await importOrchestratorPlanArtifact(sessionId, requestId, delivery, outcome.value)
        terminalCleanup = true
        return orchestratorPlanResult(requestId, imported)
      }
      const health = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-health', chatGPTHumanActionScript())
      if (noteChatGPTRateLimitGate(key, health)) {
        return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
      }
      if (health?.required === true) {
        const kind = String(health.kind || 'verification')
        setChatGPTHumanAction(key, kind, requestId, 'orchestrator-worker')
        return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(kind) }
      }
      const completion = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-completion', chatGPTResponseCompletionScript(assistantBaseline))
      if (completion?.thinking === true) thinkingObservedAt = Date.now()
      // A card whose artifact ChatGPT has collected answers every click with a
      // 404 and never fires a download. Clicking it until the deadline is the
      // one thing guaranteed not to produce the plan; the file has to be asked
      // for again, in the same conversation, a bounded number of times.
      if (chatGPTArtifactExpiredSince(chatAgentConversationID(conversationUrl), lastRequestedAt)) {
        if (rerequests >= MAX_BUNDLE_CONTINUATIONS) {
          // This conversation cannot deliver the file any more. Clearing the
          // checkpoint is what stops every remaining attempt from resuming the
          // same dead conversation: the next one starts a fresh submission,
          // which is the only recovery left once the artifacts are collected.
          await checkpointChatAgentTask(task.task_id, owner, {
            conversation_url: '', expected_filename: '', assistant_baseline: 0,
          }).catch((error) => console.warn(`[orchestrator-worker] could not clear the dead checkpoint: ${error instanceof Error ? error.message : String(error)}`))
          throw new Error(`ChatGPT no longer serves ${filename}; the planning request will start a new conversation`)
        }
        rerequests += 1
        lastRequestedAt = Date.now()
        console.warn(`[orchestrator-worker] artifact expired task=${task.task_id} request=${requestId} re-request=${rerequests}`)
        await paceChatGPTWorkerSubmission()
        const refilled = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-refill-composer', chatGPTFillComposerScript(orchestratorPlanInstruction(prompt, filename, true)))
        if (!refilled) throw new Error('ChatGPT orchestrator composer could not be populated for the re-request')
        await wait(150)
        assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
        await submitChatGPTDraft(key, target.entry, conversationUrl, { ...target, conversationUrl })
        continue
      }
      if (Number(completion?.assistantCount || 0) > assistantBaseline) {
        await executeChatGPTDOMScript(key, target.entry, 'orchestrator-download', chatGPTExpectedDownloadScript(filename, assistantBaseline))
      }
    }
    // Reaching the deadline while the page is provably still producing the plan
    // is not a failed attempt — nothing went wrong and nothing was re-sent. The
    // lease is handed back as an observation so a plan that legitimately takes
    // longer than one lease is not retired as exhausted, and so the next lease
    // resumes the same conversation instead of reloading one mid-generation.
    if (thinkingObservedAt && Date.now() - thinkingObservedAt < ORCHESTRATOR_PLAN_GENERATING_GRACE_MS) {
      return {
        status: 'waiting', observation: true, delayMs: ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS,
        error: `ChatGPT is still producing ${filename}`,
      }
    }
    throw new Error(`ChatGPT did not provide ${filename} before the orchestrator planning timeout`)
  } finally {
    if (expectedChatGPTOrchestratorPlans.get(filename) === expected) { expectedChatGPTOrchestratorPlans.delete(filename); reconcileChatGPTThrottleForKey(key, entry) }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    const terminalAttempt = terminalCleanup || Number(task.attempt || 0) >= Number(task.max_attempts || 0)
    if (terminalAttempt && attachmentCacheKey) {
      await removeStoredChatAttachments(chatAttachmentRoot(), attachmentCacheKey).catch(() => undefined)
    }
    if (conversationUrl && terminalAttempt) {
      enqueueChatAgentTask('DELETE_TEMP_CHAT', {
        key, requestId, rootRequestId: requestId, conversationURL: conversationUrl,
        parentTaskID: task.task_id, dedupeKey: `delete-orchestrator:${chatAgentConversationID(conversationUrl)}`,
        payload: {}, maxAttempts: 4,
      }).catch((error) => console.warn(`[orchestrator-worker] temporary ChatGPT cleanup scheduling failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
}

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
async function executeChatAgentMarkdownTranslation(task, entry, key, payload) {
  if (payload?.protocol !== 'wharness.translation-input/v1' || payload?.task !== 'translate_document') {
    return { status: 'failed', error: 'invalid translation worker protocol payload' }
  }
  const expectedFilename = String(payload.result_filename || '')
  if (expectedFilename !== markdownTranslationFilename(task.task_id)) {
    return { status: 'failed', error: 'translation worker payload names a foreign result artifact' }
  }
  const requestFilename = String(payload.request_filename || '')
  if (!/^whx_translation_req_cat_[a-f0-9]{20}\.zip$/.test(requestFilename)) {
    return { status: 'failed', error: 'translation worker payload names an invalid request archive' }
  }
  const bootstrap = String(payload.bootstrap || '').trim()
  if (!bootstrap) return { status: 'failed', error: 'translation worker payload has no composer bootstrap' }
  let archive
  try { archive = Buffer.from(String(payload.archive_base64 || ''), 'base64') } catch { archive = undefined }
  if (!archive?.byteLength) return { status: 'failed', error: 'translation worker payload has no request archive' }
  if (archive.byteLength > MAX_MARKDOWN_TRANSLATION_BYTES * 2) {
    return { status: 'failed', error: 'translation request archive exceeds the transport limit' }
  }

  await paceChatGPTWorkerSubmission()
  const rateLimitDelay = chatAgentRateLimitDelayMs()
  if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }

  const filename = expectedFilename
  const dir = path.join(app.getPath('temp'), 'wharness-markdown-translations', task.task_id)
  const sourcePath = path.join(dir, requestFilename)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(sourcePath, archive, { mode: 0o600 })

  let resolveDownload
  let rejectDownload
  const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
  // Attach a rejection observer immediately: a Chromium download can fail in
  // the same tick in which its will-download handler is installed.
  download.catch(() => undefined)
  const expected = {
    taskId: task.task_id, key, filename, armedAt: Date.now(),
    resolve: resolveDownload, reject: rejectDownload,
  }
  expectedChatGPTTranslations.set(filename, expected)
  reconcileChatGPTThrottleForKey(key, entry)

  // See the matching comment in executeChatAgentTodoClassification: a
  // retried attempt must not reuse a page whose composer may already hold
  // the file a previous attempt attached before failing later in the flow.
  if (Number(task.attempt || 0) > 0) {
    const { wc: staleWc } = requireOwnedChatGPTEntry(key, entry)
    await paceChatGPTWorkerSubmission({ translation: true })
    staleWc.reload()
    await waitForChatGPTSurfaceReady(key, entry)
  }
  let conversationUrl = ''
  try {
    const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
    target.reasoningEffort = 'instant'
    const filled = await executeChatGPTDOMScript(key, target.entry, 'translation-fill-composer', chatGPTFillComposerScript(bootstrap))
    if (!filled) throw new Error('ChatGPT translation composer could not be populated')
    await pasteChatGPTFile(target.entry, sourcePath, 1, 1, { translation: true })
    await wait(chatInputSettleDelay(archive.byteLength, 1))
    // A fresh chat's landing-page composer is a different mounted element
    // from the one the active conversation ends up with once an attachment
    // lands; the bootstrap text set on the earlier instance does not travel
    // to its replacement, so the request reached ChatGPT as a bare file with
    // no accompanying text. Re-asserting it now targets whichever composer
    // is live at this point, right before it matters for submission.
    await executeChatGPTDOMScript(key, target.entry, 'translation-refill-composer', chatGPTFillComposerScript(bootstrap))
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    // 'instant' is a latency/cost preference for this background transport,
    // not a correctness requirement: live testing found the effort-cycle
    // shortcut can stop registering, and a translation delivered at whatever
    // level the account is already on beats one that never submits at all.
    await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort: false })
    conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    if (!conversationUrl) throw new Error('ChatGPT translation submission has no stable conversation id')

    const deadline = Date.now() + MARKDOWN_TRANSLATION_TIMEOUT_MS
    // See the matching comment in executeChatAgentTodoClassification: clicking
    // the download control on every poll tick fired a real duplicate download
    // per tick, and ChatGPT's own browser-side duplicate-name suffix on the
    // later ones was not recognised by this task's strict filename match.
    let downloadTriggered = false
    while (Date.now() < deadline) {
      const outcome = await Promise.race([
        download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
        wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done: false })),
      ])
      if (outcome.done) {
        if (outcome.error) throw outcome.error
        return {
          status: 'done',
          payload: {
            protocol: 'harness.translation/v1', task_id: task.task_id, filename,
            bundle_base64: outcome.value.toString('base64'),
          },
        }
      }
      const health = await executeChatGPTDOMScript(key, target.entry, 'translation-health', chatGPTHumanActionScript())
      if (noteChatGPTRateLimitGate(key, health)) {
        return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
      }
      if (health?.required === true) {
        const kind = String(health.kind || 'verification')
        setChatGPTHumanAction(key, kind, '', 'translation-worker')
        return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(kind) }
      }
      const completion = await executeChatGPTDOMScript(key, target.entry, 'translation-completion', chatGPTResponseCompletionScript(assistantBaseline))
      if (!downloadTriggered && Number(completion?.assistantCount || 0) > assistantBaseline) {
        const clicked = await executeChatGPTDOMScript(key, target.entry, 'translation-download', chatGPTExpectedDownloadScript(filename, assistantBaseline))
        if (clicked) downloadTriggered = true
      }
    }
    throw new Error(`ChatGPT did not provide ${filename} before the translation timeout`)
  } finally {
    if (expectedChatGPTTranslations.get(filename) === expected) { expectedChatGPTTranslations.delete(filename); reconcileChatGPTThrottleForKey(key, entry) }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    if (conversationUrl) {
      enqueueChatAgentTask('DELETE_TEMP_CHAT', {
        key, requestId: task.task_id, rootRequestId: task.task_id, conversationURL: conversationUrl,
        parentTaskID: task.task_id, dedupeKey: `delete-translation:${chatAgentConversationID(conversationUrl)}`,
        payload: {}, maxAttempts: 4,
      }).catch((error) => console.warn(`[markdown-translation] temporary ChatGPT cleanup scheduling failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
}

async function executeChatAgentTodoClassification(task, entry, key, payload) {
  if (payload?.protocol !== 'wharness.todo-classification-input/v1' || payload?.task !== 'classify_todo') {
    return { status: 'failed', error: 'invalid TODO classification worker protocol payload' }
  }
  const filename = String(payload.result_filename || '')
  if (filename !== todoClassificationFilename(task.task_id)) return { status: 'failed', error: 'TODO classification payload names a foreign result artifact' }
  const requestFilename = String(payload.request_filename || '')
  if (!/^whx_todo_classification_req_cat_[a-f0-9]{20}\.zip$/.test(requestFilename)) return { status: 'failed', error: 'TODO classification payload names an invalid request archive' }
  const bootstrap = String(payload.bootstrap || '').trim()
  if (!bootstrap) return { status: 'failed', error: 'TODO classification payload has no composer bootstrap' }
  let archive
  try { archive = Buffer.from(String(payload.archive_base64 || ''), 'base64') } catch { archive = undefined }
  if (!archive?.byteLength || archive.byteLength > MAX_TODO_CLASSIFICATION_BYTES) return { status: 'failed', error: 'TODO classification request archive is invalid' }

  await paceChatGPTWorkerSubmission()
  const rateLimitDelay = chatAgentRateLimitDelayMs()
  if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }

  const dir = path.join(app.getPath('temp'), 'wharnex-todo-classifications', task.task_id)
  const sourcePath = path.join(dir, requestFilename)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(sourcePath, archive, { mode: 0o600 })
  let resolveDownload
  let rejectDownload
  const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
  download.catch(() => undefined)
  const expected = { taskId: task.task_id, key, filename, armedAt: Date.now(), resolve: resolveDownload, reject: rejectDownload }
  expectedChatGPTTodoClassifications.set(filename, expected)
  reconcileChatGPTThrottleForKey(key, entry)
  // A retried attempt reuses whatever page this exact function left behind
  // when an earlier attempt got past a successful upload and then failed
  // later in the flow (submission, reasoning effort, no response). ChatGPT
  // silently no-ops re-selecting a file its composer already holds, so every
  // upload attempt against that stale page "never starts" — live testing
  // against the real account reproduced this deterministically on the very
  // first retry after a confirmed upload. A hard reload guarantees the next
  // attempt begins from an empty composer instead of a stuck one.
  if (Number(task.attempt || 0) > 0) {
    const { wc: staleWc } = requireOwnedChatGPTEntry(key, entry)
    await paceChatGPTWorkerSubmission()
    staleWc.reload()
    await waitForChatGPTSurfaceReady(key, entry)
  }
  let conversationUrl = ''
  try {
    const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
    target.reasoningEffort = 'instant'
    const filled = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-fill', chatGPTFillComposerScript(bootstrap))
    if (!filled) throw new Error('ChatGPT TODO classification composer could not be populated')
    await pasteChatGPTFile(target.entry, sourcePath, 1, 1)
    await wait(chatInputSettleDelay(archive.byteLength, 1))
    // See the matching comment in executeChatAgentMarkdownTranslation: the
    // landing-page composer this was filled on is not necessarily the one
    // the conversation ends up with once the attachment lands, so the
    // bootstrap text needs reasserting against whatever composer is live now.
    await executeChatGPTDOMScript(key, target.entry, 'todo-classification-refill-composer', chatGPTFillComposerScript(bootstrap))
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    // See the matching comment in executeChatAgentMarkdownTranslation:
    // 'instant' is a preference here, not a precondition for submitting.
    await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort: false })
    conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    if (!conversationUrl) throw new Error('ChatGPT TODO classification submission has no stable conversation id')
    const deadline = Date.now() + TODO_CLASSIFICATION_TIMEOUT_MS
    // Clicking the download control fires a real ChatGPT download every time.
    // Re-clicking it on every poll tick while the response sits there (the
    // download can take longer than one tick to reach will-download) queued
    // dozens of real downloads for one response - each later one landing on
    // ChatGPT's own browser-side duplicate-name suffix, which this task's
    // strict exact-filename match then failed to recognise as ours, letting
    // it fall through to a native OS save dialog. One click per response is
    // enough; only try again if that click found nothing to click yet.
    let downloadTriggered = false
    while (Date.now() < deadline) {
      const outcome = await Promise.race([
        download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
        wait(MARKDOWN_TRANSLATION_POLL_MS).then(() => ({ done: false })),
      ])
      if (outcome.done) {
        if (outcome.error) throw outcome.error
        return { status: 'done', payload: { protocol: 'harness.todo-classification/v1', task_id: task.task_id, filename, bundle_base64: outcome.value.toString('base64') } }
      }
      const health = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-health', chatGPTHumanActionScript())
      if (noteChatGPTRateLimitGate(key, health)) return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
      if (health?.required === true) {
        const kind = String(health.kind || 'verification')
        setChatGPTHumanAction(key, kind, '', 'todo-classification-worker')
        return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(kind) }
      }
      const completion = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-completion', chatGPTResponseCompletionScript(assistantBaseline))
      if (!downloadTriggered && Number(completion?.assistantCount || 0) > assistantBaseline) {
        const clicked = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-download', chatGPTExpectedDownloadScript(filename, assistantBaseline))
        if (clicked) downloadTriggered = true
        else {
          const diag = await executeChatGPTDOMScript(key, target.entry, 'todo-classification-download-diag', chatGPTDownloadDiagnosticScript(filename, assistantBaseline))
          console.log(`[diag-download] key=${key} filename=${filename} ${JSON.stringify(diag)}`)
        }
      }
    }
    throw new Error(`ChatGPT did not provide ${filename} before the TODO classification timeout`)
  } finally {
    if (expectedChatGPTTodoClassifications.get(filename) === expected) { expectedChatGPTTodoClassifications.delete(filename); reconcileChatGPTThrottleForKey(key, entry) }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    if (conversationUrl) {
      enqueueChatAgentTask('DELETE_TEMP_CHAT', {
        key, requestId: task.task_id, rootRequestId: task.task_id, conversationURL: conversationUrl,
        parentTaskID: task.task_id, dedupeKey: `delete-todo-classification:${chatAgentConversationID(conversationUrl)}`, payload: {}, maxAttempts: 4,
      }).catch((error) => console.warn(`[todo-classification] temporary ChatGPT cleanup scheduling failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
}

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

function chatSupervisorHostWindow() {
  return [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
}

// Bind this chat to a Supervisor slot, reusing the slot it already owns.
//
// Throws when every slot is held by a request still in progress: the caller
// converts that into a free wait rather than interrupting live work.
function bindChatSupervisor(key) {
  const existing = chatgptViews.get(key)
  if (existing && !existing.view.webContents.isDestroyed()) {
    touchChatGPTEntry(existing)
    return existing
  }
  if (!chatSupervisorHostWindow()) return undefined
  if (chatgptViews.size >= desiredChatAgentSupervisorSlots) {
    const reusable = reusableSupervisor(key)
    // A background binding must never take the renderer the operator is looking
    // at: retiring it clears the window's active chat and leaves the Engine area
    // blank with nothing to navigate it back. Selecting a chat is a human action
    // and may still recycle the visible slot; claiming a queued task is not.
    if (!reusable || chatGPTEntryIsActiveVisible(reusable[0], reusable[1])) {
      throw new Error('Todos os slots de Supervisor estão vinculados a pedidos em curso')
    }
  }
  return ensureChatGPTView(key, undefined).entry
}

function noteChatSupervisorLane(index, task) {
  const runtime = chatSupervisorStates.get(index) || {}
  chatSupervisorStates.set(index, {
    ...runtime,
    lane: chatAgentLane(task) || runtime.lane || '',
    key: sanitizeOptionalChatCacheKey(task?.chat_id) || runtime.key || '',
  })
}

// Lanes other Supervisor slots are currently responsible for, so two slots never
// contend for one conversation.
function chatSupervisorLanesHeldByOthers(index) {
  const lanes = new Set()
  for (const [slot, runtime] of chatSupervisorStates) {
    if (slot === index) continue
    const lane = String(runtime?.lane || '')
    const key = sanitizeOptionalChatCacheKey(runtime?.key)
    if (!lane) continue
    if (runtime?.task || (key && supervisorBindingHeld(key, chatgptViews.get(key)))) lanes.add(lane)
  }
  return lanes
}

// Supervision of an armed response.
//
// The main-process poll already reads this resident page on the bounded DOM
// cadence and owns recovery, delivery continuations and human attention for it.
// Probing again from the lease would only duplicate those DOM reads, so the
// lease hands the slot straight back as an observation while the durable task
// stays the authority on attempts, cancellation and lineage — and, because it
// stays claimable, on holding the chat's Supervisor binding.
async function superviseChatAgentResponse(task, entry, key, payload) {
  const expected = hydrateExpectedChatAgentBundle(key, task, payload)
  if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId)) {
    disarmExpectedChatGPTBundle(key, expected.requestId)
    return { status: 'done' }
  }
  // The validated bytes are already downloaded and the local handoff — backend
  // ingestion, Policy, Protected verification, host Apply — is the only
  // unfinished operation. There is nothing left on the remote page to observe,
  // and the acknowledgement cancels this task's whole lineage durably, so the
  // slot is not what notices the end either.
  //
  // It must therefore stand back at the healthy observation cadence, not at the
  // DOM download poll. That constant paces reading a live page for a file card;
  // driving the durable queue with it re-claimed this supervision every two
  // seconds for the entire length of an apply — a claim, a start and a settle
  // per cycle, each one republishing the runtime state, which is what made the
  // owning Supervisor's card flicker continuously while a bundle was applying.
  if (pendingChatGPTBundleDeliveries.has(expected.requestId)) {
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'a entrega do bundle validado está a concluir' }
  }
  if (chatgptTransportModes.get(key) === 'manual') return { status: 'done' }
  if (entry.humanAction?.active) {
    return { status: 'attention', error: chatGPTHumanActionMessage(String(entry.humanAction.kind || 'verification')) }
  }
  void pollExpectedChatGPTDownloadKey(key)
  const now = Date.now()
  // Two evidence-shaped bounds, because a passive observation deliberately never
  // spends the attempt budget. The first is structural silence: the poll stamps
  // progress on every generating, completion or download signal, so this clock
  // only runs while the page shows no sign of life at all. The second is the
  // task's own age, which survives a Desktop restart and therefore bounds a
  // supervision whose in-memory expectation was re-armed from the queue.
  if (now - Number(expected.progressAt || now) >= AWAIT_STALL_ATTENTION_MS) {
    return {
      status: 'attention',
      error: `ChatGPT deixou de dar sinal estrutural para ${expected.filename} durante ${Math.round(AWAIT_STALL_ATTENTION_MS / 60_000)} minutos; a conversa precisa de verificação humana.`,
    }
  }
  const createdAt = Date.parse(String(task?.created_at || '')) || 0
  if (createdAt && now - createdAt >= EXPECTED_BUNDLE_TTL_MS) {
    return { status: 'attention', error: `O Wharnex aguardou ${expected.filename} durante mais de uma hora sem entrega válida.` }
  }
  return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
}

async function executeChatSupervisorTask(task, { worker, owner }) {
  const index = Math.max(1, Number(worker) || 1)
  const cooldown = chatAgentRateLimitDelayMs()
  if (cooldown > 0) return { status: 'waiting', delayMs: cooldown, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
  const payload = chatAgentTaskPayload(task)
  const key = sanitizeChatCacheKey(task?.chat_id || task?.chatId)
  if (!key) return { status: 'failed', error: 'Supervisor task has no chat binding' }
  const conversationURL = chatAgentConversationURL(task, payload)
  noteChatSupervisorLane(index, task)
  let entry
  try {
    entry = bindChatSupervisor(key)
  } catch (error) {
    return {
      status: 'waiting', delayMs: CHAT_SUPERVISOR_SLOT_WAIT_MS, observation: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (!entry) {
    return { status: 'waiting', delayMs: CHAT_SUPERVISOR_SLOT_WAIT_MS, observation: true, error: 'nenhuma janela do Wharnex aloja supervisores neste momento' }
  }
  const reason = `chat-supervisor-${String(task.type || '').toLowerCase()}`
  const current = entry.view.webContents.getURL()
  // The normal case is no navigation at all: this Supervisor sent the request and
  // has not left the conversation since.
  if (conversationURL && !sameConversationURL(current, conversationURL)) {
    await paceChatGPTWorkerNavigation()
    await loadOwnedChatGPTURL(key, entry, conversationURL, reason)
    await waitForChatGPTSurfaceReady(key, entry)
    const afterNavigation = chatAgentRateLimitDelayMs()
    if (afterNavigation > 0) return { status: 'waiting', delayMs: afterNavigation, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
  } else if (!conversationURL && !isTrustedChatGPTOrigin(current)) {
    await paceChatGPTWorkerNavigation()
    await loadOwnedChatGPTURL(key, entry, CHATGPT_URL, `${reason}-bootstrap`)
    await waitForChatGPTSurfaceReady(key, entry)
  }
  switch (task.type) {
    case 'AWAIT_RESPONSE': return superviseChatAgentResponse(task, entry, key, payload)
    case 'BOT_WRITE':
    case 'RECOVERY_WRITE': return executeChatAgentWrite(task, entry, key, payload, conversationURL)
    case 'ORCHESTRATOR_PLAN': return executeChatAgentOrchestratorPlan(task, entry, key, payload, owner)
    default: return { status: 'failed', error: `O pool de Supervisores não executa ${task.type}` }
  }
}

async function executeChatAgentTask(task, { worker, owner }) {
  const entry = workerEntryForIndex(worker)
  if (!entry) return { status: 'attention', providerWide: true, error: 'Autonomous worker browser is unavailable' }
  const initialRateLimitDelay = chatAgentRateLimitDelayMs()
  if (initialRateLimitDelay > 0) {
    return { status: 'waiting', delayMs: initialRateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
  }
  const payload = chatAgentTaskPayload(task)
  const taskKey = sanitizeChatCacheKey(task?.chat_id || task?.chatId)
  const taskConversationURL = chatAgentConversationURL(task, payload)
  if (task.type === 'AWAIT_RESPONSE' && chatGPTSupervisorOwnsExpectedResponse(taskKey, task.request_id, taskConversationURL)) {
    return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'visible Supervisor owns response supervision' }
  }
  const assigned = assignChatGPTWorker(entry, { ...task, payload })
  const key = assigned.key
  const conversationURL = taskConversationURL || assigned.conversationURL
  try {
    if (assigned.assignment.rebind) {
      if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) {
        await loadAndSettleChatGPTWorkerConversation(key, entry, conversationURL, `chat-agent-${String(task.type || '').toLowerCase()}`, assigned.assignment)
      } else if (!conversationURL && !isTrustedChatGPTOrigin(entry.view.webContents.getURL())) {
        // A fresh hidden Worker starts on about:blank. Background continuations
        // without a bound conversation must bootstrap it on the home surface.
        await loadAndSettleChatGPTWorkerConversation(key, entry, CHATGPT_URL, `chat-agent-${String(task.type || '').toLowerCase()}-bootstrap`, assigned.assignment)
      } else {
        await waitForChatGPTSurfaceReady(key, entry)
        if (!chatAgentResidency.settleAssignment(entry.slotId, assigned.assignment.epoch, assigned.lane)) throw new Error('stale worker assignment before execution')
      }
      const rateLimitDelay = chatAgentRateLimitDelayMs()
      if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
    }
    if (!chatAgentResidency.epochCurrent(entry.slotId, assigned.assignment.epoch, assigned.lane)) throw new Error('stale worker assignment epoch')
    // Taking a task always costs this slot its place in the rotation, whether
    // or not it had to rebind. A slot serving its own resident lane never
    // rebinds, so without this it would never leave the head of the queue.
    chatAgentResidency.noteAssignment(entry.slotId)
  } catch (error) {
    chatAgentResidency.cancelAssignment(entry.slotId, assigned.assignment.epoch)
    // Same reasoning as the stale-assignment branch below: the navigation was
    // abandoned at the pacing gate because the provider is suspended, so
    // nothing reached ChatGPT and the attempt budget must not be charged.
    if (error instanceof ChatGPTRateLimitDeferral) {
      return { status: 'waiting', delayMs: error.delayMs, observation: true, error: error.message }
    }
    // A slot rebound before execution began is a Wharnex-side race: nothing
    // reached ChatGPT, so this is one of the outcomes AGENTS.md requires to be
    // free. Rethrowing charged the attempt budget of a task that never made a
    // request, which is how healthy work retires as exhausted.
    if (/stale worker assignment/i.test(String(error?.message || ''))) {
      return {
        status: 'waiting', observation: true, delayMs: CHAT_AGENT_STALE_ASSIGNMENT_RETRY_MS,
        error: 'worker slot was reassigned before the task reached ChatGPT',
      }
    }
    throw error
  }
  switch (task.type) {
    case 'ORCHESTRATOR_PLAN': return executeChatAgentOrchestratorPlan(task, entry, key, payload, owner)
    case 'TRANSLATE_MARKDOWN': return executeChatAgentMarkdownTranslation(task, entry, key, payload)
    case 'TODO_CLASSIFY': return executeChatAgentTodoClassification(task, entry, key, payload)
    case 'AWAIT_RESPONSE': return probeChatAgentResponse(task, entry, key, payload, conversationURL)
    case 'BOT_WRITE':
    case 'RECOVERY_WRITE': return executeChatAgentWrite(task, entry, key, payload, conversationURL)
    case 'TITLE_DISCOVER': return executeChatAgentTitleDiscover(task, entry, key, payload, conversationURL)
    case 'TITLE_GENERATE_TEMP': return executeChatAgentTempTitle(task, entry, key, payload, conversationURL)
    case 'TITLE_AWAIT': return executeChatAgentTitleAwait(task, entry, key, payload)
    case 'ORGANIZE_CHAT': {
      const result = await organizeChatGPTConversation(key, payload.project_name, payload.title || payload.fallback_title, payload.target_url || conversationURL, entry)
      if (result.state === 'duplicate-project') return { status: 'attention', error: `Projeto ChatGPT duplicado: ${result.project}` }
      if (!result.ok) return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: accountFailureDetail(result) }
      await persistWorkspaceChatRemote(key, payload.target_url || conversationURL, { projectRef: result.project || '', remoteTitle: result.title || '', remoteState: 'organized' })
      if (payload.temp_url) await enqueueChatAgentTask('DELETE_TEMP_CHAT', { key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: payload.temp_url, parentTaskID: task.task_id, dedupeKey: `delete-temp:${chatAgentConversationID(payload.temp_url)}`, payload, maxAttempts: 6 })
      return { status: 'done' }
    }
    case 'RENAME_CHAT': {
      const result = await organizeChatGPTConversation(key, payload.project_name, payload.title, conversationURL, entry)
      if (!result.ok) return chatAgentLifecycleRetry(task, key, conversationURL, accountFailureDetail(result))
      await persistWorkspaceChatRemote(key, conversationURL, { projectRef: result.project || '', remoteTitle: result.title || payload.title || '', remoteState: 'organized' })
      return { status: 'done' }
    }
    case 'ARCHIVE_CHAT': {
      if (await chatAgentLifecycleBlocked(task)) return { status: 'waiting', delayMs: 5_000 }
      const result = await archiveChatGPTConversation(key, conversationURL, entry)
      if (!(result.ok || result.state === 'already-archived')) return chatAgentLifecycleRetry(task, key, conversationURL, accountFailureDetail(result))
      await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'archived' })
      return { status: 'done' }
    }
    case 'DELETE_CHAT':
    case 'DELETE_TEMP_CHAT': {
      if (task.type === 'DELETE_CHAT' && await chatAgentLifecycleBlocked(task)) return { status: 'waiting', delayMs: 5_000 }
      const result = await deleteChatGPTConversation(key, conversationURL, entry)
      if (!(result.ok || result.state === 'already-deleted')) return chatAgentLifecycleRetry(task, key, conversationURL, accountFailureDetail(result), { persist: task.type === 'DELETE_CHAT' })
      if (task.type === 'DELETE_CHAT') await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'deleted' })
      return { status: 'done' }
    }
    case 'DELETE_BUNDLE': {
      if (!payload.locally_persisted) return { status: 'attention', error: 'remote bundle cleanup requires confirmed local persistence' }
      const filename = String(payload.canonical_filename || '').trim()
      if (!filename || !parseBundleName(filename)) return { status: 'attention', error: 'exact canonical Wharnex bundle filename is required' }
      const result = await deleteChatGPTLibraryArtifact(key, filename, String(payload.artifact_id || ''), entry)
      if (result.ok || result.state === 'already-deleted') return { status: 'done' }
      if (result.state === 'artifact-ambiguous' || result.state === 'invalid-canonical-filename') return { status: 'attention', error: result.state }
      return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: accountFailureDetail(result) }
    }
    default: return { status: 'failed', error: `Unsupported chat-agent task type ${task.type}` }
  }
}


function chatGPTCommentFingerprint(key, requestId, comment, attachments = []) {
  const attachmentSignature = attachments.map((item) => [item?.name, item?.size, item?.type || item?.mime].map((value) => String(value || '')).join(':')).join('|')
  return createHash('sha256').update(`${key}\0${requestId}\0${comment}\0${attachmentSignature}`).digest('hex')
}

async function queueChatGPTComment(request) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.requestId || '').trim()
  const comment = String(request?.text || '').trim()
  if (!comment) throw new Error('Task comment is empty')
  if (comment.length > 16_000) throw new Error('Task comment exceeds 16 KiB limit')
  const expectedFilename = canonicalBundleFilename(key, requestId)
  const text = `USER COMMENT FOR THE ACTIVE WHARNEX TASK:
${comment}

Treat this as additional guidance for the SAME task and SAME request. Do not replace, cancel or downgrade the original deliverable. Continue the work and still return the required canonical bundle ${expectedFilename}.`
  const commentId = String(request?.commentId || `${requestId}:${comment}`).slice(0, 20000)
  const attachments = Array.isArray(request?.attachments) ? request.attachments : []
  const reasoningEffort = normalizeChatGPTReasoningEffort(request?.reasoningEffort)
  const fingerprint = chatGPTCommentFingerprint(key, requestId, comment, attachments)
  const now = Date.now()
  const priorAt = recentChatGPTCommentIds.get(`${key}:${commentId}`) || 0
  const priorFingerprintAt = recentChatGPTCommentFingerprints.get(fingerprint) || 0
  if (now - priorAt < 30 * 60 * 1000 || now - priorFingerprintAt < 60 * 1000) return { ok: true, cacheKey: key, queued: hasPendingChatGPTComments(key), requestId, duplicate: true }
  const queue = pendingChatGPTComments.get(key) || []
  const sessionId = request?.sessionId ? sanitizeSessionId(request.sessionId) : ''
  if (!queue.some((item) => item.commentId === commentId || item.fingerprint === fingerprint)) queue.push({ commentId, fingerprint, text, comment, sessionId, url: String(request?.url || ''), requestId, attachments, reasoningEffort, queuedAt: now })
  pendingChatGPTComments.set(key, queue)
  await flushQueuedChatGPTComments()
  return { ok: true, cacheKey: key, queued: Boolean(pendingChatGPTComments.get(key)?.length), requestId }
}

function hasPendingChatGPTComments(key) {
  return Boolean(pendingChatGPTComments.get(key)?.length)
}

async function flushQueuedChatGPTComments() {
  for (const [key, queue] of pendingChatGPTComments) {
    while (queue.length && Date.now() - queue[0].queuedAt > 30 * 60 * 1000) queue.shift()
    if (!queue.length) { pendingChatGPTComments.delete(key); continue }
    if (flushingChatGPTComments.has(key)) continue
    const ownedEntry = chatgptViews.get(key)
    if (!ownedEntry || ownedEntry.humanAction?.active) continue
    flushingChatGPTComments.add(key)
    const pending = queue[0]
    try {
      await withChatGPTTransportPreparation(key, ownedEntry, pending.requestId, async () => {
        const target = await targetChatGPTComposer(key, pending.url, false)
        target.reasoningEffort = normalizeChatGPTReasoningEffort(pending.reasoningEffort)
        target.entry.reasoningEffort = target.reasoningEffort
        const ready = await executeChatGPTDOMScript(key, target.entry, 'comment-composer-ready', chatGPTComposerReadyScript())
        if (!ready) return
        const expected = expectedChatGPTBundles.get(key)
        const liveTunnels = expected?.requestId === pending.requestId && Array.isArray(expected.liveTunnels) ? expected.liveTunnels : []
        const commentPrompt = expected?.requestId === pending.requestId && expected.originalPrompt
          ? `${pending.text}\n\nORIGINAL REQUEST CONTENT — authoritative task context repeated inside this comment bundle:\n\n${expected.originalPrompt}`
          : pending.text
        const expectedFilename = expected?.requestId === pending.requestId ? expected.filename : canonicalBundleFilename(key, pending.requestId)
        const requestMetadata = expected?.requestId === pending.requestId ? expected.requestMetadata || {} : pending.requestMetadata || {}
        const bundled = await fillBundledChatGPTComposer(key, target.entry, pending.sessionId, pending.requestId, commentPrompt, expectedFilename, pending.attachments, liveTunnels, requestMetadata)
        const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
        await wait(80)
        await submitChatGPTDraft(key, target.entry, target.conversationUrl, target)
        if (pending.sessionId) {
          try { await publishRemoteChannelComment(pending.sessionId, pending.requestId, pending.comment) }
          catch (error) { console.warn(`[remote-channel-comment] ${error instanceof Error ? error.message : String(error)}`) }
        }
        queue.shift()
        recentChatGPTCommentIds.set(`${key}:${pending.commentId}`, Date.now())
        recentChatGPTCommentFingerprints.set(pending.fingerprint, Date.now())
        if (!queue.length) pendingChatGPTComments.delete(key)
        if (expectedChatGPTBundles.has(key)) armExpectedChatGPTBundle(key, pending.requestId, assistantBaseline, '', [], '', pending.sessionId, expectedFilename, requestMetadata)
        touchChatGPTEntry(target.entry)
        sendToChatGPTKey(key, 'wharness:chatgpt:comment-sent', { cacheKey: key, requestId: pending.requestId, attachments: bundled.attachmentCount })
      })
      break
    } catch (error) {
      console.warn(`[chatgpt-comment] queued key=${key} error=${error instanceof Error ? error.message : String(error)}`)
    } finally {
      flushingChatGPTComments.delete(key)
      const cutoff = Date.now() - 30 * 60 * 1000
      const fingerprintCutoff = Date.now() - 60 * 1000
      for (const [id, sentAt] of recentChatGPTCommentIds) if (sentAt < cutoff) recentChatGPTCommentIds.delete(id)
      for (const [fingerprint, sentAt] of recentChatGPTCommentFingerprints) if (sentAt < fingerprintCutoff) recentChatGPTCommentFingerprints.delete(fingerprint)
    }
  }
}

async function publishRemoteChannelComment(sessionId, requestId, comment) {
  const target = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/remote-input/events`, BACKEND_URL)
  const response = await fetch(target, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: requestId, comment }) })
  // A durable-store request has no live channel; comment delivery through the
  // ChatGPT composer remains authoritative in that mode.
  if (!response.ok && response.status !== 409) throw new Error(`Remote channel comment HTTP ${response.status}`)
}

async function pollChatGPTVisibleActivity() {
  for (const [key, entry] of chatgptViews) {
    reconcileChatGPTThrottle(key, entry)
    const wc = entry.view.webContents
    if (wc.isDestroyed() || !isTrustedChatGPTOrigin(wc.getURL())) continue
    // Mirrors the same guard in pollExpectedChatGPTDownloadKey: probing the
    // DOM mid-navigation (right after a reload) can transiently fail
    // executeJavaScript, accumulating healthProbeFailures and triggering a
    // second, redundant recovery reload on top of one already in flight.
    if (entry.loading) continue
    if (chatgptTransportModes.get(key) === 'manual') continue
    try {
      const health = await wc.executeJavaScript(chatGPTHumanActionScript(), true)
      entry.healthProbeFailures = 0
      // The one probe that runs for every owned surface on a timer, so it is
      // also where a gate raised outside an active task is noticed.
      noteChatGPTRateLimitGate(key, health)
      const surfaceFingerprint = `${Boolean(health?.composerReady)}:${Boolean(health?.pageVisible)}:${String(health?.kind || '')}`
      if (entry.lastSurfaceFingerprint !== surfaceFingerprint) {
        entry.lastSurfaceFingerprint = surfaceFingerprint
        const expected = expectedChatGPTBundles.get(key)
        if (expected?.recovery) noteChatGPTRecoveryProgress(expected.recovery, `surface:${surfaceFingerprint}`, Date.now())
      }
      const expectedActive = expectedChatGPTBundles.has(key)
      const humanKind = String(health?.kind || 'verification')
      if (health?.required === true && (humanKind === 'verification' || humanKind === 'access' || expectedActive)) {
        setChatGPTHumanAction(key, humanKind, '', 'dom')
        continue
      }
      if (entry.humanAction?.source === 'dom' && health?.composerReady === true) clearChatGPTHumanAction(key, 'desafio humano concluído e compositor disponível')
      else if (entry.humanAction?.active && ['surface', 'authentication', 'access'].includes(entry.humanAction.kind) && health?.composerReady === true) clearChatGPTHumanAction(key, 'compositor voltou a responder')

      const activity = await wc.executeJavaScript(chatGPTVisibleActivityScript(), true)
      const expected = expectedChatGPTBundles.get(key)
      const normalized = { cacheKey: key, requestId: expected?.requestId || '', state: activity?.state === 'thinking' ? 'thinking' : 'idle', text: String(activity?.text || '').trim(), capturedAt: String(activity?.capturedAt || new Date().toISOString()) }
      const fingerprint = `${normalized.requestId}:${normalized.state}:${normalized.text}`
      if (chatGPTActivityFingerprints.get(key) === fingerprint) continue
      chatGPTActivityFingerprints.set(key, fingerprint)
      if (expected?.recovery) noteChatGPTRecoveryProgress(expected.recovery, `activity:${fingerprint}`, Date.now())
      sendToChatGPTKey(key, 'wharness:chatgpt:activity', normalized)
    } catch (error) {
      entry.healthProbeFailures = Number(entry.healthProbeFailures || 0) + 1
      if (expectedChatGPTBundles.has(key) && entry.healthProbeFailures >= CHATGPT_DOM_PROBE_FAILURE_LIMIT) {
        noteChatGPTRendererFault(key, `DOM health probe failed ${entry.healthProbeFailures} times: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

async function performChatGPTRecoveryAction(key, expected, entry, action, completion = {}) {
  if (!action || !expected?.recovery) return false
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  const now = Date.now()
  if (action.type === 'reload') {
    commitChatGPTRecoveryAction(expected.recovery, action, now)
    expected.settledAt = 0
    expected.lastDOMClick = 0
    console.warn(`[chatgpt-recovery] reload key=${key} request=${expected.requestId} reason=${action.reason} attempt=${expected.recovery.reloadCount}`)
    await reloadOwnedChatGPTConversation(key, entry, 'recovery-reload')
    const text = action.reason === 'transport'
      ? 'Falha de ligação detetada no ChatGPT. A conversa foi recarregada automaticamente para re-hidratar o processamento.'
      : action.reason === 'surface'
        ? 'O compositor do ChatGPT deixou de estar disponível. A conversa foi recarregada uma vez para recuperar a interface sem alterar o pedido.'
        : action.reason === 'stalled'
          ? 'O processamento do ChatGPT parece ter parado. A conversa foi recarregada uma vez para recuperar atualizações pendentes.'
          : action.reason === 'silent'
            ? 'O ChatGPT deixou de mostrar processamento sem produzir nova resposta. A conversa foi recarregada uma vez para recuperar o pedido.'
            : 'A resposta terminou sem o bundle esperado. A conversa foi recarregada uma vez antes da continuação automática.'
    sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, requestId: expected.requestId, state: 'thinking', text, capturedAt: new Date().toISOString() })
    return true
  }
  if (action.type === 'human') {
    commitChatGPTRecoveryAction(expected.recovery, action, now)
    const kind = action.reason === 'surface-unavailable' ? 'surface' : action.reason === 'recovery-exhausted' ? 'stalled' : 'transport'
    setChatGPTHumanAction(key, kind, action.detail || '', 'recovery')
    return true
  }
  if (action.type !== 'prompt') return false
  const prompt = chatGPTStalledRecoveryPrompt(expected.requestId, expected.filename, expected.originalPrompt)
  try {
    await withChatGPTTransportPreparation(key, entry, expected.requestId, async () => {
      if (expectedChatGPTBundles.get(key) !== expected) return
      await fillBundledChatGPTComposer(key, entry, expected.sessionId, expected.requestId, prompt, expected.filename, [], expected.liveTunnels || [], expected.requestMetadata || {})
      await wait(80)
      if (expectedChatGPTBundles.get(key) !== expected) return
      await submitChatGPTDraft(key, entry, entry.affinity.boundURL, { entry, wc, conversationUrl: entry.affinity.boundURL })
    })
  } catch (error) {
    escalateChatGPTContinuationFailure(key, expected, error, 'automatic-recovery')
    return true
  }
  if (expectedChatGPTBundles.get(key) !== expected) return true
  commitChatGPTRecoveryAction(expected.recovery, action, now)
  expected.assistantBaseline = Math.max(expected.assistantBaseline, Number(completion?.assistantCount) || 0)
  expected.settledAt = 0
  expected.lastDOMClick = 0
  console.warn(`[chatgpt-recovery] prompt key=${key} request=${expected.requestId} accepted=true`)
  sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, requestId: expected.requestId, state: 'thinking', text: 'O ChatGPT continuou parado após a recarga. O Wharnex enviou uma instrução automática para retomar o pedido original e concluir a entrega.', capturedAt: new Date().toISOString() })
  return true
}

function escalateChatGPTContinuationFailure(key, expected, error, source) {
  const detail = String(error instanceof Error ? error.message : error || 'erro desconhecido').slice(0, 500)
  if (expected?.recovery) {
    commitChatGPTRecoveryAction(expected.recovery, { type: 'human', reason: 'continuation-preparation', detail }, Date.now())
  }
  setChatGPTHumanAction(key, 'transport', `Não foi possível preparar a continuação do pedido: ${detail}`, source)
  console.warn(`[chatgpt-recovery] continuation-failed key=${key} request=${expected?.requestId || '-'} source=${source} error=${detail}`)
}

async function pollExpectedChatGPTDownloadKey(key) {
  if (pollingExpectedChatGPTBundles.has(key)) return
  pollingExpectedChatGPTBundles.add(key)
  const now = Date.now()
  try {
    const expected = expectedChatGPTBundles.get(key)
    if (!expected || hasPendingChatGPTComments(key)) return
    // Once validated bytes are durable, the backend handoff/ACK is the only
    // remaining operation. Do not inspect the remote page or submit another
    // continuation while that local transaction is still settling.
    if (pendingChatGPTBundleDeliveries.has(expected.requestId)) return
    if (chatgptTransportModes.get(key) === 'manual') { expectedChatGPTBundles.delete(key); return }
    if (now - expected.armedAt > EXPECTED_BUNDLE_TTL_MS) {
      expectedChatGPTBundles.delete(key)
      sendToChatGPTKey(key, 'wharness:chatgpt:bundle-download-error', { cacheKey: key, requestId: expected.requestId, error: 'Tempo limite excedido enquanto o Wharnex aguardava o bundle canónico.' })
      return
    }
    const entry = chatgptViews.get(key)
    // The Supervisor bound to this chat owns its response supervision, visible
    // or not. It is already on the conversation, so reading it here costs no
    // provider request at all — which is the whole point of binding a Supervisor
    // to a chat for the life of its request.
    if (!entry || !chatGPTSupervisorOwnsExpectedResponse(key, expected.requestId)) return
    // Recovery reloads and DOM probes must not race the serialized upload or
    // prompt preparation currently owning this surface. The next main-process
    // sweep will resume supervision after the transport boundary is released.
    if (Number(entry?.transportPreparationCount || 0) > 0) return
    const wc = entry?.view.webContents
    if (!entry || wc?.isDestroyed() || !isTrustedChatGPTOrigin(wc.getURL())) return
    if (entry.humanAction?.active) return
    if (Number(expected.backoffUntil || 0) > now) return
    try {
      const faultAction = chooseChatGPTRecoveryAction(expected.recovery, {}, now, { faultOnly: true })
      if (faultAction) {
        await performChatGPTRecoveryAction(key, expected, entry, faultAction)
        return
      }
      if (entry.loading) {
        if (!entry.loadingFaultNoted && entry.loadingSince && now - entry.loadingSince >= 30_000) {
          entry.loadingFaultNoted = true
          noteChatGPTRecoveryFault(expected.recovery, 'ChatGPT page load remained pending for more than 30 seconds', now)
        }
        return
      }

      // This request's bundle already arrived. Without this check the poller
      // kept clicking the same download affordance forever: each click really
      // downloaded the file again, the will-download handler recognised it as a
      // duplicate and dropped it, `downloadInFlight` cleared on `done`, and the
      // next sweep clicked again — a hot loop that re-downloaded the same ZIP
      // indefinitely while never making progress. Supervision for this request
      // is finished, so release it rather than merely skipping the click.
      if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId)) {
        console.log(`[chatgpt-bundle-dom] already-delivered key=${key} request=${expected.requestId}; releasing expectation`)
        disarmExpectedChatGPTBundle(key, expected.requestId)
        return
      }

      // downloadInFlight guards against re-clicking while a prior click's
      // download hasn't reached will-download yet: if ChatGPT takes longer
      // than DOM_DOWNLOAD_RETRY_MS to actually start serving the file, the
      // time-only cooldown below would otherwise fire a second concurrent
      // download of the identical file, which Chromium disambiguates on
      // disk with a "(1)"/"(2)" suffix and which the download handler would
      // then publish as two separate bundle-downloaded deliveries for the
      // same request. Cleared by the will-download handler once this
      // download resolves (success or failure), not by a timer, so it never
      // gets stuck open longer than the actual download takes.
      const keepFlowing = chatAgentKeepFlowingRequestActive(expected.requestId)
      if (!expected.downloadInFlight && (!keepFlowing || Number(expected.invalidBundleCount || 0) === 0) && (!expected.lastDOMClick || now - expected.lastDOMClick >= DOM_DOWNLOAD_RETRY_MS)) {
        await captureChatGPTProcessingDuration(entry, expected)
        const clickMode = await wc.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, expected.assistantBaseline), true)
        if (clickMode) {
          expected.lastDOMClick = now
          expected.downloadInFlight = true
          expected.progressAt = now
          recentExpectedDownload = { key, requestId: expected.requestId, at: now }
          console.log(`[chatgpt-bundle-dom] download-triggered key=${key} file=${expected.filename} mode=${clickMode}`)
          return
        }
      }

      // A restored conversation may contain many historical assistant turns.
      // During rehydration only the exact bundle affordance is authoritative;
      // terminal/recovery decisions begin after a fresh structural baseline.
      if (expected.rehydrating) return
      if (Number(expected.recoveryEligibleAt || 0) > now) return

      const completion = await wc.executeJavaScript(chatGPTResponseCompletionScript(expected.assistantBaseline), true)
      expected.domProbeFailures = 0
      noteChatGPTRecoveryAssistantCount(expected.recovery, completion?.assistantCount, now)
      // Structural evidence the page is alive. The durable supervision reads this
      // stamp to bound a passive observation that never spends an attempt, so the
      // clock has to be reset by any generating or completion signal — never by
      // the mere fact that a probe ran.
      if (completion?.thinking === true || completion?.complete === true) expected.progressAt = now
      if (completion?.thinking === true) {
        if (!expected.processingObservedAt) expected.processingObservedAt = now
        expected.processingAbsentSince = 0
      } else if (expected.processingObservedAt && !expected.processingAbsentSince) {
        expected.processingAbsentSince = now
      }
      if (completion?.complete === true) await captureChatGPTProcessingDuration(entry, expected)
      const processingSignalActive = completion?.thinking === true
        || Boolean(expected.processingAbsentSince && now - expected.processingAbsentSince < PROCESSING_SIGNAL_GRACE_MS)
      const transport = classifyChatGPTConversationTransport(entry.conversationRequests, {
        generation: entry.conversationTransportGeneration,
        loading: entry.loading,
        surfaceReady: completion?.composerReady === true,
        thinking: processingSignalActive,
        lastConversationActivity: entry.lastConversationActivity,
      }, now, { staleMs: CONVERSATION_TRANSPORT_STALE_MS })
      if (transport.state === 'stale') for (const requestId of transport.staleRequestIds) entry.staleConversationRequestIds.add(requestId)
      reconcileChatGPTConversationTransport(entry.conversationRequests, transport)
      const lastMeaningfulProgress = Math.max(Number(entry.lastConversationActivity || 0), Number(expected.recovery?.lastProgressAt || 0))
      if (transport.state === 'stale' && completion?.composerReady === true && processingSignalActive === false) {
        setChatGPTHumanAction(key, 'stalled', 'O transporte de conversa registado ficou sem atividade e a superfície está ociosa. Confirme a conversa ou use “Retomar pedido”.', 'stale-conversation-transport')
        return
      }
      if (completion?.thinking === true && completion?.composerReady === true && transport.state !== 'active' && now - lastMeaningfulProgress >= PROCESSING_STALE_ATTENTION_MS) {
        setChatGPTHumanAction(key, 'stalled', 'O controlo de processamento continua visível, mas não existe atividade de rede nem progresso estrutural recente. O Wharnex não interrompeu a tarefa; confirme a conversa ou use “Retomar pedido”.', 'ambiguous-processing-control')
        return
      }
      const responseStarted = Number(completion?.assistantCount || 0) > Number(expected.assistantBaseline || 0)
      if (!completion?.complete) expected.settledAt = 0
      else if (!expected.settledAt) expected.settledAt = now
      const completionSettled = completion?.complete === true
        && Boolean(expected.settledAt)
        && now - expected.settledAt >= BUNDLE_COMPLETION_GRACE_MS
      const recoveryAction = chooseChatGPTRecoveryAction(expected.recovery, {
        complete: completionSettled,
        thinking: processingSignalActive,
        failed: completion?.failed === true,
        responseStarted,
        surfaceReady: completion?.composerReady === true,
        humanActionRequired: entry.humanAction?.active === true,
        awaitingConversationAffinity: isChatGPTAffinityAwaitingSettlement(entry.affinity)
          && now - expected.armedAt < CHATGPT_AFFINITY_RECOVERY_GRACE_MS,
        transportActive: transport.state === 'active',
      }, now)
      if (recoveryAction) {
        await performChatGPTRecoveryAction(key, expected, entry, recoveryAction, completion)
        return
      }

      if (!completion?.complete || !completionSettled) return
      if (Number(expected.continuationCount || 0) >= MAX_BUNDLE_CONTINUATIONS) {
        setChatGPTHumanAction(key, 'stalled', `O ChatGPT terminou sem disponibilizar ${expected.filename} depois da continuação automática limitada. Use “Retomar pedido” depois de verificar a conversa.`, 'recovery')
        return
      }
      const continuationDelay = Math.min(30_000, BUNDLE_CONTINUATION_BASE_MS + Number(expected.continuationCount || 0) * 3_000)
      if (expected.lastContinuationAt && now - expected.lastContinuationAt < continuationDelay) return

      const continuation = chatGPTDeliveryContinuationPrompt(expected.requestId, expected.filename, expected.originalPrompt)
      try {
        await withChatGPTTransportPreparation(key, entry, expected.requestId, async () => {
          if (expectedChatGPTBundles.get(key) !== expected) return
          await fillBundledChatGPTComposer(key, entry, expected.sessionId, expected.requestId, continuation, expected.filename, [], expected.liveTunnels || [], expected.requestMetadata || {})
          await wait(80)
          if (expectedChatGPTBundles.get(key) !== expected) return
          await submitChatGPTDraft(key, entry, entry.affinity.boundURL, { entry, wc, conversationUrl: entry.affinity.boundURL })
        })
      } catch (error) {
        // Continuation assembly/submission is an operational transport failure,
        // not a DOM probe failure. Escalate once and pause this supervisor;
        // otherwise the successful completion probe above resets the generic
        // failure counter on every sweep and this block loops forever.
        escalateChatGPTContinuationFailure(key, expected, error, 'delivery-continuation')
        return
      }
      expected.assistantBaseline = Math.max(expected.assistantBaseline, Number(completion.assistantCount) || 0)
      expected.continuationCount = Number(expected.continuationCount || 0) + 1
      expected.lastContinuationAt = now
      expected.settledAt = 0
      expected.lastDOMClick = 0
      expected.invalidBundleCount = 0
      expected.recovery = createChatGPTRecoveryState(now)
      console.log(`[chatgpt-bundle-dom] continuation-submitted key=${key} request=${expected.requestId} attempt=${expected.continuationCount}`)
      sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, state: 'thinking', text: `Bundle não detetado após a resposta. Continuação automática ${expected.continuationCount} enviada para preservar o objetivo.`, capturedAt: new Date().toISOString() })
    } catch (error) {
      expected.domProbeFailures = Number(expected.domProbeFailures || 0) + 1
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[chatgpt-bundle-dom] scan-failed key=${key} failures=${expected.domProbeFailures} error=${detail}`)
      if (expected.domProbeFailures >= CHATGPT_DOM_PROBE_FAILURE_LIMIT) noteChatGPTRendererFault(key, `bundle DOM probe failed ${expected.domProbeFailures} times: ${detail}`)
    }
  } finally {
    pollingExpectedChatGPTBundles.delete(key)
  }
}

async function pollExpectedChatGPTDownloads() {
  const keys = [...expectedChatGPTBundles.keys()]
  await Promise.allSettled(keys.map((key) => pollExpectedChatGPTDownloadKey(key)))
}

async function exportBrowserSession(windowState) {
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  await chatSession.flushStorageData()
  closeAllChatGPTViews()
  closeAllInternalChatGPTBrowsers()
  const snapshot = await snapshotBrowserSession(chatGPTPartitionPath())
  const result = await dialog.showSaveDialog(windowState?.window, {
    title: 'Exportar sessão do navegador Wharnex',
    defaultPath: path.join(app.getPath('downloads'), `wharness-browser-session-${new Date().toISOString().slice(0, 10)}.whbs`),
    filters: [{ name: 'Wharnex Browser Session', extensions: ['whbs'] }],
  })
  if (result.canceled || !result.filePath) return { cancelled: true }
  await writeFile(result.filePath, snapshot, { mode: 0o600 })
  return { cancelled: false, bytes: snapshot.byteLength, filename: path.basename(result.filePath) }
}

async function importBrowserSession(windowState) {
  const result = await dialog.showOpenDialog(windowState?.window, {
    title: 'Importar sessão do navegador Wharnex',
    defaultPath: app.getPath('downloads'),
    properties: ['openFile'],
    filters: [{ name: 'Wharnex Browser Session', extensions: ['whbs'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
  const raw = await readFile(result.filePaths[0])
  const validationRoot = path.join(app.getPath('temp'), `wharness-browser-import-${process.pid}`)
  const restored = await restoreBrowserSession(validationRoot, raw)
  await rm(validationRoot, { recursive: true, force: true })
  await writeFile(pendingBrowserImportPath(), raw, { mode: 0o600 })
  closeAllChatGPTViews()
  closeAllInternalChatGPTBrowsers()
  setTimeout(() => { app.relaunch(); app.exit(0) }, 500)
  return { cancelled: false, restarting: true, ...restored }
}

async function applyPendingBrowserSessionImport() {
  let raw
  try { raw = await readFile(pendingBrowserImportPath()) } catch { return false }
  await restoreBrowserSession(chatGPTPartitionPath(), raw)
  await rm(pendingBrowserImportPath(), { force: true })
  console.log('[chatgpt-session] imported browser session before partition startup')
  return true
}

async function clearBrowserSession() {
  const authRecords = [...chatGPTAuthBrowsers.values()]
  closeAllChatGPTViews()
  closeAllInternalChatGPTBrowsers()
  for (const record of authRecords) await closeManagedBrowserAuth(record)
  preparedChatGPTDrafts.clear()
  retryableChatGPTPrompts.clear()
  expectedChatGPTBundles.clear()
  recentExpectedDownload = undefined
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  await chatSession.clearStorageData()
  await chatSession.clearCache()
  await chatSession.flushStorageData()
  await rm(managedAuthProfilePath(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  return { ok: true }
}

async function desktopStorageUsage() {
  const userData = app.getPath('userData')
  const embeddedBrowserBytes = await pathSize(chatGPTPartitionPath())
  const managedBrowserBytes = await pathSize(managedAuthProfilePath())
  const browserBytes = embeddedBrowserBytes + managedBrowserBytes
  const attachmentBytes = await pathSize(chatAttachmentRoot())
  let tempBytes = 0
  let entries = []
  try { entries = await readdir(app.getPath('temp'), { withFileTypes: true }) } catch { /* best effort */ }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^(wharness-(bundles|plans|context|chat-inputs|chat-protocol))$/.test(entry.name)) continue
    tempBytes += await pathSize(path.join(app.getPath('temp'), entry.name))
  }
  const userDataBytes = await pathSize(userData)
  return { total_bytes: userDataBytes + tempBytes, user_data_bytes: userDataBytes, browser_bytes: browserBytes, attachment_bytes: attachmentBytes, temp_bytes: tempBytes, other_user_data_bytes: Math.max(0, userDataBytes - browserBytes - attachmentBytes) }
}

async function clearDesktopWharnessData() {
  await clearBrowserSession()
  const localSession = session.defaultSession
  await localSession.clearStorageData()
  await localSession.clearCache()
  await localSession.flushStorageData()
  await rm(chatAttachmentRoot(), { recursive: true, force: true })
  await rm(pendingBrowserImportPath(), { force: true })
  for (const name of ['wharness-bundles', 'wharness-plans', 'wharness-context', 'wharness-chat-inputs', 'wharness-chat-protocol']) {
    await rm(path.join(app.getPath('temp'), name), { recursive: true, force: true })
  }
  return { ok: true }
}

function chatGPTConversationID(value) {
  try {
    const trusted = requireTrustedChatGPTURL(value)
    // A conversation that lives inside a ChatGPT project is served from
    // `/g/g-p-<project>/c/<id>`, not `/c/<id>`. Matching only the root form
    // meant that moving a conversation into the Wharnex project — which the
    // account automation does deliberately — silently unbound its affinity and
    // left account operations unable to address it by id.
    const { pathname } = new URL(trusted)
    const id = /(?:^|\/)c\/([^/?#]+)/.exec(pathname)?.[1] || ''
    return /^WEB(?::|%3A)/i.test(id) ? '' : id
  } catch { return '' }
}

function canonicalChatGPTConversationURL(value) {
  const id = chatGPTConversationID(value)
  return id ? `https://chatgpt.com/c/${id}` : ''
}

function sameConversationURL(left, right) {
  const a = chatGPTConversationID(left)
  const b = chatGPTConversationID(right)
  return Boolean(a && b && a === b)
}

function openInternalChatGPTBrowser(windowState, value) {
  if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot open internal ChatGPT browser without an owning Wharnex window')
  const target = requireTrustedChatGPTURL(value || CHATGPT_URL)
  const existing = internalChatGPTBrowsers.get(windowState.id)
  if (existing && !existing.isDestroyed()) {
    if (existing.webContents.getURL() !== target) void existing.loadURL(target).catch((error) => console.error(`[chatgpt-internal-browser] navigation failed error=${error?.message || 'unknown'}`))
    existing.show()
    existing.focus()
    return { ok: true, reused: true }
  }

  const browser = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: desktopWindowTitle(windowState.activeProject, DESKTOP_INSTANCE),
    icon: DESKTOP_ICON,
    parent: windowState.window,
    autoHideMenuBar: true,
    webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }),
  })
  internalChatGPTBrowsers.set(windowState.id, browser)
  browser.webContents.setUserAgent(CHATGPT_USER_AGENT)
  browser.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedChatGPTOrigin(url)) {
      void browser.loadURL(requireTrustedChatGPTURL(url)).catch((error) => console.error(`[chatgpt-internal-browser] popup navigation failed error=${error?.message || 'unknown'}`))
    } else if (isHTTPS(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  browser.webContents.on('will-navigate', (event, url) => {
    if (isTrustedChatGPTOrigin(url)) return
    event.preventDefault()
    if (isHTTPS(url)) void shell.openExternal(url)
  })
  browser.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[chatgpt-internal-browser] renderer gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  browser.on('closed', () => {
    if (internalChatGPTBrowsers.get(windowState.id) === browser) internalChatGPTBrowsers.delete(windowState.id)
  })
  void browser.loadURL(target).catch((error) => console.error(`[chatgpt-internal-browser] initial load failed error=${error?.message || 'unknown'}`))
  return { ok: true, reused: false }
}

function createWindow(windowId = `window-${randomUUID()}`, persistLayout = true) {
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(windowId || '')) ? String(windowId) : `window-${randomUUID()}`
  const initialWindowSize = loadWindowSize(id)
  const win = new BrowserWindow({
    width: initialWindowSize.width,
    height: initialWindowSize.height,
    minWidth: MIN_DESKTOP_WINDOW_SIZE.width,
    minHeight: MIN_DESKTOP_WINDOW_SIZE.height,
    title: desktopWindowTitle('', DESKTOP_INSTANCE),
    icon: DESKTOP_ICON,
    name: `wharness-${id}`,
    backgroundColor: '#eceee7',
    autoHideMenuBar: true,
    // The themed shell owns every visible pixel of window chrome, including
    // minimize, maximize and close. This keeps the controls consistent with
    // the selected Wharnex theme instead of mixing native window buttons into
    // the project header.
    frame: false,
    webPreferences: securePreferences({ preload: path.join(here, 'preload.cjs') }),
  })
  const state = { id, window: win, projects: new Set(), activeProject: '', activeChatGPTKey: '', chatgptVisible: false, chatgptBounds: undefined, activeAgentInteractionId: '' }
  desktopWindows.set(id, state)
  mainWindow = win

  const target = new URL(FRONTEND_URL)
  target.searchParams.set('wharnessWindow', id)
  target.searchParams.set('wharnessRuntime', FRONTEND_RUNTIME_TOKEN)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHTTPS(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== FRONTEND_ORIGIN) event.preventDefault() }
    catch { event.preventDefault() }
  })
  // The trusted local frontend renderer previously had no crash recovery at
  // all: a GPU/OOM-triggered renderer death left a permanently blank window
  // with no diagnostic trace, indistinguishable from the whole app crashing.
  // Renderer-crash recovery is deliberately paced and bounded.
  //
  // Reloading the instant the process dies can re-enter the same failure: a
  // loadURL issued while a previous sandboxed renderer spawn is still settling
  // is one of the ways Electron produces "Cannot destructure property
  // 'preloadScripts' of 'binding.startupData'", so an immediate retry can turn
  // a single crash into a reload loop. Back off, and stop retrying rather than
  // thrash — a window that will not come back needs a human, not another spin.
  state.rendererRestarts = 0
  state.rendererRestartTimer = undefined
  win.webContents.on('render-process-gone', (_event, details) => {
    hideChatAgentInteractionsForWindow(state)
    console.error(`[frontend-renderer] window=${id} gone reason=${details.reason} exitCode=${details.exitCode} restarts=${state.rendererRestarts}`)
    if (quitting || details.reason === 'clean-exit') return
    if (state.rendererRestarts >= FRONTEND_RENDERER_RESTART_LIMIT) {
      console.error(`[frontend-renderer] window=${id} exceeded ${FRONTEND_RENDERER_RESTART_LIMIT} restarts; leaving it stopped for human attention`)
      return
    }
    state.rendererRestarts += 1
    const delay = Math.min(8_000, 500 * (2 ** (state.rendererRestarts - 1)))
    clearTimeout(state.rendererRestartTimer)
    state.rendererRestartTimer = setTimeout(() => {
      if (quitting || win.isDestroyed()) return
      void win.loadURL(target.href).catch((error) => console.error(`[frontend-renderer] reload failed window=${id} error=${error?.message || 'unknown'}`))
    }, delay)
  })
  // A renderer that stays up long enough to be usable clears the crash budget,
  // so an unrelated crash weeks later still gets its full allowance.
  win.webContents.on('did-finish-load', () => {
    clearTimeout(state.rendererRestartHealthyTimer)
    state.rendererRestartHealthyTimer = setTimeout(() => { state.rendererRestarts = 0 }, 30_000)
  })
  win.webContents.on('unresponsive', () => console.error(`[frontend-renderer] window=${id} unresponsive`))
  win.webContents.on('responsive', () => console.log(`[frontend-renderer] window=${id} responsive`))
  win.on('focus', () => { mainWindow = win; win.flashFrame(false); publishChatGPTState(state.activeChatGPTKey) })
  win.on('blur', () => publishChatGPTState(state.activeChatGPTKey))
  win.on('resize', scheduleWindowLayoutPersistence)
  win.on('close', () => { hideChatAgentInteractionsForWindow(state); if (!quitting) rehomeChatGPTWorkers(state) })
  win.on('closed', () => {
    closeInternalChatGPTBrowserForWindow(state)
    closeChatGPTViewsForWindow(state)
    releaseWindowProjects(state)
    desktopWindows.delete(id)
    if (mainWindow === win) mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!quitting) persistWindowLayout()
  })

  void win.loadURL(target.href)
  if (!quitting && persistLayout) persistWindowLayout()
  return state
}

function registerIPC() {
  ipcMain.handle('wharness:projects:pick-directory', async (event, request) => {
    const windowState = trustedSender(event)
    const result = await dialog.showOpenDialog(windowState.window, {
      title: typeof request?.title === 'string' ? request.title.slice(0, 120) : 'Selecionar pasta',
      defaultPath: typeof request?.defaultPath === 'string' && path.isAbsolute(request.defaultPath) ? request.defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    })
    return { cancelled: result.canceled || result.filePaths.length === 0, path: result.filePaths[0] || '' }
  })
  ipcMain.handle('wharness:projects:acquire', (event, request) => acquireProjectForWindow(trustedSender(event), request?.projectPath))
  ipcMain.handle('wharness:projects:release', (event, request) => releaseProjectForWindow(trustedSender(event), request?.projectPath))
  ipcMain.handle('wharness:projects:activate', (event, request) => {
    const windowState = trustedSender(event)
    const projectPath = canonicalProjectPath(request?.projectPath)
    if (!windowState.projects.has(projectPath)) throw new Error('Projeto ativo não pertence a esta janela')
    if (windowState.activeProject && windowState.activeProject !== projectPath) suspendNativeSurfacesForWindow(windowState)
    windowState.activeProject = projectPath
    windowState.window.setTitle(desktopWindowTitle(projectPath, DESKTOP_INSTANCE))
    return { ok: true, path: projectPath }
  })
  ipcMain.handle('wharness:projects:bindings', (event) => {
    const windowState = trustedSender(event)
    return { windowId: windowState.id, projects: [...windowState.projects] }
  })
  ipcMain.handle('wharness:windows:info', (event) => {
    const windowState = trustedSender(event)
    return { windowId: windowState.id, windowCount: desktopWindows.size }
  })
  ipcMain.handle('wharness:windows:projects', (event) => {
    const current = trustedSender(event)
    const focused = BrowserWindow.getFocusedWindow()
    const items = []
    for (const state of desktopWindows.values()) {
      if (state.window.isDestroyed()) continue
      for (const projectPath of state.projects) items.push({ windowId: state.id, projectPath, focused: focused === state.window })
    }
    return { currentWindowId: current.id, items }
  })
  ipcMain.handle('wharness:windows:focus-project', (event, request) => {
    trustedSender(event)
    const projectPath = canonicalProjectPath(request?.projectPath)
    const owner = [...desktopWindows.values()].find((state) => !state.window.isDestroyed() && state.projects.has(projectPath))
    if (!owner) throw new Error('O projeto já não está aberto noutra janela do Wharnex.')
    sendToWindowState(owner, 'wharness:windows:activate-project', { projectPath })
    owner.window.show(); owner.window.focus()
    return { ok: true, windowId: owner.id, projectPath }
  })
  ipcMain.handle('wharness:windows:open', (event) => {
    trustedSender(event)
    const windowState = createWindow()
    windowState.window.show(); windowState.window.focus()
    return { ok: true, windowId: windowState.id }
  })
  ipcMain.handle('wharness:windows:minimize', (event) => {
    const windowState = trustedSender(event)
    windowState.window.minimize()
    return { ok: true }
  })
  ipcMain.handle('wharness:windows:toggle-maximize', (event) => {
    const windowState = trustedSender(event)
    if (windowState.window.isMaximized()) windowState.window.unmaximize()
    else windowState.window.maximize()
    return { ok: true, maximized: windowState.window.isMaximized() }
  })
  ipcMain.handle('wharness:windows:close', (event) => {
    const windowState = trustedSender(event)
    setTimeout(() => {
      if (!windowState.window.isDestroyed()) windowState.window.close()
    }, 0)
    return { ok: true }
  })
  ipcMain.handle('wharness:windows:prepare-restart', (event, request) => {
    const windowState = trustedSender(event)
    const scope = request?.scope === 'current' ? 'current' : 'all'
    persistWindowLayout()
    persistRestartIntent(scope, windowState.id)
    for (const state of desktopWindows.values()) {
      sendToWindowState(state, 'wharness:windows:restart-intent', { scope, currentWindowId: windowState.id, affected: scope === 'all' || state.id === windowState.id })
    }
    return { ok: true, scope, windowCount: desktopWindows.size }
  })
  ipcMain.handle('wharness:chatgpt:show', async (event, request) => {
    const windowState = trustedSender(event)
    windowState.chatgptVisible = true
    if (deferSupervisorNavigationIfBusy(request?.cacheKey, windowState, { ...request, visible: true })) return { ok: true, deferred: true }
    const entry = activateChatGPTView(request?.cacheKey, request?.bounds, windowState)
    const wc = entry.view.webContents
    // A new WebContentsView starts on about:blank.  The renderer previously
    // sent `show` and `navigate` independently, which allowed the visible
    // view to remain blank if its initial navigate IPC was delayed or lost.
    // Carry the already-known affinity target into the show operation so the
    // first visible view always owns a concrete trusted navigation.
    const initialTarget = request?.url ? requireTrustedChatGPTURL(request.url) : CHATGPT_URL
    if (!isTrustedChatGPTOrigin(wc.getURL())) {
      void loadOwnedChatGPTURL(request?.cacheKey, entry, initialTarget, 'initial-show').catch((error) => {
        console.error(`[chatgpt-load] initial-show failed key=${sanitizeChatCacheKey(request?.cacheKey)} error=${error?.message || 'unknown'}`)
      })
    }
    if (isTrustedChatGPTOrigin(wc.getURL())) {
      await waitForChatGPTSurfaceReady(request?.cacheKey, entry)
    }
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:hide', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const entry = chatgptViews.get(key)
    if (entry?.ownerWindowId === windowState.id) entry.view.setVisible(false)
    if (windowState.activeChatGPTKey === key || (deferredSupervisorNavigation?.key === key && deferredSupervisorNavigation.windowState === windowState)) windowState.chatgptVisible = false
    if (deferredSupervisorNavigation?.key === key && deferredSupervisorNavigation.windowState === windowState) deferredSupervisorNavigation.visible = false
    if (entry) reconcileChatGPTThrottle(key, entry)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:set-bounds', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    if (key !== windowState.activeChatGPTKey || !windowState.chatgptVisible) return { ok: false }
    return { ok: setChatGPTBounds(request?.bounds, windowState) }
  })
  ipcMain.handle('wharness:chatgpt:navigate', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const target = requireTrustedChatGPTURL(request?.url || CHATGPT_URL)
    if (deferSupervisorNavigationIfBusy(key, windowState, request)) {
      return currentChatGPTState(key, windowState)
    }
    // Navigation may already be in flight when a blocking Wharnex overlay
    // hides the native WebContentsView. Preserve that visibility decision here:
    // only the explicit show IPC may make the remote view visible again.
    const entry = activateChatGPTView(key, request?.bounds, windowState)
    const wc = entry.view.webContents
    const current = wc.getURL()
    const linkedConversation = canonicalChatGPTConversationURL(target)
    const targetIsHome = target === CHATGPT_URL
    const unboundHomeIntent = Boolean(request?.resetToHomeIfConversation && targetIsHome && !linkedConversation)
    const preservePendingConversation = !linkedConversation && shouldPreserveChatGPTAffinityNavigation(entry.affinity)
    if (!preservePendingConversation) syncChatGPTAffinityURL(key, entry, linkedConversation)
    const resetToHome = Boolean(!preservePendingConversation && unboundHomeIntent && chatGPTConversationID(current))
    const keepCachedDOM = !resetToHome && targetIsHome && isTrustedChatGPTOrigin(current) && current !== 'about:blank'
    if (resetToHome || (!keepCachedDOM && current !== target && !sameConversationURL(current, target))) {
      await loadOwnedChatGPTURL(key, entry, target, 'renderer-navigate')
    }
    if (!linkedConversation) {
      observeChatGPTAffinityURL(key, entry, wc.getURL())
      scheduleChatGPTAffinitySettlement(key, entry)
    }
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:confirm-affinity', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const { entry } = ensureChatGPTView(key, windowState)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    const confirmedURL = confirmChatGPTAffinity(entry.affinity, request?.conversationUrl, wc.getURL())
    console.log(`[chatgpt-affinity] confirmed key=${key} url=${sanitizeDiagnosticURL(confirmedURL)}`)
    publishChatGPTState(key)
    return { ok: true, cacheKey: key, conversationUrl: confirmedURL, ...publicChatGPTAffinity(entry.affinity) }
  })
  ipcMain.handle('wharness:chatgpt:reject-affinity', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const { entry } = ensureChatGPTView(key, windowState)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    const rejectedURL = canonicalChatGPTConversationURL(request?.conversationUrl || '')
    rejectChatGPTAffinity(entry.affinity, rejectedURL)
    const fallbackURL = entry.affinity.boundURL || CHATGPT_URL
    if (rejectedURL && sameConversationURL(wc.getURL(), rejectedURL) && !sameConversationURL(wc.getURL(), fallbackURL)) {
      await loadOwnedChatGPTURL(key, entry, fallbackURL, 'affinity-reject')
    }
    if (!entry.affinity.boundURL) observeChatGPTAffinityURL(key, entry, wc.getURL())
    console.log(`[chatgpt-affinity] rejected key=${key} url=${sanitizeDiagnosticURL(rejectedURL)}`)
    publishChatGPTState(key)
    return { ok: true, cacheKey: key, ...publicChatGPTAffinity(entry.affinity) }
  })
  ipcMain.handle('wharness:chatgpt:reload', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    await reloadOwnedChatGPTConversation(key, entry, 'manual-reload')
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:back', (event, request) => {
    const windowState = trustedSender(event)
    const { entry } = ensureChatGPTView(request?.cacheKey, windowState)
    const { wc } = requireOwnedChatGPTEntry(request?.cacheKey, entry)
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:forward', (event, request) => {
    const windowState = trustedSender(event)
    const { entry } = ensureChatGPTView(request?.cacheKey, windowState)
    const { wc } = requireOwnedChatGPTEntry(request?.cacheKey, entry)
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:state', (event, request) => { const windowState = trustedSender(event); return currentChatGPTState(request?.cacheKey, windowState) })
  ipcMain.handle('wharness:chatgpt:open-devtools', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const entry = chatgptViews.get(key)
    if (!entry || entry.ownerWindowId !== windowState.id) throw new Error('Current ChatGPT browser instance is not available')
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    wc.openDevTools({ mode: 'detach', activate: true })
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:release', (event, request) => { const windowState = trustedSender(event); return { ok: true, released: releaseChatGPTView(request?.cacheKey, windowState) } })
  ipcMain.handle('wharness:chatgpt:live-keys', (event) => { const windowState = trustedSender(event); return [...chatgptViews.entries()].filter(([, entry]) => entry.ownerWindowId === windowState.id).map(([key]) => key) })
  // Background account lifecycle work is always a durable worker task. These
  // handlers intentionally do not call ensureChatGPTView: closing, renaming or
  // deleting a chat must never resurrect or navigate the visible Supervisor.
  ipcMain.handle('wharness:chatgpt:queue-archive', async (event, request) => {
    trustedSender(event)
    return enqueueChatAgentLifecycleTask('ARCHIVE_CHAT', request)
  })
  ipcMain.handle('wharness:chatgpt:queue-rename', async (event, request) => {
    trustedSender(event)
    return enqueueChatAgentLifecycleTask('RENAME_CHAT', request)
  })
  ipcMain.handle('wharness:chatgpt:queue-delete', async (event, request) => {
    trustedSender(event)
    return enqueueChatAgentLifecycleTask('DELETE_CHAT', request)
  })
  ipcMain.handle('wharness:chatgpt:stop-conversation', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    const result = await stopChatGPTConversation(key)
    publishChatGPTAccountAction(key, 'stop', result)
    return result
  })
  ipcMain.handle('wharness:chatgpt:suggest-title', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    return suggestChatGPTConversationTitle(key, request?.url || '')
  })
  // Dev-only behavior probe (adr/ADR-0041). Off unless WHARNESS_BEHAVIOR_PROBE=1,
  // so it is not a permanent surface. The control name is matched against a
  // closed enum before anything is built, and the script is assembled entirely
  // from constants: no caller string ever reaches the page.
  ipcMain.handle('wharness:chatgpt:probe-behavior', async (event, request) => {
    const windowState = trustedSender(event)
    if (!isBehaviorProbeEnabled()) throw new Error('The ChatGPT behavior probe is disabled; start Wharnex with WHARNESS_BEHAVIOR_PROBE=1 to enable it')
    const control = sanitizeBehaviorProbeControl(request?.control)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    if (!isTrustedChatGPTOrigin(entry.view.webContents.getURL())) throw new Error('The behavior probe only runs on a trusted ChatGPT surface')
    ensureChatGPTLayoutViewport(key, entry)
    const raw = await executeChatGPTDOMScript(key, entry, `behavior-probe-${control}`, behaviorProbeScript(control))
    const result = normalizeBehaviorProbeResult(control, raw)
    console.log(`[chatgpt-behavior-probe] control=${control} viewport=${result.viewport.w}x${result.viewport.h}`)
    return result
  })
  ipcMain.handle('wharness:chatgpt:probe-behavior-controls', async (event) => {
    trustedSender(event)
    return { enabled: isBehaviorProbeEnabled(), controls: [...BEHAVIOR_PROBE_CONTROLS] }
  })
  ipcMain.handle('wharness:chatgpt:hide-sidebar', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    return hideChatGPTSidebar(key, entry)
  })
  ipcMain.handle('wharness:chatgpt:set-auth-mode', async (event, request) => {
    const windowState = trustedSender(event)
    const mode = sanitizeChatGPTAuthMode(request?.mode)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    entry.authMode = mode
    if (mode === 'embedded') {
      cancelExternalAuthentication(key)
      entry.externalAuthProvider = ''
      if (windowState.activeChatGPTKey === key) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, windowState))
    }
    publishChatGPTState(key)
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:set-transport-mode', async (event, request) => {
    trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const mode = request?.mode === 'manual' ? 'manual' : 'scraper'
    if (mode === 'manual') chatgptTransportModes.set(key, 'manual')
    else chatgptTransportModes.delete(key)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:start-auth', async (event, request) => {
    const windowState = trustedSender(event)
    const mode = sanitizeChatGPTAuthMode(request?.mode)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    entry.authMode = mode
    entry.externalAuthProvider = ''
    entry.embeddedAuthActive = mode === 'embedded'
    entry.embeddedAuthCrossedBoundary = false
    if (mode === 'external') {
      cancelExternalAuthentication(key)
      startExternalAuthentication(entry, 'OpenAI')
      return currentChatGPTState(key, windowState)
    }
    cancelExternalAuthentication(key)
    await loadOwnedChatGPTURL(key, entry, CHATGPT_LOGIN_URL, 'embedded-auth')
    requireOwnedChatGPTEntry(key, entry)
    if (windowState.activeChatGPTKey === key) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, windowState))
    publishChatGPTState(key)
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:open-external', async (event, request) => {
    trustedSender(event)
    const target = requireTrustedChatGPTURL(request?.url || CHATGPT_URL)
    await shell.openExternal(target)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:open-internal', (event, request) => {
    const windowState = trustedSender(event)
    return openInternalChatGPTBrowser(windowState, request?.url || CHATGPT_URL)
  })
  ipcMain.handle('wharness:chatgpt:resume-embedded', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    entry.externalAuthProvider = ''
    entry.authMode = 'embedded'
    cancelExternalAuthentication(key)
    if (!isTrustedChatGPTOrigin(wc.getURL())) await loadOwnedChatGPTURL(key, entry, CHATGPT_URL, 'resume-embedded')
    requireOwnedChatGPTEntry(key, entry)
    if (windowState.activeChatGPTKey === key) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, windowState))
    publishChatGPTState(key)
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:resume-expected-bundle', async (event, request) => {
    trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.requestId || '').trim()
    const target = requireTrustedChatGPTURL(request?.url || '')
    const conversation = canonicalChatGPTConversationURL(target)
    if (!conversation) throw new Error('Pending bundle recovery requires a concrete trusted ChatGPT conversation URL')
    const recoveryPrompt = String(request?.recoveryBootstrap || '')
    const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
    const requestMetadata = {
      chat_title: String(request?.chatTitle || ''), chat_id: key,
      chat_hash: String(request?.chatHash || ''), requested_at: String(request?.requestedAt || ''),
    }
    armExpectedChatGPTBundle(key, requestId, 0, recoveryPrompt, [], recoveryPrompt, request?.sessionId, expectedFilename, requestMetadata)
    const resumedExpected = expectedChatGPTBundles.get(key)
    if (resumedExpected) resumedExpected.recoveryEligibleAt = Date.now() + chatAgentInitialRequestWaitMs()
    const workspaceChatId = durableWorkspaceChatID(key, request?.workspaceChatId)
    if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversation, { remoteState: 'awaiting-response' })
    const payload = expectedChatAgentPayload(key, requestId, conversation, {
      expectedFilename, recoveryBootstrap: recoveryPrompt, originalPrompt: recoveryPrompt,
      sessionId: request?.sessionId, workspaceChatId, requestMetadata,
    })
    await enqueueChatAgentTask('AWAIT_RESPONSE', {
      key, requestId, rootRequestId: requestId, conversationURL: conversation,
      sessionID: payload.session_id, dedupeKey: `await:${requestId}`,
      payload, maxAttempts: 30,
    })
    return { ok: true, cacheKey: key, requestId, expectedFilename, scheduled: true }
  })
  ipcMain.handle('wharness:chatgpt:continue-expected-bundle', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.requestId || '').trim()
    let expected = expectedChatGPTBundles.get(key)
    if (!expected || expected.requestId !== requestId) {
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
    }
    const { entry } = ensureChatGPTView(key, windowState)
    requireOwnedChatGPTEntry(key, entry)
    return withChatGPTTransportPreparation(key, entry, requestId, async () => {
    expected = expectedChatGPTBundles.get(key)
    if (!expected || expected.requestId !== requestId) return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
    if (expected.manualContinuationInFlight) return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'continuation_in_flight' }
    const affinityURL = canonicalChatGPTConversationURL(entry.affinity.boundURL || '')
    if (!affinityURL) {
      setChatGPTHumanAction(key, 'surface', 'A continuação não possui uma conversa ChatGPT vinculada e não será enviada noutra conversa.', 'manual-continuation-affinity')
      return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'affinity_unavailable' }
    }
    let targeted
    try { targeted = await targetChatGPTComposer(key, affinityURL, false) }
    catch { return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'surface_unavailable' } }
    const { wc } = targeted

    if (entry.loading || wc.isLoading()) {
      try {
        await waitForChatGPTSurfaceReady(key, entry)
      } catch {
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'surface_loading' }
      }
      expected = expectedChatGPTBundles.get(key)
      if (!expected || expected.requestId !== requestId) {
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'not_supervised' }
      }
    }

    const completion = await executeChatGPTDOMScript(key, entry, 'manual-continuation-state', chatGPTResponseCompletionScript(expected.assistantBaseline))
    const transport = classifyChatGPTConversationTransport(entry.conversationRequests, {
      generation: entry.conversationTransportGeneration,
      loading: entry.loading,
      surfaceReady: completion?.composerReady === true,
      thinking: completion?.thinking === true,
      lastConversationActivity: entry.lastConversationActivity,
    }, Date.now(), { staleMs: CONVERSATION_TRANSPORT_STALE_MS })
    if (transport.state === 'stale') for (const staleRequestId of transport.staleRequestIds) entry.staleConversationRequestIds.add(staleRequestId)
    reconcileChatGPTConversationTransport(entry.conversationRequests, transport)
    const staleTransport = transport.state === 'stale' || entry.staleConversationRequestIds.size > 0

    if (entry.loading) return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'surface_loading' }
    if (transport.state === 'active') return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'transport_active' }
    if ((staleTransport || completion?.thinking === true) && request?.force !== true) {
      return {
        ok: false,
        cacheKey: key,
        requestId,
        confirmationRequired: true,
        reason: staleTransport ? 'transport_stale' : 'processing_ambiguous',
      }
    }

    expected.manualContinuationInFlight = true
    try {
      const prompt = chatGPTStalledRecoveryPrompt(requestId, expected.filename, expected.originalPrompt)
      try {
        await fillBundledChatGPTComposer(key, entry, expected.sessionId, requestId, prompt, expected.filename, [], expected.liveTunnels || [], expected.requestMetadata || {})
      } catch (error) {
        escalateChatGPTContinuationFailure(key, expected, error, 'manual-continuation')
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'continuation_failed' }
      }
      await wait(80)
      await submitChatGPTDraft(key, entry, affinityURL, targeted)
      expected.assistantBaseline = Math.max(expected.assistantBaseline, Number(completion?.assistantCount) || 0)
      expected.settledAt = 0
      expected.lastDOMClick = 0
      expected.recovery = createChatGPTRecoveryState(Date.now())
      entry.staleConversationRequestIds.clear()
      clearChatGPTHumanAction(key, 'continuação manual enviada')
      return { ok: true, cacheKey: key, requestId, confirmationRequired: false, reason: 'submitted' }
    } finally {
      expected.manualContinuationInFlight = false
    }
    })
  })
  ipcMain.handle('wharness:chatgpt:pick-bundle', async (event, request) => {
    const windowState = trustedSender(event)
    const requestId = String(request?.requestId || '').trim()
    const chatId = request?.cacheKey ? sanitizeChatCacheKey(request.cacheKey) : ''
    const expectedFilename = canonicalBundleFilename(chatId || 'chat', requestId)
    const result = await dialog.showOpenDialog(windowState.window, {
      title: `Selecionar ${expectedFilename}`,
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Wharnex bundle ZIP', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    const filePath = result.filePaths[0]
    const sourceFilename = path.basename(filePath)
    const bytes = await readFile(filePath)
    if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharnex excede o limite de 16 MiB.')
    const candidate = canonicalWharnessBundleDownload(sourceFilename, requestId, 'application/zip')
    if (!candidate) throw new Error('O ficheiro selecionado não é um bundle ZIP Wharnex reconhecível.')
    const validated = validateWharnessBundleDownload(candidate.filename, bytes)
    if (validated.requestId !== requestId) throw new Error('O bundle selecionado não pertence ao pedido ativo.')
    return {
      cancelled: false,
      filename: candidate.filename,
      requestId: validated.requestId,
      sourceFilename,
      normalizedFilename: candidate.normalized,
      bytes: bytes.byteLength,
      contentBase64: bytes.toString('base64'),
    }
  })
  ipcMain.handle('wharness:chatgpt:paste', (event, request) => { const windowState = trustedSender(event); const { entry } = ensureChatGPTView(request?.cacheKey, windowState); requireOwnedChatGPTEntry(request?.cacheKey, entry).wc.paste(); return { ok: true } })
  ipcMain.handle('wharness:chatgpt:pending-bundles', async (event) => { trustedSender(event); return pendingChatGPTBundlePayloads() })
  ipcMain.handle('wharness:chatgpt:ack-bundle', async (event, request) => { trustedSender(event); return acknowledgeChatGPTBundle(request?.cacheKey, request?.requestId, request?.filename) })
  ipcMain.handle('wharness:chatgpt:nack-bundle', async (event, request) => {
    trustedSender(event)
    const id = String(request?.requestId || '').trim()
    const record = pendingChatGPTBundleDeliveries.get(id)
    if (record && request?.cacheKey) record.cacheKey = sanitizeChatCacheKey(request.cacheKey)
    return { ok: true, requestId: id, retained: Boolean(record) }
  })
  ipcMain.handle('wharness:chatgpt:submit-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (key, entry) => submitPromptToChatGPT(key, request?.text, request?.url, request?.requestId, request?.sessionId, entry))
  })
  ipcMain.handle('wharness:chatgpt:prepare-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    if (request?.background === true) return queuePreparedPromptForWorker(request)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (_key, entry) => preparePromptForChatGPT(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:retry-prepared-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.expectedRequestId, (_key, entry) => retryPreparedChatGPTPrompt(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:attach-context', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (_key, entry) => attachContextToChatGPT(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:attach-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, (_key, entry) => attachPromptToChatGPT(request, entry))
  })
  ipcMain.handle('wharness:chatgpt:submit-prepared', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    return withChatGPTSupervisorTransport(key, windowState, preparedChatGPTDrafts.get(key)?.requestId, (_key, entry) => submitPreparedChatGPTDraft(key, entry))
  })
  ipcMain.handle('wharness:chatgpt:queue-comment', async (event, request) => {
    trustedSender(event)
    return queueChatGPTComment(request)
  })
  ipcMain.handle('wharness:chatgpt:cancel-request', async (event, request) => {
    trustedSender(event)
    return cancelChatGPTRequestState(request?.cacheKey, request?.requestId)
  })
  ipcMain.handle('wharness:agents:state', async (event) => {
    trustedSender(event)
    return refreshChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-supervisor-count', async (event, request) => {
    trustedSender(event)
    configuredChatAgentSupervisorSlots = normalizeSupervisorSlotCount(request?.count)
    setChatAgentSupervisorTarget(configuredChatAgentSupervisorSlots)
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-worker-count', async (event, request) => {
    const windowState = trustedSender(event)
    configuredChatAgentWorkerSlots = normalizeWorkerSlotCount(request?.count)
    setChatAgentWorkerTarget(Math.max(configuredChatAgentWorkerSlots, chatAgentKeepFlowingFloor()), windowState)
    await refreshChatAgentRuntimeState()
    if (chatAgentPolicies.auto_scale === true) await reconcileChatAgentAutoScale()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-policies', async (event, request) => {
    const windowState = trustedSender(event)
    chatAgentPolicies = normalizeChatAgentPolicies({ ...chatAgentPolicies, ...(request || {}) })
    persistChatAgentPolicies()
    if (chatAgentPolicies.auto_scale !== true) setChatAgentWorkerTarget(Math.max(configuredChatAgentWorkerSlots, chatAgentKeepFlowingFloor()), windowState)
    else await reconcileChatAgentAutoScale()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:set-worker-keep-flowing', async (event, request) => {
    trustedSender(event)
    const agentID = String(request?.agentId || '').trim()
    if (!/^worker-[1-6]$/.test(agentID)) throw new Error('Keep flowing requires a valid Worker id')
    const selected = new Set(chatAgentPolicies.keep_flowing_workers)
    if (request?.enabled === true) selected.add(agentID)
    else selected.delete(agentID)
    chatAgentPolicies = normalizeChatAgentPolicies({ ...chatAgentPolicies, keep_flowing_workers: [...selected] })
    persistChatAgentPolicies()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:pause-workers', async (event, request) => {
    trustedSender(event)
    const rawUntil = String(request?.pausedUntil || '').trim()
    let pausedUntil = ''
    if (rawUntil) {
      const deadline = Date.parse(rawUntil)
      if (!Number.isFinite(deadline)) throw new Error('Worker suspension deadline is invalid')
      if (deadline <= Date.now()) throw new Error('Worker suspension deadline must be in the future')
      pausedUntil = new Date(deadline).toISOString()
    }
    chatAgentPolicies = normalizeChatAgentPolicies({
      ...chatAgentPolicies, workers_suspended: true, workers_suspended_until: pausedUntil,
    })
    persistChatAgentPolicies()
    chatAgentScheduler?.wake()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:resume-workers', async (event) => {
    trustedSender(event)
    chatAgentPolicies = normalizeChatAgentPolicies({
      ...chatAgentPolicies, workers_suspended: false, workers_suspended_until: '',
    })
    persistChatAgentPolicies()
    chatAgentScheduler?.wake()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:pause-provider', async (event, request) => {
    trustedSender(event)
    if (!chatAgentScheduler) throw new Error('Chat-agent scheduler is not ready')
    const rawUntil = String(request?.pausedUntil || '').trim()
    let pausedUntil = null
    if (rawUntil) {
      const deadline = Date.parse(rawUntil)
      if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('Agent resume deadline must be in the future')
      pausedUntil = new Date(deadline).toISOString()
    }
    const reason = pausedUntil
      ? `Suspenso pelo utilizador até ${pausedUntil}`
      : 'Suspenso pelo utilizador até retoma manual'
    await chatAgentScheduler.setProviderPause(true, { pausedUntil, reason })
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:resume-provider', async (event) => {
    trustedSender(event)
    if (!chatAgentScheduler) throw new Error('Chat-agent scheduler is not ready')
    // An explicit human resume clears the burst window too, otherwise the next
    // single refusal would immediately re-classify as a gate on a stale hit.
    chatGPTRateLimitUntil = 0
    chatGPTRateLimitHits = []
    chatGPTRateLimitKind = ''
    chatGPTRateLimitAppliedAt = 0
    await chatAgentScheduler.setProviderPause(false)
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:snapshot', async (event, request) => { trustedSender(event); return chatAgentBrowserSnapshot(request?.agentId) })
  ipcMain.handle('wharness:agents:open-devtools', (event, request) => {
    trustedSender(event)
    const entry = workerEntryForAgentID(request?.agentId)
    entry.view.webContents.openDevTools({ mode: 'detach', activate: true })
    return { ok: true, agentId: entry.slotId }
  })
  ipcMain.handle('wharness:agents:interaction-open', async (event, request) => showChatAgentInteraction(request?.agentId, request?.bounds, trustedSender(event)))
  ipcMain.handle('wharness:agents:interaction-bounds', async (event, request) => setChatAgentInteractionBounds(request?.agentId, request?.bounds, trustedSender(event)))
  ipcMain.handle('wharness:agents:interaction-close', async (event, request) => closeChatAgentInteraction(request?.agentId, trustedSender(event)))
  ipcMain.handle('wharness:data:storage', async (event) => { trustedSender(event); return desktopStorageUsage() })
  ipcMain.handle('wharness:data:export-browser-session', async (event) => { const windowState = trustedSender(event); return exportBrowserSession(windowState) })
  ipcMain.handle('wharness:data:import-browser-session', async (event) => { const windowState = trustedSender(event); return importBrowserSession(windowState) })
  ipcMain.handle('wharness:data:clear-browser-session', async (event) => { trustedSender(event); return clearBrowserSession() })
  ipcMain.handle('wharness:data:clear-all', async (event, request) => {
    trustedSender(event)
    if (String(request?.confirm || '').trim() !== 'APAGAR WHARNEX') throw new Error('Complete Wharnex reset confirmation mismatch')
    return clearDesktopWharnessData()
  })
  ipcMain.handle('wharness:attachments:persist', async (event, request) => {
    trustedSender(event)
    const cacheKey = sanitizeChatCacheKey(request?.cacheKey)
    const messageId = sanitizeChatCacheKey(request?.messageId)
    const { decoded } = decodeChatAttachmentSet(request?.attachments || [])
    const attachments = await persistChatAttachmentFiles(chatAttachmentRoot(), cacheKey, messageId, decoded, createPersistentAttachmentPreview)
    return { ok: true, attachments }
  })
  ipcMain.handle('wharness:attachments:preview', async (event, request) => {
    trustedSender(event)
    try { return await readStoredAttachmentPreview(chatAttachmentRoot(), request?.storageRef) }
    catch { return { available: false, dataUrl: '', previewKind: 'none' } }
  })
  ipcMain.handle('wharness:attachments:read', async (event, request) => {
    trustedSender(event)
    return readStoredAttachment(chatAttachmentRoot(), request?.storageRef)
  })
  ipcMain.handle('wharness:attachments:open', async (event, request) => {
    trustedSender(event)
    const filePath = await storedAttachmentPath(chatAttachmentRoot(), request?.storageRef)
    const error = await shell.openPath(filePath)
    if (error) throw new Error(`Não foi possível abrir o anexo: ${error}`)
    return { ok: true }
  })
  ipcMain.handle('wharness:attachments:remove-chat', async (event, request) => {
    trustedSender(event)
    const cacheKey = sanitizeChatCacheKey(request?.cacheKey)
    await removeStoredChatAttachments(chatAttachmentRoot(), cacheKey)
    return { ok: true }
  })
  ipcMain.handle('wharness:clipboard:read-text', (event) => { trustedSender(event); return clipboard.readText() })
  ipcMain.handle('wharness:clipboard:write-text', async (event, value) => {
    trustedSender(event)
    const text = String(value || '')
    if (text.length > 4 * 1024 * 1024) throw new Error('Clipboard text exceeds 4 MiB limit')
    await clipboard.writeText(text)
    return { ok: true }
  })
  ipcMain.handle('wharness:clipboard:copy-context-zip', async (event, request) => {
    trustedSender(event)
    const { id: sessionId, bytes } = await fetchContextZip(request?.sessionId)

    const dir = path.join(app.getPath('temp'), 'wharness-context', sessionId)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `wharness-context-${sessionId}.zip`)
    await writeFile(filePath, bytes, { mode: 0o600 })
    await clipboard.write([new ClipboardItem({ 'text/uri-list': `${pathToFileURL(filePath).href}\r\n` })])
    return { ok: true, bytes: bytes.byteLength }
  })
}

app.whenReady().then(async () => {
  await rm(path.join(app.getPath('temp'), 'wharness-chat-protocol'), { recursive: true, force: true }).catch(() => undefined)
  try { await applyPendingBrowserSessionImport() } catch (error) { console.error('[chatgpt-session] pending import failed', error) }
  const chatSession = session.fromPartition(CHATGPT_PARTITION)
  chatSession.setUserAgent(CHATGPT_USER_AGENT, CHATGPT_ACCEPT_LANGUAGES)
  registerChatGPTPlanDownloads(chatSession)

  const remoteFilter = {
    urls: [
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://*.openai.com/*',
    ],
  }
  chatSession.webRequest.onBeforeRequest(remoteFilter, (details, callback) => {
    noteChatGPTNetworkActivity(details, 'before')
    chatGPTUploads.onBeforeRequest(details)
    chatGPTSubmissions.onBeforeRequest(details)
    callback({})
  })
  chatSession.webRequest.onErrorOccurred(remoteFilter, (details) => {
    noteChatGPTNetworkActivity(details, 'error')
    noteChatGPTNetworkFailure(details)
    chatGPTUploads.onErrorOccurred(details)
    console.error(`[chatgpt-net] ${details.method} ${sanitizeDiagnosticURL(details.url)} error=${details.error}`)
  })
  chatSession.webRequest.onCompleted(remoteFilter, (details) => {
    noteChatGPTNetworkActivity(details, 'completed')
    chatGPTUploads.onCompleted(details)
    noteChatGPTHTTPStatus(details)
    if (details.statusCode >= 400) {
      console.error(`[chatgpt-http] ${details.method} ${sanitizeDiagnosticURL(details.url)} status=${details.statusCode}`)
    }
  })

  // Remote ChatGPT gets the minimum browser permissions it needs. In particular,
  // navigator.clipboard.writeText() maps to clipboard-sanitized-write in Electron.
  // We deliberately do NOT grant clipboard-read: importing a response remains an
  // explicit Wharnex action owned by the trusted local renderer/main process.
  chatSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingURL = details?.requestingUrl || webContents?.getURL() || ''
    const trusted = isTrustedChatGPTOrigin(requestingURL)
    const allowed = trusted && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
    if (permission.startsWith('clipboard')) {
      console.log(`[chatgpt-permission] ${permission} origin=${sanitizeDiagnosticURL(requestingURL)} allowed=${allowed}`)
    }
    callback(allowed)
  })
  chatSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const requestingURL = details?.requestingUrl || requestingOrigin || details?.embeddingOrigin || ''
    const trusted = isTrustedChatGPTOrigin(requestingURL)
    return trusted && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
  })

  // Keep the local Wharnex composer useful in Portuguese while preserving
  // English for code/technical terms. Electron only accepts dictionaries that
  // are actually available in the current Chromium build.
  try {
    const available = new Set(session.defaultSession.availableSpellCheckerLanguages || [])
    const preferred = ['pt-PT', 'pt-BR', 'en-US'].filter((language) => available.has(language))
    if (preferred.length) session.defaultSession.setSpellCheckerLanguages(preferred)
  } catch (error) { console.warn('[spellcheck] dictionary configuration failed', error) }

  // Cache only: preserve cookies/login while forcing current ChatGPT assets to reload
  // under the Chrome-compatible UA. Only needed when that UA actually changed
  // since the last run; an ordinary restart on the same build reuses the warm
  // cache instead of forcing every Supervisor/Worker to refetch ChatGPT's
  // entire SPA bundle over the network. Failures here must not prevent startup.
  if (!chatGPTCacheMarkerCurrent()) {
    try { await chatSession.clearCache() } catch (error) { console.error('[chatgpt-cache] clear failed', error) }
    writeChatGPTCacheMarker()
  }

  console.log(`ChatGPT compatibility UA: Chrome/${CHATGPT_CHROMIUM_VERSION}`)
  chatAgentPolicies = loadChatAgentPolicies()
  registerIPC()
  chatGPTDownloadPoller = setInterval(() => { void flushQueuedChatGPTComments(); void pollChatGPTVisibleActivity(); void pollExpectedChatGPTDownloads(); void reconcileChatAgentAutoScale() }, DOM_DOWNLOAD_POLL_MS)

  const layout = loadWindowLayout()
  const restartIntent = consumeRestartIntent()
  if (restartIntent?.scope === 'current' && layout.includes(restartIntent.currentWindowId)) {
    // A process-level self-evolution restart cannot physically keep sibling windows
    // alive. Recreate the requesting window first, then restore the saved topology.
    createWindow(restartIntent.currentWindowId, false)
    persistWindowLayout(layout)
    setTimeout(() => {
      for (const windowId of layout) if (windowId !== restartIntent.currentWindowId && !desktopWindows.has(windowId)) createWindow(windowId, false)
      persistWindowLayout()
    }, 900)
  } else {
    for (const windowId of layout) createWindow(windowId, false)
    persistWindowLayout()
  }

  const workerHost = [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
  chatAgentScheduler = new ChatAgentSchedulerClient({
    baseURL: BACKEND_URL, workerCount: desiredChatAgentWorkerSlots, maxWorkers: HARD_MAX_WORKER_SLOTS, execute: executeChatAgentTask,
    // The Worker pool takes only small account-lifecycle and utility work. The
    // durable claim enforces that partition, so no attempt is charged to reject
    // a chat-bound task this pool must never navigate to.
    role: 'worker',
    claimOptions: (worker) => {
      // Operator suspension is Worker-only: current tasks may settle, but this
      // pool must not claim another task until manual or timed release.
      if (workerSuspensionState(chatAgentPolicies).paused) return { skip: true }
      // A suspended provider must stop the pool at the claim, not at the
      // submission. Claiming during a cooldown charges an attempt to every task
      // it touches and hands each one straight back to WAITING — churn that
      // spends the queue's own retry budget on a provider that is refusing
      // everyone. Skipping claims is what "the workers are suspended" means.
      if (chatAgentRateLimitDelayMs() > 0) return { skip: true }
      const entry = workerEntryForIndex(worker)
      if (!entry) return { skip: true }
      const blocked = Boolean(entry.interactionWindowId || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.loading)
      const supervisorLanes = chatSupervisorBoundLanes()
      const residentLane = chatAgentResidency.snapshot(entry.slotId).resident_lane
      const keepFlowing = chatAgentKeepFlowingActive(worker)
      if (!blocked && !keepFlowing && residentLane && supervisorLanes.has(residentLane)) {
        chatAgentResidency.releaseResidentLane(entry.slotId, residentLane)
      }
      const options = chatAgentResidency.claimOptions(entry.slotId, {
        blocked,
        pinResident: chatAgentSupervisingLiveResponse(worker) || keepFlowing,
      })
      // The pool is shared across projects, but a Worker may only take work the
      // operator can actually supervise. This Desktop knows which projects are
      // open in which windows; the durable claim applies that scope so no
      // attempt is charged to reject work (see adr/ADR-0044).
      const scope = { project_scoped: true, open_projects: projectWindowRegistry.openProjects() }
      if (options.skip || supervisorLanes.size === 0) return { ...options, ...scope }
      return { ...options, ...scope, excluded_lanes: [...new Set([...(options.excluded_lanes || []), ...supervisorLanes])].slice(0, 32) }
    },
    // An empty claim is the only proof a resident lane has run dry. Without it
    // residency never expired, so a slot stayed bound to a chat that had been
    // resolved hours earlier while other conversations held due work.
    onIdle: (worker) => {
      const entry = workerEntryForIndex(worker)
      if (!entry) return
      // A slot between two observations of a live response is not idle, even
      // though its claims find nothing: AWAIT_RESPONSE deliberately returns to
      // WAITING for ~30 seconds so the worker is released. Releasing its lane
      // on that evidence would hand the conversation to another slot, which
      // would reload a page the model is still writing into — the very
      // interruption the resident probe exists to avoid.
      if (chatAgentSupervisingLiveResponse(worker) || chatAgentKeepFlowingActive(worker)) return
      let released = chatAgentResidency.noteIdleClaim(entry.slotId)
      if (released) console.log(`[chat-agent] residency-released slot=${entry.slotId} reason=idle-lane`)
      // A claim that reaches the backend and finds nothing is proof the
      // scheduler loop itself is healthy again. Without this, a Worker whose
      // last claim attempt failed (worker-error) stayed painted "Com erro"
      // forever once no further task ever landed on it, even though the very
      // next claim succeeded.
      const prior = chatAgentWorkerStates.get(worker)
      if (prior?.error) { chatAgentWorkerStates.set(worker, { ...prior, error: '' }); released = true }
      if (released) publishChatAgentRuntimeState()
    },
    onState: (state) => {
      const worker = Number(state?.worker || 0)
      if (worker) {
        const prior = chatAgentWorkerStates.get(worker) || { active: true, task: undefined, lastTask: undefined, lastClaimAt: '', error: '' }
        if (state.kind === 'worker-started') chatAgentWorkerStates.set(worker, { ...prior, active: true })
        else if (state.kind === 'worker-stopped') chatAgentWorkerStates.set(worker, { ...prior, active: false, task: undefined })
        else if (state.kind === 'running') chatAgentWorkerStates.set(worker, { ...prior, active: true, task: state.task, lastTask: state.task, lastClaimAt: new Date().toISOString(), error: '' })
        else if (state.kind === 'settled') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, lastResult: state.result, error: '' })
        else if (state.kind === 'task-error') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, error: String(state?.error?.message || state?.error || '') })
        else if (state.kind === 'worker-error') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, error: String(state?.error?.message || state?.error || '') })
      }
      reconcileChatGPTWorkerPool(workerHost)
      publishChatAgentRuntimeState()
      void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
    },
  })
  // Do not compete with the first local frontend paint. The queue is durable,
  // so this short delay does not discard work; it prevents the visible app
  // from being reloaded while hidden WebContents are starting.
  setTimeout(async () => {
    if (quitting) return
    await primeChatGPTWorkerPool(workerHost)
    if (quitting) return
    chatAgentScheduler.start()
  }, CHAT_AGENT_STARTUP_DELAY_MS)
  // The Supervisor pool draws from the same durable queue with the complementary
  // role: opening the chat, submitting the request bundle, following the remote
  // instance and collecting the response bundle. One loop per Supervisor slot,
  // never resized, because the slot count is the number of chats that may stay
  // resident at once.
  chatSupervisorScheduler = new ChatAgentSchedulerClient({
    baseURL: BACKEND_URL, workerCount: desiredChatAgentSupervisorSlots, maxWorkers: HARD_MAX_SUPERVISOR_SLOTS,
    execute: executeChatSupervisorTask, role: 'supervisor', agentID: chatSupervisorSlotID,
    // Supervision spends almost all of its life handing the slot back between
    // observations, so a task cooldown here would only delay reading a page that
    // is already loaded. The provider pacing gate still covers every real action.
    taskCooldownMs: 0,
    claimOptions: (index) => {
      if (chatAgentRateLimitDelayMs() > 0) return { skip: true }
      if (!chatSupervisorHostWindow()) return { skip: true }
      const runtime = chatSupervisorStates.get(index) || {}
      const lane = String(runtime.lane || '')
      const key = sanitizeOptionalChatCacheKey(runtime.key)
      const entry = key ? chatgptViews.get(key) : undefined
      const scope = { project_scoped: true, open_projects: projectWindowRegistry.openProjects() }
      // A Supervisor mid-request serves only its own chat. Letting it claim
      // another conversation is precisely the cross-chat navigation this pool
      // exists to remove, and it would also abandon a request in flight.
      if (lane && entry && supervisorBindingHeld(key, entry)) {
        return { preferred_lane: lane, fallback_mode: 'resident_only', ...scope }
      }
      // Free: prefer the chat it already has loaded, but accept any chat-bound
      // work except the lanes other Supervisors are still holding.
      const taken = chatSupervisorLanesHeldByOthers(index)
      return {
        preferred_lane: lane, fallback_mode: 'any',
        excluded_lanes: [...taken].slice(0, 32), ...scope,
      }
    },
    // A claim that reaches the backend and finds nothing proves this slot's
    // loop is healthy again. Without this, a Supervisor whose last claim
    // attempt failed (worker-error) stayed painted "Com erro" indefinitely —
    // the whole pool read as broken even once the underlying condition (a
    // slow backend restart, a transient network hiccup) had long resolved,
    // because nothing ever cleared a sticky error on an otherwise-idle slot.
    onIdle: (index) => {
      const prior = chatSupervisorStates.get(index)
      if (!prior?.error) return
      chatSupervisorStates.set(index, { ...prior, error: '' })
      publishChatAgentRuntimeState()
    },
    onState: (state) => {
      const slot = Number(state?.worker || 0)
      if (slot) {
        const prior = chatSupervisorStates.get(slot) || { active: true, task: undefined, lastTask: undefined, lastClaimAt: '', error: '', lane: '', key: '' }
        if (state.kind === 'worker-started') chatSupervisorStates.set(slot, { ...prior, active: true })
        else if (state.kind === 'worker-stopped') chatSupervisorStates.set(slot, { ...prior, active: false, task: undefined })
        else if (state.kind === 'running') chatSupervisorStates.set(slot, { ...prior, active: true, task: state.task, lastTask: state.task, lastClaimAt: new Date().toISOString(), error: '' })
        else if (state.kind === 'settled') chatSupervisorStates.set(slot, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, lastResult: state.result, error: '' })
        else if (state.kind === 'task-error') chatSupervisorStates.set(slot, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, error: String(state?.error?.message || state?.error || '') })
        else if (state.kind === 'worker-error') chatSupervisorStates.set(slot, { ...prior, task: undefined, error: String(state?.error?.message || state?.error || '') })
      }
      publishChatAgentRuntimeState()
    },
  })
  chatSupervisorScheduler.start()
  void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
})

app.on('before-quit', () => {
  quitting = true
  persistWindowLayout()
  if (chatGPTDownloadPoller) clearInterval(chatGPTDownloadPoller)
  if (chatAgentScheduler) void chatAgentScheduler.stop()
  if (chatSupervisorScheduler) void chatSupervisorScheduler.stop()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow('primary') })
