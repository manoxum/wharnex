const ORCHESTRATOR_TASK_KEY = /^otk_[0-9]{8}T[0-9]{6}_[a-f0-9]{16}$/

export function createChatGPTDownloadPublication({
  sendToChatGPTKey, sanitizeChatCacheKey, parseBundleName, path,
  deliverOrchestratorTaskBundle, wharnessBundleRequestIdFromFilename,
  expectedChatGPTBundles,
}) {
  function publishPlanDownload(payload) {
    sendToChatGPTKey(payload?.cacheKey || '', 'wharness:chatgpt:plan-downloaded', payload)
  }

  function publishPlanDownloadError(message, filename = '', cacheKey = '') {
    console.error(`[chatgpt-plan-download] ${message}${filename ? ` file=${filename}` : ''}${cacheKey ? ` key=${cacheKey}` : ''}`)
    sendToChatGPTKey(cacheKey, 'wharness:chatgpt:plan-download-error', { message, filename, cacheKey })
  }

  function orchestratorTaskIdForBundle(payload) {
    const key = sanitizeChatCacheKey(payload?.cacheKey || '')
    if (ORCHESTRATOR_TASK_KEY.test(key)) return key
    const chat = String(parseBundleName(path.basename(String(payload?.filename || '')))?.chatId || '')
    const id = chat.replace(/-/g, '_')
    return ORCHESTRATOR_TASK_KEY.test(id) ? id : ''
  }

  // A cross-request payload carries its true cacheKey; routingKey only selects
  // a mounted window that can forward it to the workspace-wide request router.
  function publishBundleDownload(payload, routingKey = '') {
    const orchestratorTaskId = orchestratorTaskIdForBundle(payload)
    if (orchestratorTaskId) {
      void deliverOrchestratorTaskBundle(orchestratorTaskId, payload)
      return
    }
    sendToChatGPTKey(routingKey || payload?.cacheKey || '', 'wharness:chatgpt:bundle-downloaded', payload)
  }

  function publishBundleDownloadError(message, filename = '', cacheKey = '') {
    console.error(`[chatgpt-bundle-download] ${message}${filename ? ` file=${filename}` : ''}${cacheKey ? ` key=${cacheKey}` : ''}`)
    const requestId = wharnessBundleRequestIdFromFilename(filename) || expectedChatGPTBundles.get(cacheKey)?.requestId || ''
    sendToChatGPTKey(cacheKey, 'wharness:chatgpt:bundle-download-error', { message, filename, cacheKey, requestId })
  }

  return { publishPlanDownload, publishPlanDownloadError, publishBundleDownload, publishBundleDownloadError }
}
