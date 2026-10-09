import { notifyChatGPTAccountChanged } from '../health/account-change.mjs'

export function createAuthNotifications({
  chatgptViews, chatGPTKeyForEntry, windowStateForEntry, sendToWindowState,
  publishChatGPTState, sanitizeDiagnosticURL, loginURL, homeURL,
}) {
  function publishExternalAuth(entry, provider, url) {
    entry.externalAuthProvider = provider || 'OpenAI'
    entry.view.setVisible(false)
    const state = windowStateForEntry(entry)
    if (state) {
      sendToWindowState(state, 'wharness:chatgpt:external-auth', {
        cacheKey: chatGPTKeyForEntry(entry),
        provider: entry.externalAuthProvider,
        url: sanitizeDiagnosticURL(url || loginURL),
        authMode: 'external',
        managedWindow: false,
        managedBrowser: true,
      })
    }
    publishChatGPTState(chatGPTKeyForEntry(entry))
  }

  function publishAuthComplete(cacheKey, mode, url) {
    // A completed sign-in may be another account, whose own limits apply.
    notifyChatGPTAccountChanged(`login-${mode}`)
    const state = windowStateForEntry(chatgptViews.get(cacheKey))
    if (state) {
      sendToWindowState(state, 'wharness:chatgpt:auth-complete', {
        cacheKey,
        authMode: mode,
        url: sanitizeDiagnosticURL(url || homeURL),
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

  return { publishExternalAuth, publishAuthComplete, publishAuthError }
}
