export function createWorkerPacing({
  getRuntimeDiagnostics, CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS,
  CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS, CHATGPT_WORKER_NAVIGATION_GAP_MS,
  CHAT_AGENT_WORKER_ACTION_GAP_MS, chatAgentWorkerActivity, chatGPTWorkerPacer,
  CHAT_AGENT_SUBMIT_GAP_MS, CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS,
  CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, chatAgentRateLimitDelayMs,
  loadOwnedChatGPTURL, waitForChatGPTSurfaceReady, chatAgentResidency,
}) {
  function chatAgentNavigationGapMs() {
    const chatAgentRuntimeDiagnostics = getRuntimeDiagnostics()
    const provider = chatAgentRuntimeDiagnostics.provider || {}
    const level = Math.max(0, Number(provider.rate_limit_level || 0))
    const lastLimit = Date.parse(String(provider.last_rate_limit_at || '')) || 0
    // A level that has not yet been reset still counts as pressure while the
    // 429 is recent, so recovery widens the gate before the backend clears it.
    const recentlyLimited = lastLimit > 0 && Date.now() - lastLimit < CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS
    if (level <= 0 && !recentlyLimited) return CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS
    const steps = [12_000, 20_000, CHATGPT_WORKER_NAVIGATION_GAP_MS]
    return steps[Math.min(steps.length - 1, Math.max(0, level - 1))]
  }

  // A provider action that reached the front of the pacing queue only to find a
  // suspension raised while it waited. Nothing was attempted, so the task that
  // carried it must come back as a free observation rather than spend an attempt.
  class ChatGPTRateLimitDeferral extends Error {
    constructor(delayMs) {
      super('ChatGPT rate-limit cooldown is active')
      this.name = 'ChatGPTRateLimitDeferral'
      this.delayMs = Math.max(0, Number(delayMs) || 0)
      this.retryUpload = false
    }
  }

  // Declared after its base: a class that extends is evaluated at module load.
  class ChatGPTConversationUnavailable extends ChatGPTRateLimitDeferral {
    constructor(delayMs) {
      super(delayMs)
      this.name = 'ChatGPTConversationUnavailable'
      this.message = 'ChatGPT could not load this conversation; retrying after a backoff'
      this.conversationUnavailable = true
    }
  }

  async function paceChatGPTWorkerRequest(measureGapMs, minimumGapMs = CHAT_AGENT_WORKER_ACTION_GAP_MS) {
    // A task that already reached ChatGPT takes the next slot; the gap between
    // any two Worker actions is unchanged.
    const priority = chatAgentWorkerActivity.pacePriority()
    await chatAgentWorkerActivity.during('waiting_turn', () => chatGPTWorkerPacer.pace(measureGapMs, { minimumGapMs, priority }))
    chatAgentWorkerActivity.markProviderAction()
  }

  async function paceChatGPTWorkerNavigation() {
    await paceChatGPTWorkerRequest(chatAgentNavigationGapMs)
  }

  // Process-wide spacing for autonomous prompt submissions, sharing the same
  // request gate as navigation. Pressure-specific gaps still widen independently,
  // but no Worker provider action can follow another by less than 10 seconds.
  function chatAgentSubmissionGapMs() {
    const chatAgentRuntimeDiagnostics = getRuntimeDiagnostics()
    const provider = chatAgentRuntimeDiagnostics.provider || {}
    const level = Math.max(0, Number(provider.rate_limit_level || 0))
    const lastLimit = Date.parse(String(provider.last_rate_limit_at || '')) || 0
    const recentlyLimited = lastLimit > 0 && Date.now() - lastLimit < CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS
    if (level <= 0 && !recentlyLimited) return CHAT_AGENT_SUBMIT_GAP_MS
    const steps = [20_000, 30_000, 45_000, CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS]
    return steps[Math.min(steps.length - 1, Math.max(0, level - 1))]
  }

  async function paceChatGPTWorkerSubmission({ translation = false } = {}) {
    // Translation remains a bounded, artifact-only utility and may run at its
    // explicitly smaller cadence. Every other Worker task, including TODO and
    // lifecycle work, uses the 10-second account-wide floor, widened by 429 pressure.
    await paceChatGPTWorkerRequest(
      translation ? () => CHAT_AGENT_TRANSLATION_ACTION_GAP_MS : chatAgentSubmissionGapMs,
      translation ? CHAT_AGENT_TRANSLATION_ACTION_GAP_MS : CHAT_AGENT_WORKER_ACTION_GAP_MS,
    )
  }

  async function loadAndSettleChatGPTWorkerConversation(key, entry, conversationURL, reason, assignment, { translation = false } = {}) {
    if (translation) await paceChatGPTWorkerSubmission({ translation: true })
    else await paceChatGPTWorkerNavigation()
    // The caller's pre-flight rate-limit check ran before this action joined the
    // process-wide queue, and a suspension raised while it waited there is the
    // common case rather than the rare one - the Worker that went first is
    // exactly what raised it. AGENTS.md §8 requires a suspended provider to stop
    // receiving actions, not to receive the ones already in flight, so the last
    // point every navigation passes through re-reads it and defers.
    if (!translation) {
      const suspension = chatAgentRateLimitDelayMs()
      if (suspension > 0) throw new ChatGPTRateLimitDeferral(suspension)
    }
    await loadOwnedChatGPTURL(key, entry, conversationURL, reason)
    await waitForChatGPTSurfaceReady(key, entry)
    if (assignment?.rebind && !chatAgentResidency.settleAssignment(entry.slotId, assignment.epoch, assignment.lane)) {
      throw new Error('stale worker assignment after ChatGPT navigation')
    }
  }

  return {
    ChatGPTRateLimitDeferral, ChatGPTConversationUnavailable,
    chatAgentNavigationGapMs, paceChatGPTWorkerRequest, paceChatGPTWorkerNavigation,
    chatAgentSubmissionGapMs, paceChatGPTWorkerSubmission, loadAndSettleChatGPTWorkerConversation,
  }
}
