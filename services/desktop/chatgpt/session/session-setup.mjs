import { isTrustedChatGPTOrigin, sanitizeDiagnosticURL } from '../../security/security.mjs'

export async function configureChatGPTSession({
  electronSession, partition, userAgent, acceptLanguages, chromiumVersion,
  uploads, submissions, cacheMarker, registerChatGPTPlanDownloads,
  noteChatGPTNetworkActivity, noteChatGPTNetworkFailure, noteChatGPTHTTPStatus,
}) {
  const chatSession = electronSession.fromPartition(partition)
  chatSession.setUserAgent(userAgent, acceptLanguages)
  registerChatGPTPlanDownloads(chatSession)

  const remoteFilter = {
    urls: [
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://*.openai.com/*',
    ],
  }
  chatSession.webRequest.onBeforeRequest(remoteFilter, (details, callback) => {
    noteChatGPTNetworkActivity(details, 'before')
    uploads.onBeforeRequest(details)
    submissions.onBeforeRequest(details)
    callback({})
  })
  chatSession.webRequest.onErrorOccurred(remoteFilter, (details) => {
    noteChatGPTNetworkActivity(details, 'error')
    noteChatGPTNetworkFailure(details)
    uploads.onErrorOccurred(details)
    console.error(`[chatgpt-net] ${details.method} ${sanitizeDiagnosticURL(details.url)} error=${details.error}`)
  })
  chatSession.webRequest.onCompleted(remoteFilter, (details) => {
    noteChatGPTNetworkActivity(details, 'completed')
    uploads.onCompleted(details)
    noteChatGPTHTTPStatus(details)
    if (details.statusCode >= 400) {
      // The WebContents id and Retry-After tell which page keeps re-reading a
      // throttled resource and for how long the provider asked it to stop.
      const retryAfter = Object.entries(details.responseHeaders || {}).find(([name]) => name.toLowerCase() === 'retry-after')?.[1]?.[0]
      console.error(`[chatgpt-http] ${details.method} ${sanitizeDiagnosticURL(details.url)} status=${details.statusCode} wc=${details.webContentsId ?? '-'}${retryAfter ? ` retry_after=${String(retryAfter).slice(0, 32)}` : ''}`)
    }
  })

  // Remote ChatGPT gets the minimum browser permissions it needs. In particular,
  // navigator.clipboard.writeText() maps to clipboard-sanitized-write in Electron.
  // We deliberately do NOT grant clipboard-read: importing a response remains an
  // explicit Wharnex action owned by the trusted local renderer/main process.
  chatSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingURL = details?.requestingUrl || webContents?.getURL() || ''
    const trusted = isTrustedChatGPTOrigin(requestingURL)
    const allowed = trusted && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
    if (permission.startsWith('clipboard')) {
      console.log(`[chatgpt-permission] ${permission} origin=${sanitizeDiagnosticURL(requestingURL)} allowed=${allowed}`)
    }
    callback(allowed)
  })
  chatSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const requestingURL = details?.requestingUrl || requestingOrigin || details?.embeddingOrigin || ''
    const trusted = isTrustedChatGPTOrigin(requestingURL)
    return trusted && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
  })

  // Keep the local Wharnex composer useful in Portuguese while preserving
  // English for code/technical terms. Electron only accepts dictionaries that
  // are actually available in the current Chromium build.
  try {
    const available = new Set(electronSession.defaultSession.availableSpellCheckerLanguages || [])
    const preferred = ['pt-PT', 'pt-BR', 'en-US'].filter((language) => available.has(language))
    if (preferred.length) electronSession.defaultSession.setSpellCheckerLanguages(preferred)
  } catch (error) { console.warn('[spellcheck] dictionary configuration failed', error) }

  // Cache only: preserve cookies/login while forcing current ChatGPT assets to reload
  // under the Chrome-compatible UA. Only needed when that UA actually changed
  // since the last run; an ordinary restart on the same build reuses the warm
  // cache instead of forcing every Supervisor/Worker to refetch ChatGPT's
  // entire SPA bundle over the network. Failures here must not prevent startup.
  if (!cacheMarker.current()) {
    try { await chatSession.clearCache() } catch (error) { console.error('[chatgpt-cache] clear failed', error) }
    cacheMarker.write()
  }

  console.log(`ChatGPT compatibility UA: Chrome/${chromiumVersion}`)
}
