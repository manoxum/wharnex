export function createChatGPTRateLimitResume({
  state, chatGPTWorkerEntries, chatGPTKeyForEntry,
  paceChatGPTWorkerNavigation, isTrustedChatGPTOrigin, homeURL,
  userAgent, wait, waitForChatGPTReady, chatGPTHumanActionScript,
  noteChatGPTRateLimitGate, sanitizeDiagnosticURL,
}) {
  function chatAgentRateLimitDelayMs() {
    return Math.max(0, state.until - Date.now())
  }

  function chatAgentRateLimitResumeBlocked() {
    if (chatAgentRateLimitDelayMs() > 0) return true
    if (!state.resumeProbeRequired) return false
    if (!state.resumeProbe && Date.now() >= state.resumeProbeNotBefore) {
      state.resumeProbe = confirmChatGPTRateLimitResume().finally(() => { state.resumeProbe = undefined })
    }
    return true
  }

  async function confirmChatGPTRateLimitResume() {
    const entry = chatGPTWorkerEntries.find((candidate) => candidate?.view?.webContents && !candidate.view.webContents.isDestroyed())
    if (!entry) {
      state.resumeProbeNotBefore = Date.now() + 5_000
      return false
    }
    const key = chatGPTKeyForEntry(entry)
    try {
      await paceChatGPTWorkerNavigation()
      if (chatAgentRateLimitDelayMs() > 0) return false
      const wc = entry.view.webContents
      const currentURL = isTrustedChatGPTOrigin(wc.getURL()) ? wc.getURL() : homeURL
      if (currentURL === wc.getURL()) {
        wc.reload()
        // Electron schedules reload asynchronously; wait for loading to start.
        await wait(50)
      } else await wc.loadURL(currentURL, { userAgent })
      await waitForChatGPTReady({ isLoading: () => entry.loading || wc.isLoading(), lastNetworkActivity: () => entry.lastNetworkActivity, wait })
      if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('rate-limit resume URL left the trusted ChatGPT origin')
      if (chatAgentRateLimitDelayMs() > 0) return false
      const health = await wc.executeJavaScript(chatGPTHumanActionScript(), true)
      if (!health || typeof health !== 'object' || health.rateLimited !== false) {
        state.resumeProbeNotBefore = Date.now() + 30_000
        return false
      }
      if (noteChatGPTRateLimitGate(key, health) || chatAgentRateLimitDelayMs() > 0) return false
      if (health?.required === true) {
        state.resumeProbeNotBefore = Date.now() + 30_000
        return false
      }
      state.resumeProbeRequired = false
      state.resumeProbeNotBefore = 0
      console.log(`[chat-agent] rate-limit resume confirmed slot=${entry.slotId} url=${sanitizeDiagnosticURL(currentURL)}`)
      return true
    } catch (error) {
      state.resumeProbeNotBefore = Date.now() + 30_000
      console.warn(`[chat-agent] rate-limit resume probe deferred: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  return { chatAgentRateLimitDelayMs, chatAgentRateLimitResumeBlocked, confirmChatGPTRateLimitResume }
}
