import { boundedDuration, finiteGeneration, finiteOptionalTime, finiteTime } from './time-values.mjs'

const DEFAULT_TRANSPORT_STALE_MS = 30_000

// In-flight conversation requests observed on the ChatGPT network, keyed by
// request and tagged with the renderer generation that issued them.
export function recordChatGPTConversationTransport(requests, requestKey, generation, phase = 'before', now = Date.now()) {
  if (!(requests instanceof Map)) return requests
  const key = String(requestKey || '').trim()
  if (!key) return requests
  if (phase === 'completed' || phase === 'error') {
    requests.delete(key)
    return requests
  }
  if (phase !== 'before') return requests
  const observedAt = finiteTime(now)
  requests.set(key, {
    startedAt: observedAt,
    lastObservedAt: observedAt,
    generation: finiteGeneration(generation),
  })
  return requests
}

export function classifyChatGPTConversationTransport(requests, snapshot = {}, now = Date.now(), options = {}) {
  const current = finiteTime(now)
  const generation = finiteGeneration(snapshot.generation)
  const staleMs = boundedDuration(options.staleMs, DEFAULT_TRANSPORT_STALE_MS)
  const lastConversationActivity = finiteOptionalTime(snapshot.lastConversationActivity)
  const structuralIdle = snapshot.loading !== true && snapshot.surfaceReady === true && snapshot.thinking !== true
  const activeRequestIds = []
  const staleRequestIds = []

  if (requests instanceof Map) {
    for (const [requestId, metadata] of requests.entries()) {
      const requestGeneration = finiteGeneration(metadata?.generation)
      if (requestGeneration !== generation) {
        staleRequestIds.push(String(requestId))
        continue
      }
      const lastObservedAt = Math.max(
        finiteOptionalTime(metadata?.lastObservedAt),
        finiteOptionalTime(metadata?.startedAt),
        lastConversationActivity,
      )
      if (structuralIdle && lastObservedAt > 0 && current - lastObservedAt >= staleMs) {
        staleRequestIds.push(String(requestId))
        continue
      }
      activeRequestIds.push(String(requestId))
    }
  }

  return {
    state: activeRequestIds.length ? 'active' : staleRequestIds.length ? 'stale' : 'idle',
    activeRequestIds,
    staleRequestIds,
  }
}

export function reconcileChatGPTConversationTransport(requests, classification) {
  if (!(requests instanceof Map)) return requests
  for (const requestId of classification?.staleRequestIds || []) requests.delete(requestId)
  return requests
}

export function isRecoverableChatGPTNetworkError(value, options = {}) {
  const text = String(value || '').toUpperCase()
  if (options.conversationTransport === true && text.includes('ERR_FAILED')) return true
  return [
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NETWORK_CHANGED',
    'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_ABORTED',
    'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_TIMED_OUT',
    'ERR_TIMED_OUT',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_ADDRESS_UNREACHABLE',
    'ERR_SOCKET_NOT_CONNECTED',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_HTTP2_PROTOCOL_ERROR',
    'ERR_QUIC_PROTOCOL_ERROR',
    'ERR_SSL_PROTOCOL_ERROR',
    'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_DATE_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID',
  ].some((token) => text.includes(token))
}

export function isChatGPTConversationTransportURL(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || (url.hostname !== 'chatgpt.com' && !url.hostname.endsWith('.chatgpt.com'))) return false
    return url.pathname === '/backend-api/conversation'
      || url.pathname === '/backend-api/f/conversation'
      || url.pathname === '/backend-api/f/conversation/prepare'
      || url.pathname === '/backend-api/f/conversation/resume'
  } catch { return false }
}
