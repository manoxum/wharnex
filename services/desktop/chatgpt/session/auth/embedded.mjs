export function createEmbeddedChatGPTAuthentication({
  isTrustedChatGPTOrigin, isChatGPTAuthURL, chatGPTSessionProbeExpression,
  publishChatGPTState, chatGPTNavigationDisposition, publishAuthComplete,
  sanitizeDiagnosticURL,
}) {
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
      // A transient page failure does not erase a valid prior login state.
    }
  }

  function scheduleEmbeddedChatGPTAuthenticationProbe(cacheKey, entry, delayMs = 120) {
    clearTimeout(entry.authProbeTimer)
    entry.authProbeTimer = setTimeout(() => {
      entry.authProbeTimer = undefined
      void refreshEmbeddedChatGPTAuthentication(cacheKey, entry)
    }, delayMs)
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

  return { refreshEmbeddedChatGPTAuthentication, scheduleEmbeddedChatGPTAuthenticationProbe, observeEmbeddedAuthURL }
}
