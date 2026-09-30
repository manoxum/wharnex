import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

export async function sendPlanContextIncrement(flow, deps, paths) {
  const {
    sendOrchestratorContextIncrement, fetchContextZip,
    writeOrchestratorRequestBundle, persistChatArtifact,
    paceChatGPTWorkerSubmission, executeChatGPTDOMScript,
    chatGPTFillComposerScript, pasteChatGPTFile, wait, chatInputSettleDelay,
    chatGPTAssistantTurnCount, submitChatGPTDraft, checkpointChatAgentTask,
    planTimeoutMs,
  } = deps
  const {
    task, key, owner, pacedWorker, expected, target,
    sessionId, requestId, prompt, requestPath, filename, conversationUrl,
  } = flow
  flow.selectedContextPaths = paths
  const sent = await sendOrchestratorContextIncrement({
    fetchContext: () => fetchContextZip(sessionId),
    writeRequest: async (context) => {
      await rm(requestPath, { force: true })
      return writeOrchestratorRequestBundle(requestPath, { requestId, prompt, context, createdAt: task.created_at })
    },
    persistRequest: async () => persistChatArtifact(sessionId, requestId, 'input', 'bundle', path.basename(requestPath), 'application/zip', await readFile(requestPath)),
    warn: (message) => console.warn('[orchestrator-worker] ' + message),
    pace: async () => { if (pacedWorker) await paceChatGPTWorkerSubmission() },
    fill: (bootstrap, label) => executeChatGPTDOMScript(key, target.entry, label, chatGPTFillComposerScript(bootstrap)),
    attach: async () => {
      await pasteChatGPTFile(target.entry, requestPath, 1, 1, { pacedWorker })
      await wait(chatInputSettleDelay((await readFile(requestPath)).byteLength, 1))
    },
    assistantCount: () => chatGPTAssistantTurnCount(target.wc),
    submit: () => submitChatGPTDraft(key, target.entry, conversationUrl, { ...target, conversationUrl }, { requireReasoningEffort: false, rateLimitExempt: !pacedWorker }),
    checkpoint: (values) => checkpointChatAgentTask(task.task_id, owner, { conversation_url: conversationUrl, expected_filename: filename, ...values }),
  }, expected, paths)
  flow.assistantBaseline = sent.assistantBaseline
  flow.download = sent.download
  flow.lastRequestedAt = Date.now()
  flow.deadline = flow.lastRequestedAt + planTimeoutMs
  flow.downloadTriggered = false
}
