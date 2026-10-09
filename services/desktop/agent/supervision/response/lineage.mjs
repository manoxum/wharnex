import { restoredContinuationCount } from '../../scheduling/queue/index.mjs'

export function createResponseLineage({
  getScheduler, expectedChatGPTBundles, armExpectedChatGPTBundle,
  MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, chatGPTProcessingDurationScript,
  CHATGPT_BEHAVIOR, chatGPTBundleAlreadyValidated,
  disarmExpectedChatGPTBundle, BUNDLE_CONTINUATION_BASE_MS,
  enqueueChatAgentTask, CHAT_AGENT_AWAIT_PROBE_MS = 30_000,
}) {
  function recordChatGPTTaskEvent(expected, type, data = {}) {
    const taskId = String(expected?.mainRequestTaskId || '')
    const scheduler = getScheduler()
    if (!taskId || !scheduler) return
    void scheduler.recordTaskEvent(taskId, type, data, { requestId: expected?.requestId || '', rootRequestId: expected?.requestId || '' })
  }

  async function hydrateExpectedChatAgentBundle(key, task, payload) {
    const requestId = String(task?.request_id || '')
    let expected = expectedChatGPTBundles.get(key)
    let recoveryCount = Math.max(0, Number(payload.recovery_count || 0))
    if (expected?.requestId !== requestId) {
      const initialExpected = expected
      const scheduler = getScheduler()
      let tasks = [task]
      try { tasks = (await scheduler.list({ request_id: requestId }))?.tasks || tasks }
      catch { console.warn('[chat-agent] task history unavailable; cold response restoration remains passive') }
      recoveryCount = await restoredContinuationCount(scheduler, tasks, key, requestId, { continuationCount: recoveryCount })
      expected = expectedChatGPTBundles.get(key)
      if (expected?.requestId !== requestId) {
        if (expected !== initialExpected) throw new Error('ChatGPT request changed during response restoration')
        armExpectedChatGPTBundle(key, requestId, payload.assistant_baseline, payload.recovery_bootstrap, payload.live_tunnels || [], payload.original_prompt || '', payload.session_id || task?.session_id || '', payload.expected_filename || '', payload.request_metadata || {})
        expected = expectedChatGPTBundles.get(key)
        expected.rehydrating = true
      }
    }
    if (payload.observation_only === true) expected.rehydrating = true
    expected.continuationCount = Math.max(Number(expected.continuationCount || 0), recoveryCount)
    expected.automaticContinuationSent = expected.automaticContinuationSent === true || expected.continuationCount >= MAX_AUTOMATIC_BUNDLE_CONTINUATIONS
    if (task?.task_id && !expected.mainRequestTaskId) expected.mainRequestTaskId = String(task.task_id)
    return expected
  }

  async function chatAgentChildExists(task, type) {
    const listed = await getScheduler().list({ request_id: task.request_id })
    return (listed?.tasks || []).some((item) => item.type === type && item.parent_task_id === task.task_id && item.status !== 'FAILED' && item.status !== 'CANCELLED')
  }

  async function captureChatGPTProcessingDuration(entry, expected) {
    if (!entry || !expected || Number(expected.processingDurationMs || 0) > 0) return Number(expected?.processingDurationMs || 0)
    try {
      const result = await entry.view.webContents.executeJavaScript(
        chatGPTProcessingDurationScript(CHATGPT_BEHAVIOR.labels.reasoningDisclosure, expected.assistantBaseline), true)
      if (result?.matched === true && Number(result.durationMs) > 0) expected.processingDurationMs = Number(result.durationMs)
    } catch (error) {
      console.warn(`[chat-agent] processing-duration probe failed request=${expected.requestId || '-'} error=${error instanceof Error ? error.message : String(error)}`)
    }
    return Number(expected.processingDurationMs || 0)
  }

  async function enqueueChatAgentContinuation(task, key, expected, payload, conversationURL, now, reason) {
    if (chatGPTBundleAlreadyValidated(expected.requestId)) {
      disarmExpectedChatGPTBundle(key, expected.requestId)
      return { status: 'done' }
    }
    if (expected.rehydrating === true) return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
    const recoveryCount = Math.max(0, Number(payload.recovery_count || 0))
    if (expected.automaticContinuationSent === true || recoveryCount >= MAX_AUTOMATIC_BUNDLE_CONTINUATIONS) {
      return { status: 'attention', error: `ChatGPT interrompeu a resposta sem disponibilizar ${expected.filename} depois do wake-up automático único.` }
    }
    const continuationDelay = Math.min(30_000, BUNDLE_CONTINUATION_BASE_MS + recoveryCount * 3_000)
    if (expected.lastContinuationAt && now - expected.lastContinuationAt < continuationDelay) {
      return { status: 'waiting', delayMs: continuationDelay, observation: true }
    }
    if (!(await chatAgentChildExists(task, 'RECOVERY_WRITE'))) {
      await enqueueChatAgentTask('RECOVERY_WRITE', {
        key, requestId: expected.requestId, rootRequestId: task.root_request_id || expected.requestId,
        conversationURL, parentTaskID: task.task_id, sessionID: expected.sessionId, maxAttempts: 6,
        payload: { ...payload, operation: 'CONTINUE_REQUEST', continuation_reason: reason, recovery_count: recoveryCount + 1, expected_filename: expected.filename },
      })
      expected.lastContinuationAt = now
      expected.invalidBundleCount = 0
    }
    return { status: 'done' }
  }

  return {
    recordChatGPTTaskEvent, hydrateExpectedChatAgentBundle,
    chatAgentChildExists, captureChatGPTProcessingDuration,
    enqueueChatAgentContinuation,
  }
}
