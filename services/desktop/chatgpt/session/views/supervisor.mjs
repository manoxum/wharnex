import { createChatGPTViewEntry } from './entry.mjs'
import { createHostedChatGPTSurface } from './surface.mjs'

export function createChatGPTSupervisorViewLifecycle({
  WebContentsView, securePreferences, CHATGPT_PARTITION,
  CHATGPT_USER_AGENT, createChatGPTAffinityTracker,
  chatgptViews, grantChatGPTLayoutViewport,
  chatGPTNavigationDisposition, loadOwnedChatGPTURL,
  routeChatGPTNavigation, advanceChatGPTConversationTransportGeneration,
  touchChatGPTEntry, publishChatGPTState, observeChatGPTAffinityURL,
  scheduleChatGPTAffinitySettlement, scheduleEmbeddedChatGPTAuthenticationProbe,
  expectedChatGPTBundles, pollExpectedChatGPTDownloadKey,
  chatgptTransportModes, hideChatGPTSidebar, observeEmbeddedAuthURL,
  sanitizeDiagnosticURL, isRecoverableChatGPTNetworkError,
  noteChatGPTRendererFault, noteChatGPTRecoveryProgress,
  clearChatGPTHumanAction, browserHost,
}) {
  function createChatGPTView(cacheKey, windowState) {
    if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot create ChatGPT view without an owning Wharnex window')
    const native = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }) })
    native.setBackgroundColor('#ffffff')
    // The real view lives in the browser monitor; the project pane mirrors it.
    const view = createHostedChatGPTSurface(native, { View: browserHost.View, host: browserHost })
    const entry = createChatGPTViewEntry(view, cacheKey, windowState.id, createChatGPTAffinityTracker)
    chatgptViews.set(cacheKey, entry)
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
    wc.on('did-stop-loading', () => { entry.loading = false; entry.loadingSince = 0; entry.loadingFaultNoted = false; observeChatGPTAffinityURL(cacheKey, entry, wc.getURL()); scheduleChatGPTAffinitySettlement(cacheKey, entry); touchChatGPTEntry(entry); publishChatGPTState(cacheKey); scheduleEmbeddedChatGPTAuthenticationProbe(cacheKey, entry); if (expectedChatGPTBundles.has(cacheKey)) void pollExpectedChatGPTDownloadKey(cacheKey); setTimeout(() => { if (!entry.accountOperationActive && chatgptTransportModes.get(cacheKey) !== 'manual') void hideChatGPTSidebar(cacheKey, entry).catch(() => undefined) }, 500) })
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

  return { createChatGPTView }
}
