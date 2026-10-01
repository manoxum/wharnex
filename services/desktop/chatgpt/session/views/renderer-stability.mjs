export function createChatGPTRendererStability({
  sanitizeChatCacheKey, requireOwnedChatGPTEntry,
  evaluateChatGPTDOMWithDeadline, wait, waitForChatGPTReady,
  isTrustedChatGPTOrigin, recoverChatGPTConversationLoadFailure,
}) {
  async function waitForChatGPTSurfaceReady(cacheKey, entry) {
    const { wc } = requireOwnedChatGPTEntry(cacheKey, entry)
    const settle = () => waitForChatGPTReady({
      isLoading: () => entry.loading || wc.isLoading(),
      lastNetworkActivity: () => entry.lastNetworkActivity,
      wait,
    })
    await settle()
    if (!isTrustedChatGPTOrigin(wc.getURL())) throw new Error('Active cached view is not a trusted ChatGPT page')
    await recoverChatGPTConversationLoadFailure(cacheKey, entry, wc, settle)
  }

  async function executeChatGPTDOMScript(cacheKey, entry, stage, script) {
    const key = sanitizeChatCacheKey(cacheKey)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await evaluateChatGPTDOMWithDeadline(wc, script)
      } catch (error) {
        console.warn(`[chatgpt-dom] stage=${stage} key=${key} attempt=${attempt} evaluation failed; waiting for renderer stability`)
        await wait(250)
        if (attempt < 3) await waitForChatGPTSurfaceReady(key, entry)
      }
    }
    console.warn(`[chatgpt-dom] stage=${stage} key=${key} exhausted renderer evaluation retries`)
    throw new Error(`A interface do ChatGPT não ficou estável ao preparar ${stage}. Reabra a aba ChatGPT e tente novamente.`)
  }

  return { executeChatGPTDOMScript, waitForChatGPTSurfaceReady }
}
