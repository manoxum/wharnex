import { app, BrowserWindow, ClipboardItem, Notification, WebContentsView, clipboard, dialog, ipcMain, nativeImage, session, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ChatGPTSubmitCoordinator, dispatchChatGPTAccountKey, dispatchChatGPTPointerClick, dispatchChatGPTSubmit, submitWithRetry } from './chatgpt-input.mjs'
import { ChatGPTUploadCoordinator, pasteWithUploadRetry, plannerPromptMarkdown, selectChatGPTUploadFile, waitForChatGPTReady } from './chatgpt-upload.mjs'
import { persistChatAttachmentFiles, readStoredAttachmentPreview, removeStoredChatAttachments, storedAttachmentPath } from './chat-attachment-store.mjs'
import { chatGPTAssistantTurnCountScript, chatGPTComposerReadyScript, chatGPTExpectedDownloadScript, chatGPTHumanActionScript, chatGPTResponseCompletionScript, chatGPTFillComposerScript, chatGPTFocusComposerScript, chatGPTSubmitScript, chatGPTVisibleActivityScript } from './chatgpt-dom.mjs'
import { chatGPTCommitConversationTitleScript, chatGPTConfirmDeleteScript, chatGPTConversationTitleScript, chatGPTHideSidebarScript, chatGPTLibraryArtifactRectScript, chatGPTLibraryArtifactStateScript, chatGPTMenuItemRectScript, chatGPTNewProjectDialogScript, chatGPTOpenConversationMenuScript, chatGPTProjectItemRectScript, chatGPTShowSidebarScript, chatGPTStopConversationScript, normalizeChatGPTProjectName, normalizeWHXTitle } from './chatgpt-account.mjs'
import { ChatGPTAccountProviderChain } from './chatgpt-account-provider.mjs'
import { pathSize, restoreBrowserSession, snapshotBrowserSession } from './browser-session-data.mjs'
import { chatGPTNavigationDisposition, chatInputSettleDelay, chromeCompatibleUserAgent, contextBundleURL, decodeUserAttachment, isChatGPTAuthURL, isHTTPS, isTrustedChatGPTOrigin, normalizeBounds, requireLocalHTTPURL, requireTrustedChatGPTURL, sanitizeChatCacheKey, sanitizeChatGPTAuthMode, sanitizeDiagnosticURL, sanitizeSessionId, BundleOwnershipError, canonicalWharnessBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security.mjs'
import { buildBundleName, parseBundleName, safeChatId } from './bundlename.mjs'
import { shouldAttachProjectContext } from './chatgpt-context.mjs'
import { confirmChatGPTAffinity, createChatGPTAffinityTracker, isChatGPTAffinityAwaitingSettlement, markChatGPTAffinitySubmitted, observeChatGPTAffinity, proposeChatGPTAffinity, publicChatGPTAffinity, rejectChatGPTAffinity, settleChatGPTAffinity, shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinity } from './chatgpt-affinity.mjs'
import { chatGPTStalledRecoveryPrompt, chooseChatGPTRecoveryAction, classifyChatGPTConversationTransport, commitChatGPTRecoveryAction, createChatGPTRecoveryState, isChatGPTConversationTransportURL, isRecoverableChatGPTNetworkError, noteChatGPTRecoveryAssistantCount, noteChatGPTRecoveryFault, noteChatGPTRecoveryProgress, reconcileChatGPTConversationTransport, recordChatGPTConversationTransport } from './chatgpt-recovery.mjs'
import { chatGPTSessionProbeExpression, closeManagedBrowserAuth, electronCookieDetails, launchManagedBrowserAuth, managedBrowserProfileDirectory } from './managed-browser-auth.mjs'
import { ProjectWindowRegistry } from './project-window-registry.mjs'
import { parseRemoteInputResponse, remoteInputPayload } from './remote-input.mjs'
import { chatInputArchiveFilename, localChatInputBootstrap, writeChatInputArchive } from './chat-input-archive.mjs'
import { DEFAULT_WORKER_SLOTS, HARD_MAX_WORKER_SLOTS, MIN_WORKER_SLOTS, normalizeWorkerSlotCount } from './chat-agent-pool.mjs'
import { ChatAgentSchedulerClient, chatAgentBackoff } from './chat-agent-scheduler.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_URL = requireLocalHTTPURL(process.env.WHARNESS_FRONTEND_URL || 'http://127.0.0.1:5173', 'Frontend URL').href
const BACKEND_URL = requireLocalHTTPURL(process.env.WHARNESS_API_URL || 'http://127.0.0.1:8080', 'Backend URL').href
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const FRONTEND_RUNTIME_TOKEN = randomUUID()
const CHATGPT_URL = 'https://chatgpt.com/'
const CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login'
const CHATGPT_LIBRARY_URL = 'https://chatgpt.com/library'
const CHATGPT_PARTITION = 'persist:wharness-chatgpt'
const MAX_CONTEXT_BYTES = 256 * 1024 * 1024
const MAX_PLAN_BYTES = 2 * 1024 * 1024
const MAX_EXECUTION_BUNDLE_BYTES = 16 * 1024 * 1024
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
let desiredChatAgentWorkerSlots = DEFAULT_WORKER_SLOTS
let chatAgentScheduler
let chatAgentRuntimeDiagnostics = {
  scheduler: { running: false, backend_reachable: false, last_refresh_at: '', last_error: '' },
  queue: { total: 0, counts: {}, oldest_created_at: '', next_not_before: '' },
  provider: { provider: 'chatgpt', paused: false, paused_until: '', reason: '', updated_at: '' },
}
let deferredSupervisorNavigation
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
const pollingExpectedChatGPTBundles = new Set()
const chatAgentTitleSamples = new Map()
const chatGPTTransportTails = new Map()
let chatGPTSupervisorTransportTail = Promise.resolve()
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
const BUNDLE_COMPLETION_GRACE_MS = 4_000
const BUNDLE_CONTINUATION_BASE_MS = 5_000
const MAX_BUNDLE_CONTINUATIONS = 1
const PROCESSING_SIGNAL_GRACE_MS = 15_000
const CONVERSATION_TRANSPORT_STALE_MS = 30_000
const PROCESSING_STALE_ATTENTION_MS = 5 * 60_000
const CHATGPT_RATE_LIMIT_BACKOFF_MS = 60_000
const CHATGPT_DOM_PROBE_FAILURE_LIMIT = 3
const CHATGPT_ACCOUNT_ACTION_SETTLE_MS = 350
// How many times a window's frontend renderer may be restarted after a
// crash before Wharnex stops and asks for human attention.
const FRONTEND_RENDERER_RESTART_LIMIT = 5
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
// owned view keeps running at full speed only while Wharness genuinely needs
// to observe it (an expected bundle download, a pending human action, an
// in-flight transport request, or account automation). Wharness's own
// detection (executeJavaScript health probes, will-navigate/did-navigate,
// download events) is driven from this main process on its own timers, not
// from the ChatGPT page's own JS timers, so it is unaffected by Chromium's
// background throttling either way; only the remote page's own idle
// timers/rAF slow down once nothing here is waiting on it.
function chatGPTEntryNeedsSupervision(key, entry) {
  return Boolean(entry.loading || entry.humanAction?.active || entry.accountOperationActive || entry.transportPreparationCount > 0 || entry.conversationRequests.size > 0 || pendingChatGPTComments.has(key) || expectedChatGPTBundles.has(key))
}

function chatGPTEntryIsActiveVisible(key, entry) {
  const windowState = windowStateForEntry(entry)
  return Boolean(windowState && windowState.activeChatGPTKey === key && windowState.chatgptVisible)
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

async function withChatGPTTransportPreparation(cacheKey, entry, requestId, operation) {
  const key = sanitizeChatCacheKey(cacheKey)
  requireOwnedChatGPTEntry(key, entry)
  const prior = chatGPTTransportTails.get(key) || Promise.resolve()
  let release
  const tail = new Promise((resolve) => { release = resolve })
  chatGPTTransportTails.set(key, tail)
  try { await prior } catch { /* a prior operation cannot poison the queue */ }
  entry.transportPreparationCount = Number(entry.transportPreparationCount || 0) + 1
  entry.transportRequestId = String(requestId || '')
  reconcileChatGPTThrottle(key, entry)
  try {
    return await operation()
  } finally {
    entry.transportPreparationCount = Math.max(0, Number(entry.transportPreparationCount || 0) - 1)
    if (!entry.transportPreparationCount) entry.transportRequestId = ''
    reconcileChatGPTThrottle(key, entry)
    if (entry.role !== 'worker' && !entry.transportPreparationCount && deferredSupervisorNavigation) setTimeout(() => { void applyDeferredSupervisorNavigation() }, 0)
    release()
    if (chatGPTTransportTails.get(key) === tail) chatGPTTransportTails.delete(key)
  }
}

async function waitForDifferentSupervisorTransport(cacheKey) {
  const key = sanitizeChatCacheKey(cacheKey)
  for (;;) {
    const currentKey = supervisorKey()
    const current = currentKey ? chatgptViews.get(currentKey) : undefined
    if (!current || currentKey === key || Number(current.transportPreparationCount || 0) === 0) return
    const activeTail = chatGPTTransportTails.get(currentKey)
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
    return { ...lock, message: 'Este projeto já está aberto noutra janela do Wharness. A janela proprietária foi trazida para a frente.' }
  }
  windowState.projects.add(lock.path)
  return lock
}

function releaseProjectForWindow(windowState, value) {
  const result = projectWindowRegistry.release(windowState.id, value)
  if (result.released) windowState.projects.delete(result.path)
  return result
}

function releaseWindowProjects(windowState) {
  projectWindowRegistry.releaseWindow(windowState.id)
  windowState.projects.clear()
}

function windowLayoutPath() { return path.join(app.getPath('userData'), 'wharness-window-layout.json') }

function persistWindowLayout(ids = [...desktopWindows.values()].filter((state) => !state.window.isDestroyed()).map((state) => state.id)) {
  try {
    writeFileSync(windowLayoutPath(), JSON.stringify({ version: 1, windows: [...new Set(ids)].slice(0, 12) }), { mode: 0o600 })
  } catch (error) { console.warn('[windows] layout persistence failed', error) }
}

function loadWindowLayout() {
  try {
    const parsed = JSON.parse(readFileSync(windowLayoutPath(), 'utf8'))
    const windows = Array.isArray(parsed?.windows) ? parsed.windows.filter((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item)) : []
    return windows.length ? [...new Set(windows)].slice(0, 12) : ['primary']
  } catch { return ['primary'] }
}

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
  if (wharnessBundleRequestIdFromFilename(filename) !== id) throw new Error('Invalid Wharness request id for bundle transport')
  return filename
}

function authoritativeBundleFilename(value, requestId, fallbackChatId) {
  const candidate = path.basename(String(value || '').trim())
  const parsed = parseBundleName(candidate)
  if (parsed?.kind === 'res' && (parsed.subrequestId || parsed.requestId) === String(requestId || '').trim()) return candidate
  return canonicalBundleFilename(fallbackChatId, requestId)
}

function armExpectedChatGPTBundle(cacheKey, requestId, assistantBaseline = 0, recoveryBootstrap = '', liveTunnels = [], originalPrompt = '', sessionId = '', expectedFilename = '') {
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
    lastContinuationAt: sameRequest ? Number(prior.lastContinuationAt || 0) : 0,
    backoffUntil: sameRequest ? Number(prior.backoffUntil || 0) : 0,
    domProbeFailures: 0,
    processingObservedAt: sameRequest ? Number(prior.processingObservedAt || 0) : 0,
    processingAbsentSince: sameRequest ? Number(prior.processingAbsentSince || 0) : 0,
    rehydrating: sameRequest ? prior.rehydrating === true : false,
    recoveryEligibleAt: sameRequest ? Number(prior.recoveryEligibleAt || 0) : 0,
    recoveryBootstrap: String(recoveryBootstrap || (sameRequest ? prior?.recoveryBootstrap : '') || ''),
    originalPrompt: String(originalPrompt || (sameRequest ? prior?.originalPrompt : '') || ''),
    sessionId: String(sessionId || (sameRequest ? prior?.sessionId : '') || ''),
    liveTunnels: Array.isArray(liveTunnels) && liveTunnels.length ? liveTunnels.slice(0, 16) : (sameRequest && Array.isArray(prior?.liveTunnels) ? prior.liveTunnels.slice(0, 16) : []),
    recovery: createChatGPTRecoveryState(Date.now()),
  })
  return filename
}

// A prompt that was armed as an expected bundle but never actually reached
// ChatGPT (submitChatGPTDraft threw before the message was sent) must not be
// left behind: the DOM poll otherwise treats the still-open, already-settled
// prior turn as "finished without a bundle" and overwrites the unsent draft
// with a content-free WHARNESS DELIVERY CONTINUATION nudge instead of
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
  let cleared = false
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
    await refreshChatAgentRuntimeState()
    publishChatAgentRuntimeState()
  }
  return { ok: true, cacheKey: key, requestId: id, cleared, cancelledTasks }
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
  const replacement = [...desktopWindows.values()].find((state) => state.id !== windowState?.id && state.window && !state.window.isDestroyed())
  if (!replacement) return false
  for (const entry of chatGPTWorkerEntries) {
    if (entry.ownerWindowId !== windowState.id || entry.view.webContents.isDestroyed()) continue
    try { windowState.window.contentView.removeChildView?.(entry.view) } catch { /* already detached */ }
    replacement.window.contentView.addChildView(entry.view)
    entry.ownerWindowId = replacement.id
    entry.view.setVisible(false)
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
  for (const state of desktopWindows.values()) { state.activeChatGPTKey = ''; state.chatgptVisible = false }
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
  if (ownerState && entry.ownerWindowId !== ownerState.id) throw new Error('ChatGPT view belongs to another Wharness window')
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
  if (entry && windowState && entry.ownerWindowId !== windowState.id) throw new Error('ChatGPT view belongs to another Wharness window')
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
  if (kind === 'authentication') return 'A sessão do ChatGPT precisa de autenticação humana. Abra o separador ChatGPT e conclua o login para o Wharness retomar o pedido.'
  if (kind === 'access') return 'O ChatGPT bloqueou o acesso ao pedido. Abra o separador ChatGPT e conclua qualquer verificação apresentada antes de continuar.'
  if (kind === 'surface') return 'A interface do ChatGPT deixou de expor o compositor mesmo após uma recarga de recuperação. Abra o separador ChatGPT e confirme se existe um aviso, bloqueio ou alteração de interface.'
  if (kind === 'transport') return `A ligação ao ChatGPT continuou a falhar após as tentativas automáticas${suffix ? ` (${suffix})` : ''}. Verifique a ligação/VPN/proxy e abra o ChatGPT antes de continuar.`
  if (kind === 'stalled') return 'O pedido do ChatGPT continuou sem progresso após a recarga e a única continuação automática permitida. Abra o separador ChatGPT e conclua/retome o pedido manualmente.'
  return 'O ChatGPT requer uma ação humana antes de o Wharness poder continuar.'
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

function noteChatGPTHTTPStatus(details) {
  const match = chatGPTEntryForWebContentsID(details?.webContentsId)
  if (!match || !isChatGPTConversationTransportURL(details?.url)) return false
  const [key, entry] = match
  const expected = expectedChatGPTBundles.get(key)
  if (!expected) return false
  const status = Number(details?.statusCode || 0)
  if (status === 401) return setChatGPTHumanAction(key, 'authentication', 'HTTP 401', 'http')
  if (status === 403) return setChatGPTHumanAction(key, 'access', 'HTTP 403', 'http')
  if (status === 429) {
    const next = Date.now() + CHATGPT_RATE_LIMIT_BACKOFF_MS
    if (next > Number(expected.backoffUntil || 0)) {
      expected.backoffUntil = next
      noteChatGPTRecoveryProgress(expected.recovery, 'http:429-backoff', Date.now())
      sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, state: 'thinking', text: 'O ChatGPT aplicou limitação temporária de pedidos. O Wharness pausou novas tentativas por 60 segundos e retomará automaticamente.', capturedAt: new Date().toISOString() })
    }
    return true
  }
  if (status >= 500 && status <= 599) {
    noteChatGPTRecoveryFault(expected.recovery, `ChatGPT HTTP ${status}`, Date.now())
    return true
  }
  if (status > 0 && status < 400) {
    expected.backoffUntil = 0
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

function registerChatGPTPlanDownloads(chatSession) {
  chatSession.on('will-download', (_event, item, sourceWebContents) => {
    // This handler is registered on the dedicated persist:wharness-chatgpt
    // partition. A generated attachment can be served through an internal
    // download WebContents rather than the visible ChatGPT WebContentsView, so
    // do not require object identity here. The strict filename + JSON protocol
    // + request_id checks below remain the authority for plan interception.
    const sourceFilename = item.getFilename()
    const expectedBundle = expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename)
    const sourceCacheKey = expectedBundle?.key || chatGPTKeyForWebContents(sourceWebContents)
    // Manual chat transport mode: let the download proceed as an ordinary
    // Chromium download (goes to the user's normal Downloads folder) rather
    // than intercepting/validating/auto-importing it — the human is expected
    // to hand the file to Wharness themselves via the Manual upload UI.
    if (sourceCacheKey && chatgptTransportModes.get(sourceCacheKey) === 'manual') return
    let bundleCandidate
    try {
      bundleCandidate = canonicalWharnessBundleDownload(sourceFilename, expectedBundle?.requestId || '', item.getMimeType?.() || '', sourceCacheKey || '', expectedBundle?.filename || '')
    } catch (error) {
      if (error instanceof BundleOwnershipError && error.requestId && error.filename) {
        // The name is a valid Wharness response bundle; it simply belongs to
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
        publishBundleDownloadError('Bundle Wharness excede o limite de 16 MiB.', filename, sourceCacheKey)
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
          publishBundleDownloadError('Bundle Wharness excede o limite de 16 MiB.', filename, sourceCacheKey)
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
          if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharness excede o limite de 16 MiB.')
          const validated = validateWharnessBundleDownload(filename, bytes)
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
      }
      return
    }
    const sourceURL = sourceWebContents?.getURL?.() || ''
    console.log(`[chatgpt-plan-download] started file=${filename} source=${sanitizeDiagnosticURL(sourceURL)}`)

    const total = item.getTotalBytes()
    if (total > MAX_PLAN_BYTES) {
      item.cancel()
      publishPlanDownloadError('Plano Wharness excede o limite de 2 MiB.', filename, sourceCacheKey)
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
        publishPlanDownloadError('Plano Wharness excede o limite de 2 MiB.', filename, sourceCacheKey)
      }
    })

    item.once('done', async (_doneEvent, state) => {
      if (state !== 'completed') {
        if (state !== 'cancelled') publishPlanDownloadError(`Download do plano terminou em estado ${state}.`, filename, sourceCacheKey)
        return
      }
      try {
        const bytes = await readFile(savePath)
        if (bytes.byteLength > MAX_PLAN_BYTES) throw new Error('Plano Wharness excede o limite de 2 MiB.')
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
    if (ownerState?.activeChatGPTKey === cacheKey) entry.view.setVisible(ownerState.chatgptVisible)
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
  if (ownerState?.activeChatGPTKey === cacheKey) entry.view.setVisible(ownerState.chatgptVisible)
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
  if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot create ChatGPT view without an owning Wharness window')
  const view = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }) })
  view.setBackgroundColor('#ffffff')
  view.setVisible(false)
  const entry = { ownerKey: cacheKey, ownerWindowId: windowState.id, view, loading: false, lastUsed: Date.now(), lastNetworkActivity: Date.now(), lastConversationActivity: Date.now(), conversationRequests: new Map(), staleConversationRequestIds: new Set(), conversationTransportGeneration: 0, transportPreparationCount: 0, transportRequestId: '', healthProbeFailures: 0, loadingSince: 0, loadingFaultNoted: false, humanAction: undefined, humanNoticeFingerprint: '', lastSurfaceFingerprint: '', externalAuthProvider: '', authMode: 'embedded', embeddedAuthActive: false, embeddedAuthCrossedBoundary: false, authenticated: false, authProbeTimer: undefined, affinitySettleTimer: undefined, navigationPromise: undefined, navigationTarget: '', parkedLayout: false, affinity: createChatGPTAffinityTracker() }
  chatgptViews.set(cacheKey, entry)
  windowState.window.contentView.addChildView(view)

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
  view.setVisible(false)
  const entry = { role: 'worker', slotId, ownerKey: '', ownerWindowId: windowState.id, view, loading: false, lastUsed: Date.now(), lastNetworkActivity: Date.now(), lastConversationActivity: Date.now(), conversationRequests: new Map(), staleConversationRequestIds: new Set(), conversationTransportGeneration: 0, transportPreparationCount: 0, transportRequestId: '', healthProbeFailures: 0, loadingSince: 0, loadingFaultNoted: false, humanAction: undefined, humanNoticeFingerprint: '', lastSurfaceFingerprint: '', externalAuthProvider: '', authMode: 'embedded', embeddedAuthActive: false, embeddedAuthCrossedBoundary: false, authenticated: false, authProbeTimer: undefined, affinitySettleTimer: undefined, navigationPromise: undefined, navigationTarget: '', parkedLayout: true, affinity: createChatGPTAffinityTracker() }
  windowState.window.contentView.addChildView(view)
  chatGPTWorkerEntries.push(entry)
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
  })
  console.log(`[chat-agent] worker-created slot=${slotId} wc=${wc.id}`)
  return entry
}

function retireChatGPTWorkerView(entry) {
  if (!entry) return false
  clearTimeout(entry.affinitySettleTimer)
  const state = windowStateForEntry(entry)
  try { state?.window?.contentView?.removeChildView?.(entry.view) } catch { /* already detached */ }
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  return true
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
    if (runtime?.task || runtime?.active !== false) break
    const entry = chatGPTWorkerEntries.pop()
    retireChatGPTWorkerView(entry)
    chatAgentWorkerStates.delete(index)
  }
}

function ensureChatGPTWorkerPool(windowState) {
  reconcileChatGPTWorkerPool(windowState)
}

function assignChatGPTWorker(entry, task) {
  if (!entry || entry.role !== 'worker') throw new Error('Chat-agent worker slot is unavailable')
  const key = sanitizeChatCacheKey(task?.chat_id || task?.chatId)
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
  return { key, conversationURL }
}

function workerEntryForIndex(worker) {
  return chatGPTWorkerEntries[Math.max(0, Number(worker || 1) - 1)]
}

function publicChatAgentTask(task) {
  if (!task) return undefined
  return {
    task_id: String(task.task_id || ''), type: String(task.type || ''), chat_id: String(task.chat_id || ''),
    request_id: String(task.request_id || ''), root_request_id: String(task.root_request_id || ''),
    conversation_id: String(task.conversation_id || ''), status: String(task.status || ''),
    attempt: Math.max(0, Number(task.attempt || 0)), max_attempts: Math.max(0, Number(task.max_attempts || 0)),
    lease_expires_at: String(task.lease_expires_at || ''), not_before: String(task.not_before || ''),
    last_error: String(task.last_error || ''), created_at: String(task.created_at || ''),
  }
}

function chatAgentQueueDiagnostics(tasks = []) {
  const counts = {}
  let oldest = ''
  let nextNotBefore = ''
  for (const task of tasks) {
    const status = String(task?.status || 'UNKNOWN').toUpperCase()
    counts[status] = (counts[status] || 0) + 1
    if (!['DONE', 'FAILED', 'CANCELLED'].includes(status)) {
      const created = String(task?.created_at || '')
      if (created && (!oldest || created < oldest)) oldest = created
      const notBefore = String(task?.not_before || '')
      if (notBefore && (!nextNotBefore || notBefore < nextNotBefore)) nextNotBefore = notBefore
    }
  }
  return { total: tasks.length, counts, oldest_created_at: oldest, next_not_before: nextNotBefore }
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
    const [listed, provider] = await Promise.all([chatAgentScheduler.list({ limit: 500 }), chatAgentScheduler.providerState()])
    chatAgentRuntimeDiagnostics = {
      scheduler: { running: Boolean(chatAgentScheduler.running), backend_reachable: true, last_refresh_at: now, last_error: '' },
      queue: chatAgentQueueDiagnostics(Array.isArray(listed?.tasks) ? listed.tasks : []),
      provider: {
        provider: String(provider?.provider || 'chatgpt'), paused: provider?.paused === true,
        paused_until: String(provider?.paused_until || ''), reason: String(provider?.reason || ''), updated_at: String(provider?.updated_at || ''),
      },
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

function publicAgentBrowser(entry) {
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) return { available: false, web_contents_id: 0, url: '', title: '', loading: false }
  const currentURL = wc.getURL() || ''
  return {
    available: true,
    web_contents_id: wc.id,
    url: currentURL ? sanitizeDiagnosticURL(currentURL) : '',
    title: wc.getTitle() || '',
    loading: Boolean(entry.loading),
  }
}

function chatAgentRuntimeState() {
  const supervisor = supervisorEntry()
  const supervisorState = {
    id: 'supervisor', label: 'Supervisor', role: 'supervisor', status: supervisor?.loading ? 'loading' : 'idle',
    draining: false, chat_id: String(supervisor?.ownerKey || ''), task: undefined, error: '', browser: publicAgentBrowser(supervisor),
  }
  const workers = chatGPTWorkerEntries.map((entry, offset) => {
    const worker = offset + 1
    const runtime = chatAgentWorkerStates.get(worker) || {}
    return {
      id: entry.slotId || `worker-${worker}`, label: `Worker ${worker}`, role: 'worker',
      status: runtime.task ? 'running' : runtime.error ? 'error' : entry.loading ? 'loading' : 'idle',
      draining: worker > desiredChatAgentWorkerSlots, loop_active: runtime.active !== false,
      chat_id: String(runtime.task?.chat_id || runtime.lastTask?.chat_id || entry.ownerKey || ''), task: publicChatAgentTask(runtime.task),
      last_task: publicChatAgentTask(runtime.lastTask), last_claim_at: String(runtime.lastClaimAt || ''),
      error: String(runtime.error || ''), browser: publicAgentBrowser(entry),
    }
  })
  return {
    instance_id: String(chatAgentScheduler?.instanceID || ''),
    desired_workers: desiredChatAgentWorkerSlots,
    limits: { min_workers: MIN_WORKER_SLOTS, max_workers: HARD_MAX_WORKER_SLOTS, supervisors: 1 },
    scheduler: chatAgentRuntimeDiagnostics.scheduler,
    queue: chatAgentRuntimeDiagnostics.queue,
    provider: chatAgentRuntimeDiagnostics.provider,
    agents: [supervisorState, ...workers],
  }
}

function publishChatAgentRuntimeState() {
  const state = chatAgentRuntimeState()
  for (const windowState of desktopWindows.values()) sendToWindowState(windowState, 'wharness:agents:state', state)
  return state
}

async function chatAgentBrowserSnapshot(agentID) {
  const id = String(agentID || '').trim()
  const entry = id === 'supervisor' ? supervisorEntry() : chatGPTWorkerEntries.find((candidate) => candidate.slotId === id)
  const wc = entry?.view?.webContents
  if (!wc || wc.isDestroyed()) throw new Error('Agent browser instance is not available')
  const layoutKey = entry.ownerKey || (entry.role === 'supervisor' ? supervisorKey() : entry.slotId || id)
  ensureChatGPTLayoutViewport(layoutKey, entry)
  const image = await wc.capturePage()
  return { agentId: id, dataUrl: image.toDataURL(), capturedAt: new Date().toISOString() }
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

function supervisorEntry() {
  return [...chatgptViews.values()][0]
}

function supervisorKey() {
  return [...chatgptViews.keys()][0] || ''
}

function ensureChatGPTView(cacheKey, windowState) {
  const key = sanitizeChatCacheKey(cacheKey)
  let entry = chatgptViews.get(key)
  if (!entry) {
    const currentKey = supervisorKey()
    const current = currentKey ? chatgptViews.get(currentKey) : undefined
    if (current && currentKey !== key) {
      if (Number(current.transportPreparationCount || 0) > 0) throw new Error('ChatGPT Supervisor is busy submitting another chat')
      // `show` records the renderer's visible intent before activating the next
      // chat. Retiring the old Supervisor clears that window flag, so preserve
      // it across this immediate rebind or the replacement view stays hidden
      // behind the renderer's "A carregar ChatGPT…" placeholder indefinitely.
      const preserveVisibleIntent = windowState?.chatgptVisible === true
      retireChatGPTSupervisorSurface(currentKey)
      if (preserveVisibleIntent && windowState) windowState.chatgptVisible = true
    }
    const resolved = windowState || [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed())
    entry = createChatGPTView(key, resolved)
    entry.role = 'supervisor'
    entry.slotId = 'supervisor'
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

// The remote runtime has one human-facing Supervisor. The bounded autonomous
// worker pool lives outside chatgptViews. Renderer access is limited to the
// named agent-management IPC capabilities (runtime metadata, worker target,
// explicit snapshot). Switching chats retires/rebinds only the Supervisor;
// durable request state stays keyed by chat/request and workers continue independently.
const MAX_RESIDENT_CHATGPT_VIEWS = 1

function evictIdleChatGPTViews() {
  const entries = [...chatgptViews.entries()]
  if (entries.length <= MAX_RESIDENT_CHATGPT_VIEWS) return 0
  let released = 0
  for (const [key] of entries.slice(0, -MAX_RESIDENT_CHATGPT_VIEWS)) {
    if (retireChatGPTSupervisorSurface(key)) released += 1
  }
  return released
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
  // A parked view still carries the full-size layout bounds account
  // automation gave it. Showing it before the renderer reports the real
  // pane geometry would cover the whole Wharnex window for a frame, which
  // reads exactly like the project closing and reopening.
  const parked = entry.parkedLayout === true && !ownerState.chatgptBounds
  entry.view.setVisible(ownerState.chatgptVisible && !entry.externalAuthProvider && !parked)
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
  if (pending?.windowState) pending.windowState.desiredVisibleChatGPTKey = ''
}

function setDeferredSupervisorNavigation(cacheKey, windowState, request = {}, current = supervisorEntry()) {
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
}

function deferSupervisorNavigationIfBusy(cacheKey, windowState, request = {}) {
  const key = sanitizeChatCacheKey(cacheKey)
  const currentKey = supervisorKey()
  const current = currentKey ? chatgptViews.get(currentKey) : undefined
  if (!current || currentKey === key || Number(current.transportPreparationCount || 0) === 0) {
    clearDeferredSupervisorNavigation()
    return false
  }
  setDeferredSupervisorNavigation(key, windowState, request, current)
  console.log(`[chatgpt-supervisor] deferred-switch from=${currentKey} to=${key} request=${current.transportRequestId || '-'}`)
  return true
}

async function applyDeferredSupervisorNavigation() {
  const pending = deferredSupervisorNavigation
  if (!pending) return
  const current = supervisorEntry()
  if (current && Number(current.transportPreparationCount || 0) > 0) return
  deferredSupervisorNavigation = undefined
  const state = pending.windowState
  if (!state?.window || state.window.isDestroyed()) return
  state.chatgptVisible = pending.visible
  state.desiredVisibleChatGPTKey = ''
  const entry = activateChatGPTView(pending.key, pending.bounds, state)
  const target = pending.url ? requireTrustedChatGPTURL(pending.url) : CHATGPT_URL
  const currentURL = entry.view.webContents.getURL()
  if (!sameConversationURL(currentURL, target) && currentURL !== target) {
    await loadOwnedChatGPTURL(pending.key, entry, target, 'deferred-supervisor-switch')
  }
  if (state.chatgptVisible) entry.view.setVisible(!entry.externalAuthProvider)
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

async function fetchContextZip(sessionId) {
  const id = sanitizeSessionId(sessionId)
  const response = await fetch(contextBundleURL(BACKEND_URL, id), { redirect: 'error' })
  if (!response.ok) throw new Error(`Context bundle HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_CONTEXT_BYTES) throw new Error('Context ZIP exceeds 256 MiB desktop limit')
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Backend did not return a ZIP bundle')
  return { id, bytes }
}

async function fetchRequestKnowledge(sessionId, requestId) {
  const id = sanitizeSessionId(sessionId)
  const rid = String(requestId || '').trim()
  if (!/^req_[A-Za-z0-9_-]{8,180}$/.test(rid)) throw new Error('Invalid request id for project knowledge snapshot')
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/requests/${encodeURIComponent(rid)}/knowledge`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body?.knowledge) throw new Error(body?.error?.message || `Request knowledge HTTP ${response.status}`)
  return body.knowledge
}

async function persistChatArtifact(sessionId, requestId, direction, kind, filename, contentType, bytes) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/artifacts`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: String(requestId || '').trim(), direction, kind, filename, content_type: contentType || 'application/octet-stream', content_base64: Buffer.from(bytes).toString('base64') }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message || `Artifact persistence HTTP ${response.status}`)
  }
  return response.json()
}

async function publishRemoteChatInput(sessionId, requestId, prompt, bootstrapText, includeContext, attachments, artifacts, projectFiles = [], tunnelInstanceIds = []) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}/remote-input`, BACKEND_URL)
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(remoteInputPayload(requestId, prompt, bootstrapText, includeContext, attachments, artifacts, projectFiles, tunnelInstanceIds)),
  })
  const result = await response.json().catch(() => ({}))
  return parseRemoteInputResponse(response.status, result)
}

function normalizeTunnelInstanceIDs(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 16)
}

async function requireAutoSession(sessionId) {
  const id = sanitizeSessionId(sessionId)
  const target = new URL(`/api/sessions/${encodeURIComponent(id)}`, BACKEND_URL)
  const response = await fetch(target, { redirect: 'error' })
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
  if (!Array.isArray(values) || values.length > MAX_CHAT_ARTIFACTS) throw new Error(`At most ${MAX_CHAT_ARTIFACTS} Wharness artifacts are allowed`)
  const decoded = values.map((value) => decodeUserAttachment(value, MAX_CHAT_ARTIFACT_BYTES))
  const names = new Set()
  let total = 0
  for (const artifact of decoded) {
    const portableName = artifact.name.toLocaleLowerCase('en-US')
    if (names.has(portableName)) throw new Error(`Duplicate Wharness artifact filename: ${artifact.name}`)
    names.add(portableName)
    total += artifact.bytes.byteLength
  }
  if (total > MAX_CHAT_ARTIFACTS_BYTES) throw new Error('Wharness artifacts exceed the 6 MiB total limit')
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

async function materializeChatInput(cacheKey, sessionId, requestId, values, artifactValues, promptText, includeContext, projectFiles = [], liveTunnels = []) {
  const { decoded } = decodeChatAttachmentSet(values)
  const artifacts = decodeChatArtifactSet(artifactValues)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', cacheKey)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const context = includeContext ? await fetchContextZip(sessionId) : undefined
  const knowledge = await fetchRequestKnowledge(sessionId, requestId)
  const archiveName = chatInputArchiveFilename(cacheKey, requestId)
  const archivePath = path.join(dir, archiveName)
  const archive = await writeChatInputArchive(archivePath, {
    requestId,
    prompt: promptText,
    context,
    knowledge,
    attachments: decoded,
    artifacts: artifacts.decoded,
    projectFiles,
    liveTunnels,
  })
  await persistChatArtifact(sessionId, requestId, 'input', 'bundle', archiveName, 'application/zip', await readFile(archivePath))
  if (context) await persistChatArtifact(sessionId, requestId, 'input', 'context', `context-${requestId}.zip`, 'application/zip', context.bytes)
  for (const attachment of decoded) await persistChatArtifact(sessionId, requestId, 'input', 'attachment', attachment.name, attachment.mime, attachment.bytes)
  for (const artifact of artifacts.decoded) await persistChatArtifact(sessionId, requestId, 'input', 'system-artifact', artifact.name, artifact.mime, artifact.bytes)
  return { archivePath, archiveName, userAttachmentCount: decoded.length, artifactCount: artifacts.decoded.length, archiveEntryCount: archive.fileCount, bytes: archive.bytes }
}

async function materializeProtocolChatInput(cacheKey, sessionId, requestId, promptText, values = [], liveTunnels = []) {
  const { decoded } = decodeChatAttachmentSet(values)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-protocol', cacheKey, `${Date.now()}-${randomUUID()}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const archiveName = chatInputArchiveFilename(cacheKey, requestId)
  const archivePath = path.join(dir, archiveName)
  const knowledge = await fetchRequestKnowledge(sessionId, requestId)
  const archive = await writeChatInputArchive(archivePath, { requestId, prompt: promptText, knowledge, attachments: decoded, liveTunnels })
  return { archivePath, archiveName, attachmentCount: decoded.length, archiveEntryCount: archive.fileCount, bytes: archive.bytes }
}

async function fillBundledChatGPTComposer(key, entry, sessionId, requestId, promptText, expectedFilename, attachments = [], liveTunnels = []) {
  const input = await materializeProtocolChatInput(key, sessionId, requestId, promptText, attachments, liveTunnels)
  const bootstrap = localChatInputBootstrap(requestId, input.archiveName, expectedFilename, liveTunnels)
  try {
    const filled = await entry.view.webContents.executeJavaScript(chatGPTFillComposerScript(bootstrap), true)
    if (!filled) throw new Error('ChatGPT composer DOM could not be populated with bundled protocol input')
    await pasteChatGPTFile(entry, input.archivePath, 1, 1)
    await wait(chatInputSettleDelay(input.bytes, 1))
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
  return runChatGPTAccountAction('hide-sidebar', { key }, () => runChatGPTAccountScript(key, entry, 'hide-sidebar', chatGPTHideSidebarScript()))
}

// A hidden owned view is never given bounds by the window layout, which leaves
// its renderer with a zero-sized viewport: every getBoundingClientRect collapses
// to the origin and a native click would land nowhere. Account automation runs
// on background views (maintenance jobs), so give such a view a real layout
// viewport without ever making it visible.
function ensureChatGPTLayoutViewport(key, entry) {
  // Never resize a view the window is actually showing: its bounds belong to
  // the renderer layout, and overwriting them makes the visible ChatGPT surface
  // jump while the user is looking at it.
  const ownerState = windowStateForEntry(entry)
  if (ownerState?.activeChatGPTKey === key) return false
  const bounds = entry.view.getBounds?.() || { width: 0, height: 0 }
  if (bounds.width >= 640 && bounds.height >= 480) return false
  // The viewport has to sit inside the window: Electron clips a child view to
  // its parent, so off-screen bounds collapse the renderer to 0x0 — it stops
  // laying out and stops accepting trusted input, which is measured behaviour,
  // not a guess. The size is therefore real and at the origin, and the view is
  // marked parked so it can never be shown while carrying these bounds.
  entry.view.setBounds({ x: 0, y: 0, width: 1280, height: 900 })
  entry.parkedLayout = true
  return true
}

// Locates a control with a typed script and commits it with a trusted native
// click. ChatGPT's Radix menu items ignore synthetic HTMLElement.click(), so
// "locate, then click for real" is the only reliable shape for these controls.
async function commitChatGPTAccountControl(key, entry, stage, script, { attempts = 4 } = {}) {
  let located = { ok: false, state: 'action-unavailable' }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
    located = await runChatGPTAccountScript(key, entry, stage, script)
    if (located.ok && located.rect) break
  }
  if (!located.ok || !located.rect) return located
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  dispatchChatGPTPointerClick(wc, located.rect)
  return located
}

async function chooseChatGPTConversationAction(key, entry, action, conversationId = '') {
  const providerAction = action === 'move-project' ? 'move-conversation' : `${action}-conversation`
  return runChatGPTAccountAction(providerAction, { key }, async () => {
    const opened = await runChatGPTAccountScript(key, entry, `${action}-menu`, chatGPTOpenConversationMenuScript(conversationId))
    if (!opened.ok) return opened
    return commitChatGPTAccountControl(key, entry, action, chatGPTMenuItemRectScript(action))
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
    const opened = await runChatGPTAccountScript(key, entry, 'move-project-menu', chatGPTOpenConversationMenuScript(conversationId))
    if (!opened.ok) return opened
    const submenu = await commitChatGPTAccountControl(key, entry, 'move-project', chatGPTMenuItemRectScript('move-project'))
    if (!submenu.ok) return submenu
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)

    const existing = await runChatGPTAccountScript(key, entry, 'find-project', chatGPTProjectItemRectScript(name))
    if (existing.ok) return { ok: true, state: 'exists', project: name, duplicates: existing.duplicates || 1, href: existing.href || '' }

    const create = await commitChatGPTAccountControl(key, entry, 'new-project', chatGPTMenuItemRectScript('new-project'))
    if (!create.ok) return { ok: false, state: 'create-project-unavailable', project: name }
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)
    const staged = await commitChatGPTAccountControl(key, entry, 'commit-project', chatGPTNewProjectDialogScript(name), { attempts: 6 })
    if (!staged.ok) return { ok: false, state: staged.state, project: name }
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 4)

    const reopened = await runChatGPTAccountScript(key, entry, 'confirm-menu', chatGPTOpenConversationMenuScript(conversationId))
    if (!reopened.ok) return { ok: false, state: 'project-not-confirmed', project: name }
    const reSubmenu = await commitChatGPTAccountControl(key, entry, 'confirm-move-project', chatGPTMenuItemRectScript('move-project'))
    if (!reSubmenu.ok) return { ok: false, state: 'project-not-confirmed', project: name }
    await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
    const confirmed = await runChatGPTAccountScript(key, entry, 'confirm-project', chatGPTProjectItemRectScript(name))
    if (!confirmed.ok) return { ok: false, state: 'project-not-confirmed', project: name }
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
      if (expectedURL) {
        const target = requireTrustedChatGPTURL(expectedURL)
        if (!sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'organize-conversation')
        await waitForChatGPTSurfaceReady(key, entry)
      }
      ensureChatGPTLayoutViewport(key, entry)
      const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
      const shown = await runChatGPTAccountScript(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
      if (!shown.ok) return shown
      if (shown.state === 'opening') await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)

      // ensureChatGPTProject leaves the "Move to project" submenu open with the
      // wanted project present, so selecting it is the very next click.
      const project = await ensureChatGPTProject(key, entry, projectName, conversationId)
      if (!project.ok) return { ok: false, state: project.state, project: project.project || normalizeChatGPTProjectName(projectName) }
      if (Number(project.duplicates || 1) > 1) return { ok: false, state: 'duplicate-project', project: project.project, duplicates: project.duplicates }
      const selected = await commitChatGPTAccountControl(key, entry, 'select-project', chatGPTProjectItemRectScript(project.project))
      if (!selected.ok) return { ok: false, state: selected.state, project: project.project }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS * 3)

      const rename = await chooseChatGPTConversationAction(key, entry, 'rename', conversationId)
      if (!rename.ok) return { ok: false, state: rename.state, project: project.project }
      await wait(CHATGPT_ACCOUNT_ACTION_SETTLE_MS)
      // The rename control is an inline sidebar input, not a dialog: stage the
      // value, then commit it with a trusted Enter the same way the composer is
      // submitted, and confirm from the row's own label.
      const staged = await runChatGPTAccountScript(key, entry, 'commit-title', chatGPTCommitConversationTitleScript(title))
      if (!staged.ok) return { ok: false, state: staged.state, project: project.project }
      const { wc } = requireOwnedChatGPTEntry(key, entry)
      dispatchChatGPTAccountKey(wc, 'Enter')
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
      const target = expectedURL ? requireTrustedChatGPTURL(expectedURL) : ''
      if (target && !sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'archive-conversation')
      await waitForChatGPTSurfaceReady(key, entry)
      ensureChatGPTLayoutViewport(key, entry)
      const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
      const stopped = await runChatGPTAccountAction('stop-conversation', { key }, () => runChatGPTAccountScript(key, entry, 'stop', chatGPTStopConversationScript()))
      if (stopped.state === 'stopping') await wait(750)
      // The archive control lives in the sidebar history row's own menu, so the
      // sidebar has to be open before the conversation's trigger exists.
      const shown = await runChatGPTAccountScript(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
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
      const target = expectedURL ? requireTrustedChatGPTURL(expectedURL) : ''
      if (target && !sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'delete-conversation')
      await waitForChatGPTSurfaceReady(key, entry)
      ensureChatGPTLayoutViewport(key, entry)
      const conversationId = chatGPTConversationID(entry.view.webContents.getURL())
      const shown = await runChatGPTAccountScript(key, entry, 'show-sidebar', chatGPTShowSidebarScript())
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
      dispatchChatGPTPointerClick(entry.view.webContents, located.rect)
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
      return await runChatGPTAccountAction('stop-conversation', { key }, () => runChatGPTAccountScript(key, entry, 'stop', chatGPTStopConversationScript()))
    } finally {
      entry.accountOperationActive = false
      reconcileChatGPTThrottle(key, entry)
    }
  })
}

async function targetChatGPTComposer(cacheKey, expectedURL = '', preferCurrentConversation = false, entryOverride = undefined) {
  const key = sanitizeChatCacheKey(cacheKey)
  const entry = entryOverride || ensureChatGPTView(key).entry
  requireOwnedChatGPTEntry(key, entry)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  if (entry.externalAuthProvider) throw new Error(`ChatGPT está em autenticação externa via ${entry.externalAuthProvider}. Use o navegador do sistema e importe o bundle ZIP pelo Wharness.`)
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
    if (health?.required === true) {
      const kind = String(health.kind || 'verification')
      setChatGPTHumanAction(key, kind, '', 'dom')
      throw new Error(chatGPTHumanActionMessage(kind))
    }
    if (entry.humanAction?.source === 'dom' && health?.composerReady === true) clearChatGPTHumanAction(key, 'interface disponível')
  }
  const focusComposer = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const focused = await executeChatGPTDOMScript(key, entry, 'focus-composer', chatGPTFocusComposerScript())
      if (focused) return true
      await wait(250)
    }
    return false
  }
  await assertNoHumanGate('health')
  let focused = await focusComposer()
  if (!focused) {
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
    focused = await focusComposer()
  }
  if (!focused) {
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

async function pasteChatGPTFile(entry, filePath, index, count) {
  const key = chatGPTKeyForEntry(entry)
  const { wc } = requireOwnedChatGPTEntry(key, entry)
  const result = await pasteWithUploadRetry({
    beforeAttempt: async () => {
      await waitForChatGPTSurfaceReady(key, entry)
      const focused = await wc.executeJavaScript(chatGPTFocusComposerScript(), true)
      if (!focused) throw new Error('ChatGPT composer DOM was not found before upload')
    },
    beginUpload: () => chatGPTUploads.expect(wc.id),
    paste: async () => {
      await selectChatGPTUploadFile(wc, filePath)
    },
    onRetry: ({ attempt, error }) => {
      console.warn(`[chatgpt-upload] retry wc=${wc.id} file=${index}/${count} failedAttempt=${attempt} error=${error.message}`)
    },
  })
  console.log(`[chatgpt-upload] confirmed wc=${wc.id} file=${index}/${count} observed=${result.observed}`)
}

// A single click/Enter dispatch can silently fail to actually submit — a
// disabled send button, a focus loss, a stray newline instead of a submit,
// or a page still settling after navigation. Every caller here treats a
// confirmed submission as a precondition for what it does next (arming an
// expected bundle, waiting for the conversation URL, clearing a human-action
// flag, ...), so a dispatch that never reaches ChatGPT's own POST must
// surface as a real failure — via submitWithRetry, not a value callers can
// silently ignore. Callers that already checked `.accepted` (kept as
// harmless redundant defense) now simply never see a falsy value; callers
// that relied on their own try/catch or on the shared DOM-probe-failure
// counter in pollExpectedChatGPTDownloadKey already handle a thrown error
// correctly.
async function submitChatGPTDraft(key, entryOverride = undefined) {
  const target = await targetChatGPTComposer(key, '', false, entryOverride)
  const wc = target.wc
  markChatGPTAffinitySubmitted(target.entry.affinity)
  let method = 'dom-click'
  const result = await submitWithRetry({
    beforeAttempt: async (attempt) => {
      if (attempt === 1) return
      await waitForChatGPTSurfaceReady(key, target.entry)
      const focused = await wc.executeJavaScript(chatGPTFocusComposerScript(), true)
      if (!focused) throw new Error('ChatGPT composer DOM was not found before submit retry')
    },
    beginSubmission: () => chatGPTSubmissions.expect(wc.id),
    submit: async () => {
      const clicked = await wc.executeJavaScript(chatGPTSubmitScript(), true)
      method = clicked ? 'dom-click' : 'native-enter'
      if (!clicked) dispatchChatGPTSubmit(wc)
    },
    onRetry: ({ attempt, nextAttempt, error }) => {
      console.warn(`[chatgpt-submit] retry key=${key} attempt=${attempt} next=${nextAttempt} error=${error?.message || error}`)
    },
  })
  console.log(`[chatgpt-submit] accepted key=${key} method=${method} request=${result.requestId}`)
  return result
}

async function preparePromptForChatGPT(request) {
  const rawText = String(request?.text || '').trim()
  const requestedTitle = request?.firstRequest ? normalizeWHXTitle(request?.chatTitle || request?.bootstrapText) : ''
  const text = requestedTitle
    ? `${rawText}\n\nWHX CONVERSATION IDENTITY: use the conversation title ${JSON.stringify(requestedTitle)}. Keep this title stable for the full request.`
    : rawText
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.requestId || '').trim()
  const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
  const autoSubmit = request?.autoSubmit === true
  if (autoSubmit) await requireAutoSession(request?.sessionId)
  // Preserve this already-authorized delivery only in Desktop memory so a
  // transient remote-surface failure can be retried without replanning.
  retryableChatGPTPrompts.set(key, { request, preparedAt: Date.now() })
  const linkedConversation = canonicalChatGPTConversationURL(request?.url || '')
  const entry = chatgptViews.get(key)
  const currentConversationURL = linkedConversation || canonicalChatGPTConversationURL(entry?.view.webContents.getURL() || '')
  const currentSha = String(request?.contextSha256 || '').trim()
  const previousSha = String(request?.lastContextSha256 || '').trim()
  const previousURL = String(request?.lastContextChatgptUrl || '').trim()
  const includeContext = shouldAttachProjectContext({ currentSha, previousSha, currentConversationId: chatGPTConversationID(currentConversationURL), previousConversationId: chatGPTConversationID(previousURL), force: request?.includeContext === true })

  const tunnelInstanceIds = normalizeTunnelInstanceIDs(request?.tunnelInstanceIds)
  let remoteInput = null
  if (tunnelInstanceIds.length) {
    try {
      remoteInput = await publishRemoteChatInput(request?.sessionId, requestId, text, request?.bootstrapText, includeContext, request?.attachments || [], request?.artifacts || [], request?.projectFiles || [], tunnelInstanceIds)
    } catch (error) {
      console.warn(`[chatgpt-protocol-channel] optional live fallback unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Every planner request is transported as exactly one request ZIP. Selected
  // tunnels are optional live mirrors and never replace that authoritative ZIP.
  const directPrompt = remoteInput?.fallbackPrompt ? `${text}\n\n${remoteInput.fallbackPrompt}` : text
  const input = await materializeChatInput(key, request?.sessionId, requestId, request?.attachments || [], request?.artifacts || [], directPrompt, includeContext, request?.projectFiles || [], remoteInput?.tunnels || [])
  const bootstrap = localChatInputBootstrap(requestId, input.archiveName, expectedFilename, remoteInput?.tunnels || [])
  const target = await targetChatGPTComposer(key, linkedConversation || CHATGPT_URL, linkedConversation ? request?.preferCurrentConversation === true : false)
  if (!linkedConversation) syncChatGPTAffinityURL(key, target.entry)
  const filled = await executeChatGPTDOMScript(key, target.entry, 'fill-composer', chatGPTFillComposerScript(bootstrap))
  if (!filled) throw new Error('ChatGPT composer DOM could not be populated with local input bootstrap')
  await pasteChatGPTFile(target.entry, input.archivePath, 1, 1)
  let conversationUrl = target.conversationUrl
  if (autoSubmit) {
    await wait(chatInputSettleDelay(input.bytes, 1))
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, remoteInput?.tunnels || [], directPrompt, request?.sessionId, expectedFilename)
    try {
      await submitChatGPTDraft(key)
    } catch (error) {
      disarmExpectedChatGPTBundle(key, requestId)
      throw error
    }
    conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
    if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
    await persistWorkspaceChatRemote(key, conversationUrl, { remoteState: 'awaiting-response' })
    await enqueueChatAgentFollowups(key, requestId, conversationUrl, {
      expectedFilename, assistantBaseline, recoveryBootstrap: bootstrap, originalPrompt: directPrompt,
      sessionId: request?.sessionId || '', liveTunnels: remoteInput?.tunnels || [],
      projectName: request?.projectName || '', fallbackTitle: requestedTitle,
    })
    preparedChatGPTDrafts.delete(key)
  } else {
    preparedChatGPTDrafts.set(key, { preparedAt: Date.now(), attachmentCount: 1, requestId, sessionId: request?.sessionId, recoveryBootstrap: bootstrap, liveTunnels: remoteInput?.tunnels || [], originalPrompt: directPrompt, expectedFilename, projectName: request?.projectName, chatTitle: requestedTitle })
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

async function retryPersistedChatGPTPrompt(request) {
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
  const target = await targetChatGPTComposer(key, targetURL, false)
  const bootstrap = localChatInputBootstrap(requestId, archiveName, expectedFilename, [])
  const filled = await executeChatGPTDOMScript(key, target.entry, 'fill-durable-retry', chatGPTFillComposerScript(bootstrap))
  if (!filled) throw new Error('ChatGPT composer DOM could not be populated with the persisted request')
  await pasteChatGPTFile(target.entry, archivePath, 1, 1)
  await wait(chatInputSettleDelay(bytes.byteLength, 1))
  const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
  armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, [], String(request?.recoveryPrompt || ''), sessionId, expectedFilename)
  try { await submitChatGPTDraft(key) }
  catch (error) { disarmExpectedChatGPTBundle(key, requestId); throw error }
  clearChatGPTHumanAction(key, 'entrada persistida reenviada')
  return { ok: true, cacheKey: key, requestId, attachmentCount: 1, submitted: true, expectedFilename, includedContext: true, conversationUrl: targetURL, durable: true }
}

async function retryPreparedChatGPTPrompt(request) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const requestId = String(request?.expectedRequestId || '').trim()
  const retryable = retryableChatGPTPrompts.get(key)
  if (!retryable || Date.now() - retryable.preparedAt > RETRYABLE_PROMPT_TTL_MS) {
    retryableChatGPTPrompts.delete(key)
    if (requestId && recentlyDeliveredChatGPTBundleRequestId(requestId)) {
      return { ok: true, cacheKey: key, requestId, alreadyDelivered: true }
    }
    return retryPersistedChatGPTPrompt(request)
  }
  if (requestId && String(retryable.request?.requestId || '') !== requestId) {
    throw new Error('Uma requisição mais recente substituiu esta; abra a aba do ChatGPT para continuar.')
  }
  return preparePromptForChatGPT(retryable.request)
}

async function attachContextToChatGPT(request) {
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const target = await targetChatGPTComposer(key, request?.url || '', true)
  const context = await fetchContextZip(request?.sessionId)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-context')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, `wharness-context-${context.id}.zip`)
  await writeFile(filePath, context.bytes, { mode: 0o600 })
  await pasteChatGPTFile(target.entry, filePath, 1, 1)
  await wait(chatInputSettleDelay(context.bytes.byteLength, 1))
  const submission = await submitChatGPTDraft(key)
  if (!submission.accepted) throw new Error('ChatGPT context submission was dispatched but could not be confirmed')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
  touchChatGPTEntry(target.entry)
  return { ok: true, cacheKey: key, bytes: context.bytes.byteLength, submitted: true, conversationUrl }
}

async function attachPromptToChatGPT(request) {
  const text = String(request?.text || '').trim()
  if (!text) throw new Error('Prepared prompt is empty')
  if (text.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
  const key = sanitizeChatCacheKey(request?.cacheKey)
  const target = await targetChatGPTComposer(key, request?.url || '', true)
  const prompt = plannerPromptMarkdown(text)
  const dir = path.join(app.getPath('temp'), 'wharness-chat-inputs', key, 'manual-prompt')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, prompt.name)
  await writeFile(filePath, prompt.bytes, { mode: 0o600 })
  await pasteChatGPTFile(target.entry, filePath, 1, 1)
  await wait(chatInputSettleDelay(prompt.bytes.byteLength, 1))
  const submission = await submitChatGPTDraft(key)
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
  const submission = await submitChatGPTDraft(key)
  if (!submission.accepted) throw new Error('ChatGPT prompt submission was dispatched but could not be confirmed')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, entry)
  if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
  armExpectedChatGPTBundle(key, prepared.requestId, assistantBaseline, prepared.recoveryBootstrap, prepared.liveTunnels || [], prepared.originalPrompt || '', prepared.sessionId || '', expectedFilename)
  await persistWorkspaceChatRemote(key, conversationUrl, { remoteState: 'awaiting-response' })
  await enqueueChatAgentFollowups(key, prepared.requestId, conversationUrl, {
    expectedFilename, assistantBaseline, recoveryBootstrap: prepared.recoveryBootstrap,
    originalPrompt: prepared.originalPrompt || '', sessionId: prepared.sessionId || '', liveTunnels: prepared.liveTunnels || [],
    projectName: prepared.projectName || '', fallbackTitle: prepared.chatTitle || '',
  })
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
  const bundled = await fillBundledChatGPTComposer(key, target.entry, sessionId, requestId, text, expectedFilename, [], liveTunnels)
  await wait(100)
  const submission = await submitChatGPTDraft(key, target.entry)
  if (!submission.accepted) throw new Error('ChatGPT prompt submission was dispatched but could not be confirmed')
  const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
  if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
  armExpectedChatGPTBundle(key, requestId, assistantBaseline, bundled.bootstrap, liveTunnels, text, sessionId, expectedFilename)
  touchChatGPTEntry(target.entry)
  console.log(`[chatgpt-repair] submitted key=${key} chars=${text.length} method=dom`)
  return { ok: true, cacheKey: key, expectedFilename, conversationUrl, assistantBaseline, recoveryBootstrap: bundled.bootstrap, liveTunnels }
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

async function enqueueChatAgentTask(type, { key, requestId = '', rootRequestId = '', conversationURL = '', parentTaskID = '', dedupeKey = '', payload = {}, maxAttempts = 8, notBefore = undefined, projectID = '', sessionID = '' }) {
  if (!chatAgentScheduler) throw new Error('Chat-agent scheduler is not ready')
  const conversationID = chatAgentConversationID(conversationURL)
  return chatAgentScheduler.enqueue({
    type, project_id: String(projectID || ''), chat_id: sanitizeChatCacheKey(key), session_id: String(sessionID || ''),
    request_id: String(requestId || ''), root_request_id: String(rootRequestId || requestId || ''), conversation_id: conversationID,
    parent_task_id: String(parentTaskID || ''), dedupe_key: String(dedupeKey || ''), max_attempts: Number(maxAttempts || 8),
    not_before: notBefore || new Date().toISOString(), payload: { ...payload, conversation_url: canonicalChatGPTConversationURL(conversationURL) },
  })
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
    projectID: String(request.projectId || projectName || ''), sessionID: String(request.sessionId || ''),
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
    project_name: String(values.projectName || ''), fallback_title: String(values.fallbackTitle || ''), recovery_count: Math.max(0, Number(values.recoveryCount || 0)),
  }
}

async function enqueueChatAgentFollowups(key, requestId, conversationURL, values = {}) {
  const payload = expectedChatAgentPayload(key, requestId, conversationURL, values)
  const common = { key, requestId, rootRequestId: requestId, conversationURL, sessionID: payload.session_id, projectID: values.projectName || '', payload }
  await enqueueChatAgentTask('AWAIT_RESPONSE', { ...common, dedupeKey: `await:${requestId}`, maxAttempts: 30 })
  await enqueueChatAgentTask('TITLE_DISCOVER', { ...common, dedupeKey: `title:${chatAgentConversationID(conversationURL) || key}`, maxAttempts: 8 })
}

function hydrateExpectedChatAgentBundle(key, task, payload) {
  const requestId = String(task?.request_id || '')
  let expected = expectedChatGPTBundles.get(key)
  if (expected?.requestId === requestId) return expected
  armExpectedChatGPTBundle(key, requestId, payload.assistant_baseline, payload.recovery_bootstrap, payload.live_tunnels || [], payload.original_prompt || '', payload.session_id || task?.session_id || '', payload.expected_filename || '')
  expected = expectedChatGPTBundles.get(key)
  expected.continuationCount = Math.max(0, Number(payload.recovery_count || 0))
  return expected
}

async function chatAgentChildExists(task, type) {
  const listed = await chatAgentScheduler.list({ request_id: task.request_id })
  return (listed?.tasks || []).some((item) => item.type === type && item.parent_task_id === task.task_id && item.status !== 'FAILED' && item.status !== 'CANCELLED')
}

async function probeChatAgentResponse(task, entry, key, payload, conversationURL) {
  const expected = hydrateExpectedChatAgentBundle(key, task, payload)
  if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId) || pendingChatGPTBundleDeliveries.has(expected.requestId)) {
    disarmExpectedChatGPTBundle(key, expected.requestId)
    return { status: 'done' }
  }
  await targetChatGPTComposer(key, conversationURL, false, entry)
  const health = await executeChatGPTDOMScript(key, entry, 'worker-health', chatGPTHumanActionScript())
  if (health?.required === true) return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(String(health.kind || 'verification')) }
  if (!expected.downloadInFlight) {
    const clickMode = await entry.view.webContents.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, expected.assistantBaseline), true)
    if (clickMode) {
      expected.downloadInFlight = true
      expected.lastDOMClick = Date.now()
      recentExpectedDownload = { key, requestId: expected.requestId, at: Date.now() }
      return { status: 'waiting', delayMs: 2_000 }
    }
  }
  const completion = await entry.view.webContents.executeJavaScript(chatGPTResponseCompletionScript(expected.assistantBaseline), true)
  if (completion?.thinking === true || completion?.complete !== true) return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt) }
  if (Number(payload.recovery_count || 0) >= MAX_BUNDLE_CONTINUATIONS) {
    return { status: 'attention', error: `ChatGPT terminou sem disponibilizar ${expected.filename} depois da recuperação limitada.` }
  }
  if (!(await chatAgentChildExists(task, 'RECOVERY_WRITE'))) {
    const continuation = `WHARNESS DELIVERY CONTINUATION — SAME REQUEST ${expected.requestId}\n\nThe previous ChatGPT turn finished without a detected validated downloadable bundle named ${expected.filename}.\nDo not restart the analysis, change scope, or answer with prose. Continue from the work already completed and create/attach exactly ${expected.filename} according to the existing Wharness file-first contract. Finish with the file attachment only.${expected.originalPrompt ? `\n\nORIGINAL REQUEST CONTENT — authoritative task context repeated inside this continuation bundle:\n\n${expected.originalPrompt}` : ''}`
    await enqueueChatAgentTask('RECOVERY_WRITE', {
      key, requestId: expected.requestId, rootRequestId: task.root_request_id || expected.requestId,
      conversationURL, parentTaskID: task.task_id, sessionID: expected.sessionId, maxAttempts: 6,
      payload: { ...payload, prompt: continuation, recovery_count: Number(payload.recovery_count || 0) + 1, expected_filename: expected.filename },
    })
  }
  return { status: 'done' }
}

async function executeChatAgentWrite(task, entry, key, payload, conversationURL) {
  const prompt = String(payload.prompt || payload.original_prompt || '').trim()
  if (!prompt) return { status: 'failed', error: 'chat-agent write payload is empty' }
  const result = await withChatGPTTransportPreparation(key, entry, task.request_id, () =>
    submitPromptToChatGPT(key, prompt, conversationURL, task.request_id, payload.session_id || task.session_id || '', entry))
  await persistWorkspaceChatRemote(key, result.conversationUrl, { remoteState: 'awaiting-response' })
  const nextPayload = expectedChatAgentPayload(key, task.request_id, result.conversationUrl, {
    expectedFilename: result.expectedFilename, assistantBaseline: result.assistantBaseline, recoveryBootstrap: result.recoveryBootstrap,
    originalPrompt: payload.original_prompt || prompt, sessionId: payload.session_id || task.session_id || '', liveTunnels: result.liveTunnels || payload.live_tunnels || [],
    projectName: payload.project_name || '', fallbackTitle: payload.fallback_title || '', recoveryCount: payload.recovery_count || 0,
  })
  await enqueueChatAgentTask('AWAIT_RESPONSE', {
    key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: result.conversationUrl,
    parentTaskID: task.task_id, dedupeKey: `await:${task.request_id}`, payload: nextPayload, maxAttempts: 30, sessionID: nextPayload.session_id,
  })
  return { status: 'done' }
}

async function enqueueOrganizeFromTitle(task, key, payload, conversationURL, title, parentTaskID = task.task_id) {
  return enqueueChatAgentTask('ORGANIZE_CHAT', {
    key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL,
    parentTaskID, dedupeKey: `organize:${chatAgentConversationID(conversationURL) || key}`,
    payload: { ...payload, title: normalizeWHXTitle(title), target_url: conversationURL }, maxAttempts: 8,
  })
}

async function executeChatAgentTitleDiscover(task, entry, key, payload, conversationURL) {
  const title = await suggestChatGPTConversationTitle(key, conversationURL, entry)
  if (title.ok) {
    const prior = chatAgentTitleSamples.get(task.task_id)
    if (!prior || prior.title !== title.title) {
      chatAgentTitleSamples.set(task.task_id, { title: title.title, reads: 1 })
      return { status: 'waiting', delayMs: 1_500 }
    }
    prior.reads += 1
    if (prior.reads < 2) return { status: 'waiting', delayMs: 1_500 }
    await enqueueOrganizeFromTitle(task, key, payload, conversationURL, title.title)
    chatAgentTitleSamples.delete(task.task_id)
    return { status: 'done' }
  }
  if (Number(task.attempt || 0) < 3) return { status: 'waiting', delayMs: 2_500 }
  if (!(await chatAgentChildExists(task, 'TITLE_GENERATE_TEMP'))) {
    await enqueueChatAgentTask('TITLE_GENERATE_TEMP', {
      key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL,
      parentTaskID: task.task_id, dedupeKey: `title-temp:${chatAgentConversationID(conversationURL) || key}`,
      payload, maxAttempts: 4,
    })
  }
  return { status: 'done' }
}

async function executeChatAgentTempTitle(task, entry, key, payload, conversationURL) {
  const capsule = String(payload.fallback_title || payload.project_name || `WHX ${task.request_id}`).slice(0, 160)
  const target = await targetChatGPTComposer(key, CHATGPT_URL, false, entry)
  const prompt = `Create a concise conversation title for this Wharnex task context. Do not perform the task itself. Context label: ${capsule}`
  const filled = await target.wc.executeJavaScript(chatGPTFillComposerScript(prompt), true)
  if (!filled) return { status: 'failed', error: 'temporary title composer could not be filled' }
  const submitted = await submitChatGPTDraft(key, entry)
  if (!submitted.accepted) return { status: 'waiting', delayMs: 2_000 }
  const tempURL = await waitForSubmittedChatGPTConversation(key, entry, target.conversationUrl)
  if (!tempURL) return { status: 'waiting', delayMs: 2_000 }
  await enqueueChatAgentTask('TITLE_AWAIT', {
    key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: tempURL,
    parentTaskID: task.task_id, dedupeKey: `title-await:${chatAgentConversationID(tempURL)}`,
    payload: { ...payload, target_url: conversationURL, temp_url: tempURL }, maxAttempts: 8,
  })
  return { status: 'done' }
}

async function executeChatAgentTitleAwait(task, entry, key, payload) {
  const tempURL = canonicalChatGPTConversationURL(payload.temp_url || '')
  const targetURL = canonicalChatGPTConversationURL(payload.target_url || '')
  const suggested = await suggestChatGPTConversationTitle(key, tempURL, entry)
  if (!suggested.ok && Number(task.attempt || 0) < 4) return { status: 'waiting', delayMs: 2_500 }
  const title = suggested.ok ? suggested.title : normalizeWHXTitle(payload.fallback_title || task.request_id)
  await enqueueOrganizeFromTitle(task, key, payload, targetURL, title)
  return { status: 'done' }
}

async function chatAgentLifecycleBlocked(task) {
  const listed = await chatAgentScheduler.list({ chat_id: task.chat_id })
  return (listed?.tasks || []).some((item) => item.task_id !== task.task_id && ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status) && ['BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE'].includes(item.type))
}

async function chatAgentLifecycleRetry(task, key, conversationURL, error, { persist = true } = {}) {
  const detail = String(error || 'remote lifecycle operation did not complete')
  if (Number(task.attempt || 0) < Number(task.max_attempts || 0)) {
    return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: detail }
  }
  if (persist) await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'attention' })
  return { status: 'failed', error: detail }
}

async function executeChatAgentTask(task, { worker }) {
  const entry = workerEntryForIndex(worker)
  if (!entry) return { status: 'attention', providerWide: true, error: 'Autonomous worker browser is unavailable' }
  const payload = chatAgentTaskPayload(task)
  const assigned = assignChatGPTWorker(entry, { ...task, payload })
  const key = assigned.key
  const conversationURL = chatAgentConversationURL(task, payload) || assigned.conversationURL
  if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) await loadOwnedChatGPTURL(key, entry, conversationURL, `chat-agent-${String(task.type || '').toLowerCase()}`)
  switch (task.type) {
    case 'AWAIT_RESPONSE': return probeChatAgentResponse(task, entry, key, payload, conversationURL)
    case 'BOT_WRITE':
    case 'RECOVERY_WRITE': return executeChatAgentWrite(task, entry, key, payload, conversationURL)
    case 'TITLE_DISCOVER': return executeChatAgentTitleDiscover(task, entry, key, payload, conversationURL)
    case 'TITLE_GENERATE_TEMP': return executeChatAgentTempTitle(task, entry, key, payload, conversationURL)
    case 'TITLE_AWAIT': return executeChatAgentTitleAwait(task, entry, key, payload)
    case 'ORGANIZE_CHAT': {
      const result = await organizeChatGPTConversation(key, payload.project_name, payload.title || payload.fallback_title, payload.target_url || conversationURL, entry)
      if (result.state === 'duplicate-project') return { status: 'attention', error: `Projeto ChatGPT duplicado: ${result.project}` }
      if (!result.ok) return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: result.state }
      await persistWorkspaceChatRemote(key, payload.target_url || conversationURL, { projectRef: result.project || '', remoteTitle: result.title || '', remoteState: 'organized' })
      if (payload.temp_url) await enqueueChatAgentTask('DELETE_TEMP_CHAT', { key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: payload.temp_url, parentTaskID: task.task_id, dedupeKey: `delete-temp:${chatAgentConversationID(payload.temp_url)}`, payload, maxAttempts: 6 })
      return { status: 'done' }
    }
    case 'RENAME_CHAT': {
      const result = await organizeChatGPTConversation(key, payload.project_name, payload.title, conversationURL, entry)
      if (!result.ok) return chatAgentLifecycleRetry(task, key, conversationURL, result.state)
      await persistWorkspaceChatRemote(key, conversationURL, { projectRef: result.project || '', remoteTitle: result.title || payload.title || '', remoteState: 'organized' })
      return { status: 'done' }
    }
    case 'ARCHIVE_CHAT': {
      if (await chatAgentLifecycleBlocked(task)) return { status: 'waiting', delayMs: 5_000 }
      const result = await archiveChatGPTConversation(key, conversationURL, entry)
      if (!(result.ok || result.state === 'already-archived')) return chatAgentLifecycleRetry(task, key, conversationURL, result.state)
      await persistWorkspaceChatRemote(key, conversationURL, { remoteState: 'archived' })
      return { status: 'done' }
    }
    case 'DELETE_CHAT':
    case 'DELETE_TEMP_CHAT': {
      if (task.type === 'DELETE_CHAT' && await chatAgentLifecycleBlocked(task)) return { status: 'waiting', delayMs: 5_000 }
      const result = await deleteChatGPTConversation(key, conversationURL, entry)
      if (!(result.ok || result.state === 'already-deleted')) return chatAgentLifecycleRetry(task, key, conversationURL, result.state, { persist: task.type === 'DELETE_CHAT' })
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
      return { status: 'waiting', delayMs: chatAgentBackoff(task.attempt), error: result.state }
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
  const text = `USER COMMENT FOR THE ACTIVE WHARNESS TASK:
${comment}

Treat this as additional guidance for the SAME task and SAME request. Do not replace, cancel or downgrade the original deliverable. Continue the work and still return the required canonical bundle ${expectedFilename}.`
  const commentId = String(request?.commentId || `${requestId}:${comment}`).slice(0, 20000)
  const attachments = Array.isArray(request?.attachments) ? request.attachments : []
  const fingerprint = chatGPTCommentFingerprint(key, requestId, comment, attachments)
  const now = Date.now()
  const priorAt = recentChatGPTCommentIds.get(`${key}:${commentId}`) || 0
  const priorFingerprintAt = recentChatGPTCommentFingerprints.get(fingerprint) || 0
  if (now - priorAt < 30 * 60 * 1000 || now - priorFingerprintAt < 60 * 1000) return { ok: true, cacheKey: key, queued: hasPendingChatGPTComments(key), requestId, duplicate: true }
  const queue = pendingChatGPTComments.get(key) || []
  const sessionId = request?.sessionId ? sanitizeSessionId(request.sessionId) : ''
  if (!queue.some((item) => item.commentId === commentId || item.fingerprint === fingerprint)) queue.push({ commentId, fingerprint, text, comment, sessionId, url: String(request?.url || ''), requestId, attachments, queuedAt: now })
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
        const target = await targetChatGPTComposer(key, pending.url, true)
        const ready = await executeChatGPTDOMScript(key, target.entry, 'comment-composer-ready', chatGPTComposerReadyScript())
        if (!ready) return
        const expected = expectedChatGPTBundles.get(key)
        const liveTunnels = expected?.requestId === pending.requestId && Array.isArray(expected.liveTunnels) ? expected.liveTunnels : []
        const commentPrompt = expected?.requestId === pending.requestId && expected.originalPrompt
          ? `${pending.text}\n\nORIGINAL REQUEST CONTENT — authoritative task context repeated inside this comment bundle:\n\n${expected.originalPrompt}`
          : pending.text
        const expectedFilename = expected?.requestId === pending.requestId ? expected.filename : canonicalBundleFilename(key, pending.requestId)
        const bundled = await fillBundledChatGPTComposer(key, target.entry, pending.sessionId, pending.requestId, commentPrompt, expectedFilename, pending.attachments, liveTunnels)
        const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
        await wait(80)
        await submitChatGPTDraft(key)
        if (pending.sessionId) {
          try { await publishRemoteChannelComment(pending.sessionId, pending.requestId, pending.comment) }
          catch (error) { console.warn(`[remote-channel-comment] ${error instanceof Error ? error.message : String(error)}`) }
        }
        queue.shift()
        recentChatGPTCommentIds.set(`${key}:${pending.commentId}`, Date.now())
        recentChatGPTCommentFingerprints.set(pending.fingerprint, Date.now())
        if (!queue.length) pendingChatGPTComments.delete(key)
        if (expectedChatGPTBundles.has(key)) armExpectedChatGPTBundle(key, pending.requestId, assistantBaseline, '', [], '', pending.sessionId, expectedFilename)
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
      const normalized = { cacheKey: key, state: activity?.state === 'thinking' ? 'thinking' : 'idle', text: String(activity?.text || '').trim(), capturedAt: String(activity?.capturedAt || new Date().toISOString()) }
      const fingerprint = `${normalized.state}:${normalized.text}`
      if (chatGPTActivityFingerprints.get(key) === fingerprint) continue
      chatGPTActivityFingerprints.set(key, fingerprint)
      const expected = expectedChatGPTBundles.get(key)
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
    wc.reload()
    const text = action.reason === 'transport'
      ? 'Falha de ligação detetada no ChatGPT. A conversa foi recarregada automaticamente para re-hidratar o processamento.'
      : action.reason === 'surface'
        ? 'O compositor do ChatGPT deixou de estar disponível. A conversa foi recarregada uma vez para recuperar a interface sem alterar o pedido.'
        : action.reason === 'stalled'
          ? 'O processamento do ChatGPT parece ter parado. A conversa foi recarregada uma vez para recuperar atualizações pendentes.'
          : action.reason === 'silent'
            ? 'O ChatGPT deixou de mostrar processamento sem produzir nova resposta. A conversa foi recarregada uma vez para recuperar o pedido.'
            : 'A resposta terminou sem o bundle esperado. A conversa foi recarregada uma vez antes da continuação automática.'
    sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, state: 'thinking', text, capturedAt: new Date().toISOString() })
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
      await fillBundledChatGPTComposer(key, entry, expected.sessionId, expected.requestId, prompt, expected.filename, [], expected.liveTunnels || [])
      await wait(80)
      if (expectedChatGPTBundles.get(key) !== expected) return
      await submitChatGPTDraft(key)
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
  sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, state: 'thinking', text: 'O ChatGPT continuou parado após a recarga. O Wharness enviou uma instrução automática para retomar o pedido original e concluir a entrega.', capturedAt: new Date().toISOString() })
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
      sendToChatGPTKey(key, 'wharness:chatgpt:bundle-download-error', { cacheKey: key, requestId: expected.requestId, error: 'Tempo limite excedido enquanto o Wharness aguardava o bundle canónico.' })
      return
    }
    const entry = chatgptViews.get(key)
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
      if (!expected.downloadInFlight && (!expected.lastDOMClick || now - expected.lastDOMClick >= DOM_DOWNLOAD_RETRY_MS)) {
        const clickMode = await wc.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, expected.assistantBaseline), true)
        if (clickMode) {
          expected.lastDOMClick = now
          expected.downloadInFlight = true
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
      if (completion?.thinking === true) {
        if (!expected.processingObservedAt) expected.processingObservedAt = now
        expected.processingAbsentSince = 0
      } else if (expected.processingObservedAt && !expected.processingAbsentSince) {
        expected.processingAbsentSince = now
      }
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
        setChatGPTHumanAction(key, 'stalled', 'O controlo de processamento continua visível, mas não existe atividade de rede nem progresso estrutural recente. O Wharness não interrompeu a tarefa; confirme a conversa ou use “Retomar pedido”.', 'ambiguous-processing-control')
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

      const continuation = `WHARNESS DELIVERY CONTINUATION — SAME REQUEST ${expected.requestId}

The previous ChatGPT turn finished without a detected validated downloadable bundle named ${expected.filename}.
      Do not restart the analysis, change scope, or answer with prose. Continue from the work already completed and create/attach exactly ${expected.filename} according to the existing Wharness file-first contract. Finish with the file attachment only.${expected.originalPrompt ? `\n\nORIGINAL REQUEST CONTENT — authoritative task context repeated inside this continuation bundle:\n\n${expected.originalPrompt}` : ''}`
      try {
        await withChatGPTTransportPreparation(key, entry, expected.requestId, async () => {
          if (expectedChatGPTBundles.get(key) !== expected) return
          await fillBundledChatGPTComposer(key, entry, expected.sessionId, expected.requestId, continuation, expected.filename, [], expected.liveTunnels || [])
          await wait(80)
          if (expectedChatGPTBundles.get(key) !== expected) return
          await submitChatGPTDraft(key)
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
    title: 'Exportar sessão do navegador Wharness',
    defaultPath: path.join(app.getPath('downloads'), `wharness-browser-session-${new Date().toISOString().slice(0, 10)}.whbs`),
    filters: [{ name: 'Wharness Browser Session', extensions: ['whbs'] }],
  })
  if (result.canceled || !result.filePath) return { cancelled: true }
  await writeFile(result.filePath, snapshot, { mode: 0o600 })
  return { cancelled: false, bytes: snapshot.byteLength, filename: path.basename(result.filePath) }
}

async function importBrowserSession(windowState) {
  const result = await dialog.showOpenDialog(windowState?.window, {
    title: 'Importar sessão do navegador Wharness',
    defaultPath: app.getPath('downloads'),
    properties: ['openFile'],
    filters: [{ name: 'Wharness Browser Session', extensions: ['whbs'] }],
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
  if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot open internal ChatGPT browser without an owning Wharness window')
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
    title: 'Wharnex · ChatGPT',
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
  const win = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'Wharnex · WHX',
    name: `wharness-${id}`,
    windowStatePersistence: true,
    backgroundColor: '#eceee7',
    autoHideMenuBar: true,
    webPreferences: securePreferences({ preload: path.join(here, 'preload.cjs') }),
  })
  const state = { id, window: win, projects: new Set(), activeChatGPTKey: '', chatgptVisible: false, chatgptBounds: undefined }
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
  win.on('close', () => { if (!quitting) rehomeChatGPTWorkers(state) })
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
  ipcMain.handle('wharness:projects:bindings', (event) => {
    const windowState = trustedSender(event)
    return { windowId: windowState.id, projects: [...windowState.projects] }
  })
  ipcMain.handle('wharness:windows:info', (event) => {
    const windowState = trustedSender(event)
    return { windowId: windowState.id, windowCount: desktopWindows.size }
  })
  ipcMain.handle('wharness:windows:open', (event) => {
    trustedSender(event)
    const windowState = createWindow()
    windowState.window.show(); windowState.window.focus()
    return { ok: true, windowId: windowState.id }
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
    // Navigation may already be in flight when a blocking Wharness overlay
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
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    if (isTrustedChatGPTOrigin(wc.getURL())) wc.reload()
    else void loadOwnedChatGPTURL(key, entry, entry.affinity.boundURL || CHATGPT_URL, 'reload-from-blank').catch((error) => {
      console.error(`[chatgpt-load] reload-from-blank failed key=${key} error=${error?.message || 'unknown'}`)
    })
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:focus', (event, request) => { const windowState = trustedSender(event); const { entry } = ensureChatGPTView(request?.cacheKey, windowState); requireOwnedChatGPTEntry(request?.cacheKey, entry).wc.focus(); return { ok: true } })
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
      if (windowState.activeChatGPTKey === key) entry.view.setVisible(windowState.chatgptVisible)
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
    if (windowState.activeChatGPTKey === key) entry.view.setVisible(windowState.chatgptVisible)
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
    if (windowState.activeChatGPTKey === key) entry.view.setVisible(windowState.chatgptVisible)
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
    await persistWorkspaceChatRemote(key, conversation, { remoteState: 'awaiting-response' })
    const payload = expectedChatAgentPayload(key, requestId, conversation, {
      expectedFilename, recoveryBootstrap: recoveryPrompt, originalPrompt: recoveryPrompt,
      sessionId: request?.sessionId,
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
        await fillBundledChatGPTComposer(key, entry, expected.sessionId, requestId, prompt, expected.filename, [], expected.liveTunnels || [])
      } catch (error) {
        escalateChatGPTContinuationFailure(key, expected, error, 'manual-continuation')
        return { ok: false, cacheKey: key, requestId, confirmationRequired: false, reason: 'continuation_failed' }
      }
      await wait(80)
      await submitChatGPTDraft(key)
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
      filters: [{ name: 'Wharness bundle ZIP', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    const filePath = result.filePaths[0]
    const sourceFilename = path.basename(filePath)
    const bytes = await readFile(filePath)
    if (bytes.byteLength > MAX_EXECUTION_BUNDLE_BYTES) throw new Error('Bundle Wharness excede o limite de 16 MiB.')
    const candidate = canonicalWharnessBundleDownload(sourceFilename, requestId, 'application/zip')
    if (!candidate) throw new Error('O ficheiro selecionado não é um bundle ZIP Wharness reconhecível.')
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
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, () => preparePromptForChatGPT(request))
  })
  ipcMain.handle('wharness:chatgpt:retry-prepared-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.expectedRequestId, () => retryPreparedChatGPTPrompt(request))
  })
  ipcMain.handle('wharness:chatgpt:attach-context', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, () => attachContextToChatGPT(request))
  })
  ipcMain.handle('wharness:chatgpt:attach-prompt', async (event, request) => {
    const windowState = trustedSender(event)
    return withChatGPTSupervisorTransport(request?.cacheKey, windowState, request?.requestId, () => attachPromptToChatGPT(request))
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
  ipcMain.handle('wharness:agents:set-worker-count', async (event, request) => {
    const windowState = trustedSender(event)
    desiredChatAgentWorkerSlots = normalizeWorkerSlotCount(request?.count)
    chatAgentScheduler?.setWorkerCount(desiredChatAgentWorkerSlots)
    reconcileChatGPTWorkerPool(windowState)
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:resume-provider', async (event) => {
    trustedSender(event)
    if (!chatAgentScheduler) throw new Error('Chat-agent scheduler is not ready')
    await chatAgentScheduler.setProviderPause(false)
    await refreshChatAgentRuntimeState()
    return publishChatAgentRuntimeState()
  })
  ipcMain.handle('wharness:agents:snapshot', async (event, request) => { trustedSender(event); return chatAgentBrowserSnapshot(request?.agentId) })
  ipcMain.handle('wharness:data:storage', async (event) => { trustedSender(event); return desktopStorageUsage() })
  ipcMain.handle('wharness:data:export-browser-session', async (event) => { const windowState = trustedSender(event); return exportBrowserSession(windowState) })
  ipcMain.handle('wharness:data:import-browser-session', async (event) => { const windowState = trustedSender(event); return importBrowserSession(windowState) })
  ipcMain.handle('wharness:data:clear-browser-session', async (event) => { trustedSender(event); return clearBrowserSession() })
  ipcMain.handle('wharness:data:clear-all', async (event, request) => {
    trustedSender(event)
    if (String(request?.confirm || '').trim() !== 'APAGAR WHARNESS') throw new Error('Complete Wharness reset confirmation mismatch')
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
  // explicit Wharness action owned by the trusted local renderer/main process.
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

  // Keep the local Wharness composer useful in Portuguese while preserving
  // English for code/technical terms. Electron only accepts dictionaries that
  // are actually available in the current Chromium build.
  try {
    const available = new Set(session.defaultSession.availableSpellCheckerLanguages || [])
    const preferred = ['pt-PT', 'pt-BR', 'en-US'].filter((language) => available.has(language))
    if (preferred.length) session.defaultSession.setSpellCheckerLanguages(preferred)
  } catch (error) { console.warn('[spellcheck] dictionary configuration failed', error) }

  // Cache only: preserve cookies/login while forcing current ChatGPT assets to reload
  // under the Chrome-compatible UA. Failures here must not prevent startup.
  try { await chatSession.clearCache() } catch (error) { console.error('[chatgpt-cache] clear failed', error) }

  console.log(`ChatGPT compatibility UA: Chrome/${CHATGPT_CHROMIUM_VERSION}`)
  registerIPC()
  chatGPTDownloadPoller = setInterval(() => { void flushQueuedChatGPTComments(); void pollChatGPTVisibleActivity() }, DOM_DOWNLOAD_POLL_MS)

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
  ensureChatGPTWorkerPool(workerHost)
  chatAgentScheduler = new ChatAgentSchedulerClient({
    baseURL: BACKEND_URL, workerCount: desiredChatAgentWorkerSlots, maxWorkers: HARD_MAX_WORKER_SLOTS, execute: executeChatAgentTask,
    onState: (state) => {
      const worker = Number(state?.worker || 0)
      if (worker) {
        const prior = chatAgentWorkerStates.get(worker) || { active: true, task: undefined, lastTask: undefined, lastClaimAt: '', error: '' }
        if (state.kind === 'worker-started') chatAgentWorkerStates.set(worker, { ...prior, active: true })
        else if (state.kind === 'worker-stopped') chatAgentWorkerStates.set(worker, { ...prior, active: false, task: undefined })
        else if (state.kind === 'running') chatAgentWorkerStates.set(worker, { ...prior, active: true, task: state.task, lastTask: state.task, lastClaimAt: new Date().toISOString(), error: '' })
        else if (state.kind === 'settled') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, error: '' })
        else if (state.kind === 'task-error') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, lastTask: state.task || prior.lastTask, error: String(state?.error?.message || state?.error || '') })
        else if (state.kind === 'worker-error') chatAgentWorkerStates.set(worker, { ...prior, task: undefined, error: String(state?.error?.message || state?.error || '') })
      }
      reconcileChatGPTWorkerPool(workerHost)
      publishChatAgentRuntimeState()
      void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
    },
  })
  chatAgentScheduler.start()
  void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
})

app.on('before-quit', () => {
  quitting = true
  persistWindowLayout()
  if (chatGPTDownloadPoller) clearInterval(chatGPTDownloadPoller)
  if (chatAgentScheduler) void chatAgentScheduler.stop()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow('primary') })
