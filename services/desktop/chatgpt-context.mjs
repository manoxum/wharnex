export function shouldAttachProjectContext({ currentSha, previousSha, currentConversationId, previousConversationId, force = false }) {
  if (force) return true
  if (!previousSha) return true
  if (currentSha !== previousSha) return true
  return currentConversationId !== previousConversationId
}
