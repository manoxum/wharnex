// Only a newly dispatched correction may retire stale transport attention.
// Request age and the spent continuation budget remain authoritative.
export function resumeSubmittedResponse({ expectedChatGPTBundles, clearChatGPTHumanAction, now = Date.now }, key, entry, requestId) {
  const expected = expectedChatGPTBundles.get(key)
  if (expected?.requestId !== String(requestId)) return
  expected.progressAt = now()
  expected.processingObservedAt = 0
  expected.processingAbsentSince = 0
  expected.rehydrating = false
  if (entry.humanAction?.active && ['transport', 'stalled'].includes(entry.humanAction.kind)) {
    clearChatGPTHumanAction(key, 'correção de saída enviada na conversa vinculada')
  }
}
