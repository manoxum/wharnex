export function chatAgentTaskPayload(task) {
  if (task?.payload && typeof task.payload === 'object' && !Buffer.isBuffer(task.payload)) return task.payload
  try { return JSON.parse(String(task?.payload || '{}')) } catch { return {} }
}

export function createChatAgentConversationURL(canonicalChatGPTConversationURL) {
  return function chatAgentConversationURL(task, payload = chatAgentTaskPayload(task)) {
    const fromPayload = canonicalChatGPTConversationURL(payload?.conversation_url || '')
    if (fromPayload) return fromPayload
    const id = String(task?.conversation_id || '').trim()
    return /^[A-Za-z0-9-]{1,128}$/.test(id) ? `https://chatgpt.com/c/${id}` : ''
  }
}
