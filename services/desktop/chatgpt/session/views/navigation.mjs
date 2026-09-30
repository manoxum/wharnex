function isBenignChatGPTLoadAbort(error) {
  return error?.code === 'ERR_ABORTED' || Number(error?.errno) === -3
}

async function waitForChatGPTNavigationSettle(wc, wait, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!wc.isDestroyed() && wc.isLoading() && Date.now() < deadline) await wait(50)
}

export function createChatGPTViewNavigation({
  sanitizeChatCacheKey, requireTrustedChatGPTURL,
  requireOwnedChatGPTEntry, sameConversationURL,
  currentChatGPTState, windowStateForEntry,
  chatAgentWorkerActivity, sanitizeDiagnosticURL,
  withChatGPTNavigationDeadline, userAgent, wait,
  isTrustedChatGPTOrigin,
}) {
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
    chatAgentWorkerActivity.set('navigating')
    let operation
    operation = (async () => {
      entry.navigationTarget = target
      console.log(`[chatgpt-load] start key=${key} reason=${reason} target=${sanitizeDiagnosticURL(target)}`)
      try {
        await withChatGPTNavigationDeadline(
          () => wc.loadURL(target, { userAgent }),
          () => { if (!wc.isDestroyed()) wc.stop() },
        )
      } catch (error) {
        if (!isBenignChatGPTLoadAbort(error)) throw error
        await waitForChatGPTNavigationSettle(wc, wait)
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
    // A newly created hidden view can remain on about:blank without a load event.
    // Keep one bounded retry if its initial navigation remains unresolved.
    if (reason === 'initial-show') {
      setTimeout(() => {
        if (entry.navigationPromise !== operation || wc.isDestroyed() || (!wc.isLoading() && isTrustedChatGPTOrigin(wc.getURL()))) return
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

  return { loadOwnedChatGPTURL }
}
