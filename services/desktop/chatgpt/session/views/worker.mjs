import { createChatGPTViewEntry } from './entry.mjs'
import { createHostedChatGPTSurface } from './surface.mjs'

export function createChatGPTWorkerViewLifecycle({
  WebContentsView, securePreferences, CHATGPT_PARTITION,
  CHATGPT_USER_AGENT, createChatGPTAffinityTracker,
  grantChatGPTLayoutViewport, chatGPTWorkerEntries, chatAgentResidency,
  chatGPTNavigationDisposition, loadOwnedChatGPTURL, shell,
  advanceChatGPTConversationTransportGeneration, touchChatGPTEntry,
  publishChatAgentRuntimeState, observeChatGPTAffinityURL,
  scheduleChatGPTAffinitySettlement, sanitizeDiagnosticURL,
  isRecoverableChatGPTNetworkError, noteChatGPTRendererFault,
  closeWorkerMonitor, hideChatAgentInteractionEntry, windowStateForEntry, browserHost,
}) {
  function createChatGPTWorkerView(slotId, windowState) {
    if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot create ChatGPT worker without a host window')
    const native = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }) })
    native.setBackgroundColor('#ffffff')
    // Workers live in the browser monitor with the Supervisors, never in a
    // project window: a project surfaces one only as a mirror.
    const view = createHostedChatGPTSurface(native, { View: browserHost.View, host: browserHost })
    const entry = createChatGPTViewEntry(view, '', windowState.id, createChatGPTAffinityTracker, { role: 'worker', slotId, interactionWindowId: '' })
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
      closeWorkerMonitor(entry)
      if (hideChatAgentInteractionEntry(entry)) publishChatAgentRuntimeState()
    })
    console.log(`[chat-agent] worker-created slot=${slotId} wc=${wc.id}`)
    return entry
  }

  function retireChatGPTWorkerView(entry) {
    if (!entry) return false
    const monitor = entry.monitorWindowId ? windowStateForEntry({ ownerWindowId: entry.monitorWindowId }) : undefined
    if (monitor?.activeMonitorAgentEntry === entry) {
      monitor.activeMonitorAgentEntry = undefined
      monitor.activeMonitorAgentId = ''
    }
    entry.monitorWindowId = ''
    chatAgentResidency.retire(entry.slotId)
    closeWorkerMonitor(entry)
    hideChatAgentInteractionEntry(entry)
    clearTimeout(entry.affinitySettleTimer)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    return true
  }

  return { createChatGPTWorkerView, retireChatGPTWorkerView }
}
