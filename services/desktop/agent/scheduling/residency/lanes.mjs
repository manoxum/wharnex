export const CHAT_AGENT_NAVIGATION_GAP_MS = 30_000
export const CHAT_AGENT_AWAIT_PROBE_MS = 30_000

// An Orchestrator task's chat is the task itself (adr/ADR-0081). Every round
// of it shares the task's lane, whatever conversation it names, so the Worker
// pinned to the task serves all of them. The backend claim uses the same rule.
export function orchestratorTaskChat(task = {}) {
  return String(task.chat_id || task.chatId || '').trim().startsWith('otk_')
}

// The lane a task belongs to: its conversation when bound, else its chat.
export function chatAgentLane(task = {}) {
  if (orchestratorTaskChat(task)) return `h:${String(task.chat_id || task.chatId).trim()}`
  const conversation = String(task.conversation_id || task.conversationId || '').trim()
  if (conversation) return `c:${conversation}`
  const chat = String(task.chat_id || task.chatId || '').trim()
  return chat ? `h:${chat}` : ''
}
