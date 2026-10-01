export function createPromptContinuation(context) {
  const {
    sanitizeChatCacheKey,
    chatGPTBundleAlreadyValidated,
    expectedChatGPTBundles,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
    canonicalBundleFilename,
    targetChatGPTComposer,
    throwIfChatGPTTransportAborted,
    chatGPTAssistantTurnCount,
    chatGPTDeliveryContinuationPrompt,
    executeChatGPTDOMScript,
    chatGPTFillComposerScript,
    wait,
    submitChatGPTDraft,
    waitForSubmittedChatGPTConversation,
    touchChatGPTEntry,
  } = context

  function automaticChatGPTContinuationBlockReason(cacheKey, requestId, { manual = false } = {}) {
    const key = sanitizeChatCacheKey(cacheKey)
    const id = String(requestId || '').trim()
    if (chatGPTBundleAlreadyValidated(id)) return 'bundle_already_validated'
    const expected = expectedChatGPTBundles.get(key)
    if (!expected || expected.requestId !== id) return 'request_not_supervised'
    if (!manual && (expected.automaticContinuationSent === true || Number(expected.continuationCount || 0) >= MAX_AUTOMATIC_BUNDLE_CONTINUATIONS)) return 'wake_already_sent'
    return ''
  }

  function chatGPTContinuationSuppressedError(reason) {
    const error = new Error(`WHARNEX_CONTINUATION_SUPPRESSED: ${reason}`)
    error.code = 'WHARNEX_CONTINUATION_SUPPRESSED'
    error.reason = reason
    return error
  }

  async function submitChatGPTContinuation(cacheKey, expectedURL = '', requestId = '', entryOverride = undefined, { manual = false } = {}) {
    const key = sanitizeChatCacheKey(cacheKey)
    const id = String(requestId || '').trim()
    const initialBlock = automaticChatGPTContinuationBlockReason(key, id, { manual })
    if (initialBlock) return { ok: true, skipped: true, reason: initialBlock }
    const prior = expectedChatGPTBundles.get(key)
    const expectedFilename = prior?.requestId === id ? prior.filename : canonicalBundleFilename(key, id)
    const target = await targetChatGPTComposer(key, expectedURL, false, entryOverride)
    const signal = target.entry.transportAbortSignal
    const preDispatch = async () => {
      throwIfChatGPTTransportAborted(signal)
      const reason = automaticChatGPTContinuationBlockReason(key, id, { manual })
      if (reason) throw chatGPTContinuationSuppressedError(reason)
    }
    throwIfChatGPTTransportAborted(signal)
    const assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
    const prompt = chatGPTDeliveryContinuationPrompt()
    let filled = false
    try {
      await preDispatch()
      filled = await executeChatGPTDOMScript(key, target.entry, 'fill-keep-continue', chatGPTFillComposerScript(prompt))
      if (!filled) throw new Error('ChatGPT continuation composer could not be populated')
      await wait(100)
      const submission = await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { beforeDispatch: preDispatch })
      if (!submission.accepted && !submission.dispatched) throw new Error('ChatGPT continuation was not dispatched')
      const conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
      if (!conversationUrl) throw new Error('ChatGPT continuation did not produce a stable conversation id')
      if (prior?.requestId === id) {
        if (!manual) {
          prior.automaticContinuationSent = true
          prior.continuationCount = Math.max(Number(prior.continuationCount || 0), MAX_AUTOMATIC_BUNDLE_CONTINUATIONS)
        }
        prior.assistantBaseline = Math.max(Number(prior.assistantBaseline || 0), assistantBaseline)
        prior.lastDOMClick = 0
        prior.downloadInFlight = false
        prior.settledAt = 0
        prior.processingObservedAt = 0
        prior.processingAbsentSince = 0
        prior.progressAt = Date.now()
        prior.recoveryEligibleAt = 0
      }
      touchChatGPTEntry(target.entry)
      console.log(`[chatgpt-continuation] submitted key=${key} request=${id} prompt=${prompt}`)
      return {
        ok: true, skipped: false, cacheKey: key, expectedFilename, conversationUrl, assistantBaseline,
        recoveryBootstrap: prior?.requestId === id ? String(prior.recoveryBootstrap || '') : '',
        liveTunnels: prior?.requestId === id && Array.isArray(prior.liveTunnels) ? prior.liveTunnels.slice(0, 16) : [],
        originalPrompt: prior?.requestId === id ? String(prior.originalPrompt || '') : '',
      }
    } catch (error) {
      if (filled && (error?.name === 'AbortError' || error?.code === 'WHARNEX_CONTINUATION_SUPPRESSED')) {
        await executeChatGPTDOMScript(key, target.entry, 'clear-suppressed-keep-continue', chatGPTFillComposerScript('')).catch(() => undefined)
        return { ok: true, skipped: true, reason: String(error?.reason || error?.code || 'cancelled') }
      }
      throw error
    }
  }

  return { automaticChatGPTContinuationBlockReason, chatGPTContinuationSuppressedError, submitChatGPTContinuation }
}
