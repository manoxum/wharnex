export function createChatGPTRecoveryContinuation(context) {
  const {
    commitChatGPTRecoveryAction, setChatGPTHumanAction, recordChatGPTTaskEvent,
  } = context

  function escalateChatGPTContinuationFailure(key, expected, error, source) {
    const detail = String(error instanceof Error ? error.message : error || 'erro desconhecido').slice(0, 500)
    if (expected?.recovery) {
      commitChatGPTRecoveryAction(expected.recovery, { type: 'human', reason: 'continuation-preparation', detail }, Date.now())
    }
    setChatGPTHumanAction(key, 'transport', `Não foi possível preparar a continuação do pedido: ${detail}`, source)
    console.warn(`[chatgpt-recovery] continuation-failed key=${key} request=${expected?.requestId || '-'} source=${source} error=${detail}`)
  }

  // The manual "Retomar pedido" affordance and the automatic keep-continue
  // wake-up both end here (submitChatGPTContinuation). Recording it at this one
  // choke point covers both triggers without threading a type through every
  // caller.
  function recordChatGPTContinuationSent(expected, trigger, reason) {
    recordChatGPTTaskEvent(expected, 'chatgpt.continuation_sent', { trigger, reason })
  }

  return { escalateChatGPTContinuationFailure, recordChatGPTContinuationSent }
}
