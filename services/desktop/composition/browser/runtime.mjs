import { createBrowserSessionOperations, createInternalChatGPTBrowser } from '../../browser/index.mjs'

export function createDesktopBrowserRuntime(d) {
  const browserSessionOperations = createBrowserSessionOperations({
    app: d.app, session: d.session, dialog: d.dialog,
    partition: d.CHATGPT_PARTITION,
    partitionPath: d.chatGPTPartitionPath,
    authProfilePath: d.managedAuthProfilePath,
    pendingImportPath: d.pendingBrowserImportPath,
    attachmentRoot: d.chatAttachmentRoot,
    closeViews: d.closeAllChatGPTViews,
    closeInternalBrowsers: d.closeAllInternalChatGPTBrowsers,
    closeManagedAuth: d.closeManagedBrowserAuth,
    closeOwnedBrowser: d.shell.closeAll,
    ownedBrowserProfilePath: d.shell.profileRoot,
    authBrowsers: d.chatGPTAuthBrowsers,
    preparedDrafts: d.preparedChatGPTDrafts,
    retryablePrompts: d.retryableChatGPTPrompts,
    expectedBundles: d.expectedChatGPTBundles,
    clearRecentDownload: d.clearRecentDownload,
    snapshot: d.snapshotBrowserSession,
    restore: d.restoreBrowserSession, size: d.pathSize,
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
    BrowserWindow: d.BrowserWindow, shell: d.shell,
    browsers: d.internalChatGPTBrowsers,
    trustedURL: d.requireTrustedChatGPTURL,
    isTrustedOrigin: d.isTrustedChatGPTOrigin,
    isHTTPS: d.isHTTPS, titleFor: d.desktopWindowTitle,
    securePreferences: d.securePreferences,
    partition: d.CHATGPT_PARTITION, userAgent: d.CHATGPT_USER_AGENT,
    icon: d.DESKTOP_ICON, instance: d.DESKTOP_INSTANCE,
    homeURL: d.CHATGPT_URL,
  })

  return {
    exportBrowserSession, importBrowserSession, applyPendingBrowserSessionImport,
    clearBrowserSession, desktopStorageUsage, clearDesktopWharnexData,
    openInternalChatGPTBrowser,
  }
}
