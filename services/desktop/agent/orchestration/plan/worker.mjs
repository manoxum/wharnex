import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { prepareOrchestratorPlanTask } from './preflight.mjs'
import { submitOrResumeOrchestratorPlan } from './submission.mjs'
import { observeOrchestratorPlan } from './observation.mjs'

export function createOrchestratorPlanWorker(deps) {
  const {
    takeRetainedChatGPTOrchestratorPlan, importRetainedOrchestratorPlan,
    orchestratorContextIncrementPaths, removeStoredChatAttachments,
    chatAttachmentRoot, tempPath, orchestratorRequestFilename,
    expectedChatGPTOrchestratorPlans, reconcileChatGPTThrottleForKey,
    enqueueChatAgentTask, chatAgentConversationID,
  } = deps

  return async function executeChatAgentOrchestratorPlan(task, entry, key, payload, owner, { pacedWorker = true } = {}) {
    const prepared = prepareOrchestratorPlanTask(task, payload, deps)
    if (prepared.failure) return prepared.failure
    const {
      sessionId, requestId, delivery, filename, attachmentCacheKey,
      checkpointURL,
    } = prepared

    // An artifact delivered between attempts is already on disk. Import it
    // before opening a page or spending a provider request.
    const retained = await takeRetainedChatGPTOrchestratorPlan(filename)
    let pendingIncrement
    if (retained) {
      const imported = await importRetainedOrchestratorPlan(sessionId, requestId, delivery, retained)
      if (imported?.status === 'context_increment') {
        pendingIncrement = orchestratorContextIncrementPaths(
          { delivery_status: 'context_increment', context_paths: imported.contextPaths },
          prepared.selectedContextPaths,
        ) || undefined
      }
      if (imported?.status === 'done') {
        if (attachmentCacheKey) await removeStoredChatAttachments(chatAttachmentRoot(), attachmentCacheKey).catch(() => undefined)
        console.log('[orchestrator-worker] imported retained plan task=' + task.task_id + ' request=' + requestId)
        return imported
      }
    }

    const dir = path.join(tempPath(), 'wharness-orchestrator-plans', task.task_id)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    let resolveDownload
    let rejectDownload
    const download = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject })
    download.catch(() => undefined)
    const expected = {
      taskId: task.task_id, key, filename, armedAt: Date.now(),
      resolve: resolveDownload, reject: rejectDownload,
    }
    expectedChatGPTOrchestratorPlans.set(filename, expected)
    reconcileChatGPTThrottleForKey(key, entry)
    const flow = {
      ...prepared, task, entry, key, payload, owner, pacedWorker, dir,
      requestPath: path.join(dir, orchestratorRequestFilename(requestId)),
      expected, download, pendingIncrement, conversationUrl: checkpointURL,
      terminalCleanup: false,
    }
    try {
      const submissionResult = await submitOrResumeOrchestratorPlan(flow, deps)
      if (submissionResult) return submissionResult
      return await observeOrchestratorPlan(flow, deps)
    } finally {
      if (expectedChatGPTOrchestratorPlans.get(filename) === expected) {
        expectedChatGPTOrchestratorPlans.delete(filename)
        reconcileChatGPTThrottleForKey(key, entry)
      }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      const terminalAttempt = flow.terminalCleanup || Number(task.attempt || 0) >= Number(task.max_attempts || 0)
      if (terminalAttempt && attachmentCacheKey) {
        await removeStoredChatAttachments(chatAttachmentRoot(), attachmentCacheKey).catch(() => undefined)
      }
      if (flow.conversationUrl && terminalAttempt) {
        enqueueChatAgentTask('DELETE_TEMP_CHAT', {
          key, requestId, rootRequestId: requestId, conversationURL: flow.conversationUrl,
          parentTaskID: task.task_id,
          dedupeKey: 'delete-orchestrator:' + chatAgentConversationID(flow.conversationUrl),
          payload: {}, maxAttempts: 4,
        }).catch(() => console.warn('[orchestrator-worker] temporary ChatGPT cleanup scheduling failed'))
      }
    }
  }
}
