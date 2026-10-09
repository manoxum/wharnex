export function createAgentWrite({
  paceChatGPTWorkerSubmission, chatAgentRateLimitDelayMs, sanitizeSessionId,
  canonicalChatGPTConversationURL, durableWorkspaceChatID,
  withChatGPTTransportPreparation, preparePromptForChatGPT,
  chatGPTBundleAlreadyValidated, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
  chatGPTDeliveryContinuationPrompt, sameConversationURL,
  submitChatGPTContinuation, submitPromptToChatGPT, expectedChatGPTBundles,
  recordChatGPTContinuationSent, persistWorkspaceChatRemoteBestEffort,
  expectedChatAgentPayload, enqueueChatAgentTask, chatAgentInitialRequestWaitMs,
}) {
  async function executeChatAgentWrite(task, entry, key, payload, conversationURL, { pacedWorker = true } = {}) {
    if (pacedWorker) await paceChatGPTWorkerSubmission()
    // The cooldown may have opened while this submission waited its turn in the
    // queue above; submitting into an active provider pause is the one thing that
    // reliably escalates it to the next level.
    const rateLimitDelay = pacedWorker ? chatAgentRateLimitDelayMs() : 0
    if (rateLimitDelay > 0) return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
    if (payload.operation === 'PREPARE_PROMPT') {
      const requested = payload.request && typeof payload.request === 'object' ? payload.request : {}
      const sessionId = sanitizeSessionId(task.session_id || requested.sessionId)
      const requestId = String(task.request_id || requested.requestId || '').trim()
      const targetURL = conversationURL || canonicalChatGPTConversationURL(requested.url || '')
      const workspaceChatId = durableWorkspaceChatID(key, payload.workspace_chat_id || requested.workspaceChatId)
      const safeRequest = {
        ...requested,
        background: false,
        cacheKey: key,
        workspaceChatId,
        sessionId,
        requestId,
        url: targetURL,
        autoSubmit: true,
      }
      const prepared = await withChatGPTTransportPreparation(key, entry, requestId, () => preparePromptForChatGPT(safeRequest, entry, { pacedWorker }))
      return { status: 'done', payload: { operation: 'PREPARE_PROMPT', conversation_url: prepared.conversationUrl || targetURL, expected_filename: prepared.expectedFilename } }
    }
    const continuationOnly = payload.operation === 'CONTINUE_REQUEST'
    if (continuationOnly && chatGPTBundleAlreadyValidated(task.request_id)) return { status: 'done' }
    if (continuationOnly && Number(payload.recovery_count || 0) > MAX_AUTOMATIC_BUNDLE_CONTINUATIONS) return { status: 'done' }
    const prompt = continuationOnly ? chatGPTDeliveryContinuationPrompt() : String(payload.prompt || payload.original_prompt || '').trim()
    if (!prompt) return { status: 'failed', error: 'chat-agent write payload is empty' }
    const result = await withChatGPTTransportPreparation(key, entry, task.request_id, () => {
      if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) {
        throw new Error('worker conversation changed before submit/upload')
      }
      return continuationOnly
        ? submitChatGPTContinuation(key, conversationURL, task.request_id, entry)
        : submitPromptToChatGPT(key, prompt, conversationURL, task.request_id, payload.session_id || task.session_id || '', entry)
    })
    if (continuationOnly) {
      if (result?.skipped) return { status: 'done' }
      const expected = expectedChatGPTBundles.get(key)
      if (expected?.requestId === String(task.request_id)) {
        expected.automaticContinuationSent = true
        expected.continuationCount = Math.max(Number(expected.continuationCount || 0), MAX_AUTOMATIC_BUNDLE_CONTINUATIONS)
        expected.lastContinuationAt = Date.now()
        expected.invalidBundleCount = 0
        if (expected.recovery) expected.recovery.completionContinued = true
        recordChatGPTContinuationSent(expected, 'automatic', String(payload.continuation_reason || 'worker_recovery'))
      }
    }
    const workspaceChatId = durableWorkspaceChatID(key, payload.workspace_chat_id)
    if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, result.conversationUrl, { remoteState: 'awaiting-response' })
    const nextPayload = expectedChatAgentPayload(key, task.request_id, result.conversationUrl, {
      expectedFilename: result.expectedFilename, assistantBaseline: result.assistantBaseline, recoveryBootstrap: result.recoveryBootstrap,
      originalPrompt: result.originalPrompt || payload.original_prompt || prompt, sessionId: payload.session_id || task.session_id || '', liveTunnels: result.liveTunnels || payload.live_tunnels || [],
      requestMetadata: result.requestMetadata || payload.request_metadata || {},
      projectName: payload.project_name || '', projectPath: payload.project_path || '', fallbackTitle: payload.fallback_title || '', recoveryCount: payload.recovery_count || 0, requestEligibleAt: payload.request_eligible_at || '', workspaceChatId,
    })
    try {
      const successor = await enqueueChatAgentTask('AWAIT_RESPONSE', {
        key, requestId: task.request_id, rootRequestId: task.root_request_id || task.request_id, conversationURL: result.conversationUrl,
        parentTaskID: task.task_id, dedupeKey: `await:${task.request_id}`, payload: nextPayload, maxAttempts: 30, sessionID: nextPayload.session_id,
        // A submission that was just accepted has not started rendering yet, so a
        // probe running in the same second reads the turn *before* it — a static,
        // complete-looking page — and can conclude the response finished without
        // delivering before the model has written a word. Measured: a recovery
        // write at 12:42:56 reached ATTENTION at 12:43:17, 21 seconds later.
        notBefore: new Date(Date.now() + chatAgentInitialRequestWaitMs()).toISOString(),
      })
      const expected = expectedChatGPTBundles.get(key)
      if (expected?.requestId === String(task.request_id) && successor?.task_id) expected.mainRequestTaskId = String(successor.task_id)
    } catch (error) {
      return { status: 'attention', error: `ChatGPT accepted request ${task.request_id}, but response supervision could not be scheduled: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { status: 'done' }
  }

  return { executeChatAgentWrite }
}
