// Dev-only behavior probes are built from fixed scripts and return bounded data.
export function registerChatGPTProbeIPC({
  ipcMain, trustedSender, isBehaviorProbeEnabled,
  sanitizeBehaviorProbeControl, ensureChatGPTView,
  requireOwnedChatGPTEntry, isTrustedChatGPTOrigin,
  ensureChatGPTLayoutViewport, executeChatGPTDOMScript,
  behaviorProbeScript, normalizeBehaviorProbeResult,
  behaviorProbeControls,
}) {
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
    return { enabled: isBehaviorProbeEnabled(), controls: [...behaviorProbeControls] }
  })
}
