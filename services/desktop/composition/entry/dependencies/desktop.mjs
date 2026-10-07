import * as source8 from '../../../window/index.mjs'
import * as source14 from '../../../browser/index.mjs'
import * as source15 from '../../../security/security.mjs'
import * as source17 from '../../../identity/index.mjs'
import * as source18 from '../../../lifecycle/index.mjs'

export function createDesktopDependencies() {
  return {
    preserveLocalFocusDuringBackgroundOperation: source8.preserveLocalFocusDuringBackgroundOperation, installNativeSurfaceLifecycleGuard: source8.installNativeSurfaceLifecycleGuard, recoverableDesktopWindows: source8.recoverableDesktopWindows,
    MIN_DESKTOP_WINDOW_SIZE: source8.MIN_DESKTOP_WINDOW_SIZE, ProjectWindowRegistry: source8.ProjectWindowRegistry, canonicalProjectPath: source8.canonicalProjectPath,
    registerWindowIPC: source8.registerWindowIPC, spellcheckContextMenuTemplate: source8.spellcheckContextMenuTemplate, createWorkspaceSurfaceRouting: source8.createWorkspaceSurfaceRouting,
    registerDesktopShellIPC: source8.registerDesktopShellIPC, registerSpellcheckIPC: source8.registerSpellcheckIPC, createDesktopWindowCreator: source8.createDesktopWindowCreator,
    securePreferences: source8.securePreferences, restoreDesktopWindowsAtStartup: source8.restoreDesktopWindowsAtStartup,
    pathSize: source14.pathSize, restoreBrowserSession: source14.restoreBrowserSession, snapshotBrowserSession: source14.snapshotBrowserSession,
    createBrowserSessionOperations: source14.createBrowserSessionOperations, createInternalChatGPTBrowser: source14.createInternalChatGPTBrowser, registerBrowserDataIPC: source14.registerBrowserDataIPC,
    chatGPTNavigationDisposition: source15.chatGPTNavigationDisposition, chatInputSettleDelay: source15.chatInputSettleDelay, chromeCompatibleUserAgent: source15.chromeCompatibleUserAgent,
    isChatGPTAuthURL: source15.isChatGPTAuthURL, isHTTPS: source15.isHTTPS, isTrustedChatGPTOrigin: source15.isTrustedChatGPTOrigin,
    normalizeBounds: source15.normalizeBounds, requireLocalHTTPURL: source15.requireLocalHTTPURL, requireTrustedChatGPTURL: source15.requireTrustedChatGPTURL,
    sanitizeChatCacheKey: source15.sanitizeChatCacheKey, sanitizeOptionalChatCacheKey: source15.sanitizeOptionalChatCacheKey, sanitizeChatGPTAuthMode: source15.sanitizeChatGPTAuthMode,
    sanitizeDiagnosticURL: source15.sanitizeDiagnosticURL, sanitizeSessionId: source15.sanitizeSessionId, BundleOwnershipError: source15.BundleOwnershipError,
    canonicalWharnexBundleDownload: source15.canonicalWharnexBundleDownload, validateWharnessBundleDownload: source15.validateWharnessBundleDownload, validateWharnessPlanFile: source15.validateWharnessPlanFile,
    wharnessBundleRequestIdFromFilename: source15.wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename: source15.wharnessPlanRequestIdFromFilename,
    desktopInstanceName: source17.desktopInstanceName, desktopWindowTitle: source17.desktopWindowTitle, initializeDesktopIdentity: source17.initializeDesktopIdentity,
    configureDesktopProcess: source18.configureDesktopProcess,
  }
}
