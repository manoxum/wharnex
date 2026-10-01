export function createChatGPTRateLimit({
  state, classifyChatGPTRateLimit, RATE_LIMIT_GATE,
  CHATGPT_RATE_LIMIT_BACKOFF_MS, expectedChatGPTBundles,
  noteChatGPTRecoveryProgress, publishChatAgentRuntimeState,
  sendToChatGPTKey,
}) {
  function applyChatGPTRateLimit(cacheKey, { source = 'unknown', domGate = false } = {}) {
    const now = Date.now()
    const classification = classifyChatGPTRateLimit(state.hits, { now, domGate })
    state.hits = classification.hits
    const gate = classification.kind === RATE_LIMIT_GATE
    const escalated = gate && state.kind !== RATE_LIMIT_GATE
    // While a suspension is already counting down, a further refusal is expected
    // noise and must not restart the round-trip on every response — unless it is
    // the one that reveals the isolated 429 was really an account-wide gate.
    if (now < state.until && !escalated) return true

    const requestedCooldownMs = Number(state.policies.rate_limit_cooldown_minutes) * 60_000
    const configuredCooldownMs = Number.isFinite(requestedCooldownMs)
      ? Math.min(60 * 60_000, Math.max(60_000, requestedCooldownMs))
      : CHATGPT_RATE_LIMIT_BACKOFF_MS
    const configuredCooldownMinutes = configuredCooldownMs / 60_000
    const cooldownLabel = Number.isInteger(configuredCooldownMinutes)
      ? `${configuredCooldownMinutes} minutos`
      : `${Math.floor(configuredCooldownMinutes)} minutos e 30 segundos`
    const localUntil = now + configuredCooldownMs
    state.until = Math.max(state.until, localUntil)
    state.resumeProbeRequired = true
    state.kind = classification.kind
    state.appliedAt = now

    const expected = expectedChatGPTBundles.get(cacheKey)
    if (expected) {
      expected.backoffUntil = Math.max(Number(expected.backoffUntil || 0), state.until)
      noteChatGPTRecoveryProgress(expected.recovery, `http:429-${classification.kind}`, now)
    }

    if (state.scheduler) {
      void state.scheduler.recordRateLimit(source, classification.kind, Math.round(configuredCooldownMs / 1000)).then((provider) => {
        const persistedUntil = Date.parse(String(provider?.paused_until || ''))
        if (Number.isFinite(persistedUntil)) state.until = Math.max(state.until, persistedUntil)
        if (expected && Number.isFinite(persistedUntil)) expected.backoffUntil = Math.max(Number(expected.backoffUntil || 0), persistedUntil)
        state.runtimeDiagnostics.provider = { ...state.runtimeDiagnostics.provider, ...provider }
        publishChatAgentRuntimeState()
      }).catch((error) => {
        console.warn(`[chat-agent] could not persist provider rate-limit ${classification.kind}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    console.warn(`[chat-agent] provider-rate-limit kind=${classification.kind} source=${source} hits=${classification.recentHits} until=${new Date(state.until).toISOString()}`)
    if (cacheKey) {
      sendToChatGPTKey(cacheKey, 'wharness:chatgpt:activity', {
        cacheKey,
        state: 'thinking',
        text: gate
          ? `O ChatGPT bloqueou pedidos por excesso de tráfego. Os Workers ficam suspensos por ${cooldownLabel}; Supervisores e Translator continuam operacionais.`
          : `O ChatGPT devolveu HTTP 429. Os Workers ficam suspensos por ${cooldownLabel}; Supervisores e Translator continuam operacionais.`,
        capturedAt: new Date().toISOString(),
      })
    }
    return true
  }

  // ChatGPT's own limit control, seen by the passive health probe. That control
  // is conclusive structural evidence on its own, so it escalates straight to the
  // account-wide suspension without waiting for a second refusal.
  function noteChatGPTRateLimitGate(cacheKey, health) {
    if (health?.rateLimited !== true) return false
    applyChatGPTRateLimit(cacheKey, { source: 'dom_gate', domGate: true })
    return true
  }

  // ChatGPT's own generated-file download endpoint for one conversation.
  return { applyChatGPTRateLimit, noteChatGPTRateLimitGate }
}
