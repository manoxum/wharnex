export function createPreparedPromptSubmission(context) {
  const {
    sanitizeChatCacheKey,
    preparedChatGPTDrafts,
    activateChatGPTView,
    requireOwnedChatGPTEntry,
    chatGPTAssistantTurnCount,
    authoritativeBundleFilename,
    normalizeChatGPTReasoningEffort,
    submitChatGPTDraft,
    waitForSubmittedChatGPTConversation,
    armExpectedChatGPTBundle,
    durableWorkspaceChatID,
    persistWorkspaceChatRemoteBestEffort,
    enqueueChatAgentFollowups,
    expectedChatGPTBundles,
    disarmExpectedChatGPTBundle,
    touchChatGPTEntry,
  } = context

  async function submitPreparedChatGPTDraft(cacheKey, entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    const prepared = preparedChatGPTDrafts.get(key)
    if (!prepared || Date.now() - prepared.preparedAt > 10 * 60 * 1000) throw new Error('No recent prepared ChatGPT draft exists for this chat')
    const entry = entryOverride || activateChatGPTView(key)
    requireOwnedChatGPTEntry(key, entry)
    const assistantBaseline = await chatGPTAssistantTurnCount(entry.view.webContents)
    const expectedFilename = authoritativeBundleFilename(prepared.expectedFilename, prepared.requestId, key)
    entry.reasoningEffort = normalizeChatGPTReasoningEffort(prepared.reasoningEffort)
    const submission = await submitChatGPTDraft(key, entry, prepared.conversationUrl || entry.affinity.boundURL)
    if (!submission.accepted && !submission.dispatched) throw new Error('ChatGPT prompt submission was not dispatched')
    const conversationUrl = await waitForSubmittedChatGPTConversation(key, entry)
    if (!conversationUrl) throw new Error('ChatGPT submission was confirmed without a stable conversation id')
    armExpectedChatGPTBundle(key, prepared.requestId, assistantBaseline, prepared.recoveryBootstrap, prepared.liveTunnels || [], prepared.originalPrompt || '', prepared.sessionId || '', expectedFilename, prepared.requestMetadata || {})
    const workspaceChatId = durableWorkspaceChatID(key, prepared.workspaceChatId)
    if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversationUrl, { remoteState: 'awaiting-response' })
    try {
      const mainRequestTask = await enqueueChatAgentFollowups(key, prepared.requestId, conversationUrl, {
        expectedFilename, assistantBaseline, recoveryBootstrap: prepared.recoveryBootstrap,
        originalPrompt: prepared.originalPrompt || '', sessionId: prepared.sessionId || '', liveTunnels: prepared.liveTunnels || [],
        requestMetadata: prepared.requestMetadata || {},
        projectName: prepared.projectName || '', projectPath: prepared.projectPath || '', fallbackTitle: prepared.chatTitle || '', workspaceChatId,
      })
      const armed = expectedChatGPTBundles.get(key)
      if (armed?.requestId === prepared.requestId) armed.mainRequestTaskId = String(mainRequestTask?.task_id || '')
    } catch (error) {
      // See attachPromptToChatGPT's autoSubmit path: every retry already ran,
      // so a Main Request with no durable AWAIT_RESPONSE task must not be left
      // as a live in-memory expectation nobody will recover after a restart.
      disarmExpectedChatGPTBundle(key, prepared.requestId)
      console.error(`[chatgpt-supervision] submitted request ${prepared.requestId} but durable follow-up scheduling failed after retries: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error(`Não foi possível registar de forma durável o pedido ${prepared.requestId}: ${error instanceof Error ? error.message : String(error)}`)
    }
    preparedChatGPTDrafts.delete(key)
    touchChatGPTEntry(entry)
    return { ok: true, cacheKey: key, expectedFilename, conversationUrl, scheduled: true }
  }

  return { submitPreparedChatGPTDraft }
}
