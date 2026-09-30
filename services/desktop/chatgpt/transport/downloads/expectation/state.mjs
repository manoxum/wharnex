import path from 'node:path'

export function createChatGPTBundleExpectation({
  buildBundleName, safeChatId, requestIdFromFilename, parseBundleName,
  sanitizeChatCacheKey, expectedChatGPTBundles, createChatGPTRecoveryState,
  now = Date.now,
}) {
  function canonicalBundleFilename(chatId, requestId) {
    const id = String(requestId || '').trim()
    const filename = buildBundleName('res', safeChatId(chatId), id)
    if (requestIdFromFilename(filename) !== id) throw new Error('Invalid Wharnex request id for bundle transport')
    return filename
  }

  function authoritativeBundleFilename(value, requestId, fallbackChatId) {
    const candidate = path.basename(String(value || '').trim())
    const parsed = parseBundleName(candidate)
    if (parsed?.kind === 'res' && (parsed.subrequestId || parsed.requestId) === String(requestId || '').trim()) return candidate
    return canonicalBundleFilename(fallbackChatId, requestId)
  }

  function armExpectedChatGPTBundle(cacheKey, requestId, assistantBaseline = 0, recoveryBootstrap = '', liveTunnels = [], originalPrompt = '', sessionId = '', expectedFilename = '', requestMetadata = {}) {
    const key = sanitizeChatCacheKey(cacheKey)
    const prior = expectedChatGPTBundles.get(key)
    const sameRequest = prior?.requestId === String(requestId)
    const filename = authoritativeBundleFilename(expectedFilename || (sameRequest ? prior?.filename : ''), requestId, key)
    expectedChatGPTBundles.set(key, {
      requestId: String(requestId), filename,
      armedAt: sameRequest ? prior.armedAt : now(),
      assistantBaseline: sameRequest
        ? Math.max(Number(prior.assistantBaseline || 0), Number(assistantBaseline) || 0)
        : Math.max(0, Number(assistantBaseline) || 0),
      lastDOMClick: 0,
      downloadInFlight: false,
      settledAt: 0,
      continuationCount: sameRequest ? Number(prior.continuationCount || 0) : 0,
      automaticContinuationSent: sameRequest ? prior.automaticContinuationSent === true : false,
      bundleCollectedAt: sameRequest ? Number(prior.bundleCollectedAt || 0) : 0,
      invalidBundleCount: sameRequest ? Number(prior.invalidBundleCount || 0) : 0,
      lastContinuationAt: sameRequest ? Number(prior.lastContinuationAt || 0) : 0,
      backoffUntil: sameRequest ? Number(prior.backoffUntil || 0) : 0,
      domProbeFailures: 0,
      processingObservedAt: sameRequest ? Number(prior.processingObservedAt || 0) : 0,
      processingAbsentSince: sameRequest ? Number(prior.processingAbsentSince || 0) : 0,
      // A passive probe is bounded by the latest structural progress.
      progressAt: sameRequest ? Number(prior.progressAt || 0) || now() : now(),
      rehydrating: sameRequest ? prior.rehydrating === true : false,
      recoveryEligibleAt: sameRequest ? Number(prior.recoveryEligibleAt || 0) : 0,
      recoveryBootstrap: String(recoveryBootstrap || (sameRequest ? prior?.recoveryBootstrap : '') || ''),
      originalPrompt: String(originalPrompt || (sameRequest ? prior?.originalPrompt : '') || ''),
      sessionId: String(sessionId || (sameRequest ? prior?.sessionId : '') || ''),
      requestMetadata: Object.keys(requestMetadata || {}).length
        ? { ...requestMetadata }
        : (sameRequest && prior?.requestMetadata ? { ...prior.requestMetadata } : {}),
      liveTunnels: Array.isArray(liveTunnels) && liveTunnels.length ? liveTunnels.slice(0, 16) : (sameRequest && Array.isArray(prior?.liveTunnels) ? prior.liveTunnels.slice(0, 16) : []),
      recovery: createChatGPTRecoveryState(now()),
      // Set after the durable AWAIT_RESPONSE task exists.
      mainRequestTaskId: sameRequest ? String(prior?.mainRequestTaskId || '') : '',
    })
    return filename
  }

  function disarmExpectedChatGPTBundle(cacheKey, requestId) {
    const key = sanitizeChatCacheKey(cacheKey)
    const expected = expectedChatGPTBundles.get(key)
    if (expected && expected.requestId === String(requestId)) expectedChatGPTBundles.delete(key)
  }

  return { canonicalBundleFilename, authoritativeBundleFilename, armExpectedChatGPTBundle, disarmExpectedChatGPTBundle }
}
