import { sanitizeChatCacheKey } from '../../../security/security.mjs'

export function throwIfChatGPTTransportAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('WHARNEX_REQUEST_CANCELLED: ChatGPT request preparation was cancelled')
  error.name = 'AbortError'
  error.code = 'WHARNEX_REQUEST_CANCELLED'
  throw error
}

export function createChatGPTTransportPreparation({
  tails, requireOwnedEntry, reconcileThrottle, residency, withTrace, traceId,
  deferredNavigationPending, applyDeferredNavigation,
}) {
  const abortControllers = new Map()

  function abortKeyFor(cacheKey, requestId) {
    const key = sanitizeChatCacheKey(cacheKey)
    const id = String(requestId || '').trim()
    return id ? `${key}:${id}` : ''
  }

  function registerAbort(cacheKey, requestId, controller) {
    const abortKey = abortKeyFor(cacheKey, requestId)
    if (!abortKey) return ''
    const controllers = abortControllers.get(abortKey) || new Set()
    controllers.add(controller)
    abortControllers.set(abortKey, controllers)
    return abortKey
  }

  function unregisterAbort(abortKey, controller) {
    if (!abortKey) return
    const controllers = abortControllers.get(abortKey)
    if (!controllers) return
    controllers.delete(controller)
    if (!controllers.size) abortControllers.delete(abortKey)
  }

  function abortChatGPTTransportPreparations(cacheKey, requestId) {
    const controllers = abortControllers.get(abortKeyFor(cacheKey, requestId))
    if (!controllers?.size) return 0
    for (const controller of controllers) controller.abort()
    return controllers.size
  }

  async function withChatGPTTransportPreparation(cacheKey, entry, requestId, operation) {
    const key = sanitizeChatCacheKey(cacheKey)
    requireOwnedEntry(key, entry)
    // A Worker can be rebound while queued work still awaits the same physical slot.
    const transportKey = entry.role === 'worker' ? `slot:${entry.slotId}` : `chat:${key}`
    const prior = tails.get(transportKey) || Promise.resolve()
    let release
    let preparing = false
    const tail = new Promise((resolve) => { release = resolve })
    const controller = new AbortController()
    const abortKey = registerAbort(key, requestId, controller)
    tails.set(transportKey, tail)
    if (entry.role === 'worker') residency.setNonPreemptive(entry.slotId, true)
    try {
      try { await prior } catch { /* a prior operation cannot poison the queue */ }
      throwIfChatGPTTransportAborted(controller.signal)
      entry.transportPreparationCount = Number(entry.transportPreparationCount || 0) + 1
      entry.transportRequestId = String(requestId || '')
      preparing = true
      entry.transportAbortSignal = controller.signal
      reconcileThrottle(key, entry)
      return await withTrace(traceId('prepare', requestId || key, Date.now().toString(36)), operation)
    } finally {
      if (preparing) {
        entry.transportPreparationCount = Math.max(0, Number(entry.transportPreparationCount || 0) - 1)
        if (!entry.transportPreparationCount) entry.transportRequestId = ''
        if (entry.transportAbortSignal === controller.signal) delete entry.transportAbortSignal
        reconcileThrottle(key, entry)
        if (entry.role !== 'worker' && !entry.transportPreparationCount && deferredNavigationPending()) {
          setTimeout(() => { void applyDeferredNavigation() }, 0)
        }
      }
      release()
      if (entry.role === 'worker') residency.setNonPreemptive(entry.slotId, false)
      if (tails.get(transportKey) === tail) tails.delete(transportKey)
      unregisterAbort(abortKey, controller)
    }
  }

  return { abortChatGPTTransportPreparations, withChatGPTTransportPreparation }
}
