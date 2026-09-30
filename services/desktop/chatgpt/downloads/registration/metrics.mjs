export function createValidBundleMetric({
  scheduler, chatGPTWorkerEntries, chatgptViews,
  chatAgentConversationID, recordProviderDiagnostics,
}) {
  return function recordValidBundleMetric(expectedBundle, sourceURL, validated) {
    const agentScheduler = scheduler()
    if (!agentScheduler) return
    const expectedEntry = expectedBundle?.key
      ? (chatGPTWorkerEntries.find((candidate) => candidate.ownerKey === expectedBundle.key) || chatgptViews.get(expectedBundle.key))
      : undefined
    const durationMs = Number(expectedBundle?.processingDurationMs || 0)
    const conversationID = chatAgentConversationID(expectedEntry?.view?.webContents?.getURL?.() || sourceURL)
    void agentScheduler.recordValidBundle({ requestId: validated.requestId, conversationId: conversationID, durationMs })
      .then(recordProviderDiagnostics)
      .catch((error) => console.warn(`[chat-agent] valid-bundle metric failed: ${error instanceof Error ? error.message : String(error)}`))
  }
}
