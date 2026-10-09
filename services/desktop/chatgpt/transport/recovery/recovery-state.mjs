import { networkFaultStatus } from './chatgpt-transport-backoff.mjs'
import { boundedDuration, finiteTime } from './time-values.mjs'

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
    completionContinued: false,
    errorReloaded: false,
    stallReloaded: false,
    silentReloaded: false,
    surfaceReloaded: false,
    stalledPromptCount: 0,
    lastPromptAt: 0,
    humanEscalated: false,
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
  const silentMs = boundedDuration(options.silentMs, DEFAULT_SILENT_MS)
  const reloadSettleMs = boundedDuration(options.reloadSettleMs, DEFAULT_RELOAD_SETTLE_MS)
  if (state.lastActionAt && current - state.lastActionAt < cooldownMs) return undefined

  if (snapshot.humanActionRequired === true) return undefined

  const networkFault = networkFaultStatus(state, current)
  if (networkFault === 'deferred') return undefined
  if (networkFault === 'recovered') clearChatGPTRecoveryFault(state)
  if (state.pendingFault) {
    const maxTransportReloads = Math.max(1, Number(options.maxTransportReloads) || 3)
    if (Number(state.transportReloadCount || 0) >= maxTransportReloads) {
      if (state.humanEscalated) return undefined
      return { type: 'human', reason: 'transport-exhausted', detail: state.pendingFault }
    }
    return { type: 'reload', reason: 'transport', detail: state.pendingFault }
  }

  // Some callers probe only for already-recorded transport/renderer faults
  // before the DOM liveness snapshot is available. An empty/partial snapshot
  // must never be interpreted as evidence that generation is idle.
  const hasLivenessSnapshot = ['complete', 'thinking', 'failed', 'responseStarted', 'processingInterrupted', 'surfaceReady', 'awaitingConversationAffinity', 'transportActive']
    .some((key) => Object.hasOwn(snapshot || {}, key))
  if (options.faultOnly === true || !hasLivenessSnapshot) return undefined

  if (snapshot.awaitingConversationAffinity === true) return undefined
  if (snapshot.transportActive === true) return undefined

  if (snapshot.failed === true) {
    if (!state.errorReloaded) return { type: 'reload', reason: 'response-error', detail: 'ChatGPT exposed a structural response error control' }
    if (!state.humanEscalated && state.lastReloadAt && current - state.lastReloadAt >= reloadSettleMs) return { type: 'human', reason: 'response-error', detail: 'ChatGPT still reports a response error after recovery reload' }
    return undefined
  }

  if (snapshot.complete === true && !state.completionContinued) {
    return { type: 'prompt', reason: 'completed-without-bundle', detail: 'response settled without the expected validated bundle' }
  }

  if (snapshot.processingInterrupted === true && !state.completionContinued) {
    return { type: 'prompt', reason: 'processing-interrupted', detail: 'visible processing stopped without producing a new assistant turn or validated bundle' }
  }

  const thinking = snapshot.thinking === true
  const responseStarted = snapshot.responseStarted === true
  const surfaceUnavailable = snapshot.surfaceReady === false
  const lastProgressAt = Math.max(Number(state.lastProgressAt || 0), Number(state.startedAt || 0))
  if (state.surfaceReloaded && surfaceUnavailable) {
    if (state.humanEscalated || !state.lastReloadAt || current - state.lastReloadAt < reloadSettleMs) return undefined
    return { type: 'human', reason: 'surface-unavailable', detail: 'ChatGPT composer remained unavailable after the recovery reload' }
  }
  if (surfaceUnavailable && !thinking && current - lastProgressAt >= silentMs) {
    return { type: 'reload', reason: 'surface', detail: 'ChatGPT composer is unavailable on the trusted conversation surface' }
  }
  if (state.stallReloaded || state.silentReloaded) {
    if (!state.lastReloadAt || current - state.lastReloadAt < reloadSettleMs) return undefined
    const progressedAfterReload = lastProgressAt > state.lastReloadAt
    if (progressedAfterReload && (thinking || current - lastProgressAt < silentMs)) return undefined
    if (state.humanEscalated) return undefined
    return { type: 'human', reason: 'recovery-ambiguous', detail: 'ChatGPT remained structurally ambiguous after the recovery reload; automatic prompting is unsafe' }
  }
  if (thinking) {
    // A static processing indicator is not evidence that a long model task has
    // stalled. Reload only on a concrete transport fault or terminal response;
    // otherwise multi-hour requests must be allowed to keep running.
    return undefined
  }
  if (!responseStarted && current - lastProgressAt >= silentMs) {
    if (state.humanEscalated) return undefined
    return { type: 'human', reason: 'silent-ambiguous', detail: 'No positive completion or processing evidence is available; automatic prompting is unsafe' }
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
    if (action.reason === 'response-error') state.errorReloaded = true
    if (action.reason === 'stalled') state.stallReloaded = true
    if (action.reason === 'silent') state.silentReloaded = true
    if (action.reason === 'surface') state.surfaceReloaded = true
    clearChatGPTRecoveryFault(state)
    noteChatGPTRecoveryProgress(state, `reload:${action.reason}:${state.reloadCount}`, current)
  } else if (action.type === 'prompt') {
    if (action.reason === 'completed-without-bundle' || action.reason === 'processing-interrupted') state.completionContinued = true
    state.stalledPromptCount = Number(state.stalledPromptCount || 0) + 1
    state.lastPromptAt = current
    noteChatGPTRecoveryProgress(state, `prompt:${action.reason}:${state.stalledPromptCount}`, current)
  } else if (action.type === 'human') {
    state.humanEscalated = true
    clearChatGPTRecoveryFault(state)
    noteChatGPTRecoveryProgress(state, `human:${action.reason}`, current)
  }
  return state
}

export function chatGPTDeliveryContinuationPrompt() {
  // The linked conversation already contains the complete authoritative
  // request bundle and all reasoning produced so far. A minimal user-style
  // nudge resumes that same context without uploading or replaying the request.
  return 'keep continue'
}
