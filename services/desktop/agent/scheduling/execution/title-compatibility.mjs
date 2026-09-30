// Durable title tasks from older releases remain consumable without allowing
// them to create another ChatGPT conversation or derive a title from prose.
export function createLegacyTitleTasks({
  canonicalChatGPTConversationURL, chatAgentChildExists,
  enqueueChatAgentTask, chatAgentConversationID,
}) {
  async function executeChatAgentTitleDiscover() {
    // Compatibility sink: accepted planner bundles now own chat naming.
    return { status: 'done' }
  }

  async function executeChatAgentTempTitle() {
    // Compatibility sink: this task must never open a temporary conversation.
    return { status: 'done' }
  }

  async function executeChatAgentTitleAwait(task, entry, key, payload) {
    const tempURL = canonicalChatGPTConversationURL(payload.temp_url || '')
    if (tempURL && !(await chatAgentChildExists(task, 'DELETE_TEMP_CHAT'))) {
      await enqueueChatAgentTask('DELETE_TEMP_CHAT', {
        key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id,
        conversationURL: tempURL, parentTaskID: task.task_id,
        dedupeKey: `delete-temp:${chatAgentConversationID(tempURL)}`,
        payload: { ...payload, target_url: tempURL }, maxAttempts: 8,
      })
    }
    return { status: 'done' }
  }

  return { executeChatAgentTitleDiscover, executeChatAgentTempTitle, executeChatAgentTitleAwait }
}
