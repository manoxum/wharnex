export function createChatGPTDraftSubmission({
  chatAgentWorkerActivity, targetChatGPTComposer, normalizeChatGPTReasoningEffort,
  canonicalChatGPTConversationURL, sameConversationURL,
  ensureChatGPTReasoningEffort, executeChatGPTDOMScript,
  reasoningEffortStateScript, CHATGPT_BEHAVIOR, requireOwnedChatGPTEntry,
  stepChatGPTReasoningEffortToward, markChatGPTAffinitySubmitted,
  submitWithoutReplay, chatAgentRateLimitDelayMs, ChatGPTRateLimitDeferral,
  chatGPTSubmissions, chatGPTSubmitScript,
}) {
  async function submitChatGPTDraft(key, entryOverride = undefined, expectedURL = '', preparedTarget = undefined, { requireReasoningEffort = true, rateLimitExempt = true, beforeDispatch = undefined } = {}) {
    chatAgentWorkerActivity.set('submitting')
    const target = preparedTarget || await targetChatGPTComposer(key, '', false, entryOverride)
    const wc = target.wc
    const reasoningEffort = normalizeChatGPTReasoningEffort(target.reasoningEffort || target.entry.reasoningEffort || 'high')
    const expectedConversation = canonicalChatGPTConversationURL(expectedURL)
    const assertExpectedConversation = () => {
      if (!expectedConversation) return
      if (!sameConversationURL(wc.getURL(), expectedConversation)) {
        throw new Error('A conversa ChatGPT mudou durante a preparação; o pedido não foi enviado para evitar escrever noutra conversa.')
      }
    }
    assertExpectedConversation()
    let effort
    try {
      effort = await ensureChatGPTReasoningEffort({
        target: reasoningEffort,
        observe: () => executeChatGPTDOMScript(key, target.entry, 'reasoning-effort-state', reasoningEffortStateScript(CHATGPT_BEHAVIOR)),
        cycle: async () => {
          requireOwnedChatGPTEntry(key, target.entry)
          assertExpectedConversation()
          await stepChatGPTReasoningEffortToward(key, target.entry, reasoningEffort)
        },
      })
    } catch (error) {
      // Utility workers may continue at the account's current effort level.
      if (requireReasoningEffort) throw error
      console.warn(`[chatgpt-effort] key=${key} could not reach ${reasoningEffort}, submitting at whatever level ChatGPT is currently on instead: ${error instanceof Error ? error.message : String(error)}`)
      effort = { effort: `unconfirmed(wanted ${reasoningEffort})`, changed: false, cycles: 0 }
    }
    console.log(`[chatgpt-effort] key=${key} target=${effort.effort} changed=${effort.changed} cycles=${effort.cycles}`)
    markChatGPTAffinitySubmitted(target.entry.affinity)
    const method = 'dom-click'
    const result = await submitWithoutReplay({
      beforeSubmit: async () => {
        assertExpectedConversation()
        if (typeof beforeDispatch === 'function') await beforeDispatch()
        if (!rateLimitExempt) {
          const suspension = chatAgentRateLimitDelayMs()
          if (suspension > 0) throw new ChatGPTRateLimitDeferral(suspension)
        }
      },
      beginObservation: () => chatGPTSubmissions.expect(wc.id),
      submit: async () => {
        assertExpectedConversation()
        if (typeof beforeDispatch === 'function') await beforeDispatch()
        const clicked = await wc.executeJavaScript(chatGPTSubmitScript(), true)
        if (!clicked) throw new Error('ChatGPT send button is unavailable')
      },
    })
    if (result.accepted) {
      console.log(`[chatgpt-submit] accepted key=${key} method=${method} request=${result.requestId}`)
    } else {
      console.warn(`[chatgpt-submit] dispatched-unconfirmed key=${key} method=${method} error=${result.observationError || 'network observation timeout'}; continuing supervision without replay`)
    }
    chatAgentWorkerActivity.set('processing')
    return result
  }

  return { submitChatGPTDraft }
}
