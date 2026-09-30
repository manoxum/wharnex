import { readFile, rm } from 'node:fs/promises'
import { sendPlanContextIncrement } from './increment.mjs'

export async function observeOrchestratorPlan(flow, deps) {
  const {
    wait, pollIntervalMs, importOrchestratorPlanArtifact, orchestratorContextIncrementPaths,
    rearmOrchestratorPlanDownload, orchestratorPlanResult,
    executeChatGPTDOMScript, chatGPTHumanActionScript, noteChatGPTRateLimitGate,
    chatAgentRateLimitDelayMs, setChatGPTHumanAction, chatGPTHumanActionMessage,
    chatGPTResponseCompletionScript, chatGPTArtifactExpiredSince,
    chatAgentConversationID, maxBundleContinuations, checkpointChatAgentTask,
    paceChatGPTWorkerSubmission, writeOrchestratorRequestBundle,
    chatGPTFillComposerScript, pasteChatGPTFile, chatInputSettleDelay,
    chatGPTAssistantTurnCount, submitChatGPTDraft, pollWorkerExpectedDownload,
    chatGPTExpectedDownloadScript, generatingGraceMs, observeAgainMs,
    orchestratorCompletionDiagnostic, planTimeoutMs,
  } = deps
  const { task, key, owner, pacedWorker, expected, target, sessionId, requestId, delivery, filename, requestPath, prompt } = flow
  let thinkingObservedAt = 0
  let rerequests = 0
  let lastCompletion
  flow.deadline = Date.now() + planTimeoutMs
  expected.assistantBaseline = flow.assistantBaseline
  flow.downloadTriggered = false
  // Only a 404 observed after this point belongs to this request.
  flow.lastRequestedAt = Date.now()
  if (flow.pendingIncrement) await sendPlanContextIncrement(flow, deps, flow.pendingIncrement)
  while (Date.now() < flow.deadline) {
    const outcome = await Promise.race([
      flow.download.then((value) => ({ done: true, value }), (error) => ({ done: true, error })),
      wait(pollIntervalMs).then(() => ({ done: false })),
    ])
    if (outcome.done) {
      if (outcome.error) throw outcome.error
      const imported = await importOrchestratorPlanArtifact(sessionId, requestId, delivery, outcome.value)
      const increment = orchestratorContextIncrementPaths(imported, flow.selectedContextPaths)
      if (increment) await sendPlanContextIncrement(flow, deps, increment)
      else if (increment === null) flow.download = rearmOrchestratorPlanDownload(expected, flow.assistantBaseline)
      if (increment !== undefined) continue
      flow.terminalCleanup = true
      return orchestratorPlanResult(requestId, imported)
    }
    const health = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-health', chatGPTHumanActionScript())
    if (noteChatGPTRateLimitGate(key, health) && pacedWorker) {
      return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
    }
    if (health?.required === true) {
      const kind = String(health.kind || 'verification')
      setChatGPTHumanAction(key, kind, requestId, 'orchestrator-worker')
      return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(kind) }
    }
    const completion = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-completion', chatGPTResponseCompletionScript(flow.assistantBaseline))
    lastCompletion = completion
    if (completion?.thinking === true) thinkingObservedAt = Date.now()
    // A collected artifact returns 404 without a download event. Re-request
    // the same plan a bounded number of times before clearing its checkpoint.
    if (chatGPTArtifactExpiredSince(chatAgentConversationID(flow.conversationUrl), flow.lastRequestedAt)) {
      if (rerequests >= maxBundleContinuations) {
        await checkpointChatAgentTask(task.task_id, owner, {
          conversation_url: '', expected_filename: '', assistant_baseline: 0,
        }).catch(() => console.warn('[orchestrator-worker] dead checkpoint could not be cleared'))
        throw new Error('ChatGPT no longer serves ' + filename + '; the planning request will start a new conversation')
      }
      rerequests += 1
      flow.lastRequestedAt = Date.now()
      console.warn('[orchestrator-worker] artifact expired task=' + task.task_id + ' request=' + requestId + ' re-request=' + rerequests)
      if (pacedWorker) await paceChatGPTWorkerSubmission()
      await rm(requestPath, { force: true })
      const redelivery = await writeOrchestratorRequestBundle(requestPath, {
        requestId, prompt, redelivery: true, createdAt: task.created_at,
      })
      const refilled = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-refill-composer', chatGPTFillComposerScript(redelivery.bootstrap))
      if (!refilled) throw new Error('ChatGPT orchestrator composer could not be populated for the re-request')
      await pasteChatGPTFile(target.entry, requestPath, 1, 1, { pacedWorker })
      await wait(chatInputSettleDelay((await readFile(requestPath)).byteLength, 1))
      await executeChatGPTDOMScript(key, target.entry, 'orchestrator-redelivery-refill', chatGPTFillComposerScript(redelivery.bootstrap))
      flow.assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
      await submitChatGPTDraft(key, target.entry, flow.conversationUrl, { ...target, conversationUrl: flow.conversationUrl }, { requireReasoningEffort: false, rateLimitExempt: !pacedWorker })
      expected.assistantBaseline = flow.assistantBaseline
      expected.lastClickAt = 0
      flow.downloadTriggered = false
      continue
    }
    const clickMode = await pollWorkerExpectedDownload(expected,
      (script) => executeChatGPTDOMScript(key, target.entry, 'orchestrator-download', script), chatGPTExpectedDownloadScript)
    if (clickMode) flow.downloadTriggered = true
  }
  // Generating is a passive observation; a long plan must not spend an attempt.
  if (thinkingObservedAt && Date.now() - thinkingObservedAt < generatingGraceMs) {
    return {
      status: 'waiting', observation: true, liveBundlePending: true, delayMs: observeAgainMs,
      error: 'ChatGPT is still producing ' + filename,
    }
  }
  console.warn('[orchestrator-worker] response deadline task=' + task.task_id + ' request=' + requestId + ' structure=' + JSON.stringify(orchestratorCompletionDiagnostic(lastCompletion, flow.assistantBaseline, flow.downloadTriggered)))
  throw new Error('ChatGPT did not provide ' + filename + ' before the orchestrator planning timeout')
}
