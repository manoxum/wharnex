import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function submitOrResumeOrchestratorPlan(flow, deps) {
  const {
    requireOwnedChatGPTEntry, sameConversationURL, loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady, normalizeChatGPTReasoningEffort,
    chatGPTAssistantTurnCount, sanitizeDiagnosticURL, paceChatGPTWorkerSubmission,
    chatAgentRateLimitDelayMs, targetChatGPTComposer, fetchContextZip,
    storedAttachmentPath, chatAttachmentRoot, writeOrchestratorRequestBundle,
    persistChatArtifact, executeChatGPTDOMScript, chatGPTFillComposerScript,
    pasteChatGPTFile, wait, chatInputSettleDelay, submitChatGPTDraft,
    waitForSubmittedChatGPTConversation, checkpointChatAgentTask, homeURL,
  } = deps
  const {
    task, entry, key, payload, owner, pacedWorker, checkpointURL, checkpointBaseline,
    sessionId, requestId, prompt, includeContext, contextMode, attachments,
    generatedAttachments, requestPath, filename,
  } = flow
  if (checkpointURL) {
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    if (!sameConversationURL(wc.getURL(), checkpointURL)) await loadOwnedChatGPTURL(key, entry, checkpointURL, 'orchestrator-checkpoint')
    await waitForChatGPTSurfaceReady(key, entry)
    flow.target = { entry, wc, reasoningEffort: normalizeChatGPTReasoningEffort(payload.reasoning_effort) }
    flow.assistantBaseline = Number.isFinite(checkpointBaseline) && checkpointBaseline >= 0
      ? checkpointBaseline : await chatGPTAssistantTurnCount(wc)
    console.log('[orchestrator-worker] resumed task=' + task.task_id + ' request=' + requestId + ' conversation=' + sanitizeDiagnosticURL(checkpointURL))
    return undefined
  }
  if (pacedWorker) await paceChatGPTWorkerSubmission()
  const rateLimitDelay = pacedWorker ? chatAgentRateLimitDelayMs() : 0
  if (rateLimitDelay > 0) {
    return { status: 'waiting', delayMs: rateLimitDelay, observation: true, error: 'ChatGPT rate-limit cooldown is active' }
  }
  const target = await targetChatGPTComposer(key, homeURL, false, entry)
  flow.target = target
  target.reasoningEffort = normalizeChatGPTReasoningEffort(payload.reasoning_effort)
  if (flow.pendingIncrement) [flow.selectedContextPaths, flow.pendingIncrement] = [flow.pendingIncrement, undefined]
  const capturedContext = includeContext ? await fetchContextZip(sessionId) : undefined
  const contextBytes = contextMode === 'full' ? capturedContext?.bytes : undefined
  const requestAttachments = []
  for (const attachment of attachments) {
    const filePath = await storedAttachmentPath(chatAttachmentRoot(), String(attachment?.storage_ref || ''))
    requestAttachments.push({ name: attachment.name, path: filePath })
  }
  let generatedAttachmentBytes = 0
  for (const attachment of generatedAttachments) {
    const name = String(attachment?.name || '').trim()
    const content = String(attachment?.content || '')
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(name) || name === '.' || name === '..' || !content) {
      throw new Error('orchestrator generated attachment is invalid')
    }
    const bytes = Buffer.from(content, 'utf8')
    generatedAttachmentBytes += bytes.byteLength
    if (bytes.byteLength > 2 * 1024 * 1024 || generatedAttachmentBytes > 2 * 1024 * 1024) {
      throw new Error('orchestrator generated attachment is too large')
    }
    requestAttachments.push({ name, bytes })
  }
  const request = await writeOrchestratorRequestBundle(requestPath, {
    requestId, prompt, contextBytes,
    context: contextMode === 'partial' && capturedContext
      ? { ...capturedContext, mode: 'partial', paths: flow.selectedContextPaths } : undefined,
    attachments: requestAttachments, createdAt: task.created_at,
  })
  await persistChatArtifact(sessionId, requestId, 'input', 'bundle', path.basename(requestPath), 'application/zip', await readFile(requestPath))
    .catch(() => console.warn('[orchestrator-worker] request bundle could not be persisted request=' + requestId))
  const filled = await executeChatGPTDOMScript(key, target.entry, 'orchestrator-fill-composer', chatGPTFillComposerScript(request.bootstrap))
  if (!filled) throw new Error('ChatGPT orchestrator composer could not be populated')
  await pasteChatGPTFile(target.entry, requestPath, 1, 1, { pacedWorker })
  await wait(chatInputSettleDelay((await readFile(requestPath)).byteLength, 1))
  await executeChatGPTDOMScript(key, target.entry, 'orchestrator-refill-composer', chatGPTFillComposerScript(request.bootstrap))
  flow.assistantBaseline = await chatGPTAssistantTurnCount(target.wc)
  await submitChatGPTDraft(key, target.entry, target.conversationUrl, target, { requireReasoningEffort: false, rateLimitExempt: !pacedWorker })
  flow.conversationUrl = await waitForSubmittedChatGPTConversation(key, target.entry, target.conversationUrl)
  if (!flow.conversationUrl) throw new Error('ChatGPT orchestrator submission has no stable conversation id')
  await checkpointChatAgentTask(task.task_id, owner, {
    conversation_url: flow.conversationUrl,
    expected_filename: filename,
    assistant_baseline: flow.assistantBaseline,
    submitted_at: new Date().toISOString(),
  })
  console.log('[orchestrator-worker] checkpointed task=' + task.task_id + ' request=' + requestId + ' conversation=' + sanitizeDiagnosticURL(flow.conversationUrl))
  return undefined
}
