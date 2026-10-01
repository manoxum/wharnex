export function createChatGPTActivityPoll(context) {
  const {
    readPollingChatGPTVisibleActivity, setPollingChatGPTVisibleActivity, chatgptViews, reconcileChatGPTThrottle, isTrustedChatGPTOrigin,
    chatgptTransportModes, chatGPTHumanActionScript, noteChatGPTRateLimitGate, expectedChatGPTBundles, noteChatGPTRecoveryProgress,
    setChatGPTHumanAction, clearChatGPTHumanAction, chatGPTVisibleActivityScript, chatGPTActivityFingerprints, sendToChatGPTKey,
    CHATGPT_DOM_PROBE_FAILURE_LIMIT, noteChatGPTRendererFault,
  } = context

  async function pollChatGPTVisibleActivity() {
    if (readPollingChatGPTVisibleActivity()) return
    setPollingChatGPTVisibleActivity(true)
    try {
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

          // Reasoning capture is meaningful only while Wharnex is supervising
          // this exact response. Running its bounded DOM walk for every idle
          // resident conversation on each timer tick made long ChatGPT pages
          // consume cores despite having no pending Wharnex work.
          if (!expectedActive) continue
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
    } finally {
      setPollingChatGPTVisibleActivity(false)
    }
  }

  return { pollChatGPTVisibleActivity }
}
