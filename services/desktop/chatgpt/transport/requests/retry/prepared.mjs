export function createPreparedPromptRetry(context) {
  const {
    sanitizeChatCacheKey,
    expectedChatGPTBundles,
    recentlyDeliveredChatGPTBundleRequestId,
    retryableChatGPTPrompts,
    RETRYABLE_PROMPT_TTL_MS,
    getChatAgentScheduler,
    retryPersistedChatGPTPrompt,
    preparePromptForChatGPT,
  } = context

  async function retryPreparedChatGPTPrompt(request, entryOverride = undefined) {
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.expectedRequestId || '').trim()
    // A stale renderer-side retry banner must never be able to replay a request
    // that Desktop is already supervising. An armed expectation means the send
    // action crossed the point where delivery became ambiguous or confirmed; the
    // only safe action is to keep waiting for that exact response.
    const supervised = expectedChatGPTBundles.get(key)
    if (requestId && supervised?.requestId === requestId) {
      return { ok: true, cacheKey: key, requestId, alreadySupervised: true, submitted: true, expectedFilename: supervised.filename }
    }
    // A response bundle already validated and acknowledged for this exact
    // request id is a completed round trip, whether or not a retryable draft
    // still lingers in memory (its TTL is independent of delivery). Checking
    // this only in the "no retryable draft" branch below let a stale-but-not-yet
    // -expired retryable entry win the race: the UI kept showing "Entrega ao
    // ChatGPT pendente" and every retry click re-ran the whole submission
    // against a request ChatGPT had already answered, instead of recognizing
    // it was already delivered.
    if (requestId && recentlyDeliveredChatGPTBundleRequestId(requestId)) {
      retryableChatGPTPrompts.delete(key)
      return { ok: true, cacheKey: key, requestId, alreadyDelivered: true }
    }
    const retryable = retryableChatGPTPrompts.get(key)
    if (!retryable || Date.now() - retryable.preparedAt > RETRYABLE_PROMPT_TTL_MS) {
      retryableChatGPTPrompts.delete(key)
      const scheduler = getChatAgentScheduler?.()
      if (requestId && scheduler) {
        const listed = await scheduler.list({ request_id: requestId })
        const writes = (listed?.tasks || []).filter((task) =>
          task.type === 'BOT_WRITE' && task.chat_id === key &&
          task.request_id === requestId && task.session_id === request?.sessionId,
        )
        if (writes.some((task) => ['PENDING', 'LEASED', 'RUNNING', 'WAITING', 'DONE'].includes(task.status))) {
          throw new Error('Este pedido já tem um envio em curso ou concluído; aguarde a resposta antes de reenviar.')
        }
        const cancelled = writes.find((task) =>
          task.status === 'CANCELLED' &&
          task.payload?.operation === 'PREPARE_PROMPT' &&
          task.payload?.request?.cacheKey === key &&
          task.payload?.request?.requestId === requestId &&
          task.payload?.request?.sessionId === request?.sessionId,
        )
        if (cancelled) {
          // Cancellation can win the lease before the Worker uploads anything.
          // Rebuild a draft from the durable request details so a possibly
          // ambiguous provider send is never replayed without confirmation.
          return preparePromptForChatGPT({ ...cancelled.payload.request, background: false, autoSubmit: false }, entryOverride)
        }
      }
      return retryPersistedChatGPTPrompt(request, entryOverride)
    }
    if (requestId && String(retryable.request?.requestId || '') !== requestId) {
      throw new Error('Uma requisição mais recente substituiu esta; abra a aba do ChatGPT para continuar.')
    }
    return preparePromptForChatGPT(retryable.request, entryOverride)
  }

  return { retryPreparedChatGPTPrompt }
}
