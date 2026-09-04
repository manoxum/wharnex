const DEFAULT_STALL_MS = 90_000
const DEFAULT_SILENT_MS = 30_000
const DEFAULT_RELOAD_SETTLE_MS = 15_000
const DEFAULT_ACTION_COOLDOWN_MS = 5_000

export function createChatGPTRecoveryState(now = Date.now()) {
  const startedAt = finiteTime(now)
  return {
    startedAt,
    lastProgressAt: startedAt,
    lastProgressFingerprint: '',
    lastAssistantCount: 0,
    pendingFault: '',
    pendingFaultAt: 0,
    lastActionAt: 0,
    lastReloadAt: 0,
    reloadCount: 0,
    transportReloadCount: 0,
    completionReloaded: false,
    stallReloaded: false,
    silentReloaded: false,
    stalledPromptCount: 0,
  }
}

export function noteChatGPTRecoveryProgress(state, fingerprint = '', now = Date.now()) {
  if (!state) return state
  const value = String(fingerprint || '')
  if (value && value === state.lastProgressFingerprint) return state
  state.lastProgressFingerprint = value
  state.lastProgressAt = finiteTime(now)
  return state
}

export function noteChatGPTRecoveryAssistantCount(state, assistantCount, now = Date.now()) {
  if (!state) return state
  const count = Math.max(0, Number(assistantCount) || 0)
  if (count === Number(state.lastAssistantCount || 0)) return state
  state.lastAssistantCount = count
  return noteChatGPTRecoveryProgress(state, `assistant:${count}`, now)
}

export function noteChatGPTRecoveryFault(state, reason, now = Date.now()) {
  if (!state) return state
  const message = String(reason || '').trim()
  if (!message) return state
  state.pendingFault = message.slice(0, 240)
  state.pendingFaultAt = finiteTime(now)
  return state
}

export function clearChatGPTRecoveryFault(state) {
  if (!state) return state
  state.pendingFault = ''
  state.pendingFaultAt = 0
  return state
}

export function chooseChatGPTRecoveryAction(state, snapshot = {}, now = Date.now(), options = {}) {
  if (!state) return undefined
  const current = finiteTime(now)
  const cooldownMs = boundedDuration(options.actionCooldownMs, DEFAULT_ACTION_COOLDOWN_MS)
  const stallMs = boundedDuration(options.stallMs, DEFAULT_STALL_MS)
  const silentMs = boundedDuration(options.silentMs, DEFAULT_SILENT_MS)
  const reloadSettleMs = boundedDuration(options.reloadSettleMs, DEFAULT_RELOAD_SETTLE_MS)
  if (state.lastActionAt && current - state.lastActionAt < cooldownMs) return undefined

  if (state.pendingFault) {
    const maxTransportReloads = Math.max(1, Number(options.maxTransportReloads) || 3)
    if (Number(state.transportReloadCount || 0) >= maxTransportReloads) return undefined
    return { type: 'reload', reason: 'transport', detail: state.pendingFault }
  }

  if (snapshot.complete === true && !state.completionReloaded) {
    return { type: 'reload', reason: 'completed-without-bundle', detail: 'response completed without the expected validated bundle' }
  }

  const thinking = snapshot.thinking === true
  const responseStarted = snapshot.responseStarted === true
  const lastProgressAt = Math.max(Number(state.lastProgressAt || 0), Number(state.startedAt || 0))
  if (state.stallReloaded || state.silentReloaded) {
    if (state.stalledPromptCount > 0 || !state.lastReloadAt || current - state.lastReloadAt < reloadSettleMs) return undefined
    const progressedAfterReload = lastProgressAt > state.lastReloadAt
    if (progressedAfterReload && current - lastProgressAt < (thinking ? stallMs : silentMs)) return undefined
    const reason = state.stallReloaded ? 'stalled-after-reload' : 'silent-after-reload'
    return { type: 'prompt', reason, detail: 'ChatGPT remained interrupted after the recovery reload' }
  }
  if (thinking) {
    if (current - lastProgressAt < stallMs) return undefined
    return { type: 'reload', reason: 'stalled', detail: 'ChatGPT processing made no observable progress before the stall threshold' }
  }
  if (!responseStarted && current - lastProgressAt >= silentMs) {
    return { type: 'reload', reason: 'silent', detail: 'ChatGPT stopped without producing a new assistant turn or processing indicator' }
  }
  return undefined
}

export function commitChatGPTRecoveryAction(state, action, now = Date.now()) {
  if (!state || !action) return state
  const current = finiteTime(now)
  state.lastActionAt = current
  if (action.type === 'reload') {
    state.lastReloadAt = current
    state.reloadCount = Number(state.reloadCount || 0) + 1
    if (action.reason === 'transport') state.transportReloadCount = Number(state.transportReloadCount || 0) + 1
    if (action.reason === 'completed-without-bundle') state.completionReloaded = true
    if (action.reason === 'stalled') state.stallReloaded = true
    if (action.reason === 'silent') state.silentReloaded = true
    clearChatGPTRecoveryFault(state)
    noteChatGPTRecoveryProgress(state, `reload:${action.reason}:${state.reloadCount}`, current)
  } else if (action.type === 'prompt') {
    state.stalledPromptCount = Number(state.stalledPromptCount || 0) + 1
    noteChatGPTRecoveryProgress(state, `prompt:${action.reason}:${state.stalledPromptCount}`, current)
  }
  return state
}

export function isRecoverableChatGPTNetworkError(value) {
  const text = String(value || '').toUpperCase()
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
  ].some((token) => text.includes(token))
}

export function isChatGPTConversationTransportURL(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || (url.hostname !== 'chatgpt.com' && !url.hostname.endsWith('.chatgpt.com'))) return false
    return url.pathname === '/backend-api/conversation'
      || url.pathname === '/backend-api/f/conversation'
      || url.pathname === '/backend-api/f/conversation/prepare'
  } catch { return false }
}

export function chatGPTStalledRecoveryPrompt(requestId, filename) {
  const id = String(requestId || '').trim()
  const expected = String(filename || '').trim()
  return `WHARNESS PROCESSING RECOVERY — SAME REQUEST ${id}\n\nThe previous ChatGPT processing appears to have stalled and the page was reloaded once to re-hydrate the conversation. Continue the ORIGINAL request from the existing context without restarting or changing scope. Focus on finishing the requested work and deliver exactly ${expected} according to the existing Wharness file-first contract. Finish with the file attachment only.`
}

function finiteTime(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : Date.now()
}

function boundedDuration(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return number
}
