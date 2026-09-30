export function createChatGPTConversationReadHealth({
  chatGPTConversationLoadFailureScript, canonicalChatGPTConversationURL,
  chatGPTConversationID, wait, paceChatGPTWorkerNavigation,
  createConversationUnavailable, chatAgentResidency,
  createChatGPTAffinityTracker,
}) {
  const CHATGPT_CONVERSATION_LOAD_BACKOFF_MS = [2 * 60_000, 4 * 60_000, 8 * 60_000, 10 * 60_000]
  const chatGPTConversationLoadFailures = new Map()
  // Several different conversations failing to load close together is the
  // account's conversation reads being throttled, not one bad thread. Workers
  // then stop opening conversations for a while so the throttle can clear.
  const CHATGPT_CONVERSATION_READ_WINDOW_MS = 2 * 60_000
  const CHATGPT_CONVERSATION_READ_COOLDOWN_MS = 3 * 60_000
  const chatGPTConversationReadFailures = new Map()
  let chatGPTConversationReadCooldownUntil = 0
  function chatGPTConversationReadCooldownMs() {
    return Math.max(0, chatGPTConversationReadCooldownUntil - Date.now())
  }
  // When a cooldown ended, every waiting task reopened its conversation at once;
  // each opening is several refused reads, so the burst renewed the throttle and
  // the cooldown re-armed forever with every Worker idle. After a cooldown one
  // task probes alone, a failed probe re-arms a doubled cooldown, and only a
  // conversation that actually renders lets the others through.
  const CHATGPT_CONVERSATION_READ_COOLDOWN_MAX_MS = 24 * 60_000
  const CHATGPT_CONVERSATION_READ_PROBE_MS = 3 * 60_000
  const CHATGPT_CONVERSATION_READ_PROBE_WAIT_MS = 30_000
  let chatGPTConversationReadStreak = 0
  let chatGPTConversationReadProbe = { taskId: '', until: 0 }
  function chatGPTConversationReadGateMs(taskId) {
    const cooldown = chatGPTConversationReadCooldownMs()
    if (cooldown > 0 || chatGPTConversationReadStreak === 0) return cooldown
    const now = Date.now()
    if (chatGPTConversationReadProbe.until > now && chatGPTConversationReadProbe.taskId !== taskId) return CHATGPT_CONVERSATION_READ_PROBE_WAIT_MS
    if (chatGPTConversationReadProbe.until <= now) chatGPTConversationReadProbe = { taskId, until: now + CHATGPT_CONVERSATION_READ_PROBE_MS }
    return 0
  }
  function releaseChatGPTConversationReadProbe(taskId) {
    if (chatGPTConversationReadProbe.taskId === taskId) chatGPTConversationReadProbe = { taskId: '', until: 0 }
  }
  function noteChatGPTConversationReadHealthy() {
    if (chatGPTConversationReadStreak > 0) console.log(`[chatgpt-load] conversation-reads-healthy after_cooldowns=${chatGPTConversationReadStreak}`)
    chatGPTConversationReadStreak = 0
    chatGPTConversationReadProbe = { taskId: '', until: 0 }
  }
  function noteChatGPTConversationReadFailure(conversation) {
    const now = Date.now()
    chatGPTConversationReadFailures.set(conversation, now)
    for (const [key, at] of chatGPTConversationReadFailures) if (now - at > CHATGPT_CONVERSATION_READ_WINDOW_MS) chatGPTConversationReadFailures.delete(key)
    if ((chatGPTConversationReadFailures.size >= 2 || chatGPTConversationReadStreak > 0) && now >= chatGPTConversationReadCooldownUntil) {
      chatGPTConversationReadStreak += 1
      const cooldownMs = Math.min(CHATGPT_CONVERSATION_READ_COOLDOWN_MS * 2 ** (chatGPTConversationReadStreak - 1), CHATGPT_CONVERSATION_READ_COOLDOWN_MAX_MS)
      chatGPTConversationReadCooldownUntil = now + cooldownMs
      chatGPTConversationReadProbe = { taskId: '', until: 0 }
      console.warn(`[chatgpt-load] conversation-read-cooldown conversations=${chatGPTConversationReadFailures.size} streak=${chatGPTConversationReadStreak} until=${new Date(chatGPTConversationReadCooldownUntil).toISOString()}`)
    }
  }
  async function recoverChatGPTConversationLoadFailure(cacheKey, entry, wc, settle) {
    const probe = (click) => wc.executeJavaScript(chatGPTConversationLoadFailureScript(click), true).catch(() => null)
    const conversation = canonicalChatGPTConversationURL(wc.getURL()) || cacheKey
    // Only a rendered conversation proves reads work; the home composer does not.
    const noteLoaded = (result) => {
      if (!result?.loaded) return
      chatGPTConversationLoadFailures.delete(conversation)
      if (chatGPTConversationID(wc.getURL())) noteChatGPTConversationReadHealthy()
    }
    const first = await probe(false)
    noteLoaded(first)
    if (!first?.failed) return
    await wait(2_000)
    const confirmed = await probe(false)
    noteLoaded(confirmed)
    if (!confirmed?.failed) return
    if (entry.role === 'worker') await paceChatGPTWorkerNavigation()
    const retried = confirmed.retryable ? await probe(true) : null
    if (!retried?.clicked && !wc.isDestroyed()) wc.reload()
    await wait(1_000)
    await settle()
    if (!(await probe(false))?.failed) {
      console.log(`[chatgpt-load] conversation-load-recovered key=${cacheKey} action=${retried?.clicked ? 'retry' : 'reload'}`)
      chatGPTConversationLoadFailures.delete(conversation)
      noteChatGPTConversationReadHealthy()
      return
    }
    const failures = (chatGPTConversationLoadFailures.get(conversation) || 0) + 1
    chatGPTConversationLoadFailures.set(conversation, failures)
    noteChatGPTConversationReadFailure(conversation)
    const delayMs = Math.max(chatGPTConversationReadCooldownMs(), CHATGPT_CONVERSATION_LOAD_BACKOFF_MS[Math.min(failures, CHATGPT_CONVERSATION_LOAD_BACKOFF_MS.length) - 1])
    console.warn(`[chatgpt-load] conversation-load-failed key=${cacheKey} failures=${failures} action=${retried?.clicked ? 'retry' : 'reload'} backoff_ms=${delayMs}`)
    if (entry.role === 'worker') entry.parkAfterLoadFailure = true
    throw createConversationUnavailable(delayMs)
  }

  function parkChatGPTWorkerAfterLoadFailure(entry) {
    if (!entry?.parkAfterLoadFailure) return
    entry.parkAfterLoadFailure = false
    const wc = entry.view?.webContents
    if (!wc || wc.isDestroyed() || entry.interactionWindowId || entry.transportPreparationCount > 0) return
    chatAgentResidency.releaseResidentLane(entry.slotId)
    entry.ownerKey = ''
    entry.affinity = createChatGPTAffinityTracker()
    console.warn(`[chatgpt-load] worker-parked slot=${entry.slotId} reason=conversation-load-failed`)
    void wc.loadURL('about:blank').catch(() => undefined)
  }
  return { chatGPTConversationReadCooldownMs, chatGPTConversationReadGateMs, releaseChatGPTConversationReadProbe, noteChatGPTConversationReadHealthy, noteChatGPTConversationReadFailure, recoverChatGPTConversationLoadFailure, parkChatGPTWorkerAfterLoadFailure }
}
