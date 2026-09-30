import path from 'node:path'

export function createExpectedBundleLookup({
  expectedChatGPTBundles, chatgptViews, requestIdFromFilename,
  sanitizeOptionalChatCacheKey, recentDownload, ttlMs, now = Date.now,
}) {
  function expectedChatGPTBundleForDownload(sourceWebContents, sourceFilename = '') {
    const canonicalRequestId = requestIdFromFilename(path.basename(String(sourceFilename || '')))
    if (canonicalRequestId) {
      for (const [key, expected] of expectedChatGPTBundles) {
        if (expected.requestId === canonicalRequestId) return { key, ...expected }
      }
    }
    const sourceEntry = sourceWebContents && [...chatgptViews.entries()].find(([, candidate]) => candidate.view.webContents.id === sourceWebContents.id)
    if (sourceEntry) {
      const expected = expectedChatGPTBundles.get(sourceEntry[0])
      if (expected && now() - expected.armedAt <= ttlMs) return { key: sourceEntry[0], ...expected }
    }
    const recent = recentDownload()
    if (recent && now() - recent.at <= 12_000) {
      const expected = expectedChatGPTBundles.get(recent.key)
      if (expected?.requestId === recent.requestId) return { key: recent.key, ...expected }
    }
    return undefined
  }

  function chatGPTExpectedKeyForRequest(requestId, preferredKey = '') {
    const id = String(requestId || '').trim()
    const preferred = preferredKey ? sanitizeOptionalChatCacheKey(preferredKey) : ''
    if (preferred && expectedChatGPTBundles.get(preferred)?.requestId === id) return preferred
    for (const [key, expected] of expectedChatGPTBundles) if (expected?.requestId === id) return key
    return ''
  }

  return { expectedChatGPTBundleForDownload, chatGPTExpectedKeyForRequest }
}
