export function createPromptQueue(context) {
  const {
    sanitizeChatCacheKey,
    sanitizeSessionId,
    requireAutoSession,
    canonicalChatGPTConversationURL,
    durableWorkspaceChatID,
    shouldAttachProjectContext,
    chatGPTConversationID,
    authoritativeBundleFilename,
    enqueueChatAgentTask,
    refreshChatAgentRuntimeState,
    publishChatAgentRuntimeState,
  } = context

  async function queuePreparedPromptForWorker(request) {
    const rawText = String(request?.text || '').trim()
    if (!rawText) throw new Error('Prepared prompt is empty')
    if (rawText.length > 1024 * 1024) throw new Error('Prepared prompt exceeds 1 MiB limit')
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const requestId = String(request?.requestId || '').trim()
    if (!requestId) throw new Error('Background planner continuation requires a request id')
    const sessionId = sanitizeSessionId(request?.sessionId)
    await requireAutoSession(sessionId)
    const conversationURL = canonicalChatGPTConversationURL(request?.url || '')
    const workspaceChatId = durableWorkspaceChatID(key, request?.workspaceChatId)
    const includedContext = shouldAttachProjectContext({
      currentSha: String(request?.contextSha256 || '').trim(),
      previousSha: String(request?.lastContextSha256 || '').trim(),
      currentConversationId: chatGPTConversationID(conversationURL),
      previousConversationId: chatGPTConversationID(request?.lastContextChatgptUrl || ''),
      force: request?.includeContext === true,
    })
    const expectedFilename = authoritativeBundleFilename(request?.expectedFilename, requestId, key)
    const workerRequest = {
      ...request,
      background: false,
      cacheKey: key,
      workspaceChatId,
      sessionId,
      requestId,
      url: conversationURL,
      autoSubmit: true,
      expectedFilename,
    }
    const queued = await enqueueChatAgentTask('BOT_WRITE', {
      key,
      requestId,
      rootRequestId: requestId,
      conversationURL,
      sessionID: sessionId,
      projectID: String(request?.projectPath || ''),
      dedupeKey: `prepare:${requestId}`,
      payload: { operation: 'PREPARE_PROMPT', request: workerRequest, workspace_chat_id: workspaceChatId },
      maxAttempts: 6,
      notBefore: new Date().toISOString(),
    })
    void refreshChatAgentRuntimeState().then(publishChatAgentRuntimeState).catch(() => undefined)
    console.log(`[chatgpt-worker-write] queued key=${key} request=${requestId} task=${String(queued?.task_id || '-')}`)
    return {
      ok: true,
      cacheKey: key,
      attachmentCount: 1,
      submitted: true,
      queued: true,
      expectedFilename,
      includedContext,
      conversationUrl: conversationURL || undefined,
    }
  }

  return { queuePreparedPromptForWorker }
}
