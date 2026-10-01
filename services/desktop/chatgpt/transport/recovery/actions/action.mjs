export function createChatGPTRecoveryAction(context) {
  const {
    requireOwnedChatGPTEntry, isNetworkRecoveryFault, claimNetworkFaultReloadSlot, commitChatGPTRecoveryAction, recordChatGPTTaskEvent,
    reloadOwnedChatGPTConversation, sendToChatGPTKey, setChatGPTHumanAction, chatGPTBundleAlreadyValidated, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
    withChatGPTTransportPreparation, expectedChatGPTBundles, submitChatGPTContinuation, ChatGPTRateLimitDeferral, escalateChatGPTContinuationFailure,
  } = context

  async function performChatGPTRecoveryAction(key, expected, entry, action, completion = {}) {
    if (!action || !expected?.recovery) return false
    requireOwnedChatGPTEntry(key, entry)
    const now = Date.now()
    if (action.type === 'reload') {
      if (action.reason === 'transport' && isNetworkRecoveryFault(action.detail) && !claimNetworkFaultReloadSlot(now)) return false
      commitChatGPTRecoveryAction(expected.recovery, action, now)
      expected.settledAt = 0
      expected.lastDOMClick = 0
      console.warn(`[chatgpt-recovery] reload key=${key} request=${expected.requestId} reason=${action.reason} attempt=${expected.recovery.reloadCount}`)
      recordChatGPTTaskEvent(expected, 'chatgpt.recovery_reload', { reason: action.reason, attempt: expected.recovery.reloadCount })
      await reloadOwnedChatGPTConversation(key, entry, 'recovery-reload')
      const text = action.reason === 'transport'
        ? 'Falha de ligação detetada no ChatGPT. A conversa foi recarregada automaticamente para re-hidratar o processamento.'
        : action.reason === 'surface'
          ? 'O compositor do ChatGPT deixou de estar disponível. A conversa foi recarregada uma vez para recuperar a interface sem alterar o pedido.'
          : action.reason === 'stalled'
            ? 'O processamento do ChatGPT parece ter parado. A conversa foi recarregada uma vez para recuperar atualizações pendentes.'
            : action.reason === 'silent'
              ? 'O ChatGPT deixou de mostrar processamento sem produzir nova resposta. A conversa foi recarregada uma vez para recuperar o pedido.'
              : 'A resposta terminou sem o bundle esperado. A conversa foi recarregada uma vez antes da continuação automática.'
      sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, requestId: expected.requestId, state: 'thinking', text, capturedAt: new Date().toISOString() })
      return true
    }
    if (action.type === 'human') {
      commitChatGPTRecoveryAction(expected.recovery, action, now)
      const kind = action.reason === 'surface-unavailable' ? 'surface' : action.reason === 'recovery-exhausted' ? 'stalled' : 'transport'
      setChatGPTHumanAction(key, kind, action.detail || '', 'recovery')
      return true
    }
    if (action.type !== 'prompt') return false
    if (chatGPTBundleAlreadyValidated(expected.requestId)) return true
    if (expected.automaticContinuationSent === true || Number(expected.continuationCount || 0) >= MAX_AUTOMATIC_BUNDLE_CONTINUATIONS) {
      commitChatGPTRecoveryAction(expected.recovery, { type: 'human', reason: 'recovery-exhausted', detail: `O wake-up automático único já foi usado para ${expected.filename}.` }, now)
      setChatGPTHumanAction(key, 'stalled', `O ChatGPT não entregou ${expected.filename} depois do wake-up automático único. Use “Retomar pedido” depois de verificar a conversa.`, 'recovery')
      return true
    }
    let continuationResult
    try {
      continuationResult = await withChatGPTTransportPreparation(key, entry, expected.requestId, async () => {
        if (expectedChatGPTBundles.get(key) !== expected) return { ok: true, skipped: true, reason: 'request_replaced' }
        return submitChatGPTContinuation(key, entry.affinity.boundURL, expected.requestId, entry)
      })
    } catch (error) {
      if (error instanceof ChatGPTRateLimitDeferral) return true
      escalateChatGPTContinuationFailure(key, expected, error, 'automatic-recovery')
      return true
    }
    if (expectedChatGPTBundles.get(key) !== expected || continuationResult?.skipped) return true
    const recovery = expected.recovery
    commitChatGPTRecoveryAction(recovery, action, now)
    expected.automaticContinuationSent = true
    expected.continuationCount = Math.max(Number(expected.continuationCount || 0), MAX_AUTOMATIC_BUNDLE_CONTINUATIONS)
    expected.lastContinuationAt = now
    expected.invalidBundleCount = 0
    expected.assistantBaseline = Math.max(expected.assistantBaseline, Number(completion?.assistantCount) || 0)
    expected.settledAt = 0
    expected.lastDOMClick = 0
    console.warn(`[chatgpt-recovery] keep-continue key=${key} request=${expected.requestId} accepted=true reason=${action.reason}`)
    recordChatGPTTaskEvent(expected, 'chatgpt.recovery_keep_continue', { reason: action.reason })
    sendToChatGPTKey(key, 'wharness:chatgpt:activity', { cacheKey: key, requestId: expected.requestId, state: 'thinking', text: 'A resposta parou sem o bundle esperado. O Wharnex enviou apenas “keep continue” na mesma conversa, sem reenviar o pedido nem o bundle de entrada.', capturedAt: new Date().toISOString() })
    return true
  }

  return { performChatGPTRecoveryAction }
}
