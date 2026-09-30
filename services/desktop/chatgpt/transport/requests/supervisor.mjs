export function createSupervisorTransport({
  sanitizeChatCacheKey, ensureChatGPTView, withChatGPTTransportPreparation,
}) {
  async function withChatGPTSupervisorTransport(cacheKey, windowState, requestId, operation) {
    const key = sanitizeChatCacheKey(cacheKey)
    const { entry } = ensureChatGPTView(key, windowState)
    return withChatGPTTransportPreparation(key, entry, requestId, () => operation(key, entry))
  }
  return { withChatGPTSupervisorTransport }
}
