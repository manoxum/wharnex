// A retry must first prove whether this exact input ZIP is already in a user
// turn. Upload/network records alone cannot authorize response supervision.
export async function adoptSubmittedPrompt(context, { key, target, requestId, sessionId, workspaceChatId, input, bootstrap, expectedFilename, originalPrompt, request }) {
  const { executeChatGPTDOMScript, chatGPTSubmittedRequestEvidenceScript, armExpectedChatGPTBundle,
    disarmExpectedChatGPTBundle, enqueueChatAgentFollowups, expectedChatGPTBundles, persistWorkspaceChatRemoteBestEffort } = context
  const parts = input.parts || [{ name: input.archiveName }]
  if (!parts.length || parts.some((file) => !file.name)) return undefined
  for (const file of parts) {
    const evidence = await executeChatGPTDOMScript(key, target.entry, 'submitted-input-evidence', chatGPTSubmittedRequestEvidenceScript(file.name))
    if (evidence?.submitted !== true) return undefined
  }
  const conversationUrl = target.conversationUrl
  if (!conversationUrl) return undefined
  // Counts may shrink after reload. Exact filename capture remains authoritative;
  // adoption never interprets historical answer text as the current response.
  const assistantBaseline = 0
  armExpectedChatGPTBundle(key, requestId, assistantBaseline, bootstrap, [], originalPrompt, sessionId, expectedFilename, input.requestMetadata)
  let task
  try { task = await enqueueChatAgentFollowups(key, requestId, conversationUrl, {
    expectedFilename, assistantBaseline, recoveryBootstrap: bootstrap, originalPrompt,
    sessionId, liveTunnels: [], requestMetadata: input.requestMetadata,
    projectName: request?.projectName || '', projectPath: request?.projectPath || '', workspaceChatId,
  }) } catch (error) { disarmExpectedChatGPTBundle(key, requestId); throw error }
  const expected = expectedChatGPTBundles.get(key)
  if (expected?.requestId === requestId) { expected.mainRequestTaskId = String(task?.task_id || ''); expected.rehydrating = true }
  if (workspaceChatId) await persistWorkspaceChatRemoteBestEffort(workspaceChatId, conversationUrl, { remoteState: 'awaiting-response' })
  console.log(`[chatgpt-submit] adopted key=${key} request=${requestId}; exact input already submitted`)
  return { ok: true, cacheKey: key, attachmentCount: input.uploadPaths.length, submitted: true, adopted: true, expectedFilename, conversationUrl }
}
