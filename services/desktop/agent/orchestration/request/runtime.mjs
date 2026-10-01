export function createOrchestratorRequestTransport({
  pendingChatGPTBundleDeliveries, recentlyDeliveredChatGPTBundleRequestId,
  chatGPTBundleAlreadyValidated, getScheduler, expectedChatGPTBundles,
  sanitizeChatCacheKey, orchestratorConversationGuard,
  executeChatGPTDOMScript, chatGPTSubmittedRequestEvidenceScript,
  chatInputArchiveFilename, armExpectedChatGPTBundle,
  enqueueChatAgentFollowups, disarmExpectedChatGPTBundle,
  clearChatGPTHumanAction, orchestratorRetryInput,
  readStoredAttachment, chatAttachmentRoot, withChatGPTTransportPreparation,
  preparePromptForChatGPT, path,
}) {
  async function orchestratorRequestSupervision(key, requestId) {
    const id = String(requestId || '')
    if (pendingChatGPTBundleDeliveries.has(id) || recentlyDeliveredChatGPTBundleRequestId(id) || chatGPTBundleAlreadyValidated(id)) return { state: 'delivered' }
    // The durable queue decides first; an ATTENTION expectation may remain armed in memory.
    const listed = await getScheduler().list({ request_id: id })
    const tasks = (listed?.tasks || []).filter((item) => ['BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE'].includes(item.type))
    if (tasks.some((item) => ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status))) return { state: 'active' }
    const latest = tasks.filter((item) => item.type === 'AWAIT_RESPONSE').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
    if (latest && latest.status !== 'DONE') return { state: 'ended', error: String(latest.last_error || '').slice(0, 500) }
    if (latest) return { state: 'delivered' }
    // Armed but not yet durable: the submission is still scheduling its supervision.
    if (expectedChatGPTBundles.get(sanitizeChatCacheKey(key))?.requestId === id) return { state: 'active' }
    return { state: 'none' }
  }

  // Adopt only when the exact prior request ZIP is present in the bound conversation.
  async function adoptOrchestratorRequest(key, entry, current, conversationURL, assistantBaseline) {
    await orchestratorConversationGuard.ensureConversation(key, entry, conversationURL)
    const evidence = await executeChatGPTDOMScript(key, entry, 'orchestrator-agent-evidence',
      chatGPTSubmittedRequestEvidenceScript(chatInputArchiveFilename(current.chat_id, current.request_id)))
    if (evidence?.submitted !== true) return false
    const requestMetadata = { chat_id: current.chat_id }
    armExpectedChatGPTBundle(key, current.request_id, assistantBaseline, '', [], current.prompt, current.agent_session_id, current.expected_filename, requestMetadata)
    const supervision = await enqueueChatAgentFollowups(key, current.request_id, conversationURL, {
      expectedFilename: current.expected_filename, assistantBaseline, originalPrompt: current.prompt, sessionId: current.agent_session_id,
      requestMetadata, projectPath: current.task?.project_path || '', requestEligibleAt: new Date().toISOString(),
    })
    const armed = expectedChatGPTBundles.get(sanitizeChatCacheKey(key))
    if (armed?.requestId === current.request_id) armed.mainRequestTaskId = String(supervision?.task_id || '')
    console.log(`[orchestrator-round] adopted key=${key} request=${current.request_id}`)
    return true
  }

  // Send one task Main Request round through the normal chat pipeline.
  async function sendOrchestratorMainRequest(key, entry, current, conversationURL, bindSubmittedConversation) {
    // A resend starts from a clean expectation and clears the prior attention notice.
    if (expectedChatGPTBundles.get(sanitizeChatCacheKey(key))?.requestId === current.request_id) {
      disarmExpectedChatGPTBundle(key, current.request_id)
      clearChatGPTHumanAction(key, 'pedido reenviado pelo Orchestrator')
    }
    const retry = await orchestratorRetryInput(current.task, (ref) => readStoredAttachment(chatAttachmentRoot(), ref))
    const projectPath = String(current.task?.project_path || '')
    const prepared = await withChatGPTTransportPreparation(key, entry, current.request_id, () => preparePromptForChatGPT({
      orchestratorTask: true, bundleChatId: current.chat_id, text: current.prompt, cacheKey: key,
      sessionId: current.agent_session_id, requestId: current.request_id, url: conversationURL, autoSubmit: true,
      expectedFilename: current.expected_filename, reasoningEffort: current.reasoning_effort, includeContext: true,
      attachments: retry.attachments, artifacts: [], projectFiles: retry.projectFiles, projectPath,
      projectName: path.basename(projectPath), chatTitle: String(current.task?.title || ''), requestedAt: new Date().toISOString(),
      ...orchestratorConversationGuard.submissionHooks(conversationURL, bindSubmittedConversation),
    }, entry, { pacedWorker: true }))
    if (!prepared?.submitted || !prepared.conversationUrl) throw new Error('Orchestrator Main Request round was not submitted to ChatGPT')
    console.log(`[orchestrator-round] submitted key=${key} request=${current.request_id} conversation=${prepared.conversationUrl}`)
    return { conversationUrl: prepared.conversationUrl }
  }

  return { orchestratorRequestSupervision, adoptOrchestratorRequest, sendOrchestratorMainRequest }
}
