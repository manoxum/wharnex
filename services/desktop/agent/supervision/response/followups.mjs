export function createChatAgentFollowups({
  canonicalChatGPTConversationURL, authoritativeBundleFilename,
  chatAgentInitialRequestWaitMs, enqueueChatAgentTask,
}) {
  function expectedChatAgentPayload(key, requestId, conversationURL, values = {}) {
    return {
      conversation_url: canonicalChatGPTConversationURL(conversationURL),
      expected_filename: authoritativeBundleFilename(values.expectedFilename, requestId, key),
      assistant_baseline: Math.max(0, Number(values.assistantBaseline || 0)),
      recovery_bootstrap: String(values.recoveryBootstrap || ''), original_prompt: String(values.originalPrompt || ''),
      session_id: String(values.sessionId || ''), live_tunnels: Array.isArray(values.liveTunnels) ? values.liveTunnels.slice(0, 16) : [],
      project_name: String(values.projectName || ''), project_path: String(values.projectPath || ''),
      fallback_title: String(values.fallbackTitle || ''), recovery_count: Math.max(0, Number(values.recoveryCount || 0)),
      workspace_chat_id: String(values.workspaceChatId || ''),
      request_metadata: values.requestMetadata && typeof values.requestMetadata === 'object' ? { ...values.requestMetadata } : {},
      request_eligible_at: String(values.requestEligibleAt || ''),
    }
  }

  async function enqueueChatAgentFollowups(key, requestId, conversationURL, values = {}) {
    const requestEligibleAt = String(values.requestEligibleAt || new Date(Date.now() + chatAgentInitialRequestWaitMs()).toISOString())
    const payload = expectedChatAgentPayload(key, requestId, conversationURL, { ...values, requestEligibleAt })
    // The host project path is canonical; the backend resolves an empty value
    // from the task's own chat or session. This enqueue is the request's durable
    // record and must propagate failure to its caller.
    const common = { key, requestId, rootRequestId: requestId, conversationURL, sessionID: payload.session_id, projectID: payload.project_path, payload, notBefore: requestEligibleAt }
    return enqueueChatAgentTask('AWAIT_RESPONSE', { ...common, dedupeKey: `await:${requestId}`, maxAttempts: 30, retry: true })
  }

  return { expectedChatAgentPayload, enqueueChatAgentFollowups }
}
